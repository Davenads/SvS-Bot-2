// interactions/matchPanel.js
//
// Handles the action buttons on a challenge coordination thread's pinned embed
// (services/challengeThreads.js). The shared #issue-a-challenge channel is NOT
// ladder-resolvable via getLadderFromChannel, so every button carries the
// ladder key + the two duelers' identities (discordId + element) in its
// customId — routing never depends on a channel lookup.
//
// customId scheme (router: svs:{panel}:{action}:{ladderKey}[:extra...]):
//   Report Win (self-serve, participants or managers):
//     svs:match:report:{lk}:{aId}:{aElem}:{bId}:{bElem}      button
//     svs:match:reportpick:{lk}:{aId}:{aElem}:{bId}:{bElem}  who-won select
//     svs:match:reportgo:{lk}:{wId}:{wElem}:{lId}:{lElem}    confirm button
//     svs:match:reportx                                       cancel button
//   Manager-approved requests (a participant requests; a manager actions):
//     svs:match:dodge|extend|cancel:{lk}:{aId}:{aElem}:{bId}:{bElem}  request
//     svs:match:{type}ok|{type}no:{lk}:{reqId}:{reqElem}             decision
//   where {type} is dg (dodge) / ex (extend) / cn (cancel). Only the requester's
//   identity rides in the decision id — the handler re-reads the sheet and finds
//   the opponent via the Opp# column (source of truth).

require('dotenv').config();

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { google } = require('googleapis');
const { DateTime } = require('luxon');
const { logError } = require('../logger');
const { getGoogleAuth } = require('../fixGoogleAuth');
const {
  LADDERS,
  VACATION_APPROVAL_CHANNEL_ID,
  DASHBOARD_PANELS,
} = require('../config/ladders');
const { resolveMatch } = require('../services/matchResult');
const { archiveChallengeThread, persistChallengeThread } = require('../services/challengeThreads');
const { findManagerRole, MANAGER_ROLE_NAME } = require('../utils/managers');
const redisClient = require('../redis-client');
const { refreshDashboard } = require('../dashboards/refresh');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };

// Reply to the clicker privately regardless of prior ack state.
async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

function isManager(interaction) {
  return interaction.member?.roles?.cache?.some(r => r.name === MANAGER_ROLE_NAME);
}

// The two duelers encoded on a thread button: extra = [aId, aElem, bId, bElem].
function parsePair(ctx) {
  const [aId, aElem, bId, bElem] = ctx.extra;
  return {
    ladder: LADDERS[ctx.ladderKey],
    a: { discordId: aId, element: aElem },
    b: { discordId: bId, element: bElem },
  };
}

// True when the clicker is one of the two encoded duelers.
function clickerIsParticipant(interaction, a, b) {
  const id = interaction.user.id;
  return id === a.discordId || id === b.discordId;
}

