// interactions/challengesPanel.js
//
// Handles the Active Challenges board's write flow (the "⚔️ Issue a Challenge"
// button) via the global router. All customIds are svs:-namespaced so the flow
// is stateless across restarts — no per-message collector, no timeout:
//
//     svs:challenges:new:{ladderKey}                     button  -> pick char / targets
//     svs:challenges:pickChallenger:{ladderKey}          select  -> pick targets
//     svs:challenges:pickTarget:{ladderKey}:{challRank}   select  -> execute challenge
//
// Every response is ephemeral to the clicker, so one member's wizard never
// touches the shared board or another member's view. The actual write (jump
// rules, cooldown, sheet + Redis, announcement, board refresh) is delegated to
// services/challengeService.executeChallenge so this matches /challenge exactly.

require('dotenv').config();
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { LADDERS } = require('../config/ladders');
const { logError } = require('../logger');
const {
  fetchLadderRows,
  getEligibleTargets,
  executeChallenge,
} = require('../services/challengeService');

// Discord caps a select menu at 25 options; eligible targets are bounded by the
// jump rules (a handful), and a member rarely has more than a few characters.
const MAX_OPTIONS = 25;

// The clicker's own characters on this ladder (column I / index 8 = Discord id).
function ownCharacters(rows, userId) {
  return rows.filter(row => row[8] === userId && row[0] && row[1]);
}

function challengerSelectRow(ladder, chars) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`svs:challenges:pickChallenger:${ladder.key}`)
    .setPlaceholder('Which of your characters is challenging?')
    .addOptions(
      chars.slice(0, MAX_OPTIONS).map(row => ({
        label: `#${row[0]} — ${row[1]}`.slice(0, 100),
        description: `${row[2] || ''} ${row[3] || ''}`.trim().slice(0, 100) || undefined,
        value: String(row[0]),
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

function targetSelectRow(ladder, challengerRank, targets) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`svs:challenges:pickTarget:${ladder.key}:${challengerRank}`)
    .setPlaceholder('Select the opponent you want to challenge')
    .addOptions(
      targets.slice(0, MAX_OPTIONS).map(row => ({
        label: `#${row[0]} — ${row[1]}`.slice(0, 100),
        description: `${row[2] || ''} ${row[3] || ''}`.trim().slice(0, 100) || undefined,
        value: String(row[0]),
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Render the eligible-opponent picker for a chosen challenger rank into the
// (already deferred) ephemeral reply.
async function presentTargets(interaction, ladder, rows, challengerRank, userId) {
  const rank = parseInt(challengerRank);
  const targets = getEligibleTargets(ladder, rows, rank, userId).sort(
    (a, b) => parseInt(a[0]) - parseInt(b[0])
  );

  if (!targets.length) {
    return interaction.editReply({
      content: `No eligible opponents are in reach for rank #${rank} right now — they may already be in a challenge, on vacation, or outside your jump range.`,
      components: [],
    });
  }

  return interaction.editReply({
    content: `Rank #${rank} can challenge these players — pick your opponent:`,
    components: [targetSelectRow(ladder, rank, targets)],
  });
}

async function handle(interaction, ctx) {
  const ladder = LADDERS[ctx.ladderKey];
  if (!ladder) {
    return interaction.reply({ content: 'Unknown ladder.', ephemeral: true });
  }
  const userId = interaction.user.id;

  // Step 1 — button clicked: resolve the clicker's character(s) on this ladder.
  if (ctx.action === 'new') {
    await interaction.deferReply({ ephemeral: true });
    const rows = await fetchLadderRows(ladder);
    const chars = ownCharacters(rows, userId);

    if (!chars.length) {
      return interaction.editReply({
        content: `You have no registered characters on the ${ladder.displayName}. If that's wrong, ask an SvS Manager.`,
      });
    }
    if (chars.length === 1) {
      return presentTargets(interaction, ladder, rows, chars[0][0], userId);
    }
    return interaction.editReply({
      content: `You have multiple characters on the ${ladder.displayName}. Which one is issuing the challenge?`,
      components: [challengerSelectRow(ladder, chars)],
    });
  }

  // Step 2 — challenger character chosen (only when the member has >1).
  if (ctx.action === 'pickChallenger') {
    await interaction.deferUpdate();
    const rows = await fetchLadderRows(ladder);
    return presentTargets(interaction, ladder, rows, interaction.values[0], userId);
  }

  // Step 3 — opponent chosen: execute the challenge through the shared service.
  if (ctx.action === 'pickTarget') {
    await interaction.deferUpdate();
    const challengerRank = parseInt(ctx.extra[0]);
    const targetRank = parseInt(interaction.values[0]);
    const isManager = interaction.member.roles.cache.some(r => r.name === 'SvS Manager');

    const result = await executeChallenge(interaction.client, ladder, {
      challengerRank,
      targetRank,
      userId,
      isManager,
    });

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.message}`, components: [] });
    }
    return interaction.editReply({
      content: `⚔️ Challenge issued! Rank #${challengerRank} vs #${targetRank}. The announcement was posted in <#${ladder.challengeChannelId}>.`,
      components: [],
    });
  }

  // Unknown action — acknowledge so the client doesn't hang.
  logError('Challenges panel: unknown action', new Error(interaction.customId));
  if (!interaction.deferred && !interaction.replied) {
    return interaction.reply({ content: 'Unsupported action.', ephemeral: true });
  }
}

module.exports = { handle };
