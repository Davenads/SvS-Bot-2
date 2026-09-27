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

module.exports = { findManagerMembers, findManagerRole, MANAGER_ROLE_NAME };
