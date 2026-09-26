// interactions/rankingsPanel.js
//
// Handles the rankings dashboard's "View full ladder" button:
//     svs:rankings:viewfull:{ladderKey}
//
// A persistent shared board is single-state, so it can't be user-paginated
// (one viewer's "Next" would move the board for everyone). Instead the board
// shows the Top 10 and this button opens a PER-VIEWER ephemeral, paginated view
// (10/page) with its own First/Prev/Next/Last collector — mirroring the
// /leaderboard command. See CHANNEL_DASHBOARDS_PLAN.md §5.2.
//
// The pagination buttons below use NON-namespaced ids ('rank_*') on purpose so
// only this ephemeral message's collector owns them; the global router ignores
// anything not prefixed with 'svs:'.

require('dotenv').config();
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { LADDERS } = require('../config/ladders');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const statusEmojiMap = { Available: '✅', Challenge: '❌', Vacation: '🌴' };
const PAGE_SIZE = 10;

function buildPages(ladder, validRows, iconURL) {
  const pages = [];
  let current = null;
  validRows.forEach((row, index) => {
    if (index % PAGE_SIZE === 0) {
      current = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle(`🏆 ${ladder.displayName} — Full Rankings 🏆`)
        .setTimestamp()
        .setFooter({ text: `SvS Bot • ${ladder.displayName}`, iconURL });
      pages.push(current);
    }
    const rank = row[0] || 'N/A';
    const name = row[1] || 'Unknown';
    const element = row[3] || '';
    const status = row[5] || 'Available';
    current.addFields({
      name: `#${rank} - ${name} ${elementEmojiMap[element] || ''}`,
      value: `Status: ${statusEmojiMap[status] || ''} ${status}`,
      inline: false,
    });
  });
  return pages;
}

function navRow(page, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rank_first').setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('rank_prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('rank_next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= total - 1),
    new ButtonBuilder().setCustomId('rank_last').setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1)
  );
}

async function handle(interaction, ctx) {
  if (ctx.action !== 'viewfull') return;

  const ladder = LADDERS[ctx.ladderKey];
  if (!ladder) {
    return interaction.reply({ content: 'Unknown ladder.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  let validRows = [];
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!A2:H`,
    });
    validRows = (result.data.values || []).filter(row => row[0] && row[1]);
  } catch (error) {
    logError(`Rankings viewfull: read failed ${ladder.sheetName}`, error);
    return interaction.editReply({ content: 'Could not load the ladder right now. Please try again shortly.' });
  }

  if (!validRows.length) {
    return interaction.editReply({ content: `No players on the ${ladder.displayName} yet.` });
  }

  const iconURL = interaction.client.user.displayAvatarURL();
  const pages = buildPages(ladder, validRows, iconURL);

  if (pages.length === 1) {
    return interaction.editReply({ embeds: [pages[0]] });
  }

  let page = 0;
  const message = await interaction.editReply({
    embeds: [pages[page]],
    components: [navRow(page, pages.length)],
  });

  const collector = message.createMessageComponentCollector({ time: 60000 });
  collector.on('collect', async (btn) => {
    if (btn.customId === 'rank_first') page = 0;
    else if (btn.customId === 'rank_prev') page = Math.max(0, page - 1);
    else if (btn.customId === 'rank_next') page = Math.min(pages.length - 1, page + 1);
    else if (btn.customId === 'rank_last') page = pages.length - 1;
    else return;
    await btn.update({ embeds: [pages[page]], components: [navRow(page, pages.length)] });
  });
  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch (_) {
      // Ephemeral message may already be gone; ignore.
    }
  });
}

module.exports = { handle };
