require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger'); // Import the logger

const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT(
    credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']
)});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('currentvacations')
        .setDescription('Display all players currently on vacation'),
    
    async execute(interaction) {
        try {
            // Fetch all data from the sheet dynamically
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H`, // Fetches all relevant columns starting from A2
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                return interaction.reply({ content: 'No players found.', ephemeral: true });
            }

            // Element Emojis
            const elementEmojiMap = {
                'Fire': '🔥',
                'Light': '⚡',
                'Cold': '❄️'
            };

            // Find players currently in "Vacation" state
            const vacations = rows.filter(row => row[5] === 'Vacation'); // Check if the "Status" column has "Vacation"
            
            if (vacations.length === 0) {
                return interaction.reply({ content: 'There are currently no players on vacation.', ephemeral: true });
            }

            // Sort players by vacation date (cDate, column 6)
            vacations.sort((a, b) => new Date(a[6]) - new Date(b[6]));

            // Create an embed to display all players on vacation
            const vacationEmbed = new EmbedBuilder()
                .setColor(0xFFCC00)
                .setTitle('🏝️ Vacation Leaderboard 🏝️')
                .setDescription('Who is winning the vacation game? ranked by longest time away... *looks off into sunset*☀️')
                .setTimestamp()
                .setFooter({ text: 'We hope to see you back soon!', iconURL: interaction.client.user.displayAvatarURL() });

            // Add each player on vacation to the embed
            vacations.forEach(player => {
                const playerRank = player[0]; // Rank of player
                const playerName = player[1]; // Name of player
                const playerElement = player[3]; // Element of player
                const vacationDate = player[6]; // Vacation start date
                const discordUserName = player[4]; // Discord username

                vacationEmbed.addFields({
                    name: `Rank #${playerRank}: ${playerName} (${discordUserName})`,
                    value: `Element: ${elementEmojiMap[playerElement]}
                    l8z: ${vacationDate}`,
                    inline: false
                });
            });

            // Send the embed privately to the user who invoked the command
            await interaction.reply({ embeds: [vacationEmbed], ephemeral: true });

        } catch (error) {
            logError(`Error fetching current vacations: ${error.message}\nStack: ${error.stack}`);
            await interaction.reply({ content: 'There was an error fetching the players on vacation. Please try again.', ephemeral: true });
        }
    },
};
