const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger');

// Initialize the Google Sheets API client
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
const sheetId = 0; // SvS Ladder tab

// Emoji mappings
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
    )
    .addIntegerOption(option =>
      option
        .setName('rank')
        .setDescription('The rank to insert the player at')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    console.log(`\n[${new Date().toISOString()}] Insert Command`);
    console.log(`├─ Invoked by: ${interaction.user.tag}`);

    await interaction.deferReply({ ephemeral: true });

    // Check if the user has the '@SvS Manager' role
    const managerRole = interaction.guild.roles.cache.find(
      role => role.name === 'SvS Manager'
    );
    if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
      return interaction.editReply({
        content: 'You do not have the required @SvS Manager role to use this command.',
        ephemeral: true
      });
    }

    try {
      const playerName = interaction.options.getString('player_name');
      const insertRank = interaction.options.getInteger('rank');

      // Fetch data from both sheets
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

      // Find the player in extended vacation
      const playerRow = vacationRows.find(row => row[1] && row[1].toLowerCase() === playerName.toLowerCase());
      if (!playerRow) {
        return interaction.editReply({
          content: 'Player not found in Extended Vacation list.',
          ephemeral: true
        });
      }

      // Check if the insert rank exists in the main ladder
      if (insertRank > mainRows.length + 1) {
        return interaction.editReply({
          content: 'Invalid rank. The specified rank is beyond the current ladder size.',
          ephemeral: true
        });
      }

      // Find player at insert rank and rank below
      const playerAtRank = mainRows.find(row => parseInt(row[0]) === insertRank);
      const playerBelowRank = mainRows.find(row => parseInt(row[0]) === insertRank + 1);

      // Check if both ranks are in challenges
      if (playerAtRank && playerBelowRank && 
          playerAtRank[5] === 'Challenge' && playerBelowRank[5] === 'Challenge') {
        return interaction.editReply({
          content: 'Cannot insert at this rank. Both the target rank and the rank below are already in challenges.',
          ephemeral: true
        });
      }

      console.log('├─ Inserting Player:');
      console.log(`│  ├─ Name: ${playerName}`);
      console.log(`│  └─ Target Rank: #${insertRank}`);

      // Prepare player data for insertion
      const insertedPlayerData = [...playerRow];
      insertedPlayerData[0] = insertRank.toString(); // Set new rank
      insertedPlayerData[5] = 'Challenge'; // Set status to Challenge

      const challengeDate = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      });
      insertedPlayerData[6] = challengeDate; // Set challenge date

      // Determine opponent based on availability
      let opponentRank;
      if (!playerAtRank || playerAtRank[5] === 'Available') {
        opponentRank = insertRank;
      } else if (!playerBelowRank || playerBelowRank[5] === 'Available') {
        opponentRank = insertRank + 1;
      }

      insertedPlayerData[7] = opponentRank.toString(); // Set opponent rank

      const requests = [];

      // 1. Insert the new row
      requests.push({
        insertDimension: {
          range: {
            sheetId: sheetId,
            dimension: 'ROWS',
            startIndex: insertRank - 1,
            endIndex: insertRank
          },
          inheritFromBefore: false
        }
      });

      // 2. Update the inserted row with proper formatting
      requests.push({
        updateCells: {
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
                horizontalAlignment: index === 0 ? 'RIGHT' : 'LEFT',
                textFormat: { bold: index === 1 }
              }
            }))
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });

      // 3. Set element column background color
      requests.push({
        updateCells: {
          range: {
            sheetId: sheetId,
            startRowIndex: insertRank - 1,
            endRowIndex: insertRank,
            startColumnIndex: 3,
            endColumnIndex: 4
          },
          rows: [{
            values: [{
              userEnteredFormat: {
                backgroundColor: playerRow[3] === 'Cold' ? { red: 0.5, green: 0.635, blue: 1 } :
                                playerRow[3] === 'Fire' ? { red: 0.976, green: 0.588, blue: 0.51 } :
                                { red: 1, green: 0.929, blue: 0.686 }
              }
            }]
          }],
          fields: 'userEnteredFormat.backgroundColor'
        }
      });

      // 4. Update ranks and opponent references for all affected rows
      for (let i = insertRank; i < mainRows.length + 1; i++) {
        const currentRow = mainRows[i - 1];
        if (!currentRow) continue;

        // Update rank
        requests.push({
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: i,
              endRowIndex: i + 1,
              startColumnIndex: 0,
              endColumnIndex: 1
            },
            rows: [{
              values: [{
                userEnteredValue: { stringValue: (i + 1).toString() },
                userEnteredFormat: { horizontalAlignment: 'RIGHT' }
              }]
            }],
            fields: 'userEnteredValue,userEnteredFormat'
          }
        });

        // Update opponent references if in a challenge
        if (currentRow[5] === 'Challenge' && currentRow[7]) {
          const oppRank = parseInt(currentRow[7]);
          if (oppRank >= insertRank) {
            requests.push({
              updateCells: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: i,
                  endRowIndex: i + 1,
                  startColumnIndex: 7,
                  endColumnIndex: 8
                },
                rows: [{
                  values: [{
                    userEnteredValue: { stringValue: (oppRank + 1).toString() },
                    userEnteredFormat: { horizontalAlignment: 'RIGHT' }
                  }]
                }],
                fields: 'userEnteredValue,userEnteredFormat'
              }
            });
          }
        }
      }

      // 5. Update opponent's challenge status
      if (opponentRank) {
        const opponentRowIndex = opponentRank - 1;
        requests.push({
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: opponentRowIndex,
              endRowIndex: opponentRowIndex + 1,
              startColumnIndex: 5,
              endColumnIndex: 8
            },
            rows: [{
              values: [
                { userEnteredValue: { stringValue: 'Challenge' } },
                { userEnteredValue: { stringValue: challengeDate } },
                { userEnteredValue: { stringValue: insertRank.toString() } }
              ]
            }],
            fields: 'userEnteredValue'
          }
        });
      }

      // Execute all updates
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests }
      });

      // Remove player from Extended Vacation
      const vacationRowIndex = vacationRows.findIndex(row => row[1] && row[1].toLowerCase() === playerName.toLowerCase()) + 2;
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${VACATION_SHEET}!A${vacationRowIndex}:K${vacationRowIndex}`
      });

      // Create welcome back embed
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

      // Send the embed to the channel
      await interaction.channel.send({ embeds: [welcomeEmbed] });

      // Send confirmation to command issuer
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