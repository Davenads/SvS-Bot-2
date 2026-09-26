// services/challengeThreads.js
//
// Per-challenge coordination threads inside the shared #issue-a-challenge
// channel (CHANNEL_DASHBOARDS_PLAN.md §5.6). When a challenge is created a
// PRIVATE thread is spawned as a coordination room for the two duelers; both
// players and every SvS Manager are added (adding a member pings them). No
// ready-check — just a pinned detail embed.
//
// The pair -> threadId mapping lives in a durable Redis sidecar
// (`challenge-thread:{prefix}:{sortedPair}`) with a TTL longer than the
// challenge, because at challenge EXPIRY the challenge value is already gone and
// only the key name survives — the sidecar lets teardown resolve the thread
// from the same sorted pair the key name yields.
//
// Every function is best-effort: a thread failure is logged and swallowed so it
// never blocks the sheet/Redis writes that already recorded the challenge.

const { EmbedBuilder, ChannelType } = require('discord.js');
const redisClient = require('../redis-client');
const { logError } = require('../logger');
const { SHARED_CHALLENGE_CHANNEL_ID } = require('../config/ladders');
const { specEmojiMap, elementEmojiMap } = require('../config/emoji');
const { findManagerMembers } = require('../utils/managers');

// Sidecar lives longer than the challenge (~3 days) so teardown can still
// resolve the thread at/after expiry. 4 days gives a full day of margin.
const THREAD_SIDECAR_TTL = 4 * 24 * 60 * 60;

// Ladder tag used in the thread name so HLD vs LLD is obvious in the shared
// channel's thread list.
function ladderTag(ladder) {
  return ladder.key === 'lld' ? 'LLD' : 'HLD';
}

// `⚔️ [HLD] PlayerA (#3) vs PlayerB (#5)` (answer 6). Trimmed to Discord's
// 100-char thread-name limit.
function threadName(ladder, challengerRow, targetRow, challengerRank, targetRank) {
  const name = `⚔️ [${ladderTag(ladder)}] ${challengerRow[1]} (#${challengerRank}) vs ${targetRow[1]} (#${targetRank})`;
  return name.length > 100 ? name.slice(0, 100) : name;
}

// The { discordId, element } pair objects the Redis sidecar key needs (matches
// generateChallengeThreadKey's sorted-pair contract).
function pairFromRows(challengerRow, targetRow) {
  return {
    player1: { discordId: challengerRow[8], element: challengerRow[3] },
    player2: { discordId: targetRow[8], element: targetRow[3] },
  };
}

function detailEmbed(ladder, challengerRow, targetRow, challengerRank, targetRank, challengeDate) {
  return new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle(`⚔️ ${ladderTag(ladder)} Challenge — Coordination Thread`)
    .setDescription(
      'Use this thread to coordinate your match (times, games, etc.). ' +
      'When you\'re done, report the result with `/reportwin` in your challenges channel.'
    )
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
      },
      { name: 'Challenge Date', value: challengeDate || 'Just now' }
    )
    .setFooter({ text: 'Challenge expires in 3 days.' })
    .setTimestamp();
}

// Create a private coordination thread, add both duelers + all SvS Managers,
// post a pinned detail embed, and persist the pair -> threadId sidecar. Returns
// the thread id on success or null (never throws).
async function createChallengeThread(
  client,
  ladder,
  { challengerRow, targetRow, challengerRank, targetRank, challengeDate }
) {
  try {
    const channel = await client.channels.fetch(SHARED_CHALLENGE_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.threads || typeof channel.threads.create !== 'function') {
      logError(
        'Challenge threads: #issue-a-challenge channel missing or not thread-capable',
        new Error(`channel ${SHARED_CHALLENGE_CHANNEL_ID} unavailable`)
      );
      return null;
    }

    const thread = await channel.threads.create({
      name: threadName(ladder, challengerRow, targetRow, challengerRank, targetRank),
      // 7 days: never auto-archive before our explicit teardown / the 3-day
      // expiry handler does. Post-2022 Discord removed the boost gate on this.
      autoArchiveDuration: 10080,
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: `Challenge thread: ${ladder.displayName}`,
    });

    // Add both duelers + every SvS Manager. Adding a member pings them (answer 1).
    const memberIds = new Set([challengerRow[8], targetRow[8]]);
    try {
      const managers = await findManagerMembers(channel.guild);
      managers.forEach(m => memberIds.add(m.id));
    } catch (error) {
      logError('Challenge threads: manager lookup failed', error);
    }
    for (const id of memberIds) {
      if (!id) continue;
      await thread.members.add(id).catch(err =>
        logError(`Challenge threads: failed adding member ${id}`, err)
      );
    }

    // Pinned challenge-detail embed (no buttons — coordination only, answer 2).
    try {
      const msg = await thread.send({
        embeds: [detailEmbed(ladder, challengerRow, targetRow, challengerRank, targetRank, challengeDate)],
      });
      await msg.pin().catch(() => {});
    } catch (error) {
      logError('Challenge threads: failed posting detail embed', error);
    }

    // Durable pair -> threadId sidecar (TTL > challenge, answer 7).
    const { player1, player2 } = pairFromRows(challengerRow, targetRow);
    await redisClient.setChallengeThread(player1, player2, ladder, thread.id, THREAD_SIDECAR_TTL);

    return thread.id;
  } catch (error) {
    logError('Challenge threads: creation failed', error);
    return null; // Never block the challenge write.
  }
}

