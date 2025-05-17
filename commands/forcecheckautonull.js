const { SlashCommandBuilder } = require('discord.js');
const { runSafetyCheck } = require('../challenge-expiry-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcecheckautonull')
        .setDescription('Force a manual check for challenges that need to be auto-nulled'),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            await interaction.editReply({
                content: 'Starting manual challenge expiry safety check...',
                ephemeral: true
            });
            
            // Run the safety check with the client reference
            await runSafetyCheck(interaction.client);
            
            await interaction.editReply({
                content: 'Manual challenge expiry safety check completed. Any expired challenges have been nullified.',
                ephemeral: true
            });
            
        } catch (error) {
            console.error('Error in forcecheckautonull command:', error);
            await interaction.editReply({
                content: `Error running manual safety check: ${error.message}`,
                ephemeral: true
            });
        }
    }
};