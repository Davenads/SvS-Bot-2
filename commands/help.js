const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows available commands for SvS duelers'),
    
    async execute(interaction) {
        const isManager = interaction.member.roles.cache.some(role => role.name === 'SvS Manager');
        
        const duelerEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('📖 SvS Dueler Commands')
            .setDescription('Available commands for all SvS Duelers')
            .addFields(
                {
                    name: '/challenge [challenger_rank] [target_rank]',
                    value: 'Challenge another player on the ladder\n• Top 10 players: up to 2 ranks ahead\n• Other players: up to 3 ranks ahead'
                },
                {
                    name: '/reportwin [winner_rank] [loser_rank]',
                    value: 'Report the outcome of a challenge\n• Must be used by either participant'
                },
                {
                    name: '/currentchallenges',
                    value: 'View all active challenges\n• Shows challenger, opponent, and deadline'
                },
                {
                    name: '/currentvacations',
                    value: 'See which players are on vacation\n• Shows vacation start dates and info'
                },
                {
                    name: '/leaderboard',
                    value: 'View current SvS ladder rankings\n• Shows players, specs, elements, and status'
                },
                {
                    name: '/talrasha [character_name] [element] [optional: notes]',
                    value: 'Sign up for the Tal Rasha tournament\n• Available to all players (no role required)'
                }
            )
            .setFooter({ 
                text: 'Note: @SvS Dueler role required for most commands (except /talrasha)',
                iconURL: interaction.client.user.displayAvatarURL()
            })
            .setTimestamp();

        const managerEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🛡️ SvS Manager Commands')
            .setDescription('Additional commands available for SvS Managers')
            .addFields(
                {
                    name: '/register [character_name] [spec] [element] [disc_user] [optional: notes]',
                    value: 'Register a new player to the ladder\n• Automatically assigns next available rank'
                },
                {
                    name: '/remove [rank]',
                    value: 'Remove a player from the ladder\n• Moves them to Extended Vacation tab\n• Updates all rankings automatically'
                },
                {
                    name: '/cancelchallenge [player]',
                    value: 'Cancel an active challenge\n• Resets both players to Available status'
                },
                {
                    name: '/extendchallenge [player]',
                    value: 'Extend a challenge deadline by 2 days\n• Updates both players\' challenge dates'
                },
                {
                    name: '/nullchallenges',
                    value: 'Automatically voids all challenges older than 3 days\n• Resets affected players to Available status'
                }
            )
            .setFooter({ 
                text: 'These commands require the @SvS Manager role',
                iconURL: interaction.client.user.displayAvatarURL()
            })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_commands')
                    .setLabel('Toggle Manager Commands')
                    .setStyle(ButtonStyle.Primary)
            );

        let components = isManager ? [row] : [];

        const initialMessage = await interaction.reply({
            embeds: [duelerEmbed],
            components,
            ephemeral: true
        });

        if (isManager) {
            const collector = initialMessage.createMessageComponentCollector({
                time: 60000 // Button will work for 1 minute
            });

            let showingManagerCommands = false;

            collector.on('collect', async i => {
                if (i.customId === 'toggle_commands') {
                    showingManagerCommands = !showingManagerCommands;
                    await i.update({
                        embeds: [showingManagerCommands ? managerEmbed : duelerEmbed],
                        components: [row]
                    });
                }
            });

            collector.on('end', () => {
                // Remove the button after timeout
                initialMessage.edit({
                    embeds: [showingManagerCommands ? managerEmbed : duelerEmbed],
                    components: []
                }).catch(console.error);
            });
        }
    },
};