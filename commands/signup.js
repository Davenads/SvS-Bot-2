const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('signup')
        .setDescription('Display information about how to register for the SvS ladder'),

    async execute(interaction) {
        // Find the SvS Manager role in the guild
        const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
        const managerMention = managerRole ? `${managerRole}` : '@SvS Manager';

        const embed = new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle('📝 SvS Ladder Registration Guide')
            .setDescription('Want to join the SvS ladder? Here\'s how!')
            .addFields(
                {
                    name: '📋 How to Register:',
                    value: `In the **#svs-signup** channel, simply post the following information about your character:
- **In game Character Name**
- **Element** (Fire 🔥, Light ⚡, or Cold ❄️)
- **Spec** (Vita ❤️ or Energy Shield 🔵)
- **Notes** (Optional)`
                },
                {
                    name: '📊 Character Limit',
                    value: 'You may have 1 character for each element in the ladder ❄️ 🔥 ⚡'
                },
                {
                    name: '❓ Questions?',
                    value: `Reach out to any one of our ${managerMention}`
                }
            )
            .setFooter({ 
                text: 'SvS Ladder Bot',
                iconURL: interaction.client.user.displayAvatarURL()
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};