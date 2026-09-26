// dashboards/render.js
//
// Pure rendering for the persistent dashboard panels. Given a ladder config,
// each builder reads the live sheet and returns a discord.js message payload
// ({ embeds, components }) that the refresh engine either edits into the
// existing board message or posts fresh.
//
// The rankings panel mirrors the /leaderboard embed but is capped at the Top 10
// (the full ladder lives behind the sheet hyperlink; a paginated ephemeral view
// is added in a later commit). See CHANNEL_DASHBOARDS_PLAN.md §5.2.

require('dotenv').config();
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { sheetTabUrl } = require('../config/ladders');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Same maps the /leaderboard command uses, kept in sync intentionally.
const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const statusEmojiMap = { Available: '✅', Challenge: '❌', Vacation: '🌴' };
const TOP_N = 10;

async function buildRankingsPayload(ladder) {
  const url = sheetTabUrl(ladder);
  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle(`🏆 ${ladder.displayName} — Live Rankings 🏆`)
    .setURL(url)
    .setTimestamp()
    .setFooter({ text: 'Auto-updating • Top 10' });

  let validRows = [];
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!A2:H`,
    });
    validRows = (result.data.values || []).filter(row => row[0] && row[1]);
  } catch (error) {
    logError(`Dashboard render: failed reading ${ladder.sheetName}`, error);
    embed.setDescription('⚠️ Rankings are temporarily unavailable. Retrying shortly.');
    return { embeds: [embed] };
  }

  if (!validRows.length) {
    embed.setDescription(
      `No players on the ${ladder.displayName} yet.\n\n**[Open the full ladder in Google Sheets](${url})**`
    );
    return { embeds: [embed] };
  }

  const top = validRows.slice(0, TOP_N);
  embed.setDescription(
    `Top ${top.length} of ${validRows.length} — **[Open the full ladder in Google Sheets](${url})**`
  );
  top.forEach(row => {
    const rank = row[0] || 'N/A';
    const name = row[1] || 'Unknown';
    const element = row[3] || '';
    const status = row[5] || 'Available';
    embed.addFields({
      name: `#${rank} - ${name} ${elementEmojiMap[element] || ''}`,
      value: `Status: ${statusEmojiMap[status] || ''} ${status}`,
      inline: false,
    });
  });

  return { embeds: [embed] };
}

module.exports = { buildRankingsPayload };
