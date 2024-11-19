require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger');

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  )
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';
const TOP_10_MAX_JUMP = 2;
const REGULAR_MAX_JUMP = 3;

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Challenge a player on the leaderboard')
    .addIntegerOption(option =>
      option
        .setName('challenger_rank')
        .setDescription('Your rank on the leaderboard')
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option
        .setName('target_rank')
        .setDescription('The rank of the player you want to challenge')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const challengerRank = interaction.options.getInteger('challenger_rank');
      const targetRank = interaction.options.getInteger('target_rank');
      const userId = interaction.user.id;
      const memberRoles = interaction.member.roles.cache;

      // Log the challenge attempt
      console.log(`Challenge attempt - Challenger: ${challengerRank}, Target: ${targetRank}, User: ${userId}`);

      // Prevent challenging downward in the ladder
      if (challengerRank <= targetRank) {
        return await interaction.editReply({
          content: `You cannot challenge players ranked below you.`
        });
      }

      // Fetch ladder data
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:I`
      });

      const rows = result.data.values;
      if (!rows?.length) {
        logError('No data available on the leaderboard.');
        return await interaction.editReply({
          content: 'Unable to access leaderboard data. Please try again later.'
        });
      }

      // Get available players between target and challenger
      const playersBetween = rows.filter(row => {
        const rank = parseInt(row[0]);
        return rank > targetRank && rank < challengerRank;
      });

      // Filter out vacation players
      const availablePlayersBetween = playersBetween.filter(row => row[5] !== 'Vacation');
      const availableJumpSize = availablePlayersBetween.length + 1; // +1 to count the actual jump to target

      // Apply rank jump restrictions
      if (challengerRank <= 10) {
        // Top 10 restriction
        if (availableJumpSize > TOP_10_MAX_JUMP) {
          const maxTarget = rows.find(row => 
            parseInt(row[0]) === challengerRank - TOP_10_MAX_JUMP && row[5] !== 'Vacation'
          );
          return await interaction.editReply({
            content: `Top 10 players can only challenge up to ${TOP_10_MAX_JUMP} ranks ahead. The highest rank you can challenge is ${maxTarget ? maxTarget[0] : challengerRank - TOP_10_MAX_JUMP}.`
          });
        }
      } else {
        // Regular player restriction
        if (availableJumpSize > REGULAR_MAX_JUMP) {
          const maxTarget = rows.find(row => 
            parseInt(row[0]) === challengerRank - REGULAR_MAX_JUMP && row[5] !== 'Vacation'
          );
          const skippedRanks = availablePlayersBetween
            .map(row => row[0])
            .join(', ');
          return await interaction.editReply({
            content: `Players outside top 10 can only challenge up to ${REGULAR_MAX_JUMP} ranks ahead (excluding players on vacation). You're trying to skip ranks: ${skippedRanks}`
          });
        }
      }

      // Validate challenger and target
      const challengerRow = rows.find(row => parseInt(row[0]) === challengerRank);
      const targetRow = rows.find(row => parseInt(row[0]) === targetRank);

      if (!challengerRow || !targetRow) {
        return await interaction.editReply({
          content: 'One or both ranks were not found on the leaderboard.'
        });
      }

      // Verify challenger identity
      if (challengerRow[8] !== userId && !memberRoles.some(role => role.name === 'SvS Manager')) {
        return await interaction.editReply({
          content: 'You can only initiate challenges for your own rank.'
        });
      }

      // Check availability
      if (challengerRow[5] !== 'Available' || targetRow[5] !== 'Available') {
        return await interaction.editReply({
          content: `Challenge failed: ${challengerRow[5] !== 'Available' ? 'You are' : 'Your target is'} not available for challenges.`
        });
      }

      // Format challenge date
      const challengeDate = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      });

      // Update both players' status
      const challengerRowIndex = rows.findIndex(row => parseInt(row[0]) === challengerRank) + 2;
      const targetRowIndex = rows.findIndex(row => parseInt(row[0]) === targetRank) + 2;

      const updatePromises = [
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!F${challengerRowIndex}:H${challengerRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [['Challenge', challengeDate, targetRank]] }
        }),
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!F${targetRowIndex}:H${targetRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [['Challenge', challengeDate, challengerRank]] }
        })
      ];

      await Promise.all(updatePromises);

      // Create and send announcement embed
      const challengeEmbed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('⚔️ New Challenge Initiated!')
        .addFields(
          {
            name: 'Challenger',
            value: `Rank #${challengerRank} (<@${challengerRow[8]}>)
${specEmojiMap[challengerRow[2]] || ''} ${elementEmojiMap[challengerRow[3]] || ''}`,
            inline: true
          },
          {
            name: '​',
            value: 'VS',
            inline: true
          },
          {
            name: 'Challenged',
            value: `Rank #${targetRank} (<@${targetRow[8]}>)
${specEmojiMap[targetRow[2]] || ''} ${elementEmojiMap[targetRow[3]] || ''}`,
            inline: true
          }
        )
        .setTimestamp()
        .setFooter({
          text: 'May the best player win!',
          iconURL: interaction.client.user.displayAvatarURL()
        });

      await interaction.channel.send({ embeds: [challengeEmbed] });
      await interaction.editReply({ content: 'Challenge successfully initiated!' });

    } catch (error) {
      logError(`Challenge command error: ${error.message}\nStack: ${error.stack}`);
      await interaction.editReply({
        content: 'An error occurred while processing your challenge. Please try again later.'
      });
    }
  }
};