// Read the ladder and locate a single character by discordId + element, then its
// active-challenge opponent via the Opp# column. Returns { rows, row, oppRow } or
// { rows, row, reason } when the challenge can't be resolved.
async function findChallengePair(ladder, discordId, element) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`,
  });
  const rows = res.data.values || [];
  const row = rows.find(r => r[8] === discordId && r[3] === element);
  if (!row) return { rows, reason: 'character-not-found' };
  if (String(row[5] || '').toLowerCase() !== 'challenge') {
    return { rows, row, reason: 'not-in-challenge' };
  }
  const oppRank = parseInt(row[7]);
  if (!oppRank) return { rows, row, reason: 'no-opponent' };
  const oppRow = rows.find(r => parseInt(r[0]) === oppRank);
  if (!oppRow) return { rows, row, reason: 'opponent-not-found' };
  return { rows, row, oppRow };
}

// The clicker's own element within the encoded pair (which of their characters
// this thread's challenge involves).
function clickerElement(interaction, a, b) {
  return interaction.user.id === a.discordId ? a.element : b.element;
}

// ---- Report Win (self-serve) ---------------------------------------------

// Step 1: clicked "Report Win" — offer a two-option "who won?" select.
async function handleReport(interaction, ctx) {
  const { ladder, a, b } = parsePair(ctx);
  if (!ladder) return ephemeral(interaction, 'Unknown ladder.');
  if (!clickerIsParticipant(interaction, a, b) && !isManager(interaction)) {
    return ephemeral(interaction, 'Only a participant or an SvS Manager can report this result.');
  }

  await interaction.deferReply({ ephemeral: true });
  const { row: aRow, oppRow, reason } = await findChallengePair(ladder, a.discordId, a.element);
  if (reason || !oppRow) {
    return interaction.editReply({ content: 'This challenge is no longer active — nothing to report.' });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`svs:match:reportpick:${ladder.key}:${a.discordId}:${a.element}:${b.discordId}:${b.element}`)
    .setPlaceholder('Who won the match?')
    .addOptions(
      { label: `${aRow[1]} (#${aRow[0]})`.slice(0, 100), value: 'a', emoji: elementEmojiMap[a.element] },
      { label: `${oppRow[1]} (#${oppRow[0]})`.slice(0, 100), value: 'b', emoji: elementEmojiMap[b.element] }
    );
  return interaction.editReply({
    content: 'Select the winner. The result posts once you confirm.',
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

// Step 2: winner picked — show a confirm/cancel step.
async function handleReportPick(interaction, ctx) {
  await interaction.deferUpdate();
  const { ladder, a, b } = parsePair(ctx);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const winner = interaction.values[0] === 'a' ? a : b;
  const loser = interaction.values[0] === 'a' ? b : a;

  const { row, oppRow, reason } = await findChallengePair(ladder, winner.discordId, winner.element);
  if (reason || !oppRow) {
    return interaction.editReply({ content: 'This challenge is no longer active — nothing to report.', components: [] });
  }

  const confirm = new ButtonBuilder()
    .setCustomId(`svs:match:reportgo:${ladder.key}:${winner.discordId}:${winner.element}:${loser.discordId}:${loser.element}`)
    .setLabel('Confirm Result')
    .setStyle(ButtonStyle.Success);
  const cancel = new ButtonBuilder()
    .setCustomId('svs:match:reportx')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  return interaction.editReply({
    content: `Confirm: **${row[1]}** (#${row[0]}) defeated **${oppRow[1]}** (#${oppRow[0]})?`,
    components: [new ActionRowBuilder().addComponents(confirm, cancel)],
  });
}

// Step 3: confirmed — resolve the match via the shared service (identical path to
// /reportwin: rank swap, Redis clear + cooldown, thread archive, announcement,
// board refresh).
async function handleReportGo(interaction, ctx) {
  await interaction.deferUpdate();
  const ladder = LADDERS[ctx.ladderKey];
  const [wId, wElem, lId, lElem] = ctx.extra;
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const { rows, row: winnerRow, oppRow, reason } = await findChallengePair(ladder, wId, wElem);
  if (reason || !oppRow) {
    return interaction.editReply({ content: 'This challenge is no longer active — nothing to report.', components: [] });
  }
  // The opponent found via Opp# must be the loser the button encoded.
  if (!(oppRow[8] === lId && oppRow[3] === lElem)) {
    return interaction.editReply({
      content: 'The challenge changed since you opened this — please reopen and try again.',
      components: [],
    });
  }

  let announceChannel = null;
  if (ladder.challengeChannelId) {
    announceChannel = await interaction.client.channels.fetch(ladder.challengeChannelId).catch(() => null);
  }

  try {
    const { isDefense } = await resolveMatch(interaction.client, ladder, {
      rows,
      winnerRow,
      loserRow: oppRow,
      announceChannel,
    });
    return interaction.editReply({
      content: `✅ Result recorded — **${winnerRow[1]}** defeated **${oppRow[1]}**. ${
        isDefense ? 'Defender held their position.' : 'Ranks were swapped.'
      } This thread will be archived.`,
      components: [],
    });
  } catch (error) {
    logError('Match panel: report resolve failed', error);
    return interaction.editReply({
      content: 'An error occurred recording the result. Please try again or use /reportwin.',
      components: [],
    });
  }
}

// ---- Manager-approved requests (dodge / extend / cancel) ------------------

const REQUEST_META = {
  dodge: { title: '🏃 Dodge Request', color: 0xff0000, ok: 'dgok', no: 'dgno', verb: 'record a dodge against their opponent' },
  extend: { title: '⏳ Extension Request', color: 0x808080, ok: 'exok', no: 'exno', verb: 'extend this challenge by 2 days' },
  cancel: { title: '⚔️ Cancel Request', color: 0xff0000, ok: 'cnok', no: 'cnno', verb: 'cancel this match (no rank change)' },
};

// A participant clicked one of the request buttons — post a single Approve/Deny
// message to the mod approval channel (pings the SvS Manager role) and confirm
// privately. Only the requester's identity rides in the decision id.
async function handleRequest(interaction, ctx, type) {
  const meta = REQUEST_META[type];
  const { ladder, a, b } = parsePair(ctx);
  if (!ladder || !meta) return ephemeral(interaction, 'Unknown request.');
  if (!clickerIsParticipant(interaction, a, b)) {
    return ephemeral(interaction, 'Only a participant in this challenge can make that request.');
  }
  await interaction.deferReply({ ephemeral: true });

  const reqId = interaction.user.id;
  const reqElem = clickerElement(interaction, a, b);

  const { row, oppRow, reason } = await findChallengePair(ladder, reqId, reqElem);
  if (reason || !oppRow) {
    return interaction.editReply({ content: 'This challenge is no longer active — nothing to request.' });
  }

  const channel = await interaction.client.channels.fetch(VACATION_APPROVAL_CHANNEL_ID).catch(() => null);
  if (!channel || typeof channel.send !== 'function') {
    logError('Match panel: approval channel unavailable', new Error(`channel ${VACATION_APPROVAL_CHANNEL_ID} unavailable`));
    return interaction.editReply({ content: '⚠️ Could not reach the SvS Managers right now. Please ping a manager directly.' });
  }

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(`<@${reqId}> is requesting to ${meta.verb}.`)
    .addFields(
      { name: 'Requester', value: `**${row[1]}** (Rank #${row[0]}, ${ladder.displayName})`, inline: true },
      { name: 'Opponent', value: `**${oppRow[1]}** (Rank #${oppRow[0]})`, inline: true },
      { name: 'Status', value: 'Pending manager approval' }
    )
    .setTimestamp();
  if (type === 'dodge') {
    embed.addFields({ name: 'Dodge target', value: `**${oppRow[1]}** (#${oppRow[0]}) — the opponent who didn't show.` });
  }

  const managerRole = findManagerRole(interaction.guild);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`svs:match:${meta.ok}:${ladder.key}:${reqId}:${reqElem}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`svs:match:${meta.no}:${ladder.key}:${reqId}:${reqElem}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: managerRole ? `<@&${managerRole.id}>` : undefined,
    embeds: [embed],
    components: [row1],
    allowedMentions: { roles: managerRole ? [managerRole.id] : [] },
  });

  return interaction.editReply({
    content: `Your **${type}** request was sent to the **SvS Managers** for approval. You'll be notified once it's reviewed.`,
  });
}

