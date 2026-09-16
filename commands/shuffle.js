require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');
const redisClient = require('../redis-client');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { getLadderByKey } = require('../utils/ladder');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Randomly shuffle player positions on the SvS ladder (Manager only)')
        .addBooleanOption(option =>
            option
                .setName('clear_cooldowns')
                .setDescription('Remove all cooldown restrictions between players (default: false)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] Shuffle Command Execution Started`);
        console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Resolve the ladder (default: main). Phase 2 will read this from the
        // channel/option; for now it is pinned to main (behavior-neutral).
        const ladder = getLadderByKey('main');

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

        const clearCooldowns = interaction.options.getBoolean('clear_cooldowns') ?? false;

        console.log(`├─ Options: clear_cooldowns=${clearCooldowns}`);

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
                range: `${ladder.sheetName}!A2:K`
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
            // Phase 3: Clear all challenges
            // ======================
            console.log('├─ Phase 3: Clearing all challenges...');
            await interaction.editReply({ content: '⚔️ Clearing all challenges...' });

            let challengesCleared = 0;
            rows.forEach(row => {
                if (row[5] === 'Challenge') {
                    row[5] = 'Available'; // Status
                    row[6] = ''; // cDate
                    row[7] = ''; // Opp#
                    challengesCleared++;
                }
            });

            console.log(`├─ Cleared ${challengesCleared} active challenges`);

            // ======================
            // Phase 4: Update Google Sheets
            // ======================
            console.log('├─ Phase 4: Updating Google Sheets...');
            await interaction.editReply({ content: '📊 Updating Google Sheets...' });

            // Clear the entire range first
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ladder.sheetName}!A2:K${rows.length + 1}`
            });

            // Write shuffled data
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ladder.sheetName}!A2:K${rows.length + 1}`,
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

            // Phase 5A: Clear this ladder's challenge Redis keys (challenge +
            // warning), scoped by prefix so a main shuffle never wipes LLD keys.
            console.log('├─ Clearing this ladder\'s Redis challenge keys...');
            const challengeKeys = await redisClient.client.keys(`challenge:${ladder.redisPrefix}:*`);
            const warningKeys = await redisClient.client.keys(`challenge-warning:${ladder.redisPrefix}:*`);
            const allChallengeKeys = [...challengeKeys, ...warningKeys];
            if (allChallengeKeys.length > 0) {
                await redisClient.client.del(...allChallengeKeys);
                challengeKeysProcessed = allChallengeKeys.length;
                console.log(`├─ Deleted ${allChallengeKeys.length} challenge keys`);
            } else {
                console.log('├─ No challenge keys found in Redis');
            }

            // Phase 5C/5D: Handle cooldown Redis keys (scoped to this ladder)
            if (clearCooldowns) {
                console.log('├─ Clearing this ladder\'s Redis cooldown keys...');
                const cooldownKeys = await redisClient.client.keys(`cooldown:${ladder.redisPrefix}:*`);
                if (cooldownKeys.length > 0) {
                    await redisClient.client.del(...cooldownKeys);
                    cooldownKeysProcessed = cooldownKeys.length;
                    console.log(`├─ Deleted ${cooldownKeys.length} cooldown keys`);
                }
            } else {
                console.log('├─ Verifying Redis cooldown keys...');
                const cooldownKeys = await redisClient.client.keys(`cooldown:${ladder.redisPrefix}:*`);
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
                discrepancies: []
            };

            // Verify all challenges were cleared
            const remainingChallenges = rows.filter(row => row[5] === 'Challenge').length;
            const remainingRedisChallenges = await redisClient.getAllChallenges(ladder);

            if (remainingChallenges > 0) {
                console.log(`├─ ⚠️ Warning: ${remainingChallenges} challenged players still in sheet`);
                verificationResults.discrepancies.push('Challenges not fully cleared in sheet');
            }

            if (remainingRedisChallenges.length > 0) {
                console.log(`├─ ⚠️ Warning: ${remainingRedisChallenges.length} challenge keys still in Redis`);
                verificationResults.discrepancies.push('Challenge keys not fully cleared in Redis');
            }

            if (remainingChallenges === 0 && remainingRedisChallenges.length === 0) {
                console.log(`├─ ✅ All challenges cleared successfully`);
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
                    `🔄 Challenges: Cleared (all set to Available)\n` +
                    `⏱️ Cooldowns: ${clearCooldowns ? 'Cleared' : 'Preserved'}\n\n` +
                    `**Statistics:**\n` +
                    `👥 Players shuffled: ${rows.length}\n` +
                    `⚔️ Challenges cleared: ${challengesCleared}\n` +
                    `${verificationResults.discrepancies.length > 0 ? `⚠️ Minor sync issues detected (check logs)\n` : '✅ Sheet and Redis fully synchronized'}`
                )
                .setFooter({
                    text: `Shuffle requested by ${interaction.user.username}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

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
            console.log(`├─ Challenges cleared: ${challengesCleared}`);
            console.log(`├─ Redis challenge keys deleted: ${challengeKeysProcessed}`);
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
