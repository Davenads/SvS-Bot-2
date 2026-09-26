// interactions/router.js
//
// Central dispatcher for the dashboard component interactions (buttons, select
// menus, modal submits). Everything the dashboards own uses a namespaced
// customId:
//
//     svs:{panel}:{action}:{ladderKey}[:{extra...}]
//
// The ladder key always rides in the customId, so routing never depends on a
// channel lookup (this is what makes shared channels safe). See
// CHANNEL_DASHBOARDS_PLAN.md §4.4.
//
// IMPORTANT: only `svs:`-namespaced components are handled here. Any other
// component id belongs to a per-message collector (e.g. the /leaderboard
// pagination or the ephemeral "view full ladder" view) and is deliberately
// ignored so we never double-acknowledge those interactions.

const { logError } = require('../logger');

const NAMESPACE = 'svs';

// Panel handlers register here. Each module exports async handle(interaction, ctx).
const handlers = {
  rankings: require('./rankingsPanel'),
  // register / challenges panels are added in later commits.
};

function parseCustomId(customId) {
  if (typeof customId !== 'string') return null;
  const parts = customId.split(':');
  if (parts[0] !== NAMESPACE || parts.length < 3) return null;
  const [, panel, action, ladderKey, ...extra] = parts;
  return { panel, action, ladderKey: ladderKey || null, extra };
}

// Route a component interaction. Returns true if it was one of ours (handled or
// attempted), false if it should be left to a per-message collector.
async function routeComponent(interaction) {
  const ctx = parseCustomId(interaction.customId);
  if (!ctx) return false;

  const handler = handlers[ctx.panel];
  if (!handler || typeof handler.handle !== 'function') {
    logError('Interaction router: no handler for panel', new Error(interaction.customId));
    return true;
  }

  try {
    await handler.handle(interaction, ctx);
  } catch (error) {
    logError(`Interaction handler failed (${interaction.customId})`, error);
    try {
      const msg = { content: 'Something went wrong handling that action.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    } catch (_) {
      // Interaction may have expired; nothing more we can do.
    }
  }
  return true;
}

module.exports = { routeComponent, parseCustomId };
