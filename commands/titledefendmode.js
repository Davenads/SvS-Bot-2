const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const redisClient = require('../redis-client');
const { logError } = require('../logger');
const { getLadderFromOption } = require('../utils/ladder');

const MANAGER_ROLE = 'SvS Manager';

// Slash commands can't mix a top-level option with subcommands, so the optional
// `ladder` selector is attached to each subcommand (default: HLD / main).
const withLadderOption = sub =>
    sub.addStringOption(option =>
        option.setName('ladder')
            .setDescription('Which ladder (defaults to HLD)')
            .setRequired(false)
            .addChoices(
                { name: 'HLD', value: 'main' },
                { name: 'LLD', value: 'lld' }
            ));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('titledefendmode')
        .setDescription('Toggle or check title defend tracking')
        .addSubcommand(sub =>
            withLadderOption(sub.setName('on').setDescription('Enable title defend tracking'))
        )
        .addSubcommand(sub =>
            withLadderOption(sub.setName('off').setDescription('Disable title defend tracking'))
        )
        .addSubcommand(sub =>
            withLadderOption(sub.setName('status').setDescription('Check current title defend tracking state'))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const ladder = getLadderFromOption(interaction);
        console.log(`\n[${new Date().toISOString()}] Command invoked: /titledefendmode ${sub} (${ladder.key}) by ${interaction.user.tag}`);

        // on/off requires manager role
        if (sub !== 'status') {
            const isManager = interaction.member.roles.cache.some(r => r.name === MANAGER_ROLE);
            if (!isManager) {
                return interaction.reply({
                    content: 'You need the **SvS Manager** role to change title defend tracking.',
                    ephemeral: true
                });
            }
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            if (sub === 'on' || sub === 'off') {
                const enabling = sub === 'on';
                await redisClient.setTitleDefendMode(enabling, ladder);

                const embed = new EmbedBuilder()
                    .setColor(enabling ? 0x57F287 : 0xED4245)
                    .setTitle(`Title Defend Tracking Updated — ${ladder.displayName}`)
                    .setDescription(
                        enabling
                            ? '✅ Title defend tracking is now **enabled**.\nRank 1 wins will be recorded in the Metrics sheet.'
                            : '⛔ Title defend tracking is now **disabled**.\nRank 1 wins will **not** be recorded in the Metrics sheet.'
                    )
                    .setFooter({ text: `Changed by ${interaction.user.tag}` })
                    .setTimestamp();

                console.log(`└─ Title defend mode set to: ${sub} (${ladder.key})`);
                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'status') {
                const enabled = await redisClient.getTitleDefendMode(ladder);

                const embed = new EmbedBuilder()
                    .setColor(enabled ? 0x57F287 : 0xED4245)
                    .setTitle(`Title Defend Tracking Status — ${ladder.displayName}`)
                    .setDescription(
                        enabled
                            ? '✅ Title defend tracking is currently **enabled**.'
                            : '⛔ Title defend tracking is currently **disabled**.'
                    )
                    .setTimestamp();

                console.log(`└─ Title defend mode status checked: ${enabled ? 'enabled' : 'disabled'} (${ladder.key})`);
                return interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error in titledefendmode command:', error);
            logError(`titledefendmode command error: ${error.message}\nStack: ${error.stack}`);
            return interaction.editReply({
                content: 'An error occurred while updating title defend tracking. Please try again.'
            });
        }
    }
};
