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
            option.setName('migrate_old_keys')
                .setDescription('Migrate old rank-based keys to new discordId+element format')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('recalculate_ttl')
                .setDescription('Recalculate challenge expiration times from cDate column')
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
        const migrateOldKeys = interaction.options.getBoolean('migrate_old_keys') || false;
        const recalculateTTL = interaction.options.getBoolean('recalculate_ttl') || false;

        console.log(`├─ Options: force=${force}, dry_run=${dryRun}, show_cooldowns=${showCooldowns}, clear_cooldowns=${clearCooldowns}, migrate_old_keys=${migrateOldKeys}, recalculate_ttl=${recalculateTTL}`);

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

            // Handle old key migration if requested
            let migrationResults = [];
            if (migrateOldKeys) {
                console.log('├─ Processing old key migration...');
                await interaction.editReply({ content: '🔄 Migrating old rank-based keys to new format...' });

                migrationResults = await this.migrateOldFormatKeys(dryRun);
                console.log(`├─ Migration complete: ${migrationResults.length} keys processed`);
            }

            // Handle TTL recalculation if requested (can be standalone or combined)
            let ttlResults = [];
            if (recalculateTTL && !migrateOldKeys) {
                // Standalone TTL recalculation (not combined with migration)
                console.log('├─ Processing standalone TTL recalculation...');
                await interaction.editReply({ content: '🔄 Recalculating challenge expiration times...' });

                ttlResults = await this.recalculateAllChallengeTTLs(rows, dryRun);
                console.log(`├─ TTL recalculation complete: ${ttlResults.length} challenges processed`);
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
                const existingChallenge = await redisClient.checkChallenge(pair.player1, pair.player2);

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
                .setTitle(`${dryRun ? '🔍 Redis Sync Preview' : '✅ Redis Sync Complete'}${showCooldowns || clearCooldowns ? ' + Cooldowns' : ''}${recalculateTTL ? ' + TTL Sync' : ''}`)
                .setDescription(
                    dryRun
                        ? `Preview of what would be synced to Redis:${showCooldowns || clearCooldowns ? ' (including cooldown operations)' : ''}${recalculateTTL ? ' (including TTL recalculation)' : ''}`
                        : `Sync operation completed successfully!${showCooldowns || clearCooldowns ? ' (including cooldown operations)' : ''}${recalculateTTL ? ' (including TTL recalculation)' : ''}`
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

            // Add migration results to embed if applicable
            if (migrateOldKeys && migrationResults.length > 0) {
                const migratedKeys = migrationResults.filter(r => r.status === 'migrated' || r.status === 'would_migrate');

                if (migratedKeys.length > 0) {
                    const migrationText = migratedKeys
                        .slice(0, 8) // Limit to avoid embed length issues
                        .map(r => {
                            const statusEmoji = {
                                'migrated': '✅',
                                'would_migrate': '🔍',
                                'error': '❌',
                                'skipped': '⏭️'
                            }[r.status] || '❓';
                            return `${statusEmoji} ${r.oldKey} → ${r.newKey || 'N/A'}`;
                        })
                        .join('\n');

                    embed.addFields({
                        name: `🔄 Key ${dryRun ? 'Migration Preview' : 'Migration'} (${migratedKeys.length})`,
                        value: migrationText + (migratedKeys.length > 8 ? `\n... and ${migratedKeys.length - 8} more` : ''),
                        inline: false
                    });
                } else if (migrationResults.every(r => r.status === 'already_new_format')) {
                    // All keys are already in new format
                    embed.addFields({
                        name: `✅ Migration Check Complete`,
                        value: `All ${migrationResults.length} challenge keys are already in new format. No migration needed.`,
                        inline: false
                    });
                }
            }

            // Add TTL recalculation results if applicable
            if (recalculateTTL && !migrateOldKeys && ttlResults.length > 0) {
                const ttlUpdates = ttlResults.filter(r => r.status === 'updated' || r.status === 'would_update');

                if (ttlUpdates.length > 0) {
                    const ttlText = ttlUpdates
                        .slice(0, 8)
                        .map(r => {
                            const statusEmoji = r.status === 'updated' ? '✅' : '🔍';
                            const hours1 = Math.floor(r.oldTTL / 3600);
                            const hours2 = Math.floor(r.newTTL / 3600);
                            return `${statusEmoji} ${r.player1} vs ${r.player2}: ${hours1}h → ${hours2}h`;
                        })
                        .join('\n');

                    embed.addFields({
                        name: `⏰ TTL ${dryRun ? 'Analysis' : 'Updates'} (${ttlUpdates.length})`,
                        value: ttlText + (ttlUpdates.length > 8 ? `\n... and ${ttlUpdates.length - 8} more` : ''),
                        inline: false
                    });
                }
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

    // Helper method to migrate old rank-based keys to new discordId+element format
    async migrateOldFormatKeys(dryRun = false) {
        const results = [];

        try {
            // Get all challenge keys from Redis
            const allKeys = await redisClient.client.keys('challenge:*');
            console.log(`├─ Found ${allKeys.length} challenge keys in Redis`);

            for (const key of allKeys) {
                const keyPart = key.substring(10); // Remove 'challenge:' prefix

                // Detect old format: no ':' in keyPart means it's rank-based (e.g., "5-8")
                if (!keyPart.includes(':')) {
                    // Old format detected
                    console.log(`├─ OLD FORMAT KEY: ${key}`);

                    const data = await redisClient.client.get(key);
                    if (!data) {
                        console.log(`├─   Key expired during migration, skipping`);
                        results.push({
                            status: 'skipped',
                            oldKey: key,
                            newKey: null,
                            reason: 'Key expired during migration'
                        });
                        continue;
                    }

                    const challengeData = JSON.parse(data);
                    const { player1, player2 } = challengeData;

                    // Get current TTL
                    const ttl = await redisClient.client.ttl(key);
                    if (ttl <= 0) {
                        console.log(`├─   Key has no TTL, skipping`);
                        results.push({
                            status: 'skipped',
                            oldKey: key,
                            newKey: null,
                            reason: 'Key has no TTL'
                        });
                        continue;
                    }

                    // Generate new key using discordId + element
                    const newKey = redisClient.generateChallengeKey(player1, player2);

                    console.log(`├─   Old: ${key}`);
                    console.log(`├─   New: ${newKey}`);
                    console.log(`├─   TTL: ${ttl}s (${Math.floor(ttl / 3600)}h ${Math.floor((ttl % 3600) / 60)}m)`);

                    if (dryRun) {
                        results.push({
                            status: 'would_migrate',
                            oldKey: key,
                            newKey: newKey,
                            ttl: ttl,
                            player1: player1.name,
                            player2: player2.name
                        });
                    } else {
                        // Perform migration
                        try {
                            // Create new key with same data and TTL
                            await redisClient.client.setex(newKey, ttl, data);

                            // Delete old key
                            await redisClient.client.del(key);

                            // Handle warning keys
                            const oldWarningKey = `challenge-warning:${keyPart}`;
                            const newWarningKey = `challenge-warning:${newKey.substring(10)}`;

                            // Calculate warning TTL (24 hours before main expiry)
                            const warningTTL = Math.max(60, ttl - (24 * 60 * 60));

                            // Only create warning key if there's enough time
                            if (warningTTL > 60) {
                                await redisClient.client.setex(newWarningKey, warningTTL, newKey);
                            }

                            // Delete old warning key
                            await redisClient.client.del(oldWarningKey);

                            // Clean up any old warning lock
                            const oldWarningLock = `warning-lock:${keyPart}`;
                            await redisClient.client.del(oldWarningLock);

                            console.log(`├─ ✅ MIGRATED: ${key} → ${newKey}`);

                            results.push({
                                status: 'migrated',
                                oldKey: key,
                                newKey: newKey,
                                ttl: ttl,
                                player1: player1.name,
                                player2: player2.name
                            });

                        } catch (migrationError) {
                            console.error(`├─ ❌ ERROR migrating ${key}:`, migrationError);
                            results.push({
                                status: 'error',
                                oldKey: key,
                                newKey: newKey,
                                reason: `Migration failed: ${migrationError.message}`,
                                player1: player1.name,
                                player2: player2.name
                            });
                        }
                    }
                } else {
                    // New format - already migrated
                    results.push({
                        status: 'already_new_format',
                        oldKey: key,
                        newKey: null,
                        reason: 'Already in new format'
                    });
                }
            }

            const migratedCount = results.filter(r => r.status === 'migrated' || r.status === 'would_migrate').length;
            const alreadyNewCount = results.filter(r => r.status === 'already_new_format').length;
            console.log(`├─ Migration complete: ${migratedCount} migrated, ${alreadyNewCount} already new format`);

            return results;

        } catch (error) {
            console.error('├─ Error in migrateOldFormatKeys:', error);
            logError('Error migrating old format keys', error);
            return [{
                status: 'error',
                oldKey: 'N/A',
                newKey: null,
                reason: `Migration failed: ${error.message}`
            }];
        }
    },

    // Helper method to recalculate TTLs for all challenges without fixing keys
    async recalculateAllChallengeTTLs(sheetRows, dryRun = false) {
        const results = [];

        try {
            const allChallenges = await redisClient.getAllChallenges();
            console.log(`├─ Found ${allChallenges.length} existing challenges in Redis`);

            // Build rank to player data map
            const rankToPlayerData = {};
            sheetRows.forEach(row => {
                if (row[0] && row[1] && row[8]) {
                    rankToPlayerData[row[0]] = {
                        rank: row[0],
                        name: row[1],
                        challengeDate: row[6],
                        discordId: row[8]
                    };
                }
            });

            // Process each challenge
            for (const challenge of allChallenges) {
                const player1 = challenge.player1;
                const player2 = challenge.player2;
                const currentTTL = challenge.remainingTime;

                // Get cDate from sheet
                const player1Data = rankToPlayerData[player1.rank];
                const challengeDate = player1Data?.challengeDate;

                if (!challengeDate) {
                    results.push({
                        status: 'skipped',
                        key: challenge.key,
                        reason: 'No cDate found in sheet',
                        player1: player1.name,
                        player2: player2.name
                    });
                    continue;
                }

                // Calculate new TTL
                const newTTL = redisClient.calculateTTLFromChallengeDate(challengeDate);
                const ttlDiffHours = Math.abs(newTTL - currentTTL) / 3600;

                if (dryRun) {
                    results.push({
                        status: 'would_update',
                        key: challenge.key,
                        oldTTL: currentTTL,
                        newTTL: newTTL,
                        ttlDiffHours: ttlDiffHours.toFixed(2),
                        player1: player1.name,
                        player2: player2.name
                    });
                } else {
                    // Update the TTL
                    try {
                        const challengeData = await redisClient.client.get(challenge.key);
                        const warningTTL = Math.max(60, newTTL - (24 * 60 * 60));

                        // Update main challenge key
                        await redisClient.client.setex(challenge.key, Math.max(300, newTTL), challengeData);

                        // Update warning key
                        const warningKey = `challenge-warning:${challenge.key.substring(10)}`;
                        await redisClient.client.del(warningKey);
                        await redisClient.client.setex(warningKey, warningTTL, challenge.key);

                        console.log(`├─ Updated TTL for ${challenge.key}: ${currentTTL}s → ${newTTL}s`);

                        results.push({
                            status: 'updated',
                            key: challenge.key,
                            oldTTL: currentTTL,
                            newTTL: newTTL,
                            ttlDiffHours: ttlDiffHours.toFixed(2),
                            player1: player1.name,
                            player2: player2.name
                        });
                    } catch (error) {
                        console.error(`├─ Error updating TTL for ${challenge.key}:`, error);
                        results.push({
                            status: 'error',
                            key: challenge.key,
                            reason: error.message,
                            player1: player1.name,
                            player2: player2.name
                        });
                    }
                }
            }

            return results;

        } catch (error) {
            console.error('├─ Error in recalculateAllChallengeTTLs:', error);
            logError('Error recalculating TTLs', error);
            return [{
                status: 'error',
                key: 'N/A',
                reason: `Analysis failed: ${error.message}`
            }];
        }
    }
};