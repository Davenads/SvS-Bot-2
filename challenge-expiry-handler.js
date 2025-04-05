// challenge-expiry-handler.js
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
 * Initialize the challenge expiry handler, setting up event listeners
 * @param {Object} client - Discord.js client
 */
function initializeChallengeExpiryHandler(client) {
  console.log('[CHALLENGE EXPIRY HANDLER] Initializing event-driven challenge expiry handler...');
  
  // Handle challenge warnings (24 hours before expiration)
  redisClient.on('challengeWarning', async (challengeKey) => {
    console.log(`[CHALLENGE EXPIRY HANDLER] Received warning event for ${challengeKey}`);
    try {
      await handleChallengeWarning(client, challengeKey);
    } catch (error) {
      console.error(`[CHALLENGE EXPIRY HANDLER] Error processing challenge warning: ${error.message}`);
      logError(`Challenge warning handler error: ${error.message}\nStack: ${error.stack}`);
    }
  });
  
  // Handle challenge expirations
  redisClient.on('challengeExpired', async (challengeKey) => {
    console.log(`[CHALLENGE EXPIRY HANDLER] Received expiration event for ${challengeKey}`);
    try {
      await handleChallengeExpiration(client, challengeKey);
    } catch (error) {
      console.error(`[CHALLENGE EXPIRY HANDLER] Error processing challenge expiration: ${error.message}`);
      logError(`Challenge expiration handler error: ${error.message}\nStack: ${error.stack}`);
    }
  });
  
  console.log('[CHALLENGE EXPIRY HANDLER] Event handlers initialized successfully');
}

/**
 * Handle a challenge warning event (24 hours before expiration)
 * @param {Object} client - Discord.js client
 * @param {string} challengeKey - Redis key for the challenge
 */
async function handleChallengeWarning(client, challengeKey) {
  // Extract player ranks from the key
  const ranksPart = challengeKey.substring(10); // Remove 'challenge:' prefix
  const [rank1, rank2] = ranksPart.split('-').map(Number);
  
  console.log(`[CHALLENGE EXPIRY HANDLER] Processing warning for challenge between ranks ${rank1} and ${rank2}`);
  
  try {
    // Get challenge data from Redis
    const challengeData = await redisClient.client.get(challengeKey);
    if (!challengeData) {
      console.log(`Challenge ${challengeKey} no longer exists in Redis`);
      return;
    }
    
    const parsedData = JSON.parse(challengeData);
    const { player1, player2 } = parsedData;
    
    // Fetch the challenges channel
    const challengesChannel = await client.channels.fetch(CHALLENGES_CHANNEL_ID);
    if (!challengesChannel) {
      console.error('Could not find challenges channel!');
      return;
    }
    
    // Send warning message
    await challengesChannel.send(`⚠️ **CHALLENGE EXPIRING SOON** ⚠️\n\n<@${player1.discordId}> and <@${player2.discordId}>, your challenge will automatically expire in less than 24 hours! Please complete your match or ask an SvS Manager to extend the challenge.`);
    
    console.log(`Warning notification sent for challenge between ranks ${rank1} and ${rank2}`);
  } catch (error) {
    console.error(`Error handling challenge warning: ${error.message}`);
    logError(`Challenge warning handler error: ${error.message}\nStack: ${error.stack}`);
    throw error; // Re-throw to be caught by the parent handler
  }
}

/**
 * Handle a challenge expiration event
 * @param {Object} client - Discord.js client
 * @param {string} challengeKey - Redis key for the challenge
 */
