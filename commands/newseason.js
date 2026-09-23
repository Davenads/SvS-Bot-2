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
const redisClient = require('../redis-client');
const { getLadderFromOption } = require('../utils/ladder');
const { SEASON_CHAMPIONS_TAB, SEASONS_TAB } = require('../config/ladders');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const MANAGER_ROLE = 'SvS Manager';

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const specEmojiMap = { Vita: '❤️', ES: '🔵' };

// Resolve the current season number for a ladder. Redis is the fast path; if it
// has never been set, initialize from the Season Champions tab as
// (highest recorded Season for this ladder) + 1 so manual backfill and the first
// automated rollover stay in sync (plan §3.2).
async function resolveCurrentSeason(ladder, championRows) {
    let season = await redisClient.getSeason(ladder);
    if (season !== null && !Number.isNaN(season)) {
        return season;
    }
    let maxSeason = 0;
    for (const row of championRows) {
        if (row[1] === ladder.seasonLabel) {
            const n = parseInt(row[0], 10);
            if (!Number.isNaN(n) && n > maxSeason) maxSeason = n;
        }
    }
    return maxSeason + 1;
}

// Read every row of the Season Champions tab (A:K). Returns [] on empty.
async function readSeasonChampions() {
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SEASON_CHAMPIONS_TAB}!A2:K`
    });
    return result.data.values || [];
}

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
            const duplicate = championRows.some(
                row => parseInt(row[0], 10) === season && row[1] === ladder.seasonLabel
            );

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

            const embed = await performRollover(interaction, ladder, season);
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

// Perform the archival + rollover for `season` on `ladder` and return the
// announcement embed. Steps mirror plan §3.3: read champion from the live ladder,
// append to Season Champions, zero column C (leave D), advance the pointer.
async function performRollover(interaction, ladder, season) {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = (await redisClient.getSeasonStartDate(ladder)) || '';

    // 1. Read the live ladder standings (A2:K) for champion + runner-up.
    const ladderResult = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ladder.sheetName}!A2:K`
    });
    const ladderRows = ladderResult.data.values || [];
    const rank1 = ladderRows.find(row => String(row[0]) === '1');
    const rank2 = ladderRows.find(row => String(row[0]) === '2');

    const championName = rank1 ? rank1[1] || '—' : '—';
    const championSpec = rank1 ? rank1[2] || '' : '';
    const championElement = rank1 ? rank1[3] || '' : '';
    const championDiscordId = rank1 ? (rank1[8] || '').trim() : '';
    const runnerUpName = rank2 ? rank2[1] || '' : '';

    // 2. Read the Metrics title-defends table (A11:D) for season/all-time counts.
    const metricsResult = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ladder.metricsTab}!A11:D`
    });
    const metricsRows = metricsResult.data.values || [];

    let championSeasonDefends = null;
    if (championDiscordId) {
        const champMetric = metricsRows.find(row => (row[1] || '').trim() === championDiscordId);
        if (champMetric) championSeasonDefends = parseInt(champMetric[2] || '0', 10);
    }

    // Top season defenders (by column C) for the announcement embed.
    const topDefenders = metricsRows
        .filter(row => row[0] && row[2])
        .map(row => ({ username: row[0], defends: parseInt(row[2] || '0', 10) }))
        .filter(d => d.defends > 0)
        .sort((a, b) => b.defends - a.defends)
        .slice(0, 5);

    // 3. Append the champion row to the shared Season Champions log (A→K, exact
    //    column order — must not be reordered).
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SEASON_CHAMPIONS_TAB}!A:K`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
            values: [[
                String(season),                                                   // A Season
                ladder.seasonLabel,                                               // B Ladder
                startDate,                                                        // C Start Date
                endDate,                                                          // D End Date
                championName,                                                     // E Champion
                championDiscordId,                                               // F Discord ID
                championElement,                                                  // G Element
                championSpec,                                                     // H Spec
                championSeasonDefends != null ? String(championSeasonDefends) : '', // I Season Defends
                runnerUpName,                                                     // J Runner-Up
                ''                                                                // K Notes
            ]]
        }
    });
    console.log(`├─ Archived Season ${season} champion (${championName}) to ${SEASON_CHAMPIONS_TAB}`);

    // 4. Zero column C (current-season defends) for every defender; leave D (all-time)
    //    untouched.
    if (metricsRows.length > 0) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ladder.metricsTab}!C11:C${10 + metricsRows.length}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: metricsRows.map(() => ['0'])
            }
        });
        console.log(`├─ Reset current-season defends (column C) for ${metricsRows.length} row(s)`);
    }

    // 5. Advance the pointer to N+1 in Redis and mirror to the Seasons tab.
    const nextSeason = season + 1;
    await redisClient.setSeason(nextSeason, ladder);
    await redisClient.setSeasonStartDate(endDate, ladder);
    await upsertSeasonsTab(ladder, season, startDate, endDate, nextSeason);
    console.log(`└─ Season pointer advanced to ${nextSeason} (${ladder.key})`);

    // 6. Announcement embed.
    const elementEmoji = elementEmojiMap[championElement] || '';
    const specEmoji = specEmojiMap[championSpec] || '';
    const championMention = championDiscordId ? `<@${championDiscordId}>` : championName;

    let defenderText = '';
    topDefenders.forEach((d, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || '•';
        defenderText += `${medal} **${d.username}** — ${d.defends} defends\n`;
    });

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`🏆 Season ${season} Complete — ${ladder.displayName}`)
        .setDescription(
            `The dust settles on **Season ${season}**. A new season begins now!`
        )
        .addFields(
            {
                name: '👑 Champion',
                value:
                    championName === '—'
                        ? '*No rank #1 was set at season close.*'
                        : `${championMention} ${elementEmoji}${championElement ? ` ${championElement}` : ''}${specEmoji ? ` • ${specEmoji} ${championSpec}` : ''}` +
                          (championSeasonDefends != null ? `\n🛡️ ${championSeasonDefends} season title defends` : ''),
                inline: false
            }
        );

    if (runnerUpName) {
        embed.addFields({ name: '🥈 Runner-Up', value: runnerUpName, inline: true });
    }
    if (defenderText) {
        embed.addFields({ name: '📊 Top Season Defenders', value: defenderText, inline: false });
    }

    embed.addFields({ name: '🔓 New Season', value: `Season **${nextSeason}** is now live.`, inline: false });
    embed.setFooter({ text: `Rolled over by ${interaction.user.tag} • ${endDate}` });
    embed.setTimestamp();

    return embed;
}

