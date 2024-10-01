require('dotenv').config();
const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger'); // Import the logger

const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT(
    credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']
)});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Ladder Bot testing';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('challenge')
        .setDescription('Challenge a player on the leaderboard')
        .addIntegerOption(option => 
            option.setName('challenger_rank')
                .setDescription('Your rank on the leaderboard')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('target_rank')
                .setDescription('The rank of the player you want to challenge')
                .setRequired(true)),
    
    async execute(interaction) {
        try {
            const challengerRank = interaction.options.getInteger('challenger_rank');
            const targetRank = interaction.options.getInteger('target_rank');
            const userId = interaction.user.id;

            // Fetch all data from the sheet dynamically
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:I`, // Fetches all rows starting from A2 to the end of column I
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                logError('No data available on the leaderboard.');
                return interaction.reply({ content: 'No data available on the leaderboard.', ephemeral: true });
            }

            // Find the challenger and target rows based on rank
            const challengerRow = rows.find(row => parseInt(row[0]) === challengerRank);
            const targetRow = rows.find(row => parseInt(row[0]) === targetRank);

            // Log detailed info about the fetched rows
            logError(`Challenger Row Details: ${JSON.stringify(challengerRow)}`);
            logError(`Target Row Details: ${JSON.stringify(targetRow)}`);

            // Log if rows couldn't be found
            if (!challengerRow) {
                logError(`Invalid challenger rank provided: ${challengerRank}`);
                return interaction.reply({ content: 'Invalid ranks provided.', ephemeral: true });
            }

            if (!targetRow) {
                logError(`Invalid target rank provided: ${targetRank}`);
                return interaction.reply({ content: 'Invalid ranks provided.', ephemeral: true });
            }

            // Validate that the person issuing the challenge is the one making the command
            if (challengerRow[8] !== userId.toString()) {  // Updated to check Column I (index 8)
                logError(`User ID mismatch. Command issuer ID: ${userId}, Expected ID: ${challengerRow[8]}`);
                return interaction.reply({ content: 'You can only initiate challenges for your own character.', ephemeral: true });
            }

            // Ensure both players are available
            if (challengerRow[5] !== 'Available' || targetRow[5] !== 'Available') {
                logError(`One or both players are not available for a challenge. Challenger status: ${challengerRow[5]}, Target status: ${targetRow[5]}`);
                return interaction.reply({ content: 'One or both players are not available for a challenge.', ephemeral: true });
            }

            // Calculate the effective rank accounting for vacation players
            let maxReachableRank = challengerRank - 3; // Base: can challenge up to 3 ranks ahead
            for (let rank = challengerRank - 1; rank > targetRank; rank--) {
                const row = rows.find(r => parseInt(r[0]) === rank);

                if (row && row[5] === 'Vacation') {
                    maxReachableRank--; // Add one more allowable challenge range per vacation player
                }
            }

            // Logging the calculation process
            logError(`Calculated max reachable rank for challenge: ${maxReachableRank}`);

            if (targetRank < maxReachableRank) {
                return interaction.reply({ content: `You can only challenge up to 3 ranks ahead unless skipping vacation players.`, ephemeral: true });
            }

            // Capture the current timestamp for the challenge date
            const challengeDate = new Date(interaction.createdTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York' });

            // Update the status, challenge date, and opponent columns in Google Sheets for both players
            const challengerRowIndex = rows.findIndex(row => parseInt(row[0]) === challengerRank) + 2;
            const targetRowIndex = rows.findIndex(row => parseInt(row[0]) === targetRank) + 2;

            const challengerUpdateRange = `${SHEET_NAME}!F${challengerRowIndex}:H${challengerRowIndex}`;
            const targetUpdateRange = `${SHEET_NAME}!F${targetRowIndex}:H${targetRowIndex}`;

            // Log update ranges and values before sending the data to Google Sheets
            logError(`Updating Challenger Row at Range: ${challengerUpdateRange} with Values: ["Challenge", "${challengeDate}", ${targetRank}]`);
            logError(`Updating Target Row at Range: ${targetUpdateRange} with Values: ["Challenge", "${challengeDate}", ${challengerRank}]`);

            // Update Challenger Status and Challenge Date
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: challengerUpdateRange,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [['Challenge', challengeDate, targetRank]] },
            });

            // Update Target Status and Challenge Date
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: targetUpdateRange,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [['Challenge', challengeDate, challengerRank]] },
            });

            await interaction.reply({ content: `Challenge initiated between rank #${challengerRank} (${challengerRow[1]}) and rank #${targetRank} (${targetRow[1]})!`, ephemeral: false });
        } catch (error) {
            logError(`Error during challenge execution: ${error.message}\nStack: ${error.stack}`);
            await interaction.reply({ content: 'There was an error initiating the challenge. Please try again.', ephemeral: true });
        }
    },
};
