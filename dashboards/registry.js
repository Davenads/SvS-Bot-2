// dashboards/registry.js
//
// Durable message registry for the persistent channel dashboards.
//
// Each dashboard panel is ONE bot-owned message that the bot edits in place.
// To keep editing that same message across restarts (and even a Redis flush)
// the bot must remember which message is which. This module is that memory.
//
//   Primary store : hidden `Dashboards` sheet tab, columns A->E:
//                   Ladder | Panel | Channel ID | Message ID | Last Updated
//   Cache         : Redis key svs:dashboard:{scope}:{panel}:msg -> JSON record
//
// The sheet is canonical (survives a Redis wipe); Redis is only a fast read
// cache. Every function fails soft (logs + returns null/false) so a registry
// hiccup can never crash the bot or block a sheet write elsewhere.
//
// `scope` is a ladder key ('main' | 'lld') for the per-ladder rankings and
// challenge boards, or 'shared' for the single register panel that serves both
// ladders. `panel` is one of config DASHBOARD_PANELS.
//
// See CHANNEL_DASHBOARDS_PLAN.md §4.1.

require('dotenv').config();
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { DASHBOARDS_TAB } = require('../config/ladders');
const redisClient = require('../redis-client');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

function redisKey(scope, panel) {
  return `svs:dashboard:${scope}:${panel}:msg`;
}

// The ioredis handle, or null when Redis is disabled (SKIP_REDIS_INIT=true).
function redis() {
  return redisClient && redisClient.client ? redisClient.client : null;
}

async function readCache(scope, panel) {
  const client = redis();
  if (!client) return null;
  try {
    const raw = await client.get(redisKey(scope, panel));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    logError('Dashboard registry: Redis read failed', error);
    return null;
  }
}

async function writeCache(scope, panel, record) {
  const client = redis();
  if (!client) return;
  try {
    await client.set(redisKey(scope, panel), JSON.stringify(record));
  } catch (error) {
    logError('Dashboard registry: Redis write failed', error);
  }
}

// Read the whole Dashboards tab (data rows only). Returns [] on any failure.
async function readSheetRows() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${DASHBOARDS_TAB}!A2:E`,
    });
    return res.data.values || [];
  } catch (error) {
    logError('Dashboard registry: sheet read failed', error);
    return [];
  }
}

// Resolve a panel's stored message. Redis first, sheet fallback (which then
// re-warms the cache). Returns { channelId, messageId } or null when unknown.
async function getDashboardMessage(scope, panel) {
  const cached = await readCache(scope, panel);
  if (cached && cached.channelId && cached.messageId) return cached;

  const rows = await readSheetRows();
  const match = rows.find(row => row[0] === scope && row[1] === panel);
  if (!match || !match[2] || !match[3]) return null;

  const record = { channelId: match[2], messageId: match[3] };
  await writeCache(scope, panel, record);
  return record;
}

// Upsert a panel's (channelId, messageId) into the sheet, then refresh the
// cache. Returns true on success. Callers should still tolerate false (the
// board will simply be re-resolved / reposted on the next hydration).
async function setDashboardMessage(scope, panel, channelId, messageId) {
  const record = { channelId, messageId };
  const rowValues = [scope, panel, channelId, messageId, new Date().toISOString()];

  try {
    const rows = await readSheetRows();
    const idx = rows.findIndex(row => row[0] === scope && row[1] === panel);

    if (idx === -1) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${DASHBOARDS_TAB}!A:E`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowValues] },
      });
    } else {
      const rowNum = idx + 2; // +1 for the header row, +1 for 1-based indexing
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${DASHBOARDS_TAB}!A${rowNum}:E${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowValues] },
      });
    }

    await writeCache(scope, panel, record);
    return true;
  } catch (error) {
    logError('Dashboard registry: sheet upsert failed', error);
    return false;
  }
}

module.exports = {
  getDashboardMessage,
  setDashboardMessage,
};
