const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const moment = require('moment');  // Use regular moment

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
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if the user has the '@SvS Manager' role
            const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
            if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
                return await interaction.editReply({
                    content: 'You do not have the required @SvS Manager role to use this command.',
                });
            }

            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`,
            });

            const rows = result.data.values;
            if (!rows?.length) {
                return await interaction.editReply({ 
                    content: 'No data available on the leaderboard.' 
                });
            }

            const now = moment();
            let requests = [];
            const processedChallenges = new Set();
            const nullifiedChallenges = [];

            // First pass: Identify all challenges that need to be nullified
            const challengesToNullify = rows.reduce((acc, row, index) => {
                const status = row[5]; // Status
                const challengeDateStr = row[6]; // cDate
                const opponent = row[7]; // Opp#
                const playerName = row[1]; // Player Name
                const playerRank = row[0]; // Player Rank

                if (status === 'Challenge' && challengeDateStr && opponent) {
                    // Handle multiple date formats and edge cases
                    let challengeDate;
                    const dateFormats = [
                        'M/D, h:mm A',
                        'M/D/YYYY, h:mm A',
                        'MM/DD, hh:mm A',
                        'MM/DD/YYYY, hh:mm A'
                    ];

                    // Remove any timezone abbreviations before parsing
                    const cleanDateStr = challengeDateStr.replace(/\s+(EDT|EST)$/, '');

                    // Try parsing with different formats
                    for (const format of dateFormats) {
                        const parsed = moment(cleanDateStr, format);
                        if (parsed.isValid()) {
                            challengeDate = parsed;
                            break;
                        }
                    }

                    if (challengeDate && challengeDate.isValid()) {
                        const daysDiff = now.diff(challengeDate, 'hours') / 24;
                        
                        if (daysDiff > 3) {
                            const challengeKey = [playerRank, opponent].sort().join('-');
                            if (!processedChallenges.has(challengeKey)) {
                                processedChallenges.add(challengeKey);
                                acc.push({
                                    rowIndex: index,
                                    playerName: playerName,
                                    opponent: opponent,
                                    challengeDate: challengeDateStr,
                                    daysDiff: daysDiff
                                });
                            }
                        }
                    } else {
                        console.log(`Warning: Could not parse date "${challengeDateStr}" for player ${playerName}`);
                    }
                }
                return acc;
            }, []);

            // Second pass: Create update requests for each challenge to nullify
            challengesToNullify.forEach(challenge => {
                // Update the challenger's row
                requests.push({
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: challenge.rowIndex + 1,
                            endRowIndex: challenge.rowIndex + 2,
                            startColumnIndex: 5, // Column F (Status)
                            endColumnIndex: 8 // Through Column H (Opp#)
                        },
                        rows: [{
                            values: [
                                { userEnteredValue: { stringValue: 'Available' } },
                                { userEnteredValue: { stringValue: '' } },
                                { userEnteredValue: { stringValue: '' } }
                            ]
                        }],
                        fields: 'userEnteredValue'
                    }
                });

                // Find and update the opponent's row
                const opponentRow = rows.findIndex(row => row[0] === challenge.opponent);
                if (opponentRow !== -1) {
                    requests.push({
                        updateCells: {
                            range: {
                                sheetId: sheetId,
                                startRowIndex: opponentRow + 1,
                                endRowIndex: opponentRow + 2,
                                startColumnIndex: 5, // Column F (Status)
                                endColumnIndex: 8 // Through Column H (Opp#)
                            },
                            rows: [{
                                values: [
                                    { userEnteredValue: { stringValue: 'Available' } },
                                    { userEnteredValue: { stringValue: '' } },
                                    { userEnteredValue: { stringValue: '' } }
                                ]
                            }],
                            fields: 'userEnteredValue'
                        }
                    });
                }

                // Store challenge details for the embed message
                nullifiedChallenges.push({
                    player: challenge.playerName,
                    opponent: rows.find(r => r[0] === challenge.opponent)?.[1] || 'Unknown',
                    date: challenge.challengeDate,
                    daysPast: Math.floor(challenge.daysDiff)
                });
            });

            if (requests.length > 0) {
                // Execute all updates
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { requests }
                });

                // Create embed message
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Nullified Old Challenges 🛡️')
                    .setDescription(`✨ Success! Nullified ${nullifiedChallenges.length} challenge pairs older than 3 days! ✨`)
                    .setColor(0x00AE86)
                    .setTimestamp();

                // Add nullified challenges details
                if (nullifiedChallenges.length > 0) {
                    const challengesList = nullifiedChallenges
                        .map(c => `${c.player} vs ${c.opponent} (${c.date}) - ${c.daysPast} days old`)
                        .join('\n');
                    
                    if (challengesList.length <= 1024) {
                        embed.addFields({
                            name: 'Nullified Challenges',
                            value: challengesList
                        });
                    } else {
                        // Split into multiple fields if too long
                        const chunks = challengesList.match(/.{1,1024}/g) || [];
                        chunks.forEach((chunk, index) => {
                            embed.addFields({
                                name: index === 0 ? 'Nullified Challenges' : '⠀', // Empty character for subsequent fields
                                value: chunk
                            });
                        });
                    }
                }

                embed.setFooter({ 
                    text: 'Challenges nullified successfully! Players can now issue new challenges.',
                    iconURL: interaction.client.user.displayAvatarURL()
                });

                // Send the public embed message
                await interaction.channel.send({ embeds: [embed] });

                // Update the deferred reply
                await interaction.editReply({ 
                    content: `Successfully nullified ${nullifiedChallenges.length} challenge pairs.` 
                });
            } else {
                await interaction.editReply({ 
                    content: 'No challenges older than 3 days found.' 
                });
            }

        } catch (error) {
            console.error('Error nullifying old challenges:', error);
            await interaction.editReply({
                content: 'An error occurred while processing the command. Please try again later.'
            });
        }
    },
};