// Best-effort DM to the requester about the decision.
async function dmRequester(client, discordId, text) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(text);
  } catch {
    // DMs closed — the mod post is the record.
  }
}

// Edit the approval message into a resolved, button-less state.
async function finalizeApproval(interaction, color, resultLine) {
  const original = interaction.message?.embeds?.[0];
  const embed = original
    ? EmbedBuilder.from(original).setColor(color)
    : new EmbedBuilder().setColor(color).setTitle('Match Request');
  embed.addFields({ name: 'Resolution', value: resultLine });
  return interaction.editReply({ embeds: [embed], components: [] });
}

// Increment a player's dodge count (col K).
async function applyDodge(ladder, rows, dodgerRow) {
  const idx = rows.findIndex(r => r[8] === dodgerRow[8] && r[3] === dodgerRow[3]);
  if (idx === -1) return null;
  const current = parseInt(dodgerRow[10]);
  const next = (Number.isNaN(current) ? 0 : current) + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!K${idx + 2}`,
    valueInputOption: 'RAW',
    resource: { values: [[String(next)]] },
  });
  return next;
}

// Clear both rows' challenge columns (F:H), drop the Redis challenge, archive the
// thread, and refresh the boards. Mirrors /cancelchallenge.
async function applyCancel(client, ladder, rows, row, oppRow) {
  const idx = rows.findIndex(r => r[8] === row[8] && r[3] === row[3]) + 2;
  const oppIdx = rows.findIndex(r => r[8] === oppRow[8] && r[3] === oppRow[3]) + 2;
  for (const range of [`${ladder.sheetName}!F${idx}:H${idx}`, `${ladder.sheetName}!F${oppIdx}:H${oppIdx}`]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Available', '', '']] },
    });
  }
  const p1 = { discordId: row[8], element: row[3] };
  const p2 = { discordId: oppRow[8], element: oppRow[3] };
  try {
    await redisClient.removeChallenge(p1, p2, ladder);
  } catch (err) {
    logError('Match panel: cancel Redis removal failed', err);
  }
  archiveChallengeThread(client, ladder, p1, p2, '⚔️ This match was cancelled by a manager. Thread archived.');
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS);
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.CHALLENGES);
}

// Extend both rows' challenge date (col G) by 2 days and bump Redis. Mirrors
// /extendchallenge's date handling. Returns the formatted new date or null.
async function applyExtend(client, ladder, rows, row, oppRow) {
  const idx = rows.findIndex(r => r[8] === row[8] && r[3] === row[3]) + 2;
  const oppIdx = rows.findIndex(r => r[8] === oppRow[8] && r[3] === oppRow[3]) + 2;

  let dateString = row[6] || '';
  const timezoneRegex = /\s(EDT|EST)$/;
  let tz = '';
  if (timezoneRegex.test(dateString)) {
    tz = dateString.match(timezoneRegex)[1];
    dateString = dateString.replace(timezoneRegex, '');
  }
  const formats = ['M/d, h:mm a', 'M/d/yyyy, h:mm a'];
  let current = null;
  for (const f of formats) {
    current = DateTime.fromFormat(dateString, f, { zone: 'America/New_York' });
    if (current.isValid) break;
  }
  if (!current || !current.isValid) return null;

  const formatted = `${current.plus({ days: 2 }).toFormat('M/d, h:mm a')} ${tz}`.trim();
  for (const range of [`${ladder.sheetName}!G${idx}`, `${ladder.sheetName}!G${oppIdx}`]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[formatted]] },
    });
  }
  const p1 = { discordId: row[8], element: row[3] };
  const p2 = { discordId: oppRow[8], element: oppRow[3] };
  try {
    await redisClient.updateChallenge(p1, p2, formatted, ladder);
  } catch (err) {
    logError('Match panel: extend Redis update failed', err);
  }
  persistChallengeThread(client, ladder, p1, p2, `⏳ This challenge was extended. New date: ${formatted}.`);
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.CHALLENGES);
  return formatted;
}

// Approve/Deny handler for the three request types. Manager-gated; guarded
// against a double-approval with a short lock on the approval message id.
async function handleDecision(interaction, ctx, type, approve) {
  if (!isManager(interaction)) {
    return interaction.reply({ content: `Only **${MANAGER_ROLE_NAME}s** can act on this request.`, ephemeral: true });
  }
  const lockKey = `svs:match-decision:${interaction.message?.id}`;
  const gotLock = await redisClient.acquireLock(lockKey, 30);
  if (!gotLock) {
    return interaction.reply({ content: 'Another manager is already handling this request.', ephemeral: true });
  }

  await interaction.deferUpdate();
  try {
    const ladder = LADDERS[ctx.ladderKey];
    const reqId = ctx.extra[0];
    const reqElem = ctx.extra[1];
    if (!ladder || !reqId || !reqElem) {
      return finalizeApproval(interaction, 0x808080, 'Malformed request — no action taken.');
    }

    if (!approve) {
      await dmRequester(interaction.client, reqId, `Your **${type}** request on the **${ladder.displayName}** was declined by a manager.`);
      return finalizeApproval(interaction, 0xcc0000, `❌ Denied by <@${interaction.user.id}>.`);
    }

    const { rows, row, oppRow, reason } = await findChallengePair(ladder, reqId, reqElem);
    if (reason || !oppRow) {
      await dmRequester(interaction.client, reqId, `Your **${type}** request on the **${ladder.displayName}** could not be applied — the challenge is no longer active.`);
      return finalizeApproval(interaction, 0x808080, 'Challenge no longer active — no change made.');
    }

    if (type === 'dodge') {
      const count = await applyDodge(ladder, rows, oppRow);
      await dmRequester(interaction.client, reqId, `🏃 Your dodge request was approved — a dodge was recorded against **${oppRow[1]}**.`);
      return finalizeApproval(interaction, 0x2ecc71, `✅ Approved by <@${interaction.user.id}> — dodge recorded against **${oppRow[1]}** (total: ${count}).`);
    }
    if (type === 'cancel') {
      await applyCancel(interaction.client, ladder, rows, row, oppRow);
      await dmRequester(interaction.client, reqId, `⚔️ Your cancel request on the **${ladder.displayName}** was approved — the match was voided with no rank change.`);
      return finalizeApproval(interaction, 0x2ecc71, `✅ Approved by <@${interaction.user.id}> — match between **${row[1]}** and **${oppRow[1]}** cancelled.`);
    }
    if (type === 'extend') {
      const formatted = await applyExtend(interaction.client, ladder, rows, row, oppRow);
      if (!formatted) {
        return finalizeApproval(interaction, 0x808080, 'Could not parse the challenge date — extend manually with /extendchallenge.');
      }
      await dmRequester(interaction.client, reqId, `⏳ Your extension request was approved — the challenge is now due ${formatted}.`);
      return finalizeApproval(interaction, 0x2ecc71, `✅ Approved by <@${interaction.user.id}> — extended to ${formatted}.`);
    }
    return finalizeApproval(interaction, 0x808080, 'Unknown request type — no action taken.');
  } catch (error) {
    logError('Match panel: decision failed', error);
    return interaction.followUp({ content: 'An error occurred applying that decision. Please try again.', ephemeral: true });
  } finally {
    await redisClient.releaseLock(lockKey).catch(() => {});
  }
}

async function handle(interaction, ctx) {
  switch (ctx.action) {
    case 'report':
      return handleReport(interaction, ctx);
    case 'reportpick':
      return handleReportPick(interaction, ctx);
    case 'reportgo':
      return handleReportGo(interaction, ctx);
    case 'reportx':
      await interaction.deferUpdate();
      return interaction.editReply({ content: 'Cancelled — no result reported.', components: [] });
    case 'dodge':
      return handleRequest(interaction, ctx, 'dodge');
    case 'extend':
      return handleRequest(interaction, ctx, 'extend');
    case 'cancel':
      return handleRequest(interaction, ctx, 'cancel');
    case 'dgok':
      return handleDecision(interaction, ctx, 'dodge', true);
    case 'dgno':
      return handleDecision(interaction, ctx, 'dodge', false);
    case 'exok':
      return handleDecision(interaction, ctx, 'extend', true);
    case 'exno':
      return handleDecision(interaction, ctx, 'extend', false);
    case 'cnok':
      return handleDecision(interaction, ctx, 'cancel', true);
    case 'cnno':
      return handleDecision(interaction, ctx, 'cancel', false);
    default: {
      logError('Match panel: unknown action', new Error(interaction.customId));
      return ephemeral(interaction, 'Unsupported action.');
    }
  }
}

module.exports = { handle };
