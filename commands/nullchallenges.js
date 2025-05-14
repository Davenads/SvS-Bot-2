const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');  // Use moment-timezone for better timezone handling
const { logError } = require('../logger');
const { getGoogleAuth } = require('../fixGoogleAuth');

// Initialize the Google Sheets API client
const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
  });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const sheetId = 0; // Numeric sheetId for 'SvS Ladder' tab
const DEFAULT_TIMEZONE = 'America/New_York'; // The timezone used for challenge dates
const MAX_CHALLENGE_DAYS = 2; // Maximum number of days a challenge can be active

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nullchallenges')
        .setDescription('Nullify challenges older than 3 days'),
    
    async execute(interaction) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] NullChallenges Command Execution Started`);
        console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);
        
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if the user has the '@SvS Manager' role
            const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
            if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
                console.log('└─ Error: User lacks SvS Manager role');
                return await interaction.editReply({
                    content: 'You do not have the required @SvS Manager role to use this command.',
                });
            }
            
            console.log('├─ Fetching data from Google Sheets...');
            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`,
            });

            const rows = result.data.values;
            if (!rows?.length) {
                console.log('└─ Error: No data found in the leaderboard');
                return await interaction.editReply({ 
                    content: 'No data available on the leaderboard.' 
                });
            }
            
            console.log(`├─ Processing ${rows.length} rows from the leaderboard...`);

            // Current time in the specified timezone
            const now = moment().tz(DEFAULT_TIMEZONE);
            console.log(`├─ Current time: ${now.format('YYYY-MM-DD HH:mm:ss z')}`);
            
            let requests = [];
            const processedChallenges = new Set();
            const nullifiedChallenges = [];
            const validChallengesFound = [];
            const challengesWithDateParsingIssues = [];

            // First pass: Identify all challenges that need to be nullified
            console.log('├─ First pass: Identifying challenges to nullify...');
            rows.forEach((row, index) => {
                if (!row[0] || !row[1]) return; // Skip rows without rank or name
                
                const playerRank = row[0]; // Player Rank
                const playerName = row[1]; // Player Name
                const status = row[5];     // Status
                const challengeDateStr = row[6]; // cDate
                const opponent = row[7];   // Opp#
                
                // Skip non-challenge rows
                if (status !== 'Challenge') return;
                
                // Log details for all challenges found
                console.log(`│  ├─ Found challenge: Rank #${playerRank} (${playerName})`);
                console.log(`│  │  ├─ Status: ${status}`);
                console.log(`│  │  ├─ Challenge date: ${challengeDateStr || 'N/A'}`);
                console.log(`│  │  └─ Opponent: ${opponent || 'N/A'}`);
                
                // Skip incomplete challenges
                if (!challengeDateStr || !opponent) {
                    console.log(`│  │     └─ Skipping: Incomplete challenge data`);
                    return;
                }
                
                // Handle specific date format: M/D, h:mm AM/PM EST
                let challengeDate;
                const dateFormat = 'M/D, h:mm A';

                // Remove timezone abbreviation (EST/EDT) before parsing
                const cleanDateStr = challengeDateStr.replace(/\s+(EST|EDT)$/i, '').trim();
                
                // Parse with the specific format
                const parsed = moment.tz(cleanDateStr, dateFormat, DEFAULT_TIMEZONE);
                if (parsed.isValid()) {
                    challengeDate = parsed;
                    console.log(`│  │     ├─ Successfully parsed date: ${parsed.format('YYYY-MM-DD HH:mm:ss z')}`);
                } else {
                    console.log(`│  │     ├─ Failed to parse with format: ${dateFormat}`);
                    console.log(`│  │     ├─ Original string: "${challengeDateStr}"`);
                    console.log(`│  │     └─ Cleaned string: "${cleanDateStr}"`);
                }

                // Handle year for dates (add current year, but handle year boundary cases)
                if (parsed.isValid()) {
                    // If the date appears to be in the future, it's likely from last year
                    const currentYear = now.year();
                    if (parsed.month() > now.month() || 
                        (parsed.month() === now.month() && parsed.date() > now.date())) {
                        parsed.year(currentYear - 1);
                        console.log(`│  │     ├─ Adjusted year to previous year: ${parsed.format('YYYY-MM-DD HH:mm:ss z')}`);
                    } else {
                        parsed.year(currentYear);
                        console.log(`│  │     ├─ Set year to current year: ${parsed.format('YYYY-MM-DD HH:mm:ss z')}`);
                    }
                    challengeDate = parsed;
                }
                
                if (challengeDate && challengeDate.isValid()) {
                    const hoursDiff = now.diff(challengeDate, 'hours');
                    const daysDiff = hoursDiff / 24;
                    
                    console.log(`│  │     ├─ Age: ${daysDiff.toFixed(2)} days (${hoursDiff} hours)`);
                    
                    if (daysDiff > MAX_CHALLENGE_DAYS) {
                        // Create a consistent key regardless of order
                        const challengeKey = [String(playerRank), String(opponent)].sort().join('-');
                        
                        if (!processedChallenges.has(challengeKey)) {
                            processedChallenges.add(challengeKey);
                            console.log(`│  │     └─ MARKED FOR NULLIFICATION (${challengeKey})`);
                            
                            validChallengesFound.push({
                                rowIndex: index,
                                playerRank: playerRank,
                                playerName: playerName,
                                opponent: opponent,
                                challengeDate: challengeDateStr,
                                daysDiff: daysDiff
                            });
                        } else {
                            console.log(`│  │     └─ Already processed challenge pair (${challengeKey})`);
                        }
                    } else {
                        console.log(`│  │     └─ Challenge is not old enough to nullify`);
                    }
                } else {
                    console.log(`│  │     └─ WARNING: Could not parse date "${challengeDateStr}" for player ${playerName} (Rank ${playerRank})`);
                    challengesWithDateParsingIssues.push({
                        playerName,
                        playerRank,
                        challengeDateStr
                    });
                }
            });
            
            console.log(`├─ Found ${validChallengesFound.length} challenges that need nullification`);
            console.log(`├─ ${challengesWithDateParsingIssues.length} challenges had date parsing issues`);
            
            // Second pass: Create update requests for each challenge to nullify
            console.log('├─ Second pass: Creating update requests...');
            for (const challenge of validChallengesFound) {
                console.log(`│  ├─ Processing challenge: Rank #${challenge.playerRank} (${challenge.playerName}) vs Rank #${challenge.opponent}`);
                
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
                console.log(`│  │  ├─ Added request to update challenger row (index ${challenge.rowIndex + 1})`);

                // Find and update the opponent's row
                const opponentRowIndex = rows.findIndex(row => row[0] === challenge.opponent);
                if (opponentRowIndex !== -1) {
                    requests.push({
                        updateCells: {
                            range: {
                                sheetId: sheetId,
                                startRowIndex: opponentRowIndex + 1,
                                endRowIndex: opponentRowIndex + 2,
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
                    console.log(`│  │  └─ Added request to update opponent row (index ${opponentRowIndex + 1})`);
                } else {
                    console.log(`│  │  └─ WARNING: Could not find opponent row with rank ${challenge.opponent}`);
                }

                // Store challenge details for the embed message
                const opponentName = rows.find(r => r[0] === challenge.opponent)?.[1] || 'Unknown';
                nullifiedChallenges.push({
                    player: challenge.playerName,
                    playerRank: challenge.playerRank,
                    opponent: opponentName,
                    opponentRank: challenge.opponent,
                    date: challenge.challengeDateStr,
                    daysPast: Math.floor(challenge.daysDiff)
                });
            }

            console.log(`├─ Generated ${requests.length} update requests`);

            if (requests.length > 0) {
                // Execute all updates
                console.log('├─ Executing batch update...');
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { requests }
                });
                console.log(`├─ Batch update completed successfully`);

                // Create embed message
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Nullified Old Challenges 🛡️')
                    .setDescription(`✨ Success! Nullified ${nullifiedChallenges.length} challenge pairs older than ${MAX_CHALLENGE_DAYS} days! ✨`)
                    .setColor(0x00AE86)
                    .setTimestamp();

                // Add nullified challenges details
                if (nullifiedChallenges.length > 0) {
                    const challengesList = nullifiedChallenges
                        .map(c => `Rank #${c.playerRank} ${c.player} vs Rank #${c.opponentRank} ${c.opponent} - ${c.daysPast} days old`)
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

                // Add date parsing issues if any
                if (challengesWithDateParsingIssues.length > 0) {
                    const issuesList = challengesWithDateParsingIssues
                        .map(c => `Rank #${c.playerRank} ${c.playerName}: date "${c.challengeDateStr}" could not be parsed`)
                        .join('\n');
                    
                    if (issuesList.length <= 1024) {
                        embed.addFields({
                            name: '⚠️ Date Parsing Issues (Manual Review Required)',
                            value: issuesList
                        });
                    }
                }

                embed.setFooter({ 
                    text: 'Challenges nullified successfully! Players can now issue new challenges.',
                    iconURL: interaction.client.user.displayAvatarURL()
                });

                // Send the public embed message
                console.log('├─ Sending embed message to channel...');
                await interaction.channel.send({ embeds: [embed] });

                // Update the deferred reply
                await interaction.editReply({ 
                    content: `Successfully nullified ${nullifiedChallenges.length} challenge pairs.` 
                });
                
                console.log(`└─ Command executed successfully: ${nullifiedChallenges.length} challenge pairs nullified`);
            } else {
                console.log('└─ No challenges to nullify found');
                await interaction.editReply({ 
                    content: `No challenges older than ${MAX_CHALLENGE_DAYS} days found.` 
                });
            }

        } catch (error) {
            console.error(`└─ Error executing nullchallenges command: ${error.message}`);
            console.error(error.stack);
            logError(`Nullchallenges command error: ${error.message}\nStack: ${error.stack}`);
            
            await interaction.editReply({
                content: 'An error occurred while processing the command. Please try again later.'
            });
        }
    },
};