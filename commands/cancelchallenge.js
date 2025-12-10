const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const redisClient = require('../redis-client');

const elementEmojis = {
  'Fire': '🔥',
  'Light': '⚡',
  'Cold': '❄️'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelchallenge')
    .setDescription('Cancel a challenge involving a specific player.')
    .addStringOption(option =>
      option.setName('player')
        .setDescription('The name of one player involved in the challenge')
        .setRequired(true)
    ),
  async execute(interaction) {
    // Check if the user has the '@SvS Manager' role
    if (!interaction.member.roles.cache.some(role => role.name === 'SvS Manager')) {
      return interaction.reply('You do not have permission to use this command. Only users with the @SvS Manager role can use it.');
    }

    const playerName = interaction.options.getString('player');

    await interaction.deferReply();

    try {
      // Load the Google Sheet
      const { google } = require('googleapis');
      const { getGoogleAuth } = require('../fixGoogleAuth');

      const sheets = google.sheets({
        version: 'v4',
        auth: getGoogleAuth()
      });
      
      const sheetName = 'SvS Ladder';
      console.log('Fetching data from Google Sheets...');
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${sheetName}!A2:K`
      });
      let rows = result.data.values;
      console.log('Rows fetched:', rows);

      // Filter out empty rows
      rows = rows.filter(row => row[1] && row[1].trim() !== '');
      console.log('Filtered rows:', rows);

      // Find the row for the player
      console.log(`Searching for rank: ${playerName}`);
      const playerRowIndex = rows.findIndex((row) => row[0] && row[0].trim() === playerName.trim());
      console.log('Player row index found:', playerRowIndex);

      if (playerRowIndex === -1) {
        return interaction.editReply('The specified player could not be found. Please check the name and try again.');
      }

      const playerRow = rows[playerRowIndex];

      // Find the opponent based on the 'Opp#' column
      const opponentName = playerRow[7];
      console.log('Opponent name:', opponentName);
      if (!opponentName) {
        return interaction.editReply('The specified player is not currently in a challenge.');
      }

      const opponentRowIndex = rows.findIndex((row) => row[0] && row[0].trim() === opponentName.trim());
      console.log('Opponent row index found:', opponentRowIndex);
      if (opponentRowIndex === -1) {
        return interaction.editReply('The opponent could not be found. Please check the data and try again.');
      }

      const opponentRow = rows[opponentRowIndex];

      // Prepare the updates to clear the challenge information
      const updates = [
        {
          range: `${sheetName}!F${playerRowIndex + 2}:H${playerRowIndex + 2}`,
          values: [['Available', '', '']]
        },
        {
          range: `${sheetName}!F${opponentRowIndex + 2}:H${opponentRowIndex + 2}`,
          values: [['Available', '', '']]
        }
      ];

      console.log('Updating player and opponent rows to clear challenge information...');
      // Update player and opponent rows
      for (const update of updates) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: update.range,
          valueInputOption: 'USER_ENTERED',
          resource: { values: update.values }
        });
      }
      
      // Remove the challenge from Redis
      try {
        const player1 = {
          discordId: playerRow[8],
          element: playerRow[3]
        };
        const player2 = {
          discordId: opponentRow[8],
          element: opponentRow[3]
        };
        await redisClient.removeChallenge(player1, player2);
        console.log('Challenge removed from Redis');
      } catch (error) {
        console.error('Error removing challenge from Redis:', error);
        // Continue with the cancellation even if Redis removal fails
      }

      // Prepare an embed message to confirm the cancellation
      const playerSpec = playerRow[2];
      const playerElement = playerRow[3];
      const playerNameText = playerRow[1];
      const playerDiscUser = playerRow[4];
      const opponentSpec = opponentRow[2];
      const opponentElement = opponentRow[3];
      const opponentNameText = opponentRow[1];
      const opponentDiscUser = opponentRow[4];

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Challenge Canceled ⚔️')
        .setDescription(`The challenge between **${playerNameText}** and **${opponentNameText}** has been successfully canceled.`)
        .addFields(
          { name: `Rank ${playerRow[0]}: ${playerNameText}`, value: `${elementEmojis[playerElement] || ''} ${playerSpec}
Discord User: ${playerDiscUser}`, inline: true },
          { name: 'VS', value: '​', inline: true },
          { name: `Rank ${opponentRow[0]}: ${opponentNameText}`, value: `${elementEmojis[opponentElement] || ''} ${opponentSpec}
Discord User: ${opponentDiscUser}`, inline: true }
        )
        .setColor(0xff0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error canceling the challenge:', error);
      await interaction.editReply('An error occurred while attempting to cancel the challenge. Please try again later.');
    }
  },
};