// Mirror the season pointer to the durable Seasons tab (Season | Ladder | Start
// Date | End Date). Stamps the ending season's End Date and appends a fresh row
// for the newly-opened season. The tab is the human-visible source of truth.
async function upsertSeasonsTab(ladder, endedSeason, endedStartDate, endDate, nextSeason) {
    try {
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SEASONS_TAB}!A2:D`
        });
        const rows = result.data.values || [];

        // Close out the ended season's row if it exists (stamp End Date), else add it.
        const endedIdx = rows.findIndex(
            row => parseInt(row[0], 10) === endedSeason && row[1] === ladder.seasonLabel
        );
        if (endedIdx === -1) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SEASONS_TAB}!A:D`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [[String(endedSeason), ladder.seasonLabel, endedStartDate, endDate]]
                }
            });
        } else {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SEASONS_TAB}!A${2 + endedIdx}:D${2 + endedIdx}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[String(endedSeason), ladder.seasonLabel, rows[endedIdx][2] || endedStartDate, endDate]]
                }
            });
        }

        // Open the next season's row if it isn't already present.
        const hasNext = rows.some(
            row => parseInt(row[0], 10) === nextSeason && row[1] === ladder.seasonLabel
        );
        if (!hasNext) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SEASONS_TAB}!A:D`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [[String(nextSeason), ladder.seasonLabel, endDate, '']]
                }
            });
        }
    } catch (error) {
        // The Seasons tab is a durability mirror; Redis remains authoritative for
        // the live pointer, so don't fail the whole rollover if this write hiccups.
        console.error('Error updating Seasons tab:', error);
        logError(`newseason Seasons-tab update error: ${error.message}`);
    }
}
