const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger');

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key.replace(/\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  )
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const MAIN_SHEET = 'SvS Ladder';
const VACATION_SHEET = 'Extended Vacation';
const sheetId = 0;

const elementEmojis = {
  Fire: '🔥',
  Light: '⚡',
  Cold: '❄️'
};

const specEmojis = {
  Vita: '❤️',
  ES: '🟠'
};

const welcomeMessages = [
  'Welcome back to the ladder! 🌟',
  'The champion returns! ⚔️',
  'Back to claim glory once again! 👑',
  'The ladder welcomes a familiar face! 🎭',
  'A legendary return to the battlefield! 🏰',
  'Ready to climb once more! 🏔️',
  'The warrior returns to battle! ⚔️',
  'Back to conquer new heights! 🗻'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('insert')
    .setDescription('Insert a player from extended vacation into the ladder')
    .addStringOption(option =>
      option
        .setName('player_name')
        .setDescription('The name of the player to insert')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();

    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${VACATION_SHEET}!A2:E`
      });

      const rows = result.data.values || [];
      const players = rows
        .filter(row => row[1] && row[4])
        .map(row => ({
          name: `${row[4]} (${row[1]})`,
          value: row[1]
        }))
        .filter(choice => 
          choice.name.toLowerCase().includes(focusedValue) || 
          choice.value.toLowerCase().includes(focusedValue)
        )
        .slice(0, 25);

      await interaction.respond(players);
    } catch (error) {
      console.error('Error fetching autocomplete options:', error);
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    console.log(`\n[${new Date().toISOString()}] Insert Command`);
    console.log(`├─ Invoked by: ${interaction.user.tag}`);

    await interaction.deferReply({ ephemeral: true });

    // Check manager role
    const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
    if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
      return interaction.editReply({
        content: 'You do not have the required @SvS Manager role to use this command.',
        ephemeral: true
      });
    }

    try {
      const playerName = interaction.options.getString('player_name');

      // Fetch both sheets data in parallel
      const [mainResult, vacationResult] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${MAIN_SHEET}!A2:K`
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${VACATION_SHEET}!A2:K`
        })
      ]);

      const mainRows = mainResult.data.values || [];
      const vacationRows = vacationResult.data.values || [];

      // Find player in vacation sheet
      const playerRow = vacationRows.find(row => row[1] && row[1].toLowerCase() === playerName.toLowerCase());
      if (!playerRow) {
        return interaction.editReply({ content: 'Player not found in Extended Vacation list.' });
      }

      const originalRank = parseInt(playerRow[0]);
      if (!originalRank) {
        return interaction.editReply({ content: 'Could not determine player\'s original rank.' });
      }

      // Determine insert position
      const targetRank = originalRank;
      const playerAtRank = mainRows.find(row => parseInt(row[0]) === targetRank);
      const playerBelowRank = mainRows.find(row => parseInt(row[0]) === targetRank + 1);

      let insertRank, opponentRank;
      if (playerAtRank && playerAtRank[5] === 'Available') {
        insertRank = targetRank + 1;
        opponentRank = targetRank;
      } else if (playerBelowRank && playerBelowRank[5] === 'Available') {
        insertRank = targetRank + 2;
        opponentRank = targetRank + 1;
      } else {
        return interaction.editReply({
          content: 'Cannot insert player. Both the target rank and the rank below are in challenges.'
        });
      }

      // Prepare player data
      const insertedPlayerData = [...playerRow];
      insertedPlayerData[0] = insertRank.toString();
      insertedPlayerData[5] = 'Challenge';
      insertedPlayerData[6] = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      });
      insertedPlayerData[7] = opponentRank.toString();

      // Prepare batch update
      const requests = [{
        insertDimension: {
          range: {
            sheetId: sheetId,
            dimension: 'ROWS',
            startIndex: insertRank - 1,
            endIndex: insertRank
          },
          inheritFromBefore: true
        }
      }];

      // Base cell format for all cells
      const baseCellFormat = {
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'WRAP',
        backgroundColor: { red: 0.949, green: 0.949, blue: 0.949 },
        borders: {
          top: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
          bottom: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
          left: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
          right: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } }
        }
      };

      // Update inserted row and affected rows in one batch
      const rowUpdates = [];
      
      // Insert new row
      rowUpdates.push({
        range: {
          sheetId: sheetId,
          startRowIndex: insertRank - 1,
          endRowIndex: insertRank,
          startColumnIndex: 0,
          endColumnIndex: 11
        },
        rows: [{
          values: insertedPlayerData.map((value, index) => ({
            userEnteredValue: { stringValue: value?.toString() || '' },
            userEnteredFormat: {
              ...baseCellFormat,
              horizontalAlignment: index === 0 || index === 7 ? 'RIGHT' : 'LEFT',
              textFormat: {
                fontSize: index === 0 ? 12 : 10,
                bold: index === 1 || index === 3 || index === 4
              },
              backgroundColor: index === 3 ? (
                value === 'Cold' ? { red: 0.5, green: 0.635, blue: 1 } :
                value === 'Fire' ? { red: 0.976, green: 0.588, blue: 0.51 } :
                { red: 1, green: 0.929, blue: 0.686 }
              ) : baseCellFormat.backgroundColor
            }
          }))
        }]
      });

      // Update subsequent rows
      const affectedRows = mainRows.slice(insertRank - 1);
      if (affectedRows.length > 0) {
        const bulkUpdate = {
          range: {
            sheetId: sheetId,
            startRowIndex: insertRank,
            endRowIndex: insertRank + affectedRows.length,
            startColumnIndex: 0,
            endColumnIndex: 11
          },
          rows: affectedRows.map((row, idx) => ({
            values: row.map((value, colIdx) => ({
              userEnteredValue: { 
                stringValue: colIdx === 0 ? (insertRank + idx + 1).toString() : value?.toString() || '' 
              },
              userEnteredFormat: {
                ...baseCellFormat,
                horizontalAlignment: colIdx === 0 || colIdx === 7 ? 'RIGHT' : 'LEFT',
                textFormat: {
                  fontSize: colIdx === 0 ? 12 : 10,
                  bold: colIdx === 1 || colIdx === 3 || colIdx === 4
                },
                backgroundColor: colIdx === 3 ? (
                  value === 'Cold' ? { red: 0.5, green: 0.635, blue: 1 } :
                  value === 'Fire' ? { red: 0.976, green: 0.588, blue: 0.51 } :
                  { red: 1, green: 0.929, blue: 0.686 }
                ) : baseCellFormat.backgroundColor
              }
            }))
          }))
        };
        rowUpdates.push(bulkUpdate);
      }

      // Add all row updates to requests
      requests.push(...rowUpdates.map(update => ({
        updateCells: {
          ...update,
          fields: 'userEnteredValue,userEnteredFormat'
        }
      })));

      // Execute batch update
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests }
      });

      // Remove from vacation sheet
      const vacationRowIndex = vacationRows.findIndex(row => 
        row[1] && row[1].toLowerCase() === playerName.toLowerCase()
      ) + 2;
      
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${VACATION_SHEET}!A${vacationRowIndex}:K${vacationRowIndex}`
      });

      // Create and send welcome embed
      const welcomeEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('🎉 Welcome Back to the Ladder!')
        .setDescription(welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)])
        .addFields(
          {
            name: '🎭 Character',
            value: `**${playerName}** (Rank #${insertRank})`,
            inline: true
          },
          {
            name: '⚔️ Build',
            value: `${specEmojis[playerRow[2]] || ''} ${playerRow[2]} ${elementEmojis[playerRow[3]] || ''} ${playerRow[3]}`,
            inline: true
          },
          {
            name: '👤 Discord',
            value: playerRow[8] ? `<@${playerRow[8]}>` : playerRow[4],
            inline: true
          },
          {
            name: '🤺 First Challenge',
            value: `Challenging Rank #${opponentRank}`,
            inline: false
          }
        )
        .setFooter({
          text: 'Successfully inserted into the ladder!',
          iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.channel.send({ embeds: [welcomeEmbed] });
      await interaction.editReply({
        content: `Successfully inserted ${playerName} at rank ${insertRank} and updated all affected rankings and challenges.`,
        ephemeral: true
      });

    } catch (error) {
      console.error(`└─ Error: ${error.message}`);
      logError(`Error inserting player: ${error.message}\nStack: ${error.stack}`);
      return interaction.editReply({
        content: 'An error occurred while inserting the player. Please try again later.',
        ephemeral: true
      });
    }
  }
};