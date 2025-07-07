require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { logError } = require('../logger');
const redisClient = require('../redis-client');

// Initialize the Google Sheets API client
const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncredis')
        .setDescription('Sync existing Google Sheets challenges to Redis (Manager only)')
        .addBooleanOption(option =>
            option.setName('force')
                .setDescription('Force sync even if challenges already exist in Redis')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('dry_run')
                .setDescription('Show what would be synced without making changes')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('show_cooldowns')
                .setDescription('Display all current cooldowns for verification')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('clear_cooldowns')
                .setDescription('Clear all player cooldowns (use when reverting matches)')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('fix_broken_keys')
                .setDescription('Fix Redis challenge keys that have outdated rank numbers after manual rank shifts')
                .setRequired(false)
        ),

    async execute(interaction) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] SyncRedis Command Execution Started`);
        console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);

        // Check if the user has the 'SvS Manager' role
        const isManager = interaction.member.roles.cache.some(role => role.name === 'SvS Manager');
        if (!isManager) {
            console.log('└─ Error: User lacks SvS Manager role');
            return await interaction.reply({
                content: 'You do not have the required @SvS Manager role to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const force = interaction.options.getBoolean('force') || false;
        const dryRun = interaction.options.getBoolean('dry_run') || false;
        const showCooldowns = interaction.options.getBoolean('show_cooldowns') || false;
        const clearCooldowns = interaction.options.getBoolean('clear_cooldowns') || false;
        const fixBrokenKeys = interaction.options.getBoolean('fix_broken_keys') || false;

        console.log(`├─ Options: force=${force}, dry_run=${dryRun}, show_cooldowns=${showCooldowns}, clear_cooldowns=${clearCooldowns}, fix_broken_keys=${fixBrokenKeys}`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Send immediate status update
        await interaction.editReply({ content: '🔄 Starting Redis sync operation...' });

        try {
            console.log('├─ Testing connections...');
            
            // Test Redis connection
            await redisClient.client.ping();
            console.log('├─ Redis connection OK');
            
            // Update progress
            await interaction.editReply({ content: '🔄 Connections verified. Fetching ladder data...' });
            
            console.log('├─ Fetching current ladder data...');

            // Fetch data from Google Sheets
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:K`
            });

            const rows = result.data.values || [];
            console.log(`├─ Found ${rows.length} total rows in spreadsheet`);

            // Handle broken key fixing if requested
            let brokenKeyResults = [];
            if (fixBrokenKeys) {
                console.log('├─ Processing broken key fixes...');
                await interaction.editReply({ content: '🔄 Analyzing Redis keys for rank mismatches...' });
                
                brokenKeyResults = await this.fixBrokenChallengeKeys(rows, dryRun);
                console.log(`├─ Broken key analysis complete: ${brokenKeyResults.length} issues found`);
            }

            // Handle cooldown operations first
            if (showCooldowns || clearCooldowns) {
                console.log('├─ Processing cooldown operations...');
                const allCooldowns = await redisClient.listAllCooldowns();
                
                if (clearCooldowns && !dryRun) {
                    console.log(`├─ Clearing ${allCooldowns.length} cooldowns...`);
                    // Clear each cooldown individually since SvS doesn't have a bulk clear method
                    let clearedCount = 0;
                    for (const cooldown of allCooldowns) {
                        const success = await redisClient.removeCooldown(cooldown.player1, cooldown.player2);
                        if (success) clearedCount++;
                    }
                    console.log(`├─ Successfully cleared ${clearedCount} cooldown entries`);
                }

                if (showCooldowns || dryRun) {
                    const cooldownEmbed = new EmbedBuilder()
                        .setColor(clearCooldowns && !dryRun ? '#FF6B6B' : '#FFA500')
                        .setTitle(clearCooldowns && !dryRun ? '🗑️ Cooldowns Cleared' : '🕒 Current Cooldowns')
                        .setDescription(
                            clearCooldowns && !dryRun 
                                ? `Cleared ${allCooldowns.length} player cooldowns from Redis.`
                                : `Found ${allCooldowns.length} active cooldowns in Redis.`
                        )
                        .setTimestamp();

                    if (allCooldowns.length > 0 && showCooldowns) {
                        const cooldownList = allCooldowns
                            .slice(0, 15) // Limit to avoid embed length issues
                            .map(cd => {
                                const hours = Math.floor(cd.remainingTime / 3600);
                                const minutes = Math.floor((cd.remainingTime % 3600) / 60);
                                return `• ${cd.player1.name} (${cd.player1.element}) ↔ ${cd.player2.name} (${cd.player2.element}) (${hours}h ${minutes}m)`;
                            })
                            .join('\n');

                        cooldownEmbed.addFields({
                            name: '🔒 Active Cooldowns',
                            value: cooldownList + (allCooldowns.length > 15 ? `\n... and ${allCooldowns.length - 15} more` : ''),
                            inline: false
                        });
                    }

                    // Store cooldown embed for later
                    interaction.cooldownEmbed = cooldownEmbed;
                }
            }

            // Find all active challenges (players with status 'Challenge')
            const challengePlayers = rows.filter(row => 
                row[0] && row[1] && row[5] === 'Challenge' && row[7] && row[8] // Check rank, name, status, opp#, discordID
            );

            console.log(`├─ Found ${challengePlayers.length} players in active challenges`);

            // Progress update
            await interaction.editReply({ content: `🔄 Found ${challengePlayers.length} players in challenges. Processing...` });

            if (challengePlayers.length === 0 && !showCooldowns && !clearCooldowns) {
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ Redis Sync Complete')
                    .setDescription('No active challenges found in Google Sheets to sync.')
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // Group into challenge pairs
            const challengePairs = [];
            const processedPairs = new Set();

            for (const player of challengePlayers) {
                const rank = player[0];
                const characterName = player[1];
                const spec = player[2];
                const element = player[3];
                const discUser = player[4];
                const opponentRank = player[7];
                const discordId = player[8];
                const challengeDate = player[6];

                const pairKey = [rank, opponentRank].sort().join('-');
                if (processedPairs.has(pairKey)) continue;

                // Find the opponent
                const opponent = challengePlayers.find(p => p[0] === opponentRank);
                if (!opponent) {
                    console.log(`├─ WARNING: Could not find opponent for rank ${rank} vs ${opponentRank}`);
                    continue;
                }

                // Verify bidirectional challenge
                if (opponent[7] !== rank) {
                    console.log(`├─ WARNING: Challenge mismatch for ranks ${rank} and ${opponentRank}`);
                    continue;
                }

                processedPairs.add(pairKey);

                challengePairs.push({
                    player1: {
                        rank: rank,
                        name: characterName,
                        discordId: discordId,
                        element: element,
                        spec: spec,
                        discUser: discUser
                    },
                    player2: {
                        rank: opponentRank,
                        name: opponent[1],
                        discordId: opponent[8],
                        element: opponent[3],
                        spec: opponent[2],
                        discUser: opponent[4]
                    },
                    challengeDate: challengeDate
                });
            }

            console.log(`├─ Identified ${challengePairs.length} valid challenge pairs`);

            // Check existing Redis entries and sync
            let existingCount = 0;
            let syncedCount = 0;
            let skippedCount = 0;
            const syncResults = [];

            for (const pair of challengePairs) {
                // Check if challenge already exists in Redis
                const existingChallenge = await redisClient.checkChallenge(pair.player1.rank, pair.player2.rank);

                if (existingChallenge.active && !force) {
                    console.log(`├─ SKIP: Challenge ${pair.player1.rank} vs ${pair.player2.rank} already exists in Redis`);
                    existingCount++;
                    syncResults.push({
                        status: 'skipped',
                        player1: pair.player1.name,
                        player1Rank: pair.player1.rank,
                        player2: pair.player2.name,
                        player2Rank: pair.player2.rank,
                        reason: 'Already exists'
                    });
                    continue;
                }

                if (dryRun) {
                    console.log(`├─ DRY RUN: Would sync challenge ${pair.player1.rank} vs ${pair.player2.rank}`);
                    syncResults.push({
                        status: 'would_sync',
                        player1: pair.player1.name,
                        player1Rank: pair.player1.rank,
                        player2: pair.player2.name,
                        player2Rank: pair.player2.rank,
                        reason: 'Ready to sync'
                    });
                    syncedCount++;
                    continue;
                }

                // Actually sync to Redis
                try {
                    console.log(`├─ SYNC: Creating Redis entries for ${pair.player1.rank} vs ${pair.player2.rank}`);

                    // Set challenge in Redis
                    await redisClient.setChallenge(pair.player1, pair.player2, pair.challengeDate || '');
                    
                    syncedCount++;
                    syncResults.push({
                        status: 'synced',
                        player1: pair.player1.name,
                        player1Rank: pair.player1.rank,
                        player2: pair.player2.name,
                        player2Rank: pair.player2.rank,
                        reason: 'Successfully synced'
                    });

                    console.log(`├─ SUCCESS: Synced ${pair.player1.name} vs ${pair.player2.name}`);

                } catch (syncError) {
                    console.error(`├─ ERROR: Failed to sync ${pair.player1.rank} vs ${pair.player2.rank}:`, syncError);
                    skippedCount++;
                    syncResults.push({
                        status: 'error',
                        player1: pair.player1.name,
                        player1Rank: pair.player1.rank,
                        player2: pair.player2.name,
                        player2Rank: pair.player2.rank,
                        reason: `Error: ${syncError.message}`
                    });
                }
            }

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor(dryRun ? '#FFA500' : (syncedCount > 0 ? '#00FF00' : '#FFFF00'))
                .setTitle(`${dryRun ? '🔍 Redis Sync Preview' : '✅ Redis Sync Complete'}${showCooldowns || clearCooldowns ? ' + Cooldowns' : ''}`)
                .setDescription(
                    dryRun 
                        ? `Preview of what would be synced to Redis:${showCooldowns || clearCooldowns ? ' (including cooldown operations)' : ''}`
                        : `Sync operation completed successfully!${showCooldowns || clearCooldowns ? ' (including cooldown operations)' : ''}`
                )
                .addFields(
                    { name: '📊 Statistics', value: 
                        `• Challenge pairs found: **${challengePairs.length}**\n` +
                        `• ${dryRun ? 'Would sync' : 'Successfully synced'}: **${syncedCount}**\n` +
                        `• Already existed: **${existingCount}**\n` +
                        `• Errors/Skipped: **${skippedCount}**`,
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: dryRun ? 'Run without dry_run to actually sync' : 'SvS Redis Sync',
                    iconURL: interaction.client.user.displayAvatarURL() 
                });

            // Add details if there are results to show
            if (syncResults.length > 0) {
                const detailsText = syncResults
                    .slice(0, 10) // Limit to 10 results to avoid embed length limits
                    .map(r => {
                        const statusEmoji = {
                            'synced': '✅',
                            'would_sync': '🔄',
                            'skipped': '⏭️',
                            'error': '❌'
                        }[r.status] || '❓';
                        
                        return `${statusEmoji} Rank #${r.player1Rank} ${r.player1} vs Rank #${r.player2Rank} ${r.player2}`;
                    })
                    .join('\n');

                embed.addFields({
                    name: '📋 Details',
                    value: detailsText + (syncResults.length > 10 ? `\n... and ${syncResults.length - 10} more` : ''),
                    inline: false
                });
            }

            // Verification info
            if (!dryRun) {
                const allChallenges = await redisClient.getAllChallenges();
                const allCooldowns = await redisClient.listAllCooldowns();
                
                // Get fresh cooldown count after potential clearing
                const finalCooldowns = clearCooldowns ? await redisClient.listAllCooldowns() : allCooldowns;
                
                let verificationText = `• Total challenges in Redis: **${allChallenges.length}**\n• Total cooldowns in Redis: **${finalCooldowns.length}**`;
                
                if (clearCooldowns) {
                    const clearedCount = allCooldowns.length - finalCooldowns.length;
                    verificationText += `\n• Cooldowns cleared: **${clearedCount}**`;
                }
                
                embed.addFields({
                    name: '🔍 Verification',
                    value: verificationText,
                    inline: false
                });
            }

            console.log(`└─ Sync command completed: ${syncedCount} synced, ${existingCount} existed, ${skippedCount} errors`);

            // Add broken key results to embed if applicable
            if (fixBrokenKeys && brokenKeyResults.length > 0) {
                const brokenKeyText = brokenKeyResults
                    .slice(0, 8) // Limit to avoid embed length issues
                    .map(r => {
                        const statusEmoji = {
                            'fixed': '🔧',
                            'would_fix': '🔍',
                            'no_fix_needed': '✅',
                            'error': '❌'
                        }[r.status] || '❓';
                        return `${statusEmoji} ${r.oldKey} → ${r.newKey || 'N/A'}`;
                    })
                    .join('\n');
                
                embed.addFields({
                    name: `🔧 Broken Key ${dryRun ? 'Analysis' : 'Fixes'} (${brokenKeyResults.length})`,
                    value: brokenKeyText + (brokenKeyResults.length > 8 ? `\n... and ${brokenKeyResults.length - 8} more` : ''),
                    inline: false
                });
            }

            // Collect all embeds to send
            const embeds = [embed];
            if (interaction.cooldownEmbed) embeds.push(interaction.cooldownEmbed);
            
            await interaction.editReply({ embeds: embeds });

        } catch (error) {
            console.error(`└─ Error in sync command: ${error.message}`);
            console.error(`└─ Full error:`, error);
            logError(`SyncRedis command error: ${error.message}\nStack: ${error.stack}`);

            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Redis Sync Failed')
                .setDescription(`An error occurred during the sync operation: ${error.message}`)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },

    // Helper method to fix broken challenge keys after rank shifts
    async fixBrokenChallengeKeys(sheetRows, dryRun = false) {
        const results = [];
        
        try {
            // Get all existing challenge keys from Redis
            const allChallenges = await redisClient.getAllChallenges();
            console.log(`├─ Found ${allChallenges.length} existing challenge keys in Redis`);
            
            // Create a lookup map of Discord ID to current rank from Google Sheets
            const discordIdToRank = {};
            const rankToPlayerData = {};
            
            sheetRows.forEach(row => {
                if (row[0] && row[8]) { // rank and discordId
                    const rank = row[0];
                    const discordId = row[8];
                    discordIdToRank[discordId] = rank;
                    rankToPlayerData[rank] = {
                        rank: rank,
                        name: row[1],
                        spec: row[2],
                        element: row[3],
                        discUser: row[4],
                        status: row[5],
                        challengeDate: row[6],
                        opponentRank: row[7],
                        discordId: discordId
                    };
                }
            });
            
            // Analyze each challenge key
            for (const challenge of allChallenges) {
                const player1 = challenge.player1;
                const player2 = challenge.player2;
                
                // Get current ranks from Google Sheets
                const currentRank1 = discordIdToRank[player1.discordId];
                const currentRank2 = discordIdToRank[player2.discordId];
                
                // Check if ranks have changed
                const rank1Changed = currentRank1 && currentRank1 !== player1.rank;
                const rank2Changed = currentRank2 && currentRank2 !== player2.rank;
                
                if (rank1Changed || rank2Changed) {
                    console.log(`├─ BROKEN KEY DETECTED: ${challenge.key}`);
                    console.log(`├─   Player 1: ${player1.name} stored rank ${player1.rank} → current rank ${currentRank1}`);
                    console.log(`├─   Player 2: ${player2.name} stored rank ${player2.rank} → current rank ${currentRank2}`);
                    
                    if (!currentRank1 || !currentRank2) {
                        // Player(s) no longer on ladder
                        results.push({
                            status: 'error',
                            oldKey: challenge.key,
                            newKey: null,
                            reason: 'Player(s) no longer on ladder',
                            player1: player1.name,
                            player2: player2.name
                        });
                        continue;
                    }
                    
                    // Generate new key with current ranks
                    const newKey = redisClient.generateChallengeKey(currentRank1, currentRank2);
                    
                    if (dryRun) {
                        results.push({
                            status: 'would_fix',
                            oldKey: challenge.key,
                            newKey: newKey,
                            reason: 'Rank mismatch detected',
                            player1: `${player1.name} (${player1.rank}→${currentRank1})`,
                            player2: `${player2.name} (${player2.rank}→${currentRank2})`
                        });
                    } else {
                        // Fix the broken key
                        try {
                            // Get current TTL and challenge data
                            const challengeData = challenge;
                            const currentTTL = challenge.remainingTime;
                            
                            // Update player ranks in the data
                            const updatedData = {
                                ...challengeData,
                                player1: {
                                    ...challengeData.player1,
                                    rank: currentRank1
                                },
                                player2: {
                                    ...challengeData.player2,
                                    rank: currentRank2
                                }
                            };
                            
                            // Remove old key and warning key
                            await redisClient.client.del(challenge.key);
                            const oldWarningKey = `challenge-warning:${challenge.key.substring(10)}`;
                            await redisClient.client.del(oldWarningKey);
                            
                            // Create new key with corrected ranks
                            const challengeDataStr = JSON.stringify(updatedData);
                            await redisClient.client.setex(newKey, Math.max(300, currentTTL), challengeDataStr);
                            
                            // Create new warning key
                            const warningTTL = Math.max(60, currentTTL - (24 * 60 * 60));
                            const newWarningKey = `challenge-warning:${newKey.substring(10)}`;
                            await redisClient.client.setex(newWarningKey, warningTTL, newKey);
                            
                            console.log(`├─ FIXED: ${challenge.key} → ${newKey}`);
                            
                            results.push({
                                status: 'fixed',
                                oldKey: challenge.key,
                                newKey: newKey,
                                reason: 'Successfully updated ranks',
                                player1: `${player1.name} (${player1.rank}→${currentRank1})`,
                                player2: `${player2.name} (${player2.rank}→${currentRank2})`
                            });
                            
                        } catch (fixError) {
                            console.error(`├─ ERROR fixing ${challenge.key}:`, fixError);
                            results.push({
                                status: 'error',
                                oldKey: challenge.key,
                                newKey: newKey,
                                reason: `Fix failed: ${fixError.message}`,
                                player1: player1.name,
                                player2: player2.name
                            });
                        }
                    }
                } else {
                    // Key is correct, no changes needed
                    results.push({
                        status: 'no_fix_needed',
                        oldKey: challenge.key,
                        newKey: null,
                        reason: 'Ranks match current ladder',
                        player1: player1.name,
                        player2: player2.name
                    });
                }
            }
            
            const issuesFound = results.filter(r => r.status !== 'no_fix_needed').length;
            console.log(`├─ Broken key analysis complete: ${issuesFound} issues found, ${results.length} total keys checked`);
            
            return results;
            
        } catch (error) {
            console.error('├─ Error in fixBrokenChallengeKeys:', error);
            logError('Error fixing broken challenge keys', error);
            return [{
                status: 'error',
                oldKey: 'N/A',
                newKey: null,
                reason: `Analysis failed: ${error.message}`,
                player1: 'N/A',
                player2: 'N/A'
            }];
        }
    }
};