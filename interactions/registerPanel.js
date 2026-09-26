// interactions/registerPanel.js
//
// Handles the shared #register control panel's buttons via the global router.
// The panel lives in one channel and serves BOTH ladders, so the top-level
// button customIds carry no ladder segment (svs:register:{action}); the ladder
// is chosen inside each wizard (Sign Up) or inferred from the caller's own
// characters (Vacation / Leave). See CHANNEL_DASHBOARDS_PLAN.md §5.1 / §6.
//
// Implemented so far:
//   D2 — Request / Return from Vacation (self-serve status flips, below)
// Still stubbed (friendly ephemerals until their commit lands):
//   D3 — Leave Ladder (shared removal service)
//   D4 — Extended-Vacation buttons (DM the SvS Managers)
//   Phase E — Sign Up (multi-step self-serve registration)

const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { logError } = require('../logger');
const { findUserCharacters, setCharacterStatus } = require('../services/characterService');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const MAX_OPTIONS = 25;

// Reply to the clicker privately. Works whether or not the interaction was
// already deferred/acknowledged.
async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

const STUBS = {
  signup:
    '📝 **Sign Up** is coming soon. For now, ask an **SvS Manager** to run `/register` for you.',
  leave:
    '👋 **Leave Ladder** is coming soon. For now, ask an **SvS Manager** to run `/remove` for your character.',
  extvac:
    '🏖️ **Extended Vacation** requests are coming soon. For now, ask an **SvS Manager** to run `/bench`.',
  unextvac:
    '🧳 **Return from Extended Vacation** is coming soon. For now, ask an **SvS Manager** to run `/insert`.',
};

// A character-picker select whose option values encode `${ladderKey}:${rank}`,
// so the follow-up handler can act without a channel/ladder lookup.
function characterSelectRow(customId, placeholder, chars) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      chars.slice(0, MAX_OPTIONS).map(c => ({
        label: `#${c.rank} — ${c.name}`.slice(0, 100),
        description: `${c.ladder.displayName} • ${c.spec || ''} ${c.element || ''}`.trim().slice(0, 100),
        value: `${c.ladderKey}:${c.rank}`,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Apply a vacation status flip to a single character and refresh its ladder's
// rankings board. `interaction` is already deferred.
async function applyStatus(interaction, char, targetStatus, verb) {
  await setCharacterStatus(char.ladder, char.rowNum, targetStatus);
  refreshDashboard(interaction.client, char.ladderKey, DASHBOARD_PANELS.RANKINGS);
  return interaction.editReply({
    content: `${targetStatus === 'Vacation' ? '🌴' : '☀️'} **${char.name}** (Rank #${char.rank}, ${char.ladder.displayName}) ${verb}.`,
    components: [],
  });
}

// Shared driver for both vacation directions.
//   direction 'to'   : Available -> Vacation
//   direction 'from' : Vacation  -> Available
async function handleVacation(interaction, direction) {
  await interaction.deferReply({ ephemeral: true });
  const chars = await findUserCharacters(interaction.user.id);
  if (!chars.length) {
    return interaction.editReply({
      content: 'You have no registered characters on either ladder.',
    });
  }

  const eligible =
    direction === 'to'
      ? chars.filter(c => c.status === 'Available')
      : chars.filter(c => c.status === 'Vacation');

  if (!eligible.length) {
    return interaction.editReply({
      content:
        direction === 'to'
          ? 'None of your characters are available to put on vacation — a character must be **Available** (not in a challenge or already on vacation).'
          : 'None of your characters are currently on vacation.',
    });
  }

  if (eligible.length === 1) {
    const c = eligible[0];
    return applyStatus(
      interaction,
      c,
      direction === 'to' ? 'Vacation' : 'Available',
      direction === 'to' ? 'is now on vacation' : 'is back from vacation'
    );
  }

  const customId = direction === 'to' ? 'svs:register:vacpick' : 'svs:register:unvacpick';
  const placeholder =
    direction === 'to' ? 'Which character goes on vacation?' : 'Which character returns from vacation?';
  return interaction.editReply({
    content: `You have multiple eligible characters — pick one:`,
    components: [characterSelectRow(customId, placeholder, eligible)],
  });
}

// Follow-up when the caller picked from the multi-character select. Re-reads the
// sheet and re-verifies eligibility so a stale rank/status can't be acted on.
async function handleVacationPick(interaction, direction) {
  await interaction.deferUpdate();
  const [ladderKey, rank] = String(interaction.values[0]).split(':');
  const chars = await findUserCharacters(interaction.user.id);
  const requiredStatus = direction === 'to' ? 'Available' : 'Vacation';
  const char = chars.find(
    c => c.ladderKey === ladderKey && String(c.rank) === String(rank) && c.status === requiredStatus
  );

  if (!char) {
    return interaction.editReply({
      content: 'That character is no longer eligible (its status changed). Please try again.',
      components: [],
    });
  }

  return applyStatus(
    interaction,
    char,
    direction === 'to' ? 'Vacation' : 'Available',
    direction === 'to' ? 'is now on vacation' : 'is back from vacation'
  );
}

async function handle(interaction, ctx) {
  switch (ctx.action) {
    case 'vacation':
      return handleVacation(interaction, 'to');
    case 'unvacation':
      return handleVacation(interaction, 'from');
    case 'vacpick':
      return handleVacationPick(interaction, 'to');
    case 'unvacpick':
      return handleVacationPick(interaction, 'from');
    default: {
      const message = STUBS[ctx.action];
      if (message) return ephemeral(interaction, message);
      logError('Register panel: unknown action', new Error(interaction.customId));
      return ephemeral(interaction, 'Unsupported action.');
    }
  }
}

module.exports = { handle };
