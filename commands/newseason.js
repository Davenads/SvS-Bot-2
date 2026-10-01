const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { logError } = require('../logger');
const { getLadderFromOption } = require('../utils/ladder');
const {
    readSeasonChampions,
    resolveCurrentSeason,
    seasonAlreadyArchived,
    performRollover
} = require('../services/seasonService');

const MANAGER_ROLE = 'SvS Manager';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('newseason')
        .setDescription('Archive the current season champion and start a new season (Manager only)')
        .addStringOption(option =>
            option.setName('ladder')
                .setDescription('Which ladder (defaults to HLD)')
                .setRequired(false)
                .addChoices(
                    { name: 'HLD', value: 'main' },
                    { name: 'LLD', value: 'lld' }
                ))
        .addBooleanOption(option =>
            option.setName('force')
                .setDescription('Override the duplicate-season safety guard')
                .setRequired(false)),

    async execute(interaction) {
        const ladder = getLadderFromOption(interaction);
        const force = interaction.options.getBoolean('force') || false;
        console.log(`\n[${new Date().toISOString()}] Command invoked: /newseason (${ladder.key}, force=${force}) by ${interaction.user.tag}`);

        const isManager = interaction.member.roles.cache.some(r => r.name === MANAGER_ROLE);
        if (!isManager) {
            return interaction.reply({
                content: 'You need the **SvS Manager** role to start a new season.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Read the shared Season Champions log and resolve the ending season N.
            const championRows = await readSeasonChampions();
            const season = await resolveCurrentSeason(ladder, championRows);

            // Idempotency guard: a row for (season, ladder) already means this season
            // was archived. Require an explicit confirmation (or force:true) before
            // writing a second row.
            const duplicate = seasonAlreadyArchived(championRows, season, ladder);

            if (duplicate && !force) {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('newseason_confirm')
                        .setLabel('Archive anyway')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('newseason_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

                const warning = new EmbedBuilder()
                    .setColor(0xFEE75C)
                    .setTitle(`⚠️ Season ${season} already archived — ${ladder.displayName}`)
                    .setDescription(
                        `The **Season Champions** log already has a row for **Season ${season} (${ladder.seasonLabel})**.\n\n` +
                        'Running the rollover again will append a **second** champion row for this season. ' +
                        'Only continue if you know what you are doing.'
                    )
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });

                const message = await interaction.editReply({
                    embeds: [warning],
                    components: [confirmRow]
                });

                try {
                    const button = await message.awaitMessageComponent({
                        filter: i => i.user.id === interaction.user.id,
                        time: 30000
                    });

                    if (button.customId === 'newseason_cancel') {
                        return button.update({
                            content: 'Season rollover cancelled.',
                            embeds: [],
                            components: []
                        });
                    }

                    await button.update({ components: [] });
                } catch (err) {
                    return interaction.editReply({
                        content: 'Confirmation timed out — season rollover cancelled.',
                        embeds: [],
                        components: []
                    });
                }
            }

            const embed = await performRollover(ladder, season, interaction.user.tag);
            return interaction.editReply({ content: null, embeds: [embed], components: [] });
        } catch (error) {
            console.error('Error in newseason command:', error);
            logError(`newseason command error: ${error.message}\nStack: ${error.stack}`);
            return interaction.editReply({
                content: 'An error occurred while starting the new season. No changes may have been applied — check the sheet before retrying.',
                embeds: [],
                components: []
            });
        }
    }
};
