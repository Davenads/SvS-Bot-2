require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger'); // Import the logger

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Challenge a player on the leaderboard')
    .addIntegerOption(option =>
      option
        .setName('challenger_rank')
        .setDescription('Your rank on the leaderboard')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('target_rank')
        .setDescription('The rank of the player you want to challenge')
        .setRequired(true)
    ),

  async execute (interaction) {
    try {
      const challengerRank = interaction.options.getInteger('challenger_rank');
      const targetRank = interaction.options.getInteger('target_rank');
      const userId = interaction.user.id;

      // Prevent challenging downward in the ladder
      if (challengerRank <= targetRank) {
        return interaction.reply({
          content: `Nice try <@${userId}>, but you can't challenge downward in the ladder!`,
          ephemeral: false
        });
      }

      // Fetch all data from the sheet dynamically
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:I` // Fetches all rows starting from A2 to the end of column I
      });

      const rows = result.data.values;
      if (!rows || !rows.length) {
        logError('No data available on the leaderboard.');
        return interaction.reply({
          content: 'No data available on the leaderboard.',
          ephemeral: true
        });
      }

      // Find the challenger and target rows based on rank
      const challengerRow = rows.find(
        row => parseInt(row[0]) === challengerRank
      );
      const targetRow = rows.find(row => parseInt(row[0]) === targetRank);

      // Element and Spec Emojis
      const elementEmojiMap = {
        Fire: '🔥',
        Light: '⚡',
        Cold: '❄️'
      };

      const specEmojiMap = {
        Vita: '❤️',
        ES: '🟠'
      };

      if (!challengerRow || !targetRow) {
        return interaction.reply({
          content: 'Invalid ranks provided.',
          ephemeral: true
        });
      }

      // Validate that the person issuing the challenge is the one making the command
      if (challengerRow[8] !== userId.toString()) {
        // Updated to check Column I (index 8)
        return interaction.reply({
          content: 'You can only initiate challenges for your own character.',
          ephemeral: true
        });
      }

      // Ensure both players are available
      if (challengerRow[5] !== 'Available' || targetRow[5] !== 'Available') {
        return interaction.reply({
          content: 'One or both players are not available for a challenge.',
          ephemeral: true
        });
      }

      // Format the challenge date in the shortened format
      const challengeDate = new Date(interaction.createdTimestamp).toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'America/New_York', // Adjust for your timezone
        timeZoneName: 'short'
      });

      // Update the status, challenge date, and opponent columns in Google Sheets for both players
      const challengerRowIndex =
        rows.findIndex(row => parseInt(row[0]) === challengerRank) + 2;
      const targetRowIndex =
        rows.findIndex(row => parseInt(row[0]) === targetRank) + 2;

      const challengerUpdateRange = `${SHEET_NAME}!F${challengerRowIndex}:H${challengerRowIndex}`;
      const targetUpdateRange = `${SHEET_NAME}!F${targetRowIndex}:H${targetRowIndex}`;

      // Update Challenger Status, Challenge Date, and Opponent
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: challengerUpdateRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Challenge', challengeDate, targetRank]] }
      });

      // Update Target Status, Challenge Date, and Opponent
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: targetUpdateRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Challenge', challengeDate, challengerRank]] }
      });

      // Create an Embed Message with User Mentions
      const challengeEmbed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('New Challenge Initiated!')
        .addFields(
          {
            name: 'Challenger',
            value: `**Rank #${challengerRank}** (<@${challengerRow[8]}>) ${
              specEmojiMap[challengerRow[2]]
            }${elementEmojiMap[challengerRow[3]]}`,
            inline: true
          },
          {
            name: 'Challenged',
            value: `**Rank #${targetRank}** (<@${targetRow[8]}>) ${
              specEmojiMap[targetRow[2]]
            }${elementEmojiMap[targetRow[3]]}`,
            inline: true
          }
        )
        .setTimestamp()
        .setFooter({
          text: 'Good luck to both players!',
          iconURL: interaction.client.user.displayAvatarURL()
        });

      // Send the Embed to the channel
      await interaction.channel.send({ embeds: [challengeEmbed] });

      return interaction.reply({
        content: `Challenge initiated successfully!`,
        ephemeral: true
      });
    } catch (error) {
      logError(
        `Error during challenge execution: ${error.message}\nStack: ${error.stack}`
      );
      await interaction.reply({
        content:
          'There was an error initiating the challenge. Please try again.',
        ephemeral: true
      });
    }
  }
};
