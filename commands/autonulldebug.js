const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const redisClient = require('../redis-client');
const moment = require('moment-timezone');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autonulldebug')
        .setDescription('Debug tool for viewing all auto-null challenge timers in Redis'),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            // Get all active challenges from Redis
            const activeChallenges = await redisClient.getAllChallenges();
            
            if (activeChallenges.length === 0) {
                return interaction.editReply({
                    content: 'No active challenges found in Redis database.',
                    ephemeral: true
                });
            }
            
            // Build an embed to display the challenge information
            const embed = new EmbedBuilder()
                .setTitle('AutoNull Debug - Active Challenges')
                .setDescription('Listing all active challenges tracked in Redis with their expiration timers')
                .setColor(0x0099FF)
                .setTimestamp();
            
            // Sort challenges by remaining time
            activeChallenges.sort((a, b) => a.remainingTime - b.remainingTime);
            
            // Add each challenge to the embed
            for (const challenge of activeChallenges) {
                const { player1, player2, remainingTime, warningNotificationSent, key } = challenge;
                
                // Format the remaining time nicely
                const days = Math.floor(remainingTime / (24 * 60 * 60));
                const hours = Math.floor((remainingTime % (24 * 60 * 60)) / (60 * 60));
                const minutes = Math.floor((remainingTime % (60 * 60)) / 60);
                
                const timeString = `${days}d ${hours}h ${minutes}m`;
                const expiryDate = moment().add(remainingTime, 'seconds').tz('America/New_York').format('M/D, h:mm A z');
                
                // Get warning key status (if applicable)
                const warningKey = `challenge-warning:${key.substring(10)}`;
                const warningTTL = await redisClient.client.ttl(warningKey);
                const warningStatus = warningTTL > 0 
                    ? `Warning in: ${Math.floor(warningTTL / (60 * 60))}h ${Math.floor((warningTTL % (60 * 60)) / 60)}m`
                    : (warningNotificationSent ? 'Warning sent ✓' : 'Warning pending');
                
                embed.addFields({
                    name: `Rank #${player1.rank} vs Rank #${player2.rank}`,
                    value: `**Key:** ${key}\n**Time Left:** ${timeString}\n**Expires:** ${expiryDate}\n**Warning Status:** ${warningStatus}`
                });
            }
            
            // Add footer with count
            embed.setFooter({ 
                text: `Total Active Challenges: ${activeChallenges.length}`
            });
            
            await interaction.editReply({
                embeds: [embed],
                ephemeral: true
            });
            
        } catch (error) {
            console.error('Error in autonulldebug command:', error);
            await interaction.editReply({
                content: `Error retrieving challenge data: ${error.message}`,
                ephemeral: true
            });
        }
    }
};