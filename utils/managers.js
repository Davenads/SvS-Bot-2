// Shared manager-lookup helper. Both the register panel (extended-vacation DMs)
// and the challenge-thread service (thread membership + pings) need the list of
// members holding the SvS Manager role, so it lives here to avoid two copies
// drifting apart (CHANNEL_DASHBOARDS_PLAN.md Risk #1).

const { logError } = require('../logger');

const MANAGER_ROLE_NAME = 'SvS Manager';

// Return every non-bot member holding the SvS Manager role. Falls back to a full
// guild member fetch when the role's member cache is empty (large guilds don't
// cache every member up front). Returns [] if the role doesn't exist.
async function findManagerMembers(guild) {
  const role = guild.roles.cache.find(r => r.name === MANAGER_ROLE_NAME);
  if (!role) return [];
  let members = role.members;
  if (!members || members.size === 0) {
    try {
      await guild.members.fetch();
    } catch (error) {
      logError('findManagerMembers: failed fetching guild members', error);
    }
    members = role.members;
  }
  return members ? [...members.values()].filter(m => !m.user.bot) : [];
}

module.exports = { findManagerMembers, MANAGER_ROLE_NAME };
