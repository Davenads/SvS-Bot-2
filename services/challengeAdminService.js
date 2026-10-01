// services/challengeAdminService.js
//
// Manager-facing challenge administration, extracted from commands/cancelchallenge.js
// so both the slash command and the Manager Panel's "Force-Cancel Match" wizard
// share one code path. Force-cancelling voids an active challenge with NO rank
// change (for disputes / mistakes): both players return to Available, the Redis
// challenge key is cleared, the coordination thread is archived, and the live
// boards are refreshed.

require('dotenv').config();
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const redisClient = require('../redis-client');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');
const { archiveChallengeThread } = require('./challengeThreads');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Force-cancel the active challenge involving the character at `rank` on `ladder`.
// Re-reads the sheet (source of truth) so a stale rank can never be acted on.
// Returns { success, reason, player, opponent } where player/opponent are
// { rank, name, spec, element, discUsername, discordId }.
async function forceCancelChallengeByRank(client, ladder, rank) {
  const sheetName = ladder.sheetName;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:K`,
  });

  let rows = res.data.values || [];
  // Keep the 1-based sheet row with each record so we can write straight back.
  const indexed = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(r => r.row[0] && r.row[1]);

  const playerRec = indexed.find(r => String(r.row[0]).trim() === String(rank).trim());
  if (!playerRec) {
    return { success: false, reason: 'That rank no longer holds a character (the ladder may have shifted).' };
  }

  const playerRow = playerRec.row;
  if (playerRow[5] !== 'Challenge') {
    return { success: false, reason: `**${playerRow[1]}** is not currently in an active challenge.` };
  }

  // Column H (index 7) stores the opponent's rank for the active pairing.
  const opponentRank = playerRow[7];
  if (!opponentRank) {
    return { success: false, reason: `**${playerRow[1]}** has no recorded opponent to cancel.` };
  }

  const opponentRec = indexed.find(r => String(r.row[0]).trim() === String(opponentRank).trim());
  if (!opponentRec) {
    return { success: false, reason: 'The opponent could not be found — the sheet may be out of sync.' };
  }
  const opponentRow = opponentRec.row;

  // Clear challenge state (F:H = Status, cDate, Opp#) for BOTH players.
  const updates = [
    { range: `${sheetName}!F${playerRec.rowNum}:H${playerRec.rowNum}`, values: [['Available', '', '']] },
    { range: `${sheetName}!F${opponentRec.rowNum}:H${opponentRec.rowNum}`, values: [['Available', '', '']] },
  ];
  for (const update of updates) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: update.range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: update.values },
    });
  }

  // Remove the Redis challenge key and archive the coordination thread
  // (best-effort — never let Redis/thread I/O block the cancellation).
  const p1 = { discordId: playerRow[8], element: playerRow[3] };
  const p2 = { discordId: opponentRow[8], element: opponentRow[3] };
  try {
    await redisClient.removeChallenge(p1, p2, ladder);
    archiveChallengeThread(
      client,
      ladder,
      p1,
      p2,
      '⚔️ This challenge was force-cancelled by a manager. Thread archived.'
    );
  } catch (error) {
    logError('challengeAdminService: Redis/thread cleanup failed', error);
    // Continue — the sheet is already corrected.
  }

  // Both players are Available again (rankings) and the pair left the board.
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS);
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.CHALLENGES);

  return {
    success: true,
    player: {
      rank: playerRow[0],
      name: playerRow[1],
      spec: playerRow[2],
      element: playerRow[3],
      discUsername: playerRow[4],
      discordId: playerRow[8],
    },
    opponent: {
      rank: opponentRow[0],
      name: opponentRow[1],
      spec: opponentRow[2],
      element: opponentRow[3],
      discUsername: opponentRow[4],
      discordId: opponentRow[8],
    },
  };
}

module.exports = { forceCancelChallengeByRank };
