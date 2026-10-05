// Shared manager-lookup helper. Both the register panel (extended-vacation DMs)
// and the challenge-thread service (thread membership + pings) need the list of
// members holding the SvS Manager role, so it lives here to avoid two copies
// drifting apart (CHANNEL_DASHBOARDS_PLAN.md Risk #1).

const { logError } = require('../logger');

const MANAGER_ROLE_NAME = 'SvS Manager';

// Resolve the SvS Manager role from the guild's ROLE cache. Roles are cached in
// full (unlike members), so a name lookup here is reliable. Returns null if the
// role doesn't exist.
function findManagerRole(guild) {
  return guild.roles.cache.find(r => r.name === MANAGER_ROLE_NAME) || null;
}

// Return every non-bot member holding the SvS Manager role.
//
// `role.members` is derived from the guild MEMBER cache, which on an active
// guild is only PARTIALLY populated (Discord only gossips recently-active
// members). The previous guard refetched ONLY when that cache was completely
// empty, so a partial cache returned a partial roster — silently dropping the
// uncached managers (the "~80% of managers" bug in thread membership and the
// extended-vacation DMs). We now ALWAYS fetch the full member list first so the
// roster is complete. These lookups fire on infrequent events (challenge
// creation, extended-vacation requests), so the fetch cost is acceptable.
async function findManagerMembers(guild) {
  const role = findManagerRole(guild);
  if (!role) return [];
  try {
    await guild.members.fetch();
  } catch (error) {
    logError('findManagerMembers: failed fetching guild members', error);
  }
  const members = role.members;
  return members ? [...members.values()].filter(m => !m.user.bot) : [];
}

// Resolve the channel where the single Approve/Deny post for a manager request
// (vacation + thread dodge/extend/cancel) should land. We prefer the dashboard
// registry's `shared/manager` row — that's the admin-panel channel managers
// actually watch, so the approval post lands where they're looking and the
// channel auto-follows wherever the manager panel is posted (single source of
// truth, no extra env var). Falls back to the configured approval channel if the
// panel hasn't been posted yet or the registry lookup fails. Returns a sendable
// channel or null; never throws. Deferred requires avoid a config<->registry
// require cycle at module load.
async function resolveManagerApprovalChannel(client) {
  // eslint-disable-next-line global-require
  const { getDashboardMessage } = require('../dashboards/registry');
  // eslint-disable-next-line global-require
  const { DASHBOARD_PANELS, VACATION_APPROVAL_CHANNEL_ID } = require('../config/ladders');

  let channelId = null;
  try {
    const record = await getDashboardMessage('shared', DASHBOARD_PANELS.MANAGER);
    if (record && record.channelId) channelId = record.channelId;
  } catch (error) {
    logError('resolveManagerApprovalChannel: registry lookup failed', error);
  }
  if (!channelId) channelId = VACATION_APPROVAL_CHANNEL_ID;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel && typeof channel.send === 'function' ? channel : null;
}

module.exports = {
  findManagerMembers,
  findManagerRole,
  resolveManagerApprovalChannel,
  MANAGER_ROLE_NAME,
};
