const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const redisClient = require('../redis-client');

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
            
            // Get number of active keys
            let challengeCount = 0;
            let warningCount = 0;
            
            try {
                const challengeKeys = await redisClient.client.keys('challenge:*');
                const warningKeys = await redisClient.client.keys('challenge-warning:*');
                
                challengeCount = challengeKeys.length;
                warningCount = warningKeys.length;
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