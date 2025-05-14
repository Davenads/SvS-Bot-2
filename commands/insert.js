const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');
const { getGoogleAuth } = require('../fixGoogleAuth');

const sheets = google.sheets({
  version: 'v4',
  auth: getGoogleAuth()
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
        .filter(
          choice =>
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

    const managerRole = interaction.guild.roles.cache.find(
      role => role.name === 'SvS Manager'
    );
    if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
      return interaction.editReply({
        content:
          'You do not have the required @SvS Manager role to use this command.',
        ephemeral: true
      });
    }

    try {
      const playerName = interaction.options.getString('player_name');

      const [mainSheetData, vacationSheetData] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${MAIN_SHEET}!A2:K`,
          valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${VACATION_SHEET}!A2:K`
        })
      ]);

      const mainRows = mainSheetData.data.values || [];
      const vacationRows = vacationSheetData.data.values || [];

      const playerRow = vacationRows.find(
        row => row[1] && row[1].toLowerCase() === playerName.toLowerCase()
      );
      if (!playerRow) {
        return interaction.editReply({
          content: 'Player not found in Extended Vacation list.',
          ephemeral: true
        });
      }

      const originalRank = parseInt(playerRow[0]);
      if (!originalRank) {
        return interaction.editReply({
          content: "Could not determine player's original rank.",
          ephemeral: true
        });
      }

      const targetRank = originalRank;
      console.log(`│  ├─ Target Rank: #${targetRank}`);

      const insertedPlayerData = [...playerRow];
      insertedPlayerData[0] = targetRank.toString();
      insertedPlayerData[5] = 'Challenge';

      const challengeDate = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      });
      insertedPlayerData[6] = challengeDate;
      insertedPlayerData[7] = targetRank.toString();

      mainRows.splice(targetRank - 1, 0, insertedPlayerData);

      const updateRows = mainRows.map((row, index) => {
        row[0] = (index + 1).toString();
        row[5] = row[5] === 'Challenge' && parseInt(row[7]) >= targetRank
          ? (parseInt(row[7]) + 1).toString()
          : row[5];
        return row;
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${MAIN_SHEET}!A2:K`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: updateRows }
      });

      const vacationRowIndex =
        vacationRows.findIndex(
          row => row[1] && row[1].toLowerCase() === playerName.toLowerCase()
        ) + 2;
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${VACATION_SHEET}!A${vacationRowIndex}:K${vacationRowIndex}`
      });

      const welcomeEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('🎉 Welcome Back to the Ladder!')
        .setDescription(
          welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
        )
        .addFields(
          {
            name: '🎭 Character',
            value: `**${playerName}** (Rank #${targetRank})`,
            inline: true
          },
          {
            name: '⚔️ Build',
            value: `${specEmojis[playerRow[2]] || ''} ${playerRow[2]} ${
              elementEmojis[playerRow[3]] || ''
            } ${playerRow[3]}`,
            inline: true
          },
          {
            name: '👤 Discord',
            value: playerRow[8] ? `<@${playerRow[8]}>` : playerRow[4],
            inline: true
          },
          {
            name: '🤺 First Challenge',
            value: `Challenging Rank #${targetRank}`,
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
        content: `Successfully inserted ${playerName} at rank ${targetRank} and updated all affected rankings and challenges.`,
        ephemeral: true
      });
    } catch (error) {
      console.error(`└─ Error: ${error.message}`);
      logError(
        `Error inserting player: ${error.message}\nStack: ${error.stack}`
      );
      return interaction.editReply({
        content:
          'An error occurred while inserting the player. Please try again later.',
        ephemeral: true
      });
    }
  }
};
