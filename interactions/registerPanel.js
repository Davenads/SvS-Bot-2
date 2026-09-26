// interactions/registerPanel.js
//
// Handles the shared #register control panel's buttons via the global router.
// The panel lives in one channel and serves BOTH ladders, so the top-level
// button customIds carry no ladder segment (svs:register:{action}); the ladder
// is chosen inside each wizard (Sign Up) or inferred from the caller's own
// characters (Vacation / Leave). See CHANNEL_DASHBOARDS_PLAN.md §5.1 / §6.
//
// This commit (D1) ships the panel plumbing with friendly, self-explaining
// stubs. Subsequent commits fill in the real behavior:
//   D2 — Request / Return from Vacation (self-serve status flips)
//   D3 — Leave Ladder (shared removal service)
//   D4 — Extended-Vacation buttons (DM the SvS Managers)
//   Phase E — Sign Up (multi-step self-serve registration)

const { logError } = require('../logger');

// Reply to the clicker privately. Works whether or not the interaction was
// already deferred/acknowledged.
async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

// Friendly "not wired yet" messages keyed by action, so a member clicking a
// panel button during rollout gets guidance instead of an error.
const STUBS = {
  signup:
    '📝 **Sign Up** is coming soon. For now, ask an **SvS Manager** to run `/register` for you.',
  leave:
    '👋 **Leave Ladder** is coming soon. For now, ask an **SvS Manager** to run `/remove` for your character.',
  vacation:
    '🌴 **Request Vacation** is coming soon.',
  unvacation:
    '☀️ **Return from Vacation** is coming soon.',
  extvac:
    '🏖️ **Extended Vacation** requests are coming soon. For now, ask an **SvS Manager** to run `/bench`.',
  unextvac:
    '🧳 **Return from Extended Vacation** is coming soon. For now, ask an **SvS Manager** to run `/insert`.',
};

async function handle(interaction, ctx) {
  const message = STUBS[ctx.action];
  if (message) {
    return ephemeral(interaction, message);
  }

  logError('Register panel: unknown action', new Error(interaction.customId));
  return ephemeral(interaction, 'Unsupported action.');
}

module.exports = { handle };
