// Shared manager-lookup helper. Both the register panel (extended-vacation DMs)
// and the challenge-thread service (thread membership + pings) need the list of
// members holding the SvS Manager role, so it lives here to avoid two copies
// drifting apart (CHANNEL_DASHBOARDS_PLAN.md Risk #1).

const { logError } = require('../logger');

const MANAGER_ROLE_NAME = 'SvS Manager';

// Opt-in role that controls who gets ADDED to (and thus pinged by) challenge
// coordination threads. Decoupled from SvS Manager so a manager can keep the mod
// role without drinking from the thread-notification firehose: only SvS Thread
// Mod holders are added; every other manager browses on demand via the Manage
// Threads permission. See MANAGER_THREAD_NOTIFICATIONS_PLAN.md.
const THREAD_MOD_ROLE_NAME = 'SvS Thread Mod';

// Resolve the SvS Manager role from the guild's ROLE cache. Roles are cached in
// full (unlike members), so a name lookup here is reliable. Returns null if the
// role doesn't exist.
function findManagerRole(guild) {
  return guild.roles.cache.find(r => r.name === MANAGER_ROLE_NAME) || null;
}

// Return every non-bot member holding `role`, or [] when role is null.
//
// `role.members` is derived from the guild MEMBER cache, which on an active
// guild is only PARTIALLY populated (Discord only gossips recently-active
// members). The previous guard refetched ONLY when that cache was completely
// empty, so a partial cache returned a partial roster — silently dropping the
// uncached members (the "~80% of managers" bug in thread membership and the
// extended-vacation DMs). We now ALWAYS fetch the full member list first so the
// roster is complete. These lookups fire on infrequent events (challenge
// creation, extended-vacation requests), so the fetch cost is acceptable.
async function membersForRole(guild, role) {
  if (!role) return [];
  try {
    await guild.members.fetch();
  } catch (error) {
    logError('membersForRole: failed fetching guild members', error);
  }
  const members = role.members;
  return members ? [...members.values()].filter(m => !m.user.bot) : [];
}

// Return every non-bot member holding the SvS Manager role.
async function findManagerMembers(guild) {
  return membersForRole(guild, findManagerRole(guild));
}

// Resolve the SvS Thread Mod role (opt-in challenge-thread subscribers). Returns
// null when the role doesn't exist.
function findThreadModRole(guild) {
  return guild.roles.cache.find(r => r.name === THREAD_MOD_ROLE_NAME) || null;
}

// Return every non-bot member holding the SvS Thread Mod role.
async function findThreadModMembers(guild) {
  return membersForRole(guild, findThreadModRole(guild));
}

// Resolve the channel where the single Approve/Deny post for a manager request
// (vacation + thread dodge/extend/cancel) should land. This is the DEDICATED
// #admin-approvals channel (MANAGER_APPROVAL_CHANNEL_ID), kept SEPARATE from the
// manager control panel channel: the panel is a static "post once, edit forever"
// message that only stays visible if nothing posts beneath it, so routing the
// live approval stream here stops the cards from burying the panel. Falls back
// to the legacy approval channel if the dedicated id is unset. Returns a sendable
// channel or null; never throws. Deferred require avoids a config require cycle
// at module load.
async function resolveManagerApprovalChannel(client) {
  // eslint-disable-next-line global-require
  const { MANAGER_APPROVAL_CHANNEL_ID, VACATION_APPROVAL_CHANNEL_ID } = require('../config/ladders');

  const channelId = MANAGER_APPROVAL_CHANNEL_ID || VACATION_APPROVAL_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel && typeof channel.send === 'function' ? channel : null;
}

module.exports = {
  findManagerMembers,
  findManagerRole,
  findThreadModMembers,
  findThreadModRole,
  resolveManagerApprovalChannel,
  MANAGER_ROLE_NAME,
  THREAD_MOD_ROLE_NAME,
};
