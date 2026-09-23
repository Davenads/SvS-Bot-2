const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { getLadderByKey } = require('../utils/ladder');
const { LADDERS, SEASON_CHAMPIONS_TAB } = require('../config/ladders');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const ENTRIES_PER_PAGE = 5;

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seasonhistory')
        .setDescription('Show past season champions')
        .addStringOption(option =>
            option.setName('ladder')
                .setDescription('Filter by ladder (defaults to all)')
                .setRequired(false)
                .addChoices(
                    { name: 'HLD', value: 'main' },
                    { name: 'LLD', value: 'lld' }
                )),

    async execute(interaction) {
        console.log(`[${new Date().toISOString()}] Command invoked: /seasonhistory by ${interaction.user.tag}`);
        await interaction.deferReply({ ephemeral: true });

        // Optional ladder filter. When omitted, show champions from every ladder.
        const ladderKey = interaction.options.getString('ladder');
        const ladder = ladderKey ? getLadderByKey(ladderKey) : null;
        const seasonLabelFilter = ladder ? ladder.seasonLabel : null;

        // Map a seasonLabel (Standard / LLD) back to its display name for embeds.
        const labelToDisplay = {};
        Object.values(LADDERS).forEach(l => { labelToDisplay[l.seasonLabel] = l.displayName; });

        try {
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SEASON_CHAMPIONS_TAB}!A2:K`
            });

            const rows = result.data.values || [];

            const champions = rows
                .filter(row => row[0] && row[4]) // must have a Season and a Champion
                .filter(row => !seasonLabelFilter || row[1] === seasonLabelFilter)
                .map(row => ({
                    season: parseInt(row[0], 10),
                    ladderLabel: row[1] || '',
                    startDate: row[2] || '',
                    endDate: row[3] || '',
                    champion: row[4],
                    discordId: row[5] ? row[5].trim() : '',
                    element: row[6] || '',
                    spec: row[7] || '',
                    seasonDefends: row[8] || '',
                    runnerUp: row[9] || '',
                    notes: row[10] || ''
                }))
                // Newest season first; group by ladder within the same season.
                .sort((a, b) => b.season - a.season || a.ladderLabel.localeCompare(b.ladderLabel));

            const titleSuffix = ladder ? ` — ${ladder.displayName}` : '';

            if (champions.length === 0) {
                return interaction.editReply({
                    content: `No season champions recorded yet${titleSuffix ? ` for ${ladder.displayName}` : ''}.`
                });
            }

            // Build paginated embeds.
            const pages = [];
            for (let i = 0; i < champions.length; i += ENTRIES_PER_PAGE) {
                const slice = champions.slice(i, i + ENTRIES_PER_PAGE);
                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle(`👑 Season Champions${titleSuffix}`)
                    .setTimestamp()
                    .setFooter({
                        text: `Page ${pages.length + 1}/${Math.ceil(champions.length / ENTRIES_PER_PAGE)}`,
                        iconURL: interaction.client.user.displayAvatarURL()
                    });

                for (const c of slice) {
                    const elementEmoji = elementEmojiMap[c.element] || '';
                    const championDisplay = c.discordId ? `<@${c.discordId}>` : c.champion;
                    const ladderName = ladder ? '' : ` [${labelToDisplay[c.ladderLabel] || c.ladderLabel}]`;

                    let value = `🏆 ${championDisplay}${elementEmoji ? ` ${elementEmoji}` : ''}`;
                    if (c.spec) value += ` • ${c.spec}`;
                    if (c.seasonDefends) value += `\n🛡️ ${c.seasonDefends} season defends`;
                    if (c.runnerUp) value += `\n🥈 Runner-Up: ${c.runnerUp}`;
                    const dateRange = c.startDate ? `${c.startDate} → ${c.endDate}` : c.endDate;
                    if (dateRange) value += `\n📅 ${dateRange}`;
                    if (c.notes) value += `\n📝 ${c.notes}`;

                    embed.addFields({ name: `Season ${c.season}${ladderName}`, value, inline: false });
                }

                pages.push(embed);
            }

            if (pages.length === 1) {
                return interaction.editReply({ embeds: [pages[0]] });
            }

            let currentPage = 0;
            const makeRow = page => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('first').setLabel('First').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId('previous').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1),
                new ButtonBuilder().setCustomId('last').setLabel('Last').setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1)
            );

            const message = await interaction.editReply({
                embeds: [pages[currentPage]],
                components: [makeRow(currentPage)]
            });

            const collector = message.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async buttonInteraction => {
                switch (buttonInteraction.customId) {
                    case 'first': currentPage = 0; break;
                    case 'previous': currentPage--; break;
                    case 'next': currentPage++; break;
                    case 'last': currentPage = pages.length - 1; break;
                }
                await buttonInteraction.update({
                    embeds: [pages[currentPage]],
                    components: [makeRow(currentPage)]
                });
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => {});
            });
        } catch (error) {
            console.error('Error in seasonhistory command:', error);
            logError(`seasonhistory command error: ${error.message}\nStack: ${error.stack}`);
            return interaction.editReply({
                content: 'An error occurred while fetching season history. Please try again later.'
            });
        }
    }
};
