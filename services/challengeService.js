// services/challengeService.js
//
// Shared challenge logic used by BOTH the /challenge slash command and the
// #issue-a-challenge dashboard button. Keeping the jump-rule validation,
// cooldown check, sheet write, Redis persistence, announcement embed, and board
// refresh in one place guarantees the two entry points behave identically.
//
// Column layout for the A2:I read used here:
//   [0] rank  [1] name  [2] spec  [3] element  [4] discUsername
//   [5] status [6] challengeDate [7] opp#  [8] discordId
//
// Every function is pure-ish: they read/write the sheet + Redis but never touch
// the interaction, so callers own all user-facing replies.

require('dotenv').config();
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const redisClient = require('../redis-client');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { logError } = require('../logger');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');
const { createChallengeThread } = require('./challengeThreads');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const specEmojiMap = { Vita: '❤️', ES: '🔵' };
const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };

// Read the ladder's active player rows (A2:I).
async function fetchLadderRows(ladder) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:I`,
  });
  return result.data.values || [];
}

// Effective jump size = 1 + number of AVAILABLE players strictly between the
// target and challenger, excluding players on vacation and the challenger's own
// characters. Mirrors the /challenge command exactly.
function effectiveJumpSize(rows, challengerRank, targetRank, userId) {
  const playersBetween = rows.filter(row => {
    const rank = parseInt(row[0]);
    return rank > targetRank && rank < challengerRank;
  });
  const availablePlayersBetween = playersBetween.filter(row => {
    if (row[5] === 'Vacation') return false;
    if (row[8] === userId) return false;
    return true;
  });
  return { availableJumpSize: availablePlayersBetween.length + 1, availablePlayersBetween };
}

// Validate a proposed challenge against the ladder's jump rules. Returns
// { ok: true } or { ok: false, reason } with the same wording the slash command
// uses. `rows` is the A2:I data; `userId` is the challenger's Discord id.
function validateJumpRules(ladder, rows, challengerRank, targetRank, userId) {
  const { availableJumpSize, availablePlayersBetween } = effectiveJumpSize(
    rows,
    challengerRank,
    targetRank,
    userId
  );

  if (targetRank <= ladder.top10Threshold && challengerRank > ladder.top10Threshold) {
    if (availableJumpSize > ladder.top10MaxJump) {
      const maxAllowedRank = challengerRank - ladder.top10MaxJump;
      return {
        ok: false,
        reason: `Players outside top 10 can only challenge up to ${ladder.top10MaxJump} ranks ahead when targeting top 10 players. The highest rank you can challenge is ${maxAllowedRank}.`,
      };
    }
  } else if (challengerRank <= ladder.top10Threshold) {
    if (availableJumpSize > ladder.top10MaxJump) {
      const maxTarget = rows.find(
        row => parseInt(row[0]) === challengerRank - ladder.top10MaxJump && row[5] !== 'Vacation'
      );
      return {
        ok: false,
        reason: `Top 10 players can only challenge up to ${ladder.top10MaxJump} ranks ahead. The highest rank you can challenge is ${
          maxTarget ? maxTarget[0] : challengerRank - ladder.top10MaxJump
        }.`,
      };
    }
  } else {
    if (availableJumpSize > ladder.regularMaxJump) {
      const skippedRanks = availablePlayersBetween.map(row => row[0]).join(', ');
      return {
        ok: false,
        reason: `Players outside top 10 can only challenge up to ${ladder.regularMaxJump} ranks ahead (excluding players on vacation). You're trying to skip ranks: ${skippedRanks}`,
      };
    }
  }
  return { ok: true };
}

// Which ranks can `challengerRank` legally challenge right now? Used to populate
// the dashboard button's opponent picker. Returns an array of target rows (A2:I
// slices) that are Available, not the challenger's own character, and pass the
// jump rules. `rows` is the A2:I data; `userId` the challenger's Discord id.
function getEligibleTargets(ladder, rows, challengerRank, userId) {
  return rows.filter(row => {
    const rank = parseInt(row[0]);
    if (!rank || rank >= challengerRank) return false; // only upward
    if (row[5] !== 'Available') return false;
    if (row[8] === userId) return false; // not your own character
    return validateJumpRules(ladder, rows, challengerRank, rank, userId).ok;
  });
}

