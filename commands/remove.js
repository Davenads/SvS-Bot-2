// Import necessary modules
const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');

// Initialize the Google Sheets API client
const sheets = google.sheets({
    version: 'v4',
    auth: new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key.replace(/\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets']
    ),
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const sheetId = 0; // Numeric sheetId for 'SvS Ladder' tab

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a player from the ladder')
        .addIntegerOption(option =>
            option.setName('rank')
                .setDescription('The rank number of the player to remove')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // Check if the user has the '@SvS Manager' role
        const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
        if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
            return interaction.editReply({
                content: 'You do not have the required @SvS Manager role to use this command.',
                ephemeral: true
            });
        }

        // Retrieve command options
        const rank = interaction.options.getInteger('rank');

        try {
            // Fetch data from the Google Sheet (Main Tab: 'SvS Ladder')
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`, // Fetch columns A to K
            });

            const rows = result.data.values;
            const rowIndex = rows.findIndex(row => row[0] && parseInt(row[0]) === rank);

            if (rowIndex === -1) {
                return interaction.editReply({
                    content: 'Rank not found in the ladder.',
                    ephemeral: true
                });
            }

            // Clear the row in the Google Sheet
            const emptyRow = Array(11).fill('');
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A${rowIndex + 2}:K`,
                valueInputOption: 'RAW',
                resource: {
                    values: [emptyRow]
                }
            });

            return interaction.editReply({
                content: `Player at rank **${rank}** has been removed from the ladder.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error removing player:', error);
            return interaction.editReply({
                content: 'An error occurred while removing the player. Please try again later.',
                ephemeral: true
            });
        }
    },
};
