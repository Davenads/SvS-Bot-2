// Ladder resolution helpers. Commands use these to turn a slash-command option
// (or the channel a command was run in) into a concrete ladder config object
// from config/ladders.js.
//
// Routing rules (plan §4.3):
//   - Challenge commands (/challenge, /reportwin, /cancelchallenge,
//     /extendchallenge, /nullchallenges, /currentchallenges) infer the ladder
//     from the channel they were run in — use getLadderFromChannel().
//   - Everything else takes an optional `ladder` option defaulting to main —
//     use getLadderFromOption().

const { LADDERS, DEFAULT_LADDER_KEY } = require('../config/ladders');

// Look up a ladder config by key. Falls back to the default ladder for null /
// unknown keys so callers can pass a raw option value safely.
function getLadderByKey(key) {
  if (key && Object.prototype.hasOwnProperty.call(LADDERS, key)) {
    return LADDERS[key];
  }
  return LADDERS[DEFAULT_LADDER_KEY];
}

// Read the optional `ladder` slash-command option (default = main).
// Used by leaderboard, stats, titledefends, seasonhistory, and manager ops.
function getLadderFromOption(interaction) {
  const key = interaction.options.getString('ladder') || DEFAULT_LADDER_KEY;
  return getLadderByKey(key);
}

// Infer the ladder from the channel the command was run in. Returns null if the
// channel is not a configured challenge channel, so callers can reject with the
// appropriate "wrong channel" message.
function getLadderFromChannel(channelId) {
  return (
    Object.values(LADDERS).find(l => l.challengeChannelId === channelId) || null
  );
}

// Resolve a ladder config from a Redis key prefix ('main' | 'lld'). Falls back
// to the default ladder for an unknown / missing prefix so legacy keys resolve
// to main. Used by the expiry handler/checker.
function getLadderByRedisPrefix(prefix) {
  return (
    Object.values(LADDERS).find(l => l.redisPrefix === prefix) ||
    LADDERS[DEFAULT_LADDER_KEY]
  );
}

// Parse an expired/active challenge Redis key into its ladder + player parts.
// Handles both formats:
//   new:    challenge:{ladder}:{id1}-{el1}:{id2}-{el2}   (3 colon segments)
//   legacy: challenge:{id1}-{el1}:{id2}-{el2}            (2 colon segments)
// The legacy form (pre key-namespacing) is tolerated so in-flight challenges
// created before the migration still auto-null correctly during the drain.
function parseChallengeKey(challengeKey) {
  const body = challengeKey.replace(/^challenge:/, '');
  const parts = body.split(':');

  let prefix;
  let p1;
  let p2;
  if (parts.length >= 3) {
    [prefix, p1, p2] = parts;
  } else {
    [p1, p2] = parts;
    prefix = LADDERS[DEFAULT_LADDER_KEY].redisPrefix;
  }

  const [discordId1, element1] = (p1 || '').split('-');
  const [discordId2, element2] = (p2 || '').split('-');

  return {
    ladder: getLadderByRedisPrefix(prefix),
    discordId1,
    element1,
    discordId2,
    element2,
  };
}

// Convenience: comma-free human list of the configured challenge channels, for
// error messages.
function challengeChannelMention(ladder) {
  return `<#${ladder.challengeChannelId}>`;
}

module.exports = {
  getLadderByKey,
  getLadderFromOption,
  getLadderFromChannel,
  getLadderByRedisPrefix,
  parseChallengeKey,
  challengeChannelMention,
};
