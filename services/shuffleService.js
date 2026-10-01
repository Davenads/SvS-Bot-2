// services/shuffleService.js
//
// Ladder shuffle, extracted from commands/shuffle.js so the slash command and
// the Manager Panel's "Shuffle Ranks" wizard share one implementation. Randomly
// reorders every player's rank (Fisher-Yates), clears ALL active challenges, and
// synchronizes Redis. Does NOT archive a season — pure re-order (see
// ADMIN_PANEL_EXPANSION_PLAN.md §4.1). Returns a stats object; callers own the
// user-facing messaging and any confirmation gating.

require('dotenv').config();
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const redisClient = require('../redis-client');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Shuffle `ladder`. If `clearCooldowns` is true, every cooldown key for the
// ladder is removed; otherwise only now-invalid cooldowns (referencing removed
// players) are pruned. Returns:
//   { success, reason, playersShuffled, challengesCleared,
//     challengeKeysDeleted, cooldownKeysProcessed, discrepancies[] }
async function shuffleLadder(client, ladder, { clearCooldowns = false } = {}) {
  // Abort early if Redis is unreachable — a half-synced shuffle is worse than
  // no shuffle (matches the slash command's guard).
  try {
    await redisClient.client.ping();
  } catch (error) {
    logError('shuffleService: Redis ping failed', error);
    return { success: false, reason: 'Redis connection unavailable. Shuffle aborted to prevent desynchronization.' };
  }

  // Phase 1: fetch ladder data.
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`,
  });
  let rows = (result.data.values || []).filter(row => row[0] && row[1]);
  if (!rows.length) {
    return { success: false, reason: 'No players on the ladder to shuffle.' };
  }

  // Phase 2: Fisher-Yates shuffle, then reassign sequential ranks.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  rows.forEach((row, index) => {
    row[0] = (index + 1).toString();
  });

  // Phase 3: clear every active challenge (Status/cDate/Opp#).
  let challengesCleared = 0;
  rows.forEach(row => {
    if (row[5] === 'Challenge') {
      row[5] = 'Available';
      row[6] = '';
      row[7] = '';
      challengesCleared++;
    }
  });

  // Phase 4: write back (clear the range first so trailing rows never linger).
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K${rows.length + 1}`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K${rows.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows },
  });

  // Phase 5: synchronize Redis (scoped to this ladder's prefix).
  let challengeKeysDeleted = 0;
  let cooldownKeysProcessed = 0;

  const challengeKeys = await redisClient.client.keys(`challenge:${ladder.redisPrefix}:*`);
  const warningKeys = await redisClient.client.keys(`challenge-warning:${ladder.redisPrefix}:*`);
  const allChallengeKeys = [...challengeKeys, ...warningKeys];
  if (allChallengeKeys.length > 0) {
    await redisClient.client.del(...allChallengeKeys);
    challengeKeysDeleted = allChallengeKeys.length;
  }

  if (clearCooldowns) {
    const cooldownKeys = await redisClient.client.keys(`cooldown:${ladder.redisPrefix}:*`);
    if (cooldownKeys.length > 0) {
      await redisClient.client.del(...cooldownKeys);
      cooldownKeysProcessed = cooldownKeys.length;
    }
  } else {
    const cooldownKeys = await redisClient.client.keys(`cooldown:${ladder.redisPrefix}:*`);
    const validDiscordIds = new Set(rows.map(row => row[8]));
    for (const key of cooldownKeys) {
      try {
        const cooldownData = await redisClient.client.get(key);
        if (!cooldownData) {
          await redisClient.client.del(key);
          cooldownKeysProcessed++;
          continue;
        }
        const data = JSON.parse(cooldownData);
        const player1Exists = validDiscordIds.has(data.player1.discordId);
        const player2Exists = validDiscordIds.has(data.player2.discordId);
        if (!player1Exists || !player2Exists) {
          await redisClient.client.del(key);
          cooldownKeysProcessed++;
        }
      } catch (error) {
        logError(`shuffleService: error processing cooldown key ${key}`, error);
      }
    }
  }

  // Phase 6: verify challenge clearance (sheet + Redis).
  const discrepancies = [];
  const remainingChallenges = rows.filter(row => row[5] === 'Challenge').length;
  let remainingRedisChallenges = [];
  try {
    remainingRedisChallenges = await redisClient.getAllChallenges(ladder);
  } catch (error) {
    logError('shuffleService: getAllChallenges verification failed', error);
  }
  if (remainingChallenges > 0) discrepancies.push('Challenges not fully cleared in sheet');
  if (remainingRedisChallenges.length > 0) discrepancies.push('Challenge keys not fully cleared in Redis');

  // Refresh the live rankings board (every position changed).
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS);

  return {
    success: true,
    playersShuffled: rows.length,
    challengesCleared,
    challengeKeysDeleted,
    cooldownKeysProcessed,
    discrepancies,
  };
}

module.exports = { shuffleLadder };
