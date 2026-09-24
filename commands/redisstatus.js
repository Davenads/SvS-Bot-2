const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const redisClient = require('../redis-client');
const { LADDERS } = require('../config/ladders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('redisstatus')
        .setDescription('Check the Redis database connection status'),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            let status = 'Unknown';
            let pingResult = 'Failed';
            let config = {};
            
            // Try to ping Redis
            try {
                const startTime = Date.now();
                const pingResponse = await redisClient.client.ping();
                const endTime = Date.now();
                
                if (pingResponse === 'PONG') {
                    status = 'Connected';
                    pingResult = `${endTime - startTime}ms`;
                }
            } catch (pingError) {
                status = 'Disconnected';
                pingResult = `Error: ${pingError.message}`;
            }
            
            // Get Redis config info
            try {
                // Check which Redis config is being used
                config = redisClient.getRedisConfig();
                
                // Sanitize the config to hide sensitive info
                if (config.password) {
                    config.password = '********';
                }
            } catch (configError) {
                console.error('Error getting Redis config:', configError);
            }
            
            // Get number of active keys, broken down per ladder. Keys are namespaced
            // as `challenge:{prefix}:...` / `challenge-warning:{prefix}:...`.
            let challengeCount = 0;
            let warningCount = 0;
            let ladderBreakdown = '';

            try {
                const challengeKeys = await redisClient.client.keys('challenge:*');
                const warningKeys = await redisClient.client.keys('challenge-warning:*');

                challengeCount = challengeKeys.length;
                warningCount = warningKeys.length;

                // Per-ladder tallies by Redis prefix.
                const lines = [];
                for (const ladder of Object.values(LADDERS)) {
                    const prefix = ladder.redisPrefix;
                    const c = challengeKeys.filter(k => k.startsWith(`challenge:${prefix}:`)).length;
                    const w = warningKeys.filter(k => k.startsWith(`challenge-warning:${prefix}:`)).length;
                    lines.push(`**${ladder.displayName}** — ${c} challenge(s), ${w} warning(s)`);
                }
                // Surface any legacy (un-prefixed) keys so they don't hide silently.
                const knownPrefixes = Object.values(LADDERS).map(l => l.redisPrefix);
                const orphanChallenges = challengeKeys.filter(k => !knownPrefixes.some(p => k.startsWith(`challenge:${p}:`))).length;
                if (orphanChallenges > 0) {
                    lines.push(`_Unprefixed/legacy_ — ${orphanChallenges} challenge key(s)`);
                }
                ladderBreakdown = lines.join('\n');
            } catch (keysError) {
                console.error('Error getting Redis keys count:', keysError);
            }

            // Build an embed with the information
            const embed = new EmbedBuilder()
                .setTitle('Redis Database Status')
                .setDescription(`Status: **${status}**`)
                .setColor(status === 'Connected' ? 0x00FF00 : 0xFF0000)
                .addFields(
                    { name: 'Ping', value: pingResult, inline: true },
                    { name: 'Active Challenges', value: challengeCount.toString(), inline: true },
                    { name: 'Pending Warnings', value: warningCount.toString(), inline: true },
                    { name: 'Per-Ladder Breakdown', value: ladderBreakdown || 'No active keys', inline: false },
                    { name: 'Connection Info', value: `Host: ${config.host || 'Unknown'}\nPort: ${config.port || 'Unknown'}\nRedis URL: ${process.env.REDISCLOUD_URL ? 'Configured' : 'Not Configured'}` }
                )
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [embed],
                ephemeral: true
            });
            
        } catch (error) {
            console.error('Error in redisstatus command:', error);
            await interaction.editReply({
                content: `Error checking Redis status: ${error.message}`,
                ephemeral: true
            });
        }
    }
};