// dashboards/refresh.js
//
// The dashboard refresh engine: "post once, edit forever". For a (ladder,
// panel) it renders the current payload and either edits the existing board
// message in place or — if the stored message is missing/deleted — reposts and
// records the new message id via the registry.
//
//   refreshDashboard(client, ladderKey, panel)  debounced per-mutation trigger
//   hydrateAll(client)                          startup + periodic safety sweep
//
// Mirrors the challenge-expiry-handler pattern: event-driven edits backstopped
// by a timed sweep so manual sheet edits / missed events self-heal. Everything
// fails soft (logs + returns) so a board hiccup never blocks a sheet write.
//
// See CHANNEL_DASHBOARDS_PLAN.md §4.3.

const {
  LADDERS,
  DASHBOARD_PANELS,
  SHARED_CHALLENGE_CHANNEL_ID,
  SHARED_REGISTER_CHANNEL_ID,
} = require('../config/ladders');
const { getDashboardMessage, setDashboardMessage } = require('./registry');
const { buildRankingsPayload, buildChallengesPayload, buildRegisterPayload } = require('./render');
const { logError } = require('../logger');

// Coalesce mutation bursts (a shuffle touches many rows) into one edit per
// panel per window, staying well under Discord's message edit rate limits.
const DEBOUNCE_MS = 2500;
const pending = new Map(); // `${ladderKey}:${panel}` -> timeout handle

// Resolve where a panel lives + its rendered payload for a given ladder.
// Returns null for panels not yet implemented (register lands later).
//
// The two challenge boards are per-ladder (scope = ladder.key) but share the
// single #issue-a-challenge channel, so the registry keys (main,challenges) and
// (lld,challenges) point at two distinct messages in the same channel.
async function buildPanel(ladder, panel) {
  if (panel === DASHBOARD_PANELS.RANKINGS) {
    return {
      scope: ladder.key,
      channelId: ladder.rankingsChannelId,
      payload: await buildRankingsPayload(ladder),
    };
  }
  if (panel === DASHBOARD_PANELS.CHALLENGES) {
    return {
      scope: ladder.key,
      channelId: SHARED_CHALLENGE_CHANNEL_ID,
      payload: await buildChallengesPayload(ladder),
    };
  }
  return null;
}

// Given a resolved plan { scope, channelId, payload }, edit the stored board
// message in place, or repost + record its id when missing/deleted. `label` is
// only for log context. Shared by the per-ladder and shared-panel paths.
async function applyPlan(client, plan, panel, label) {
  if (!plan || !plan.channelId || !plan.payload) return;

  try {
    const channel = await client.channels.fetch(plan.channelId).catch(() => null);
    if (!channel) {
      logError(
        `Dashboard refresh: channel ${plan.channelId} not found (${label})`,
        new Error('channel fetch returned null')
      );
      return;
    }

    const stored = await getDashboardMessage(plan.scope, panel);
    if (stored && stored.messageId) {
      const existing = await channel.messages.fetch(stored.messageId).catch(() => null);
      if (existing) {
        await existing.edit(plan.payload);
        return;
      }
    }

    // No stored message, or it was deleted — post fresh and record the id.
    const posted = await channel.send(plan.payload);
    await setDashboardMessage(plan.scope, panel, plan.channelId, posted.id);
  } catch (error) {
    logError(`Dashboard refresh failed (${label})`, error);
  }
}

// Immediately (re)render and edit-or-repost a per-ladder panel.
async function doRefresh(client, ladderKey, panel) {
  const ladder = LADDERS[ladderKey];
  if (!ladder) return;

  let plan;
  try {
    plan = await buildPanel(ladder, panel);
  } catch (error) {
    logError(`Dashboard build failed (${ladderKey}/${panel})`, error);
    return;
  }
  await applyPlan(client, plan, panel, `${ladderKey}/${panel}`);
}

// Immediately (re)render and edit-or-repost a SHARED (non-ladder) panel. Today
// that's just the register control panel, which is static (buttons only) so it
// never needs a mutation-triggered refresh — only hydration / the safety sweep.
async function doRefreshShared(client, panel) {
  let plan = null;
  try {
    if (panel === DASHBOARD_PANELS.REGISTER) {
      plan = {
        scope: 'shared',
        channelId: SHARED_REGISTER_CHANNEL_ID,
        payload: buildRegisterPayload(),
      };
    }
  } catch (error) {
    logError(`Dashboard build failed (shared/${panel})`, error);
    return;
  }
  await applyPlan(client, plan, panel, `shared/${panel}`);
}

// Debounced public entry point — call this from mutating commands.
function refreshDashboard(client, ladderKey, panel) {
  if (!client || !ladderKey || !panel) return;
  const key = `${ladderKey}:${panel}`;
  if (pending.has(key)) clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      doRefresh(client, ladderKey, panel).catch(err =>
        logError('Dashboard debounced refresh failed', err)
      );
    }, DEBOUNCE_MS)
  );
}

// Startup hydration + periodic safety sweep: reconcile every persistent board
// (sequential, so the ladders/panels are naturally staggered).
async function hydrateAll(client) {
  for (const ladderKey of Object.keys(LADDERS)) {
    await doRefresh(client, ladderKey, DASHBOARD_PANELS.RANKINGS);
    await doRefresh(client, ladderKey, DASHBOARD_PANELS.CHALLENGES);
  }
  // The register panel is shared across ladders — reconcile it once.
  await doRefreshShared(client, DASHBOARD_PANELS.REGISTER);
}

module.exports = { refreshDashboard, hydrateAll };
