// Load environment variables
require('dotenv').config();

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
        credentials.private_key.replace(/\\n/g, '\n'), 
        ['https://www.googleapis.com/auth/spreadsheets']
    ),
});

const SPREADSHEET_ID = '1Ay8YGTGk1vUSTpD2DteeWeUxXlTCLdtvB-uFKDWIYEU'; // Your spreadsheet ID
const SHEET_NAME = 'Ladder Bot testing'; // Name of the tab within the Google Sheet
const sheetId = 1574388856; // Numeric sheetId obtained from the URL

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportwin')
        .setDescription('Report the results of a challenge')
        .addIntegerOption(option =>
            option.setName('challenger_rank')
                .setDescription('The rank number of the challenger')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('challenged_rank')
                .setDescription('The rank number of the challenged player')
                .setRequired(true)),
    
    async execute(interaction) {
        const challengerRank = interaction.options.getInteger('challenger_rank');
        const challengedRank = interaction.options.getInteger('challenged_rank');

        try {
            console.log('Executing reportwin command.');

            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:I`,
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                return interaction.reply({ content: 'No data available on the leaderboard.', ephemeral: true });
            }

            // Find the challenger and challenged rows based on rank
            const challengerRow = rows.find(row => parseInt(row[0]) === challengerRank);
            const challengedRow = rows.find(row => parseInt(row[0]) === challengedRank);

            if (!challengerRow || !challengedRow) {
                return interaction.reply({ content: 'Invalid ranks provided.', ephemeral: true });
            }

            console.log(`Swapping data between challengerRank ${challengerRank} and challengedRank ${challengedRank}`);

            const challengerRowIndex = rows.findIndex(row => parseInt(row[0]) === challengerRank) + 2;
            const challengedRowIndex = rows.findIndex(row => parseInt(row[0]) === challengedRank) + 2;

            // Prepare data for swapping, excluding the rank column (Column A)
            const updatedChallengerRow = [...challengedRow];
            updatedChallengerRow[0] = challengerRow[0]; // Keep the original rank
            updatedChallengerRow[5] = 'Available'; // Set status to 'Available'
            updatedChallengerRow[6] = ''; // Clear cDate
            updatedChallengerRow[7] = ''; // Clear Opp#

            const updatedChallengedRow = [...challengerRow];
            updatedChallengedRow[0] = challengedRow[0]; // Keep the original rank
            updatedChallengedRow[5] = 'Available'; // Set status to 'Available'
            updatedChallengedRow[6] = ''; // Clear cDate
            updatedChallengedRow[7] = ''; // Clear Opp#

            // Create a batchUpdate request to update the rows
            const requests = [
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId, // Use the numeric sheetId here
                            startRowIndex: challengerRowIndex - 1, // Google Sheets API is 0-indexed
                            endRowIndex: challengerRowIndex,
                            startColumnIndex: 1, // Start at column B (index 1)
                            endColumnIndex: 9   // End at column I (index 9)
                        },
                        rows: [{ values: updatedChallengerRow.slice(1).map(cellValue => ({ userEnteredValue: { stringValue: cellValue } })) }],
                        fields: 'userEnteredValue'
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId, // Use the numeric sheetId here
                            startRowIndex: challengedRowIndex - 1,
                            endRowIndex: challengedRowIndex,
                            startColumnIndex: 1, // Start at column B (index 1)
                            endColumnIndex: 9   // End at column I (index 9)
                        },
                        rows: [{ values: updatedChallengedRow.slice(1).map(cellValue => ({ userEnteredValue: { stringValue: cellValue } })) }],
                        fields: 'userEnteredValue'
                    }
                }
            ];

            // Execute the batchUpdate request
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests
                }
            });

            return interaction.reply({ content: `Challenge result reported successfully! The ranks have been swapped between #${challengerRank} and #${challengedRank}.`, ephemeral: true });

        } catch (error) {
            console.error('Error reporting match result:', error);
            return interaction.reply({
                content: 'An error occurred while reporting the match result. Please try again later.',
                ephemeral: true
            });
        }
    },
};
