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

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
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
            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `Ladder Bot testing!A2:I`,
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

            // Define color mappings
            const specColorMap = {
                'Vita': { red: 0.96, green: 0.80, blue: 0.69 }, // Tan color for Vita
                'ES': { red: 0.78, green: 0.86, blue: 0.94 },  // Off-blue color for ES
            };

            const elementColorMap = {
                'Fire': { red: 0.98, green: 0.59, blue: 0.51 }, // Red color for Fire
                'Light': { red: 1.0, green: 0.93, blue: 0.69 }, // Yellow color for Light
                'Cold': { red: 0.68, green: 0.85, blue: 0.90 }, // Blue color for Cold
            };

            const nameColumnColor = { red: 0.8, green: 0.94, blue: 0.75 }; // Light green color
            const userInfoColumnColor = { red: 0.8, green: 0.9, blue: 0.98 }; // Light blue color

            // Create a batchUpdate request to update the rows with cell values and color
            const requests = [
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: challengerRowIndex - 1,
                            endRowIndex: challengerRowIndex,
                            startColumnIndex: 1, // Start at column B
                            endColumnIndex: 9   // End at column I
                        },
                        rows: [{
                            values: updatedChallengerRow.slice(1).map((cellValue, colIndex) => ({
                                userEnteredValue: { stringValue: cellValue },
                                userEnteredFormat: colIndex === 1 // Spec column
                                    ? { backgroundColor: specColorMap[updatedChallengerRow[2]] }
                                    : colIndex === 2 // Element column
                                        ? { backgroundColor: elementColorMap[updatedChallengerRow[3]] }
                                        : colIndex === 0 || colIndex >= 3 // Name and other light blue/green columns
                                            ? {
                                                backgroundColor: colIndex === 0 ? nameColumnColor : userInfoColumnColor,
                                            }
                                            : {}
                            }))
                        }],
                        fields: 'userEnteredValue,userEnteredFormat.backgroundColor'
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: challengedRowIndex - 1,
                            endRowIndex: challengedRowIndex,
                            startColumnIndex: 1, // Start at column B
                            endColumnIndex: 9   // End at column I
                        },
                        rows: [{
                            values: updatedChallengedRow.slice(1).map((cellValue, colIndex) => ({
                                userEnteredValue: { stringValue: cellValue },
                                userEnteredFormat: colIndex === 1 // Spec column
                                    ? { backgroundColor: specColorMap[updatedChallengedRow[2]] }
                                    : colIndex === 2 // Element column
                                        ? { backgroundColor: elementColorMap[updatedChallengedRow[3]] }
                                        : colIndex === 0 || colIndex >= 3 // Name and other light blue/green columns
                                            ? {
                                                backgroundColor: colIndex === 0 ? nameColumnColor : userInfoColumnColor,
                                            }
                                            : {}
                            }))
                        }],
                        fields: 'userEnteredValue,userEnteredFormat.backgroundColor'
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
