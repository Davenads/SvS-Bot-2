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

// Spec and Element Emoji Maps
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
    )
    .addIntegerOption(option =>
      option
        .setName('target_rank')
        .setDescription('The rank of the player you want to challenge')
        .setRequired(true)
    ),

  async execute (interaction) {
    let deferred = false;
    const deferIfNecessary = async () => {
      if (!deferred) {
        await interaction.deferReply({ ephemeral: true });
        deferred = true;
      }
    };

    try {
      const challengerRank = interaction.options.getInteger('challenger_rank');
      const targetRank = interaction.options.getInteger('target_rank');
      const userId = interaction.user.id;
      const memberRoles = interaction.member.roles.cache;

      console.log(`Challenger Rank: ${challengerRank}, Target Rank: ${targetRank}`);

      // Prevent challenging downward in the ladder
      if (challengerRank <= targetRank) {
        await deferIfNecessary();
        return await interaction.editReply({
          content: `Nice try <@${userId}>, but you can't challenge downward in the ladder!`
        });
      }

      // Fetch all data from the sheet dynamically
      await deferIfNecessary();
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:I` // Fetches all rows starting from A2 to the end of column I
      });

      const rows = result.data.values;
      if (!rows || !rows.length) {
        logError('No data available on the leaderboard.');
        await deferIfNecessary();
        return await interaction.editReply({
          content: 'No data available on the leaderboard.'
        });
      }

      // Find the challenger and target rows based on rank
      const challengerRow = rows.find(
        row => parseInt(row[0]) === challengerRank
      );
      const targetRow = rows.find(row => parseInt(row[0]) === targetRank);

      if (!challengerRow || !targetRow) {
        await deferIfNecessary();
        return await interaction.editReply({
          content: 'Invalid ranks provided.'
        });
      }

      // Validate that the person issuing the challenge is the one making the command
      if (challengerRow[8] !== userId.toString() && !memberRoles.some(role => role.name === 'SvS Manager')) {
        await deferIfNecessary();
        return await interaction.editReply({
          content: 'You can only initiate challenges for your own character, unless you have the @SvS Manager role.'
        });
      }

      // Ensure both players are available
      if (challengerRow[5] !== 'Available' || targetRow[5] !== 'Available') {
        await deferIfNecessary();
        return await interaction.editReply({
          content: 'One or both players are not available for a challenge.'
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

      await deferIfNecessary();
      // Update Challenger Status, Challenge Date, and Opponent
      const challengerUpdateResult = await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: challengerUpdateRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Challenge', challengeDate, targetRank]] }
      });

      if (challengerUpdateResult.status !== 200) {
        throw new Error('Failed to update challenger data in Google Sheets');
      }

      // Update Target Status, Challenge Date, and Opponent
      const targetUpdateResult = await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: targetUpdateRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Challenge', challengeDate, challengerRank]] }
      });

      if (targetUpdateResult.status !== 200) {
        throw new Error('Failed to update target data in Google Sheets');
      }

      // Create an Embed Message with User Mentions
      const challengerSpecEmoji = specEmojiMap[challengerRow[2]] || '';
      const challengerElementEmoji = elementEmojiMap[challengerRow[3]] || '';
      const targetSpecEmoji = specEmojiMap[targetRow[2]] || '';
      const targetElementEmoji = elementEmojiMap[targetRow[3]] || '';

      const challengeEmbed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('New Challenge Initiated!')
        .addFields(
          {
            name: 'Challenger',
            value: `**Rank #${challengerRank}** (<@${challengerRow[8]}>) ${challengerSpecEmoji}${challengerElementEmoji}`,
            inline: true
          },
          {
            name: 'Challenged',
            value: `**Rank #${targetRank}** (<@${targetRow[8]}>) ${targetSpecEmoji}${targetElementEmoji}`,
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

      // Only respond to the interaction if not already responded
      if (!deferred) {
        return await interaction.reply({
          content: `Challenge initiated successfully!`,
          ephemeral: true
        });
      }
    } catch (error) {
      logError(
        `Error during challenge execution: ${error.message}\nStack: ${error.stack}`
      );
      console.error(`Detailed error: ${error.message}`);
      await deferIfNecessary();
      await interaction.editReply({
        content:
          'There was an error initiating the challenge. Please try again.'
      });
    }
  }
};
