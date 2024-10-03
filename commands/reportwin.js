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
const sheetId = 0; // Numeric sheetId for 'SvS Ladder' tab

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
            // Fetch data from the Google Sheet (Main Tab: 'SvS Ladder')
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`,  // Fetch columns A to K
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

            // Preserve Notes (Column J) and Cooldown (Column K) and prepare other data for swapping, excluding the rank column (Column A)
            const updatedChallengerRow = [...challengedRow];
            updatedChallengerRow[0] = challengerRow[0]; // Keep the original rank (Column A)
            updatedChallengerRow[5] = 'Available'; // Set status to 'Available'
            updatedChallengerRow[6] = ''; // Clear cDate
            updatedChallengerRow[7] = ''; // Clear Opp#
            updatedChallengerRow[9] = challengedRow[9]; // Preserve Notes (Column J)
            updatedChallengerRow[10] = challengedRow[10]; // Preserve Cooldowns (Column K)

            const updatedChallengedRow = [...challengerRow];
            updatedChallengedRow[0] = challengedRow[0]; // Keep the original rank (Column A)
            updatedChallengedRow[5] = 'Available'; // Set status to 'Available'
            updatedChallengedRow[6] = ''; // Clear cDate
            updatedChallengedRow[7] = ''; // Clear Opp#
            updatedChallengedRow[9] = challengerRow[9]; // Preserve Notes (Column J)
            updatedChallengedRow[10] = challengerRow[10]; // Preserve Cooldowns (Column K)

            // Define color mappings (this can remain the same)
            const specColorMap = {
                'Vita': { red: 0.96, green: 0.80, blue: 0.69 },
                'ES': { red: 0.78, green: 0.86, blue: 0.94 },
            };

            const elementColorMap = {
                'Fire': { red: 0.98, green: 0.59, blue: 0.51 },
                'Light': { red: 1.0, green: 0.93, blue: 0.69 },
                'Cold': { red: 0.68, green: 0.85, blue: 0.90 },
            };

            const nameColumnColor = { red: 0.8, green: 0.94, blue: 0.75 };
            const userInfoColumnColor = { red: 0.8, green: 0.9, blue: 0.98 };

            // Create a batchUpdate request to update the rows with cell values and color
            const requests = [
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: challengerRowIndex - 1,
                            endRowIndex: challengerRowIndex,
                            startColumnIndex: 1,
                            endColumnIndex: 11  // Adjusted for columns B to K (Name to Cooldowns)
                        },
                        rows: [{
                            values: updatedChallengerRow.slice(1).map((cellValue, colIndex) => ({
                                userEnteredValue: { stringValue: cellValue },
                                userEnteredFormat: colIndex === 1 
                                    ? { backgroundColor: specColorMap[updatedChallengerRow[2]] }
                                    : colIndex === 2 
                                        ? { backgroundColor: elementColorMap[updatedChallengerRow[3]] }
                                        : colIndex === 0 || colIndex >= 3 
                                            ? {
                                                backgroundColor: colIndex === 0 ? nameColumnColor : userInfoColumnColor,
                                            }
                                            : {}
                            }))
                        }],
                        fields: 'userEnteredValue, userEnteredFormat.backgroundColor'  // Corrected fields
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: challengedRowIndex - 1,
                            endRowIndex: challengedRowIndex,
                            startColumnIndex: 1,
                            endColumnIndex: 11  // Adjusted for columns B to K (Name to Cooldowns)
                        },
                        rows: [{
                            values: updatedChallengedRow.slice(1).map((cellValue, colIndex) => ({
                                userEnteredValue: { stringValue: cellValue },
                                userEnteredFormat: colIndex === 1 
                                    ? { backgroundColor: specColorMap[updatedChallengedRow[2]] }
                                    : colIndex === 2 
                                        ? { backgroundColor: elementColorMap[updatedChallengedRow[3]] }
                                        : colIndex === 0 || colIndex >= 3 
                                            ? {
                                                backgroundColor: colIndex === 0 ? nameColumnColor : userInfoColumnColor,
                                            }
                                            : {}
                            }))
                        }],
                        fields: 'userEnteredValue, userEnteredFormat.backgroundColor'  // Corrected fields
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

            // Public success message
            await interaction.channel.send(`Challenge result reported successfully! The ranks have been swapped between #${challengerRank} and #${challengedRank}.`);

            return interaction.reply({ content: `Challenge result reported successfully!`, ephemeral: true });

        } catch (error) {
            console.error('Error reporting match result:', error);

            // Public error message
            await interaction.channel.send('An error occurred while reporting the match result. Please try again later.');

            return interaction.reply({
                content: 'An error occurred while reporting the match result. Please try again later.',
                ephemeral: true
            });
        }
    },
};
