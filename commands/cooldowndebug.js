const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const redisClient = require('../redis-client');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cooldowndebug')
        .setDescription('Debug cooldown information')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all active cooldowns'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check cooldown for a specific player')
                .addStringOption(option =>
                    option
                        .setName('discord_id')
                        .setDescription('Discord ID to check')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear cooldown between two players')
                .addStringOption(option =>
                    option
                        .setName('discord_id1')
                        .setDescription('First player\'s Discord ID')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('discord_id2')
                        .setDescription('Second player\'s Discord ID')
                        .setRequired(true))),

    async execute(interaction) {
            const timestamp = new Date().toISOString();
            console.log(`\n[${timestamp}] Cooldown Debug Command`);
            console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);
            console.log(`├─ Channel: #${interaction.channel.name} (${interaction.channel.id})`);
            console.log(`├─ Guild: ${interaction.guild.name} (${interaction.guild.id})`);
            console.log(`├─ Subcommand: ${interaction.options.getSubcommand()}`);
        // Check if user has SvS Manager role
        if (!interaction.member.roles.cache.some(role => role.name === 'SvS Manager')) {
            return interaction.reply({
                content: 'You need the SvS Manager role to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'list': {
                    const cooldowns = await redisClient.listAllCooldowns();
                    if (cooldowns.length === 0) {
                        return interaction.editReply('No active cooldowns found.');
                    }

                    const cooldownFields = await Promise.all(cooldowns.map(async cd => {
                        const player1Member = await interaction.guild.members.fetch(cd.player1.discordId).catch(() => null);
                        const player2Member = await interaction.guild.members.fetch(cd.player2.discordId).catch(() => null);
                        
                        const player1Display = player1Member ? `<@${cd.player1.discordId}>` : cd.player1.name;
                        const player2Display = player2Member ? `<@${cd.player2.discordId}>` : cd.player2.name;
                        
                        const remainingHours = Math.ceil(cd.remainingTime / 3600);
                        return `**${player1Display}** (${cd.player1.element}) vs ` +
                               `**${player2Display}** (${cd.player2.element})\n` +
                               `Time remaining: ${remainingHours} hours\n`;
                    }));

                    const embed = new EmbedBuilder()
                        .setTitle('Active Cooldowns')
                        .setColor(0x00AE86)
                        .setDescription(cooldownFields.join('\n'));

                    return interaction.editReply({ embeds: [embed] });
                }

                case 'check': {
                    const discordId = interaction.options.getString('discord_id');
                    const playerCooldowns = await redisClient.getPlayerCooldowns(discordId);
                    
                    if (playerCooldowns.length === 0) {
                        const member = await interaction.guild.members.fetch(discordId).catch(() => null);
                        const userDisplay = member ? `<@${discordId}>` : discordId;
                        return interaction.editReply(`No active cooldowns found for ${userDisplay}`);
                    }

                    const cooldownFields = await Promise.all(playerCooldowns.map(async cd => {
                        const opponentMember = await interaction.guild.members.fetch(cd.opponent.discordId).catch(() => null);
                        const opponentDisplay = opponentMember ? `<@${cd.opponent.discordId}>` : cd.opponent.name;
                        
                        const remainingHours = Math.ceil(cd.remainingTime / 3600);
                        return `vs **${opponentDisplay}** (${cd.opponent.element})\n` +
                               `Time remaining: ${remainingHours} hours\n`;
                    }));

                    const member = await interaction.guild.members.fetch(discordId).catch(() => null);
                    const userDisplay = member ? `<@${discordId}>` : discordId;

                    const embedTitle = member ? 
                        `Cooldowns for ${member.user.username} (${discordId})` : 
                        `Cooldowns for ${discordId}`;

                    const playerEmbed = new EmbedBuilder()
                        .setTitle(embedTitle)
                        .setColor(0x00AE86)
                        .setDescription(cooldownFields.join('\n'));

                    return interaction.editReply({ embeds: [playerEmbed] });
                }

                case 'clear': {
                    const discordId1 = interaction.options.getString('discord_id1');
                    const discordId2 = interaction.options.getString('discord_id2');
                    
                    const member1 = await interaction.guild.members.fetch(discordId1).catch(() => null);
                    const member2 = await interaction.guild.members.fetch(discordId2).catch(() => null);
                    
                    const display1 = member1 ? `<@${discordId1}>` : discordId1;
                    const display2 = member2 ? `<@${discordId2}>` : discordId2;
                    
                    const player1 = { discordId: discordId1, element: 'any' };
                    const player2 = { discordId: discordId2, element: 'any' };
                    
                    await redisClient.removeCooldown(player1, player2);
                    return interaction.editReply(`Cooldown cleared between ${display1} and ${display2}`);
                }
            }
        } catch (error) {
            console.error('Error in cooldowndebug command:', error);
            return interaction.editReply('An error occurred while processing the command.');
        }
    },
};