async function handleChallengeExpiration(client, challengeKey) {
  // Extract player ranks from the key
  const ranksPart = challengeKey.substring(10); // Remove 'challenge:' prefix
  const [rank1, rank2] = ranksPart.split('-').map(Number);
  
  console.log(`[CHALLENGE EXPIRY HANDLER] Processing expiration for challenge between ranks ${rank1} and ${rank2}`);
  
  try {
    // Fetch current data from Google Sheets
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:K`
    });
    
    const rows = sheetData.data.values || [];
    if (!rows.length) {
      console.log('No data found in Google Sheets. Exiting.');
      return;
    }
    
    // Find player rows in the sheet
    const player1Row = rows.find(row => parseInt(row[0]) === rank1);
    const player2Row = rows.find(row => parseInt(row[0]) === rank2);
    
    if (!player1Row || !player2Row) {
      console.log(`One or both players (ranks ${rank1}, ${rank2}) not found in sheet.`);
      return;
    }
    
    // Verify both players are still in challenge status with each other
    const player1Status = player1Row[5];
    const player2Status = player2Row[5];
    const player1Opponent = player1Row[7];
    const player2Opponent = player2Row[7];
    
    if (
      player1Status !== 'Challenge' || 
      player2Status !== 'Challenge' || 
      player1Opponent !== String(rank2) || 
      player2Opponent !== String(rank1)
    ) {
      console.log(`Challenge state mismatch between Redis and Google Sheets.`);
      return;
    }
    
    // Build requests to update Google Sheet
    const requests = [];
    const processedChallenges = [];
    
    // Find row indices
    const player1RowIndex = rows.findIndex(row => parseInt(row[0]) === rank1);
    const player2RowIndex = rows.findIndex(row => parseInt(row[0]) === rank2);
    
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
        rank: rank1,
        discordId: player1Row[8],
        element: player1Row[3],
        spec: player1Row[2]
      },
      player2: {
        name: player2Row[1],
        rank: rank2,
        discordId: player2Row[8],
        element: player2Row[3],
        spec: player2Row[2]
      },
      challengeDate: player1Row[6]
    });
    
    // Execute the updates
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests }
    });
    
    console.log(`Google Sheet updated for expired challenge between ranks ${rank1} and ${rank2}`);
    
    // Fetch the challenges channel
    const challengesChannel = await client.channels.fetch(CHALLENGES_CHANNEL_ID);
    if (!challengesChannel) {
      console.error('Could not find challenges channel!');
      return;
    }
    
    // Create and send embed for nullified challenge
    const challenge = processedChallenges[0];
    const embed = new EmbedBuilder()
      .setTitle('⏰ Challenge Expired - Auto-Nullified ⏰')
      .setDescription(`The challenge has expired after reaching the 3-day time limit.`)
      .setColor(0xFF5733)
      .addFields(
        {
          name: 'Player 1',
          value: `Rank #${challenge.player1.rank} (<@${challenge.player1.discordId}>)
${specEmojiMap[challenge.player1.spec] || ''} ${elementEmojiMap[challenge.player1.element] || ''}`,
          inline: true
        },
        {
          name: '​',
          value: 'VS',
          inline: true
        },
        {
          name: 'Player 2',
          value: `Rank #${challenge.player2.rank} (<@${challenge.player2.discordId}>)
${specEmojiMap[challenge.player2.spec] || ''} ${elementEmojiMap[challenge.player2.element] || ''}`,
          inline: true
        },
        {
          name: 'Challenge Details',
          value: `Challenge Date: ${challenge.challengeDate}\nExpired: ${moment().tz(DEFAULT_TIMEZONE).format('M/D, h:mm A z')}`
        }
      )
      .setFooter({
        text: 'Both players are now available for new challenges',
      })
      .setTimestamp();
      
    await challengesChannel.send({ embeds: [embed] });
    console.log('Auto-nullification embed sent to challenges channel');
  } catch (error) {
    console.error(`Error handling challenge expiration: ${error.message}`);
    logError(`Challenge expiration handler error: ${error.message}\nStack: ${error.stack}`);
    throw error; // Re-throw to be caught by the parent handler
  }
}

/**
 * Run a safety check to ensure no challenges are missed
 * This is a backup in case Redis keyspace events miss something
 */
async function runSafetyCheck(client) {
  console.log('\n[CHALLENGE EXPIRY HANDLER] Running safety check for challenges...');
  
  try {
    // Get all active challenges from Redis
    const activeChallenges = await redisClient.getAllChallenges();
    console.log(`Found ${activeChallenges.length} active challenges in Redis during safety check`);
    
    if (activeChallenges.length === 0) {
      console.log('No active challenges to check in safety scan. Exiting.');
      return;
    }

    const now = Date.now();
    
    // Check for any challenges that should be expired or warned but aren't
    for (const challenge of activeChallenges) {
      const { remainingTime, key } = challenge;
      
      // Check if TTL is very low or negative but key hasn't expired yet
      if (remainingTime <= 5) { // Within 5 seconds of expiry
        console.log(`Safety check: Challenge ${key} should be expiring very soon, ensuring it's processed`);
        handleChallengeExpiration(client, key).catch(err => {
          console.error(`Safety check error processing expiration: ${err.message}`);
        });
      }
      
      // Check if we're within 24 hours of expiry but the warning hasn't been sent
      if (remainingTime <= 24 * 60 * 60 && remainingTime > 23.9 * 60 * 60) {
        console.log(`Safety check: Challenge ${key} should be sending warning soon`);
        // The warning key should have expired, but just in case, trigger the warning
        handleChallengeWarning(client, key).catch(err => {
          console.error(`Safety check error processing warning: ${err.message}`);
        });
      }
    }
    
    console.log('[CHALLENGE EXPIRY HANDLER] Safety check completed');
  } catch (error) {
    console.error(`[CHALLENGE EXPIRY HANDLER] Error in safety check: ${error.message}`);
    logError(`Challenge safety check error: ${error.message}\nStack: ${error.stack}`);
  }
}

module.exports = { 
  initializeChallengeExpiryHandler,
  runSafetyCheck
};