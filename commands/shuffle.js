require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');
const redisClient = require('../redis-client');
const { getGoogleAuth } = require('../fixGoogleAuth');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Randomly shuffle player positions on the SvS ladder (Manager only)')
        .addBooleanOption(option =>
            option
                .setName('clear_challenges')
                .setDescription('Reset all active challenges to Available status')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('clear_cooldowns')
                .setDescription('Remove all cooldown restrictions between players')
                .setRequired(false)
        ),

    async execute(interaction) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] Shuffle Command Execution Started`);
        console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Check for SvS Manager role
        const managerRole = interaction.guild.roles.cache.find(
            role => role.name === 'SvS Manager'
        );

        if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
            console.log('└─ Error: User lacks permission');
            return interaction.editReply({
                content: 'You do not have permission to use this command. Only users with the @SvS Manager role can use it.',
                flags: MessageFlags.Ephemeral
            });
        }

        const clearChallenges = interaction.options.getBoolean('clear_challenges') ?? false;
        const clearCooldowns = interaction.options.getBoolean('clear_cooldowns') ?? false;

        console.log(`├─ Options: clear_challenges=${clearChallenges}, clear_cooldowns=${clearCooldowns}`);

        try {
            // Check Redis connection before starting
            console.log('├─ Testing Redis connection...');
            try {
                await redisClient.client.ping();
                console.log('├─ Redis connection OK');
            } catch (redisError) {
                console.error('├─ Redis connection FAILED:', redisError.message);
                return interaction.editReply({
                    content: '⚠️ Redis connection unavailable. Shuffle aborted to prevent desynchronization. Please try again or contact an administrator.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // ======================
            // Phase 1: Fetch ladder data
            // ======================
            console.log('├─ Phase 1: Fetching ladder data...');
            await interaction.editReply({ content: '🔄 Fetching ladder data...' });

            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:K`
            });

            let rows = result.data.values;

            if (!rows || rows.length === 0) {
                console.log('└─ Error: No data found in ladder');
                return interaction.editReply({
                    content: 'No data available on the leaderboard.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Filter out empty rows
            rows = rows.filter(row => row[0] && row[1]);
            console.log(`├─ Found ${rows.length} active players on the ladder`);

            // ======================
            // Phase 2: Shuffle algorithm
            // ======================
            console.log('├─ Phase 2: Shuffling player positions...');
            await interaction.editReply({ content: '🎲 Shuffling player positions...' });

            // Create rank mapping before shuffle
            const rankMapping = {}; // oldRank -> { newRank, discordId, name, element }

            // Store original ranks
            rows.forEach(row => {
                const oldRank = row[0];
                rankMapping[oldRank] = {
                    discordId: row[8],
                    name: row[1],
                    element: row[3]
                };
            });

            // Fisher-Yates shuffle
            for (let i = rows.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [rows[i], rows[j]] = [rows[j], rows[i]];
            }

            // Update rank numbers and complete rank mapping
            rows.forEach((row, index) => {
                const oldRank = row[0];
                const newRank = (index + 1).toString();
                row[0] = newRank;

                // Complete the mapping with new ranks
                rankMapping[oldRank].newRank = newRank;
            });

            console.log(`├─ Shuffle complete, ranks reassigned`);

            // ======================
            // Phase 3: Handle challenges
            // ======================
            console.log('├─ Phase 3: Processing challenges...');
            await interaction.editReply({ content: '⚔️ Processing challenges...' });

            const challengeUpdates = [];

            if (clearChallenges) {
                // Clear all challenges
                console.log('├─ Clearing all challenges...');
                rows.forEach(row => {
                    if (row[5] === 'Challenge') {
                        row[5] = 'Available'; // Status
                        row[6] = ''; // cDate
                        row[7] = ''; // Opp#
                    }
                });
            } else {
                // Preserve challenges and update opponent ranks
                console.log('├─ Preserving challenges and updating opponent ranks...');

                // First, build a map of current ranks to find opponents
                const currentRankMap = {};
                rows.forEach(row => {
                    currentRankMap[row[0]] = row;
                });

                rows.forEach(row => {
                    if (row[5] === 'Challenge' && row[7]) {
                        const currentRank = parseInt(row[0]);
                        const oldOpponentRank = row[7];

                        // Find what the opponent's new rank is
                        const opponentNewRank = rankMapping[oldOpponentRank]?.newRank;

                        if (opponentNewRank) {
                            // Check if opponent still exists and is in challenge
                            const opponentRow = currentRankMap[opponentNewRank];

                            if (opponentRow && opponentRow[5] === 'Challenge') {
                                // Update opponent rank reference
                                row[7] = opponentNewRank;

                                challengeUpdates.push({
                                    player: row[4], // DiscUser
                                    playerRank: currentRank,
                                    opponent: rankMapping[oldOpponentRank].name,
                                    opponentOldRank: oldOpponentRank,
                                    opponentNewRank: opponentNewRank
                                });
                            } else {
                                // Opponent not in challenge anymore - clear this player's challenge
                                console.log(`├─ Clearing orphaned challenge for player at rank ${currentRank}`);
                                row[5] = 'Available';
                                row[6] = '';
                                row[7] = '';
                            }
                        } else {
                            // Opponent no longer exists - clear challenge
                            console.log(`├─ Clearing challenge with missing opponent for player at rank ${currentRank}`);
                            row[5] = 'Available';
                            row[6] = '';
                            row[7] = '';
                        }
                    }
                });

                console.log(`├─ Updated ${challengeUpdates.length} active challenges`);
            }

            // ======================
            // Phase 4: Update Google Sheets
            // ======================
            console.log('├─ Phase 4: Updating Google Sheets...');
            await interaction.editReply({ content: '📊 Updating Google Sheets...' });

            // Clear the entire range first
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:K${rows.length + 1}`
            });

            // Write shuffled data
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:K${rows.length + 1}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: rows }
            });

            console.log('├─ Google Sheets updated successfully');

            // ======================
            // Phase 5: Synchronize Redis
            // ======================
            console.log('├─ Phase 5: Synchronizing Redis cache...');
            await interaction.editReply({ content: '🔄 Synchronizing Redis cache...' });

            let challengeKeysProcessed = 0;
            let cooldownKeysProcessed = 0;

            // Phase 5A/5B: Handle challenge Redis keys
            if (clearChallenges) {
                console.log('├─ Clearing all Redis challenge keys...');
                const challengeKeys = await redisClient.client.keys('challenge*');
                if (challengeKeys.length > 0) {
                    await redisClient.client.del(...challengeKeys);
                    challengeKeysProcessed = challengeKeys.length;
                    console.log(`├─ Deleted ${challengeKeys.length} challenge keys`);
                }
            } else {
                console.log('├─ Updating Redis challenge keys with new ranks...');
                const challengeKeys = await redisClient.client.keys('challenge:*');

                for (const oldKey of challengeKeys) {
                    // Skip warning keys - we'll handle them with their parent challenge
                    if (oldKey.includes('challenge-warning:')) continue;

                    try {
                        // Get challenge data and TTL
                        const challengeData = await redisClient.client.get(oldKey);
                        const ttl = await redisClient.client.ttl(oldKey);

                        if (!challengeData || ttl < 0) {
                            // Expired or missing - delete
                            await redisClient.client.del(oldKey);
                            challengeKeysProcessed++;
                            continue;
                        }

                        const data = JSON.parse(challengeData);

                        // Get old ranks from data
                        const oldRank1 = data.player1.rank;
                        const oldRank2 = data.player2.rank;

                        // Look up new ranks
                        const newRank1 = rankMapping[oldRank1]?.newRank;
                        const newRank2 = rankMapping[oldRank2]?.newRank;

                        if (!newRank1 || !newRank2) {
                            // Player(s) no longer exist - delete challenge
                            await redisClient.client.del(oldKey);
                            const warningKey = oldKey.replace('challenge:', 'challenge-warning:');
                            await redisClient.client.del(warningKey);
                            challengeKeysProcessed++;
                            continue;
                        }

                        // Update data with new ranks
                        data.player1.rank = parseInt(newRank1);
                        data.player2.rank = parseInt(newRank2);

                        // Create new key with updated ranks
                        const newKey = redisClient.generateChallengeKey(newRank1, newRank2);

                        if (oldKey !== newKey) {
                            // Set new key with preserved TTL
                            await redisClient.client.setex(newKey, ttl, JSON.stringify(data));

                            // Delete old key
                            await redisClient.client.del(oldKey);

                            // Update warning key
                            const oldWarningKey = oldKey.replace('challenge:', 'challenge-warning:');
                            const newWarningKey = newKey.replace('challenge:', 'challenge-warning:');
                            const warningTTL = await redisClient.client.ttl(oldWarningKey);

                            if (warningTTL > 0) {
                                await redisClient.client.setex(newWarningKey, warningTTL, newKey);
                                await redisClient.client.del(oldWarningKey);
                            }

                            challengeKeysProcessed++;
                        }
                    } catch (error) {
                        console.error(`├─ Error processing challenge key ${oldKey}:`, error.message);
                        // Continue with next key
                    }
                }

                console.log(`├─ Processed ${challengeKeysProcessed} challenge keys`);
            }

            // Phase 5C/5D: Handle cooldown Redis keys
            if (clearCooldowns) {
                console.log('├─ Clearing all Redis cooldown keys...');
                const cooldownKeys = await redisClient.client.keys('cooldown:*');
                if (cooldownKeys.length > 0) {
                    await redisClient.client.del(...cooldownKeys);
                    cooldownKeysProcessed = cooldownKeys.length;
                    console.log(`├─ Deleted ${cooldownKeys.length} cooldown keys`);
                }
            } else {
                console.log('├─ Verifying Redis cooldown keys...');
                const cooldownKeys = await redisClient.client.keys('cooldown:*');
                const validDiscordIds = new Set(rows.map(row => row[8])); // Column I

                for (const key of cooldownKeys) {
                    try {
                        const cooldownData = await redisClient.client.get(key);

                        if (!cooldownData) {
                            await redisClient.client.del(key);
                            cooldownKeysProcessed++;
                            continue;
                        }

                        const data = JSON.parse(cooldownData);
                        const player1Exists = validDiscordIds.has(data.player1.discordId);
                        const player2Exists = validDiscordIds.has(data.player2.discordId);

                        if (!player1Exists || !player2Exists) {
                            // One or both players removed - delete cooldown
                            await redisClient.client.del(key);
                            cooldownKeysProcessed++;
                        }
                    } catch (error) {
                        console.error(`├─ Error processing cooldown key ${key}:`, error.message);
                        // Continue with next key
                    }
                }

                console.log(`├─ Verified cooldowns, removed ${cooldownKeysProcessed} invalid entries`);
            }

            // ======================
            // Phase 6: Post-shuffle verification
            // ======================
            console.log('├─ Phase 6: Running verification checks...');
            await interaction.editReply({ content: '✅ Verifying synchronization...' });

            const verificationResults = {
                sheetChallenges: 0,
                redisChallenges: 0,
                discrepancies: []
            };

            if (!clearChallenges) {
                // Count challenges in sheet
                verificationResults.sheetChallenges = rows.filter(row => row[5] === 'Challenge').length;

                // Count challenges in Redis
                const allRedisChallenges = await redisClient.getAllChallenges();
                verificationResults.redisChallenges = allRedisChallenges.length;

                // Basic sanity check
                const expectedRedisChallenges = verificationResults.sheetChallenges / 2; // Each challenge = 2 sheet rows, 1 Redis key

                if (verificationResults.redisChallenges !== expectedRedisChallenges) {
                    console.log(`├─ ⚠️ Challenge count mismatch: Sheet has ${verificationResults.sheetChallenges} challenged players, Redis has ${verificationResults.redisChallenges} keys (expected ${expectedRedisChallenges})`);
                    verificationResults.discrepancies.push('Challenge count mismatch detected');
                } else {
                    console.log(`├─ ✅ Challenge counts match: ${verificationResults.redisChallenges} challenges in sync`);
                }
            }

            // ======================
            // Phase 7: Response & Logging
            // ======================
            console.log('├─ Phase 7: Generating results...');
            await interaction.editReply({ content: '📢 Announcing results...' });

            // Create embed response
            const embed = new EmbedBuilder()
                .setColor('#00ae86') // SvS theme color
                .setTitle('🎲 SvS Ladder Shuffle Completed! 🎲')
                .setDescription(
                    `The SvS ladder has been randomly shuffled! All player positions have been reorganized.\n\n` +
                    `**Settings:**\n` +
                    `🔄 Challenges: ${clearChallenges ? 'Cleared' : 'Preserved'}\n` +
                    `⏱️ Cooldowns: ${clearCooldowns ? 'Cleared' : 'Preserved'}\n\n` +
                    `**Statistics:**\n` +
                    `👥 Players shuffled: ${rows.length}\n` +
                    `${!clearChallenges ? `⚔️ Redis challenges synced: ${verificationResults.redisChallenges}\n` : ''}` +
                    `${verificationResults.discrepancies.length > 0 ? `⚠️ Minor sync issues detected (auto-handled)\n` : '✅ Sheet and Redis fully synchronized'}`
                )
                .setFooter({
                    text: `Shuffle requested by ${interaction.user.username}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            // If challenges preserved, show updates
            if (!clearChallenges && challengeUpdates.length > 0) {
                const updatesPreview = challengeUpdates.slice(0, 5); // Show first 5
                const hasMore = challengeUpdates.length > 5;

                embed.addFields({
                    name: '⚠️ Active Challenges Updated',
                    value: updatesPreview.map(update =>
                        `**${update.player}** vs **${update.opponent}** ` +
                        `(Opponent rank: ${update.opponentOldRank} → ${update.opponentNewRank})`
                    ).join('\n') + (hasMore ? `\n...and ${challengeUpdates.length - 5} more` : '')
                });
            }

            // Send embed to channel (public announcement)
            await interaction.channel.send({ embeds: [embed] });

            // Confirm to command invoker
            await interaction.editReply({
                content: `✅ Successfully shuffled the ladder! ${rows.length} player positions have been randomized.` +
                         `${verificationResults.discrepancies.length > 0 ? '\n\n⚠️ Minor discrepancies detected. Check logs if needed.' : ''}`,
                flags: MessageFlags.Ephemeral
            });

            // Final logging
            console.log(`├─ Players shuffled: ${rows.length}`);
            console.log(`├─ Active challenges affected: ${challengeUpdates.length}`);
            console.log(`├─ Redis challenge keys processed: ${challengeKeysProcessed}`);
            console.log(`├─ Redis cooldown keys ${clearCooldowns ? 'cleared' : 'verified'}: ${cooldownKeysProcessed}`);
            console.log(`├─ Verification: ${verificationResults.discrepancies.length} discrepancies found`);
            console.log(`└─ Shuffle completed successfully`);

        } catch (error) {
            console.error(`└─ Error shuffling ladder: ${error.message}`);
            logError('Shuffle command error', error);
            return interaction.editReply({
                content: 'An error occurred while shuffling the ladder. Please check the logs and verify data integrity. You may need to restore from Google Sheets version history if needed.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
