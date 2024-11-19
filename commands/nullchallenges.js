const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const moment = require('moment');

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
        .setName('nullchallenges')
        .setDescription('Nullify challenges older than 3 days'),
    
    async execute(interaction) {
        // Defer the reply immediately
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if the user has the '@SvS Manager' role
            const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
            if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
                return await interaction.editReply({
                    content: 'You do not have the required @SvS Manager role to use this command.',
                });
            }

            // Fetch data from the Google Sheet (Main Tab: 'SvS Ladder')
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`,  // Fetch columns A to K
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                return await interaction.editReply({ 
                    content: 'No data available on the leaderboard.' 
                });
            }

            const now = moment();
            let requests = [];
            let nullifiedPairs = 0;
            const processedOpponents = new Set();
            const nullifiedChallenges = [];

            rows.forEach((row, index) => {
                const status = row[5]; // Column F: Status
                const challengeDate = row[6]; // Column G: cDate
                const opponent = row[7]; // Column H: Opp#
                const player = row[1]; // Column B: Player Name
                
                if (status === 'Challenge' && challengeDate && opponent && !processedOpponents.has(opponent)) {
                    // Parse challenge date using moment
                    const challengeDateObj = moment(challengeDate, 'MM/DD, hh:mm A z');
                    if (challengeDateObj.isValid() && now.diff(challengeDateObj, 'days') > 3) {
                        // Store challenge details for logging
                        nullifiedChallenges.push({
                            player: player,
                            opponent: rows.find(r => r[0] === opponent)?.[1] || 'Unknown',
                            date: challengeDate
                        });

                        // Nullify the challenge by updating the status and clearing relevant columns
                        row[5] = 'Available'; // Set status to 'Available'
                        row[6] = ''; // Clear cDate
                        row[7] = ''; // Clear Opp#

                        requests.push({
                            updateCells: {
                                range: {
                                    sheetId: sheetId,
                                    startRowIndex: index + 1,
                                    endRowIndex: index + 2,
                                    startColumnIndex: 0,
                                    endColumnIndex: 11
                                },
                                rows: [
                                    {
                                        values: row.map((cellValue, cellIndex) => ({
                                            userEnteredValue: { stringValue: cellValue },
                                            userEnteredFormat: cellIndex === 0 ? { horizontalAlignment: 'RIGHT' } : {}
                                        }))
                                    }
                                ],
                                fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
                            }
                        });
                        nullifiedPairs++;
                        processedOpponents.add(opponent);
                        processedOpponents.add(player);
                    }
                }
            });

            if (requests.length > 0) {
                // Execute the batchUpdate request to nullify old challenges
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        requests
                    }
                });

                // Create an embed message to announce the result
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Nullified Old Challenges 🛡️')
                    .setDescription(`✨ Success! Nullified challenge pairs older than 3 days: **${Math.floor(nullifiedPairs / 2)}** ! ✨`)
                    .setColor(0x00AE86)
                    .addFields(
                        { name: 'Status', value: '✅ Challenges cleared and status set to **Available**' },
                        { name: 'Challenge Date', value: '🗓️ Dates cleared for affected challenges' },
                        { name: 'Opponents', value: '🤝 Opponent information cleared' }
                    );

                // Add nullified challenges details if any exist
                if (nullifiedChallenges.length > 0) {
                    const challengesList = nullifiedChallenges
                        .map(c => `${c.player} vs ${c.opponent} (${c.date})`)
                        .join('\n');
                    embed.addFields({
                        name: 'Nullified Challenges',
                        value: challengesList.length > 1024 ? 
                            challengesList.substring(0, 1021) + '...' : 
                            challengesList
                    });
                }

                embed.setFooter({ text: 'Stay fierce and keep challenging! 💪⚔️' })
                    .setTimestamp();

                // Send the public embed message
                await interaction.channel.send({ embeds: [embed] });

                // Update the deferred reply
                await interaction.editReply({ 
                    content: `Successfully nullified ${Math.floor(nullifiedPairs / 2)} challenge pairs.`
                });
            } else {
                await interaction.editReply({ 
                    content: 'No challenges older than 3 days found.' 
                });
            }

        } catch (error) {
            console.error('Error nullifying old challenges:', error);

            // Try to send error messages
            try {
                await interaction.channel.send({
                    content: 'An error occurred while nullifying old challenges. Please try again later.'
                });

                await interaction.editReply({
                    content: 'An error occurred while processing the command. The error has been logged.'
                });
            } catch (followUpError) {
                console.error('Error sending error messages:', followUpError);
            }
        }
    },
};