// Post a note into a thread, unarchiving first if Discord has archived it (a
// send to an archived thread is rejected). Best-effort — swallows send/permission
// errors so callers never have to guard the write.
async function postThreadNote(thread, text) {
  if (!text) return;
  if (thread.archived) await thread.setArchived(false).catch(() => {});
  await thread.send(text).catch(() => {});
}

// Archive (never delete — answer 3) the coordination thread for a resolved
// challenge and drop the sidecar. The threadId is resolved from the sidecar, so
// this works even at EXPIRY when the challenge value is already gone (the caller
// passes the pair parsed from the key name). `player1`/`player2` need only
// { discordId, element }. Best-effort — never throws.
async function archiveChallengeThread(client, ladder, player1, player2, closingText) {
  try {
    const threadId = await redisClient.getChallengeThread(player1, player2, ladder);
    if (!threadId) return; // No thread (pre-feature challenge, or creation failed).

    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (thread) {
      // Post the closing note while the thread is still active, then archive.
      await postThreadNote(thread, closingText);
      await thread
        .setArchived(true)
        .catch(err => logError('Challenge threads: archive failed', err));
    }

    await redisClient.removeChallengeThread(player1, player2, ladder);
  } catch (error) {
    logError('Challenge threads: teardown failed', error);
  }
}

// Keep the thread alive on /extendchallenge (answer 5): bump the sidecar TTL to
// match the reset challenge lifetime and optionally post a note. The thread's
// autoArchiveDuration is already the 7-day max, so nothing to bump there.
async function persistChallengeThread(client, ladder, player1, player2, noteText) {
  try {
    const threadId = await redisClient.getChallengeThread(player1, player2, ladder);
    if (!threadId) return;

    await redisClient.refreshChallengeThreadTTL(player1, player2, ladder, THREAD_SIDECAR_TTL);

    if (noteText) {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (thread) await postThreadNote(thread, noteText);
    }
  } catch (error) {
    logError('Challenge threads: persist failed', error);
  }
}

// Orphan-thread safety sweep (G3, Risk #9). Walks every challenge-thread sidecar
// and archives any thread whose sibling challenge no longer exists — i.e. the
// challenge resolved or expired but its teardown was missed (e.g. the bot was
// down when the keyspace-expiry event fired). Runs off the existing hourly
// safety check. Best-effort; never throws.
async function sweepOrphanThreads(client) {
  try {
    const keys = await redisClient.listChallengeThreadKeys();
    if (!keys.length) return;

    let archived = 0;
    for (const key of keys) {
      // Challenge still live -> leave its thread alone.
      const stillActive = await redisClient.challengeExistsForThreadKey(key);
      if (stillActive) continue;

      const threadId = await redisClient.getChallengeThreadValue(key);
      if (threadId) {
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (thread && !thread.archived) {
          await postThreadNote(thread, '🧹 This challenge is no longer active. Thread archived.');
          await thread
            .setArchived(true)
            .catch(err => logError('Challenge threads: orphan archive failed', err));
          archived++;
        }
      }
      // Drop the stale sidecar either way.
      await redisClient.removeChallengeThreadByKey(key);
    }

    if (archived) {
      console.log(`[CHALLENGE THREADS] Orphan sweep archived ${archived} stale thread(s)`);
    }
  } catch (error) {
    logError('Challenge threads: orphan sweep failed', error);
  }
}

module.exports = {
  createChallengeThread,
  archiveChallengeThread,
  persistChallengeThread,
  sweepOrphanThreads,
  THREAD_SIDECAR_TTL,
  pairFromRows,
  ladderTag,
};