// Build the "New Challenge Initiated" announcement embed (identical to the one
// the slash command posts to the ladder's challenges channel).
function buildAnnouncementEmbed(client, challengerRow, targetRow, challengerRank, targetRank) {
  return new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle('⚔️ New Challenge Initiated!')
    .addFields(
      {
        name: 'Challenger',
        value: `Rank #${challengerRank} (<@${challengerRow[8]}>)\n${specEmojiMap[challengerRow[2]] || ''} ${elementEmojiMap[challengerRow[3]] || ''}`,
        inline: true,
      },
      { name: '​', value: 'VS', inline: true },
      {
        name: 'Challenged',
        value: `Rank #${targetRank} (<@${targetRow[8]}>)\n${specEmojiMap[targetRow[2]] || ''} ${elementEmojiMap[targetRow[3]] || ''}`,
        inline: true,
      }
    )
    .setTimestamp()
    .setFooter({
      text: 'May the best player win! Challenge expires in 3 days.',
      iconURL: client.user.displayAvatarURL(),
    });
}

// Execute a validated challenge end-to-end: re-validate against the live sheet,
// enforce cooldown + availability, write both rows to Challenge, persist to
// Redis with the 3-day TTL, announce in the ladder's challenges channel, and
// refresh the live boards.
//
// Returns { success: true } or { success: false, message } — the caller decides
// how to surface `message` (ephemeral reply, etc.). `isManager` bypasses the
// "own rank only" identity check, matching the slash command's SvS Manager path.
async function executeChallenge(client, ladder, { challengerRank, targetRank, userId, isManager = false }) {
  if (challengerRank <= targetRank) {
    return { success: false, message: 'You cannot challenge players ranked below you.' };
  }

  const rows = await fetchLadderRows(ladder);
  if (!rows.length) {
    return { success: false, message: 'Unable to access leaderboard data. Please try again later.' };
  }

  const jump = validateJumpRules(ladder, rows, challengerRank, targetRank, userId);
  if (!jump.ok) {
    return { success: false, message: jump.reason };
  }

  const challengerRow = rows.find(row => parseInt(row[0]) === challengerRank);
  const targetRow = rows.find(row => parseInt(row[0]) === targetRank);
  if (!challengerRow || !targetRow) {
    return { success: false, message: 'One or both ranks were not found on the leaderboard.' };
  }

  if (challengerRow[8] !== userId && !isManager) {
    return { success: false, message: 'You can only initiate challenges for your own rank.' };
  }

  // Cooldown check between the two players.
  const player1 = { discordId: challengerRow[8], name: challengerRow[1], element: challengerRow[3] };
  const player2 = { discordId: targetRow[8], name: targetRow[1], element: targetRow[3] };
  const cooldownCheck = await redisClient.checkCooldown(player1, player2, ladder);
  if (cooldownCheck.onCooldown) {
    const remainingHours = Math.ceil(cooldownCheck.remainingTime / 3600);
    return {
      success: false,
      message: `You cannot challenge this player yet. Cooldown remains for ${remainingHours} hours.`,
    };
  }

  if (challengerRow[5] !== 'Available' || targetRow[5] !== 'Available') {
    return {
      success: false,
      message: `Challenge failed: ${
        challengerRow[5] !== 'Available' ? 'You are' : 'Your target is'
      } not available for challenges.`,
    };
  }

  const challengeDate = new Date().toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  });

  const challengerRowIndex = rows.findIndex(row => parseInt(row[0]) === challengerRank) + 2;
  const targetRowIndex = rows.findIndex(row => parseInt(row[0]) === targetRank) + 2;

  await Promise.all([
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!F${challengerRowIndex}:H${challengerRowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Challenge', challengeDate, targetRank]] },
    }),
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!F${targetRowIndex}:H${targetRowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Challenge', challengeDate, challengerRank]] },
    }),
  ]);

  const challenger = { discordId: challengerRow[8], name: challengerRow[1], element: challengerRow[3], rank: challengerRank };
  const target = { discordId: targetRow[8], name: targetRow[1], element: targetRow[3], rank: targetRank };
  await redisClient.setChallenge(challenger, target, challengeDate, ladder);

  // Announce in the ladder's challenges channel (NOT #issue-a-challenge).
  try {
    const channel = await client.channels.fetch(ladder.challengeChannelId).catch(() => null);
    if (channel) {
      const embed = buildAnnouncementEmbed(client, challengerRow, targetRow, challengerRank, targetRank);
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    logError('Challenge service: announcement failed', error);
    // Non-fatal: the challenge is already recorded.
  }

  // Refresh the live boards.
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS);
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.CHALLENGES);

  // Spawn the private coordination thread in #issue-a-challenge (best-effort;
  // never blocks — the challenge is already recorded). See §5.6.
  try {
    await createChallengeThread(client, ladder, {
      challengerRow,
      targetRow,
      challengerRank,
      targetRank,
      challengeDate,
    });
  } catch (error) {
    logError('Challenge service: thread creation failed', error);
  }

  return { success: true, challengerRow, targetRow, challengeDate };
}

module.exports = {
  fetchLadderRows,
  validateJumpRules,
  getEligibleTargets,
  executeChallenge,
  specEmojiMap,
  elementEmojiMap,
};
