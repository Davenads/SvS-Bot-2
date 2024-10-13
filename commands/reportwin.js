// Load environment variables
require('dotenv').config();

// Import necessary modules
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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

const elementEmojis = {
    'Fire': '🔥',
    'Light': '⚡',
    'Cold': '❄️'
};

const elementColors = {
    'Fire': { red: 0.976, green: 0.588, blue: 0.510 }, // #f99682
    'Light': { red: 1, green: 0.925, blue: 0.682 },   // #ffecae
    'Cold': { red: 0.498, green: 0.631, blue: 1 }     // #7fa1ff
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportwin')
        .setDescription('Report the results of a challenge')
        .addIntegerOption(option =>
            option.setName('winner_rank')
                .setDescription('The rank number of the winner')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('loser_rank')
                .setDescription('The rank number of the loser')
                .setRequired(true)),
    
    async execute(interaction) {
        const winnerRank = interaction.options.getInteger('winner_rank');
        const loserRank = interaction.options.getInteger('loser_rank');
        const userId = interaction.user.id;

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

            // Find the winner and loser rows based on rank
            const winnerRow = rows.find(row => parseInt(row[0]) === winnerRank);
            const loserRow = rows.find(row => parseInt(row[0]) === loserRank);

            if (!winnerRow || !loserRow) {
                return interaction.reply({ content: 'Invalid ranks provided.', ephemeral: true });
            }

            const winnerDiscordId = winnerRow[8]; // Discord user ID of the winner
            const loserDiscordId = loserRow[8]; // Discord user ID of the loser

            // Check if the user is allowed to execute this command
            if (userId !== winnerDiscordId && userId !== loserDiscordId && !interaction.member.roles.cache.some(role => role.name === 'SvS Manager')) {
                return interaction.reply({ content: 'You do not have permission to report this challenge result.', ephemeral: true });
            }

            const winnerDiscordName = winnerRow[4]; // Discord name of the winner
            const loserDiscordName = loserRow[4]; // Discord name of the loser
            const winnerElement = winnerRow[3]; // Element of the winner
            const loserElement = loserRow[3]; // Element of the loser
            const winnerEmoji = elementEmojis[winnerElement] || '';
            const loserEmoji = elementEmojis[loserElement] || '';

            const winnerRowIndex = rows.findIndex(row => parseInt(row[0]) === winnerRank) + 2;
            const loserRowIndex = rows.findIndex(row => parseInt(row[0]) === loserRank) + 2;

            let updatedWinnerRow = [...winnerRow];
            let updatedLoserRow = [...loserRow];

            if (winnerRank > loserRank) {
                // Swap rows if the winner has a worse rank (higher number)
                updatedWinnerRow = [...loserRow];
                updatedWinnerRow[0] = String(winnerRow[0]); // Keep the original rank (Column A)
                
                updatedLoserRow = [...winnerRow];
                updatedLoserRow[0] = String(loserRow[0]); // Keep the original rank (Column A)

                // Swap Notes (Column J) and Cooldown (Column K)
                [updatedWinnerRow[9], updatedLoserRow[9]] = [loserRow[9], winnerRow[9]]; // Swap Notes
                [updatedWinnerRow[10], updatedLoserRow[10]] = [loserRow[10], winnerRow[10]]; // Swap Cooldown
            } else {
                updatedWinnerRow[0] = String(updatedWinnerRow[0]);
                updatedLoserRow[0] = String(updatedLoserRow[0]);
                
                // Ensure Notes and Cooldown remain consistent if no swap is needed
                updatedWinnerRow[9] = winnerRow[9];
                updatedWinnerRow[10] = winnerRow[10];
                updatedLoserRow[9] = loserRow[9];
                updatedLoserRow[10] = loserRow[10];
            }

            // Set status to 'Available' and clear challenge-specific columns
            updatedWinnerRow[5] = 'Available'; // Set status to 'Available'
            updatedWinnerRow[6] = ''; // Clear cDate
            updatedWinnerRow[7] = ''; // Clear Opp#
            updatedLoserRow[5] = 'Available'; // Set status to 'Available'
            updatedLoserRow[6] = ''; // Clear cDate
            updatedLoserRow[7] = ''; // Clear Opp#

            // Create a batchUpdate request to update the rows with new values
            const requests = [
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: winnerRowIndex - 1,
                            endRowIndex: winnerRowIndex,
                            startColumnIndex: 0,
                            endColumnIndex: 11  // Columns A to K
                        },
                        rows: [
                            {
                                values: updatedWinnerRow.map((cellValue, index) => ({
                                    userEnteredValue: { stringValue: cellValue },
                                    userEnteredFormat: index === 0 ? { horizontalAlignment: 'RIGHT' } : {} // Ensure right alignment for Column A
                                }))
                            }
                        ],
                        fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: loserRowIndex - 1,
                            endRowIndex: loserRowIndex,
                            startColumnIndex: 0,
                            endColumnIndex: 11  // Columns A to K
                        },
                        rows: [
                            {
                                values: updatedLoserRow.map((cellValue, index) => ({
                                    userEnteredValue: { stringValue: cellValue },
                                    userEnteredFormat: index === 0 ? { horizontalAlignment: 'RIGHT' } : {} // Ensure right alignment for Column A
                                }))
                            }
                        ],
                        fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
                    }
                }
            ];

            // Execute the batchUpdate request to update rows
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests
                }
            });

            // Manually assign colors to the element column after the swap
            const elementUpdateRequests = [
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: winnerRowIndex - 1,
                            endRowIndex: winnerRowIndex,
                            startColumnIndex: 3, // Column D (Element)
                            endColumnIndex: 4
                        },
                        rows: [
                            {
                                values: [
                                    {
                                        userEnteredFormat: {
                                            backgroundColor: elementColors[updatedWinnerRow[3]]
                                        }
                                    }
                                ]
                            }
                        ],
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: loserRowIndex - 1,
                            endRowIndex: loserRowIndex,
                            startColumnIndex: 3, // Column D (Element)
                            endColumnIndex: 4
                        },
                        rows: [
                            {
                                values: [
                                    {
                                        userEnteredFormat: {
                                            backgroundColor: elementColors[updatedLoserRow[3]]
                                        }
                                    }
                                ]
                            }
                        ],
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                }
            ];

            // Execute the batchUpdate request to update element colors
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: elementUpdateRequests
                }
            });

            // Create an embed message to announce the result
            const embed = new EmbedBuilder()
                .setTitle('🔥 SvS Challenge Result Reported ⚔️')
                .setDescription(`The challenge result has been successfully reported!

**Winner Rank:** #${winnerRank} (${winnerDiscordName}) ${winnerEmoji}
**Loser Rank:** #${loserRank} (${loserDiscordName}) ${loserEmoji}

${winnerRank > loserRank ? '🏆 The ranks have been swapped between the winner and loser.' : '🎉 No rank swap was needed.'}`)
                .setColor(0xFFA500)
                .setThumbnail('https://example.com/svs_logo.png') // Example URL for SvS flair
                .setFooter({ text: 'SvS Ladder Bot - Stay Fierce!' })
                .setTimestamp();

            // Send the embed message
            await interaction.channel.send({ embeds: [embed] });

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