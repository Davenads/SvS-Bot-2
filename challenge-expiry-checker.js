// challenge-expiry-checker.js
require('dotenv').config();
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const redisClient = require('./redis-client');
const { logError } = require('./logger');

// Initialize the Google Sheets API client
const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  )
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';
const sheetId = 0; // Numeric sheetId for 'SvS Ladder' tab
const CHALLENGES_CHANNEL_ID = '1330563945341390959';
const DEFAULT_TIMEZONE = 'America/New_York';

// Emoji maps for spec and element indicators
const specEmojiMap = {
  Vita: '❤️',
  ES: '🟠'
};

const elementEmojiMap = {
  Fire: '🔥',
  Light: '⚡',
  Cold: '❄️'
};

/**
 * Checks all active challenges and handles:
 * 1. Sending 24-hour warnings for challenges approaching expiration
 * 2. Auto-nullifying challenges that have expired
 */
async function checkChallengeExpirations(client) {
  console.log('\n[CHALLENGE EXPIRY CHECKER] Starting challenge expiration check...');
  
  try {
    // Get all active challenges from Redis
    const activeChallenges = await redisClient.getAllChallenges();
    console.log(`Found ${activeChallenges.length} active challenges in Redis`);
    
    if (activeChallenges.length === 0) {
      console.log('No active challenges to check. Exiting.');
      return;
    }

    // Fetch current data from Google Sheets for verification
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:K`
    });
    
    const rows = sheetData.data.values || [];
    if (!rows.length) {
      console.log('No data found in Google Sheets. Exiting.');
      return;
    }

    const challengesChannel = await client.channels.fetch(CHALLENGES_CHANNEL_ID);
    if (!challengesChannel) {
      console.error('Could not find challenges channel!');
      return;
    }

    // Process each active challenge
    for (const challenge of activeChallenges) {
      const { player1, player2, remainingTime, warningNotificationSent } = challenge;
      console.log(`Processing challenge between ${player1.name} and ${player2.name} - Remaining time: ${remainingTime}s`);

      // Verify both players are still in a challenge according to the sheet
      const player1Row = rows.find(row => row[8] === player1.discordId && row[3] === player1.element);
      const player2Row = rows.find(row => row[8] === player2.discordId && row[3] === player2.element);

      if (!player1Row || !player2Row) {
        console.log(`One or both players not found in sheet. Removing challenge from Redis.`);
        await redisClient.removeChallenge(player1, player2);
        continue;
      }
      
      // Verify both players are still in challenge status with each other
      const player1Status = player1Row[5];
      const player2Status = player2Row[5];
      const player1Opponent = player1Row[7];
      const player2Opponent = player2Row[7];
      const player1Rank = player1Row[0];
      const player2Rank = player2Row[0];

      if (
        player1Status !== 'Challenge' ||
        player2Status !== 'Challenge' ||
        player1Opponent !== player2Rank.toString() ||
        player2Opponent !== player1Rank.toString()
      ) {
        console.log(`Challenge state mismatch between Redis and Google Sheets. Removing from Redis tracking.`);
        await redisClient.removeChallenge(player1, player2);
        continue;
      }
      
      // Challenge is valid - proceed with time checks
      
      // Check if challenge is approaching expiration (24-hour mark) and warning not sent yet
      const ONE_DAY_IN_SECONDS = 24 * 60 * 60;
      
      if (remainingTime <= ONE_DAY_IN_SECONDS && !warningNotificationSent) {
        console.log(`Challenge between ${player1.name} and ${player2.name} will expire in less than 24 hours`);

        // Try to acquire a lock to prevent duplicate warnings
        const canSendWarning = await redisClient.markChallengeWarningAsSent(player1, player2);

        if (canSendWarning) {
          // Send warning message
          await challengesChannel.send(`⚠️ **CHALLENGE EXPIRING SOON** ⚠️\n\n<@${player1.discordId}> and <@${player2.discordId}>, your challenge will automatically expire in less than 24 hours! Please complete your match or ask an SvS Manager to extend the challenge.`);
          console.log('Warning notification sent and marked in Redis');
        } else {
          console.log(`Warning already sent for challenge between ${player1.name} and ${player2.name}, skipping duplicate`);
        }
      }
      
      // Check if challenge has expired
      if (remainingTime <= 0) {
        console.log(`Challenge between ${player1.name} and ${player2.name} has expired. Processing auto-nullification...`);

        // Build requests to update Google Sheet
        const requests = [];
        const processedChallenges = [];

        // Find row indices
        const player1RowIndex = rows.findIndex(row => row[8] === player1.discordId && row[3] === player1.element);
        const player2RowIndex = rows.findIndex(row => row[8] === player2.discordId && row[3] === player2.element);
        
        if (player1RowIndex !== -1 && player2RowIndex !== -1) {
          // Update player1's row
          requests.push({
            updateCells: {
              range: {
                sheetId: sheetId,
                startRowIndex: player1RowIndex + 1,
                endRowIndex: player1RowIndex + 2,
                startColumnIndex: 5, // Column F (Status)
                endColumnIndex: 8 // Through Column H (Opp#)
              },
              rows: [{
                values: [
                  { userEnteredValue: { stringValue: 'Available' } },
                  { userEnteredValue: { stringValue: '' } },
                  { userEnteredValue: { stringValue: '' } }
                ]
              }],
              fields: 'userEnteredValue'
            }
          });
          
          // Update player2's row
          requests.push({
            updateCells: {
              range: {
                sheetId: sheetId,
                startRowIndex: player2RowIndex + 1,
                endRowIndex: player2RowIndex + 2,
                startColumnIndex: 5, // Column F (Status)
                endColumnIndex: 8 // Through Column H (Opp#)
              },
              rows: [{
                values: [
                  { userEnteredValue: { stringValue: 'Available' } },
                  { userEnteredValue: { stringValue: '' } },
                  { userEnteredValue: { stringValue: '' } }
                ]
              }],
              fields: 'userEnteredValue'
            }
          });
          
          // Store challenge details for embed
          processedChallenges.push({
            player1: {
              name: player1Row[1],
              rank: player1Row[0],
              discordId: player1.discordId,
              element: player1.element,
              spec: player1Row[2]
            },
            player2: {
              name: player2Row[1],
              rank: player2Row[0],
              discordId: player2.discordId,
              element: player2.element,
              spec: player2Row[2]
            },
            challengeDate: player1Row[6]
          });
          
          // Execute the updates
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests }
          });
          
          console.log(`Google Sheet updated for expired challenge: ${player1.name} vs ${player2.name}`);

          // Create and send embed for nullified challenge
          const embed = new EmbedBuilder()
            .setTitle('⏰ Challenge Expired - Auto-Nullified ⏰')
            .setDescription(`The challenge has expired after reaching the 3-day time limit.`)
            .setColor(0xFF5733)
            .addFields(
              {
                name: 'Player 1',
                value: `Rank #${player1Row[0]} (<@${player1.discordId}>)
${specEmojiMap[player1Row[2]] || ''} ${elementEmojiMap[player1.element] || ''}`,
                inline: true
              },
              {
                name: '​',
                value: 'VS',
                inline: true
              },
              {
                name: 'Player 2',
                value: `Rank #${player2Row[0]} (<@${player2.discordId}>)
${specEmojiMap[player2Row[2]] || ''} ${elementEmojiMap[player2.element] || ''}`,
                inline: true
              },
              {
                name: 'Challenge Details',
                value: `Challenge Date: ${player1Row[6]}\nExpired: ${moment().tz(DEFAULT_TIMEZONE).format('M/D, h:mm A z')}`
              }
            )
            .setFooter({
              text: 'Both players are now available for new challenges',
            })
            .setTimestamp();

          await challengesChannel.send({ embeds: [embed] });
          console.log('Auto-nullification embed sent to challenges channel');

          // Remove from Redis tracking
          await redisClient.removeChallenge(player1, player2);
          console.log('Challenge removed from Redis tracking');
        } else {
          console.log(`Could not find one or both players in sheet. Removing from Redis.`);
          await redisClient.removeChallenge(player1, player2);
        }
      }
    }
    
    console.log('[CHALLENGE EXPIRY CHECKER] Challenge expiration check completed');
    
  } catch (error) {
    console.error('[CHALLENGE EXPIRY CHECKER] Error processing challenge expirations:', error);
    logError(`Challenge expiry checker error: ${error.message}\nStack: ${error.stack}`);
  }
}

module.exports = { checkChallengeExpirations };