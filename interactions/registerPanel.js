// interactions/registerPanel.js
//
// Handles the shared #register control panel's buttons via the global router.
// The panel lives in one channel and serves BOTH ladders, so the top-level
// button customIds carry no ladder segment (svs:register:{action}); the ladder
// is chosen inside each wizard (Sign Up) or inferred from the caller's own
// characters (Vacation / Leave). See CHANNEL_DASHBOARDS_PLAN.md §5.1 / §6.
//
// Implemented so far:
//   D2 — Request Vacation (a manager approves via a single Approve/Deny post) /
//        Return from Vacation (self-serve status flip, below)
//   D3 — Leave Ladder (self-serve removal via the shared removalService)
//   D4 — Extended-Vacation requests (DM every SvS Manager; bench/insert stay
//        manager-run — the buttons only notify, they never mutate the sheet)
//   E  — Sign Up (multi-step self-serve registration: ladder -> element ->
//        build -> name/notes modal, with one-per-element-per-ladder guard)

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { logError } = require('../logger');
const { LADDERS, VACATION_APPROVAL_CHANNEL_ID } = require('../config/ladders');
const {
  findUserCharacters,
  findUserVacationCharacters,
  setCharacterStatus,
} = require('../services/characterService');
const { removeCharacterByRank } = require('../services/removalService');
const { writeNewCharacter, getTakenElements } = require('../services/registrationService');
const { findManagerMembers, findManagerRole, MANAGER_ROLE_NAME } = require('../utils/managers');
const redisClient = require('../redis-client');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');

// A pending vacation request lives this long (7 days) before its Redis lock
// self-clears — long enough for managers to get to it, short enough that a
// stale request doesn't linger forever.
const VACATION_REQUEST_TTL = 7 * 24 * 60 * 60;

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const specEmojiMap = { Vita: '❤️', ES: '🔵' };
const DUELER_ROLE_NAME = 'SvS Dueler';
const ALL_ELEMENTS = ['Fire', 'Light', 'Cold'];
const MAX_OPTIONS = 25;

// Reply to the clicker privately. Works whether or not the interaction was
// already deferred/acknowledged.
async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

// True only if the clicker holds the SvS Dueler role. Buttons/selects/modals
// bypass the slash-command role gate in index.js, so the Sign Up flow re-checks
// the role itself at both entry and submit.
function hasDuelerRole(interaction) {
  const role = interaction.guild?.roles.cache.find(r => r.name === DUELER_ROLE_NAME);
  return role ? interaction.member.roles.cache.has(role.id) : false;
}

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
    // Return is self-serve; going ON vacation is now a manager-approved request.
    if (direction === 'from') {
      return applyStatus(interaction, c, 'Available', 'is back from vacation');
    }
    return requestVacation(interaction, c);
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

  // Return is self-serve; going ON vacation is now a manager-approved request.
  if (direction === 'from') {
    return applyStatus(interaction, char, 'Available', 'is back from vacation');
  }
  return requestVacation(interaction, char);
}

// --- Vacation request + manager approval -----------------------------------
// Going on vacation is no longer an instant self-serve flip: it records a
// pending Redis request and posts a SINGLE Approve/Deny message any SvS Manager
// can action (VACATION_APPROVAL_AND_THREAD_FIX_PLAN.md §B). Return from vacation
// stays self-serve (handled above via applyStatus).

// Best-effort DM to the requester about the outcome. Swallows closed-DM errors.
async function dmRequester(client, discordId, text) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(text);
  } catch {
    // Requester has DMs closed — nothing we can do; the mod post is the record.
  }
}

// Post the single Approve/Deny request to the mod approval channel. Returns true
// on success. Pings the SvS Manager role for visibility (server-side resolves
// membership, so no manager is missed). Never throws.
async function postVacationApproval(interaction, char) {
  try {
    const channel = await interaction.client.channels
      .fetch(VACATION_APPROVAL_CHANNEL_ID)
      .catch(() => null);
    if (!channel || typeof channel.send !== 'function') {
      logError(
        'Vacation approval: approval channel unavailable',
        new Error(`channel ${VACATION_APPROVAL_CHANNEL_ID} unavailable`)
      );
      return false;
    }

    const requester = interaction.user;
    const build = `${specEmojiMap[char.spec] || ''} ${char.spec || ''} ${
      elementEmojiMap[char.element] || ''
    } ${char.element || ''}`.trim();

    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle('🌴 Vacation Request')
      .setDescription(`<@${requester.id}> (${requester.tag}) is requesting vacation.`)
      .addFields(
        { name: 'Character', value: `**${char.name}** (Rank #${char.rank}, ${char.ladder.displayName})` },
        { name: 'Build', value: build || 'Unknown', inline: true },
        { name: 'Status', value: 'Pending manager approval', inline: true }
      )
      .setTimestamp();

    // Approve/Deny carry the ladder + requester id + element so the handler needs
    // no server-side state and re-reads the sheet as the source of truth.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`svs:register:vacapprove:${char.ladderKey}:${requester.id}:${char.element}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`svs:register:vacdeny:${char.ladderKey}:${requester.id}:${char.element}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger)
    );

    const managerRole = findManagerRole(interaction.guild);
    await channel.send({
      content: managerRole ? `<@&${managerRole.id}>` : undefined,
      embeds: [embed],
      components: [row],
      allowedMentions: { roles: managerRole ? [managerRole.id] : [] },
    });
    return true;
  } catch (error) {
    logError('Vacation approval: failed posting request', error);
    return false;
  }
}

// Record the pending request + post the Approve/Deny message. `interaction` is
// already deferred/updated by the caller so this only editReplies.
async function requestVacation(interaction, char) {
  const discordId = interaction.user.id;
  const created = await redisClient.createVacationRequest(
    discordId,
    char.element,
    char.ladder,
    VACATION_REQUEST_TTL
  );
  if (!created) {
    return interaction.editReply({
      content: `⚠️ You already have a pending vacation request for **${char.name}** (${char.ladder.displayName}). A manager will review it soon.`,
      components: [],
    });
  }

  const posted = await postVacationApproval(interaction, char);
  if (!posted) {
    // Roll the lock back so the player can retry once the channel is reachable.
    await redisClient.consumeVacationRequest(discordId, char.element, char.ladder);
    return interaction.editReply({
      content:
        '⚠️ Your request could not be delivered to the SvS Managers right now. Please ping a manager directly.',
      components: [],
    });
  }

  return interaction.editReply({
    content: `🌴 Your vacation request for **${char.name}** (Rank #${char.rank}, ${char.ladder.displayName}) was sent to the **SvS Managers** for approval. You'll be notified once it's reviewed.`,
    components: [],
  });
}

// Edit the mod approval message into a resolved state (buttons removed) so it
// can't be actioned twice and the outcome is visible in history.
async function finalizeApprovalMessage(interaction, color, resultLine) {
  const original = interaction.message?.embeds?.[0];
  const embed = original
    ? EmbedBuilder.from(original).setColor(color)
    : new EmbedBuilder().setColor(color).setTitle('🌴 Vacation Request');
  embed.addFields({ name: 'Resolution', value: resultLine });
  return interaction.editReply({ embeds: [embed], components: [] });
}

// Approve/Deny button handler (manager-gated). `approve` distinguishes the two.
async function handleVacationDecision(interaction, ctx, approve) {
  const isManager = interaction.member?.roles?.cache?.some(r => r.name === MANAGER_ROLE_NAME);
  if (!isManager) {
    return interaction.reply({
      content: `Only **${MANAGER_ROLE_NAME}s** can act on vacation requests.`,
      ephemeral: true,
    });
  }
  await interaction.deferUpdate();

  const ladderKey = ctx.ladderKey;
  const discordId = ctx.extra[0];
  const element = ctx.extra[1];
  const ladder = LADDERS[ladderKey];
  if (!ladder || !discordId || !element) {
    return finalizeApprovalMessage(interaction, 0x808080, 'Malformed request — no action taken.');
  }

  // First click consumes the pending key; a second manager sees "already handled".
  const existed = await redisClient.consumeVacationRequest(discordId, element, ladder);
  if (!existed) {
    return finalizeApprovalMessage(interaction, 0x808080, 'Already handled — no action taken.');
  }

  if (!approve) {
    await dmRequester(
      interaction.client,
      discordId,
      `Your vacation request on the **${ladder.displayName}** was declined by a manager.`
    );
    return finalizeApprovalMessage(interaction, 0xcc0000, `❌ Denied by <@${interaction.user.id}>.`);
  }

  // Approve — re-read the sheet (source of truth) and locate the character by
  // discordId + element (never by a stale rank).
  try {
    const chars = await findUserCharacters(discordId);
    const char = chars.find(c => c.ladderKey === ladderKey && c.element === element);
    if (!char) {
      await dmRequester(
        interaction.client,
        discordId,
        `Your vacation request on the **${ladder.displayName}** couldn't be applied — the character is no longer on the ladder.`
      );
      return finalizeApprovalMessage(
        interaction,
        0x808080,
        'Character no longer on the ladder — no change made.'
      );
    }

    await setCharacterStatus(char.ladder, char.rowNum, 'Vacation');
    refreshDashboard(interaction.client, ladderKey, DASHBOARD_PANELS.RANKINGS);
    await dmRequester(
      interaction.client,
      discordId,
      `🌴 Your vacation request for **${char.name}** (${char.ladder.displayName}) was approved. Your character is now on vacation.`
    );
    return finalizeApprovalMessage(
      interaction,
      0x2ecc71,
      `✅ Approved by <@${interaction.user.id}> — **${char.name}** is now on vacation.`
    );
  } catch (error) {
    logError('Vacation approval: approve failed', error);
    // Restore the pending key so the request can be retried; leave buttons intact.
    await redisClient.createVacationRequest(discordId, element, ladder, VACATION_REQUEST_TTL);
    return interaction.followUp({
      content: 'An error occurred applying the vacation. Please try again.',
      ephemeral: true,
    });
  }
}

// A one-off confirm/cancel row for a specific character. The confirm button
// carries `${ladderKey}:${rank}` so the destructive step needs no state.
function leaveConfirmRow(char) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`svs:register:leaveconfirm:${char.ladderKey}:${char.rank}`)
      .setLabel('Yes, remove me')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('svs:register:leavecancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

// Leave Ladder — self-serve for a member's OWN characters. Managers who need to
// remove an arbitrary rank still use /remove. Presents a confirmation before the
// irreversible removal (re-rank + Redis cleanup) runs.
async function handleLeave(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const chars = await findUserCharacters(interaction.user.id);
  if (!chars.length) {
    return interaction.editReply({
      content: 'You have no registered characters on either ladder.',
    });
  }

  if (chars.length === 1) {
    const c = chars[0];
    return interaction.editReply({
      content: `⚠️ Remove **${c.name}** (Rank #${c.rank}, ${c.ladder.displayName}) from the ladder? This is permanent and re-ranks everyone below.`,
      components: [leaveConfirmRow(c)],
    });
  }

  return interaction.editReply({
    content: 'Which character do you want to remove from the ladder?',
    components: [characterSelectRow('svs:register:leavepick', 'Select a character to remove', chars)],
  });
}

// A character was picked from the multi-character select — show the confirm step.
async function handleLeavePick(interaction) {
  await interaction.deferUpdate();
  const [ladderKey, rank] = String(interaction.values[0]).split(':');
  const chars = await findUserCharacters(interaction.user.id);
  const char = chars.find(
    c => c.ladderKey === ladderKey && String(c.rank) === String(rank)
  );

  if (!char) {
    return interaction.editReply({
      content: 'That character could no longer be found. Please try again.',
      components: [],
    });
  }

  return interaction.editReply({
    content: `⚠️ Remove **${char.name}** (Rank #${char.rank}, ${char.ladder.displayName}) from the ladder? This is permanent and re-ranks everyone below.`,
    components: [leaveConfirmRow(char)],
  });
}

// Final step — re-verify the caller still owns that rank, then remove via the
// shared removal service (identical to /remove: sheet mutation, re-rank, Redis
// cleanup, board refreshes).
async function handleLeaveConfirm(interaction, ctx) {
  await interaction.deferUpdate();
  const ladderKey = ctx.ladderKey;
  const rank = parseInt(ctx.extra[0]);
  const ladder = LADDERS[ladderKey];

  if (!ladder || Number.isNaN(rank)) {
    return interaction.editReply({ content: 'Unknown ladder or rank.', components: [] });
  }

  // Re-verify ownership so the button can't remove someone else's rank if the
  // ladder shifted between render and click.
  const chars = await findUserCharacters(interaction.user.id);
  const char = chars.find(
    c => c.ladderKey === ladderKey && String(c.rank) === String(rank)
  );
  if (!char) {
    return interaction.editReply({
      content: 'That character is no longer at that rank (the ladder may have shifted). Please try again.',
      components: [],
    });
  }

  try {
    const result = await removeCharacterByRank(interaction.client, ladder, rank);
    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.reason}`, components: [] });
    }
    return interaction.editReply({
      content: `👋 **${result.player.name}** has left the ${ladder.displayName}. All affected rankings and challenges were updated.`,
      components: [],
    });
  } catch (error) {
    logError('Register panel: leave confirm failed', error);
    return interaction.editReply({
      content: 'An error occurred while removing your character. Please try again later.',
      components: [],
    });
  }
}

// DM every SvS Manager about an extended-vacation request. Returns delivery
// counts so the caller can tailor the confirmation. The buttons NEVER touch the
// sheet — a manager runs /bench or /insert after seeing the DM.
async function notifyManagers(interaction, requestType, char) {
  const isBench = requestType === 'extvac';
  const requester = interaction.user;
  const build = `${specEmojiMap[char.spec] || ''} ${char.spec || ''} ${
    elementEmojiMap[char.element] || ''
  } ${char.element || ''}`.trim();
  const command = isBench
    ? `/bench rank:${char.rank} ladder:${char.ladderKey}`
    : `/insert player_name:${char.name} ladder:${char.ladderKey}`;

  const embed = new EmbedBuilder()
    .setColor(isBench ? 0xffa500 : 0x4caf50)
    .setTitle(isBench ? '🏖️ Extended Vacation Request' : '🧳 Return from Extended Vacation')
    .setDescription(
      `<@${requester.id}> (${requester.tag}) has requested ${
        isBench ? 'extended vacation' : 'to return from extended vacation'
      }.`
    )
    .addFields(
      {
        name: 'Character',
        value: `**${char.name}** (Rank #${char.rank}, ${char.ladder.displayName})`,
      },
      { name: 'Build', value: build || 'Unknown', inline: true },
      { name: 'Action needed', value: `Run \`${command}\`` }
    )
    .setTimestamp();

  const managers = await findManagerMembers(interaction.guild);
  let delivered = 0;
  for (const m of managers) {
    try {
      await m.send({ embeds: [embed] });
      delivered++;
    } catch {
      // Manager has DMs closed — skip; the confirmation reflects the shortfall.
    }
  }
  return { delivered, total: managers.length };
}

// Deliver the request and reply to the caller with an outcome-aware message.
async function sendExtVacRequest(interaction, requestType, char) {
  const isBench = requestType === 'extvac';
  const label = isBench ? 'extended vacation' : 'return from extended vacation';
  const { delivered, total } = await notifyManagers(interaction, requestType, char);

  let content;
  if (total === 0) {
    content = `⚠️ Your ${label} request for **${char.name}** was recorded, but no **SvS Manager** could be found. Please ping a manager directly.`;
  } else if (delivered === 0) {
    content = `⚠️ Couldn't DM any of the ${total} **SvS Manager${
      total === 1 ? '' : 's'
    }** (their DMs may be closed). Please ping a manager directly about your ${label} request for **${char.name}**.`;
  } else {
    content = `${isBench ? '🏖️' : '🧳'} Your ${label} request for **${char.name}** (Rank #${char.rank}, ${char.ladder.displayName}) was sent to ${delivered} **SvS Manager${
      delivered === 1 ? '' : 's'
    }**. They'll process it shortly.`;
  }
  return interaction.editReply({ content, components: [] });
}

// Extended-vacation request entry point.
//   requestType 'extvac'   : bench an active ladder character  (uses /bench)
//   requestType 'unextvac' : return a benched character        (uses /insert)
async function handleExtVac(interaction, requestType) {
  await interaction.deferReply({ ephemeral: true });
  const isBench = requestType === 'extvac';
  const chars = isBench
    ? await findUserCharacters(interaction.user.id)
    : await findUserVacationCharacters(interaction.user.id);

  if (!chars.length) {
    return interaction.editReply({
      content: isBench
        ? 'You have no active characters on the ladder to request extended vacation for.'
        : 'You have no characters currently in Extended Vacation.',
    });
  }

  if (chars.length === 1) {
    return sendExtVacRequest(interaction, requestType, chars[0]);
  }

  const customId = isBench ? 'svs:register:extvacpick' : 'svs:register:unextvacpick';
  const placeholder = isBench
    ? 'Which character needs extended vacation?'
    : 'Which character should return?';
  return interaction.editReply({
    content: 'You have multiple characters — pick one:',
    components: [characterSelectRow(customId, placeholder, chars)],
  });
}

// Follow-up after picking from the multi-character select.
async function handleExtVacPick(interaction, requestType) {
  await interaction.deferUpdate();
  const [ladderKey, rank] = String(interaction.values[0]).split(':');
  const isBench = requestType === 'extvac';
  const chars = isBench
    ? await findUserCharacters(interaction.user.id)
    : await findUserVacationCharacters(interaction.user.id);
  const char = chars.find(
    c => c.ladderKey === ladderKey && String(c.rank) === String(rank)
  );

  if (!char) {
    return interaction.editReply({
      content: 'That character could no longer be found. Please try again.',
      components: [],
    });
  }
  return sendExtVacRequest(interaction, requestType, char);
}

// --- Sign Up wizard --------------------------------------------------------
// Step order: ladder select -> element select -> build select -> name/notes
// modal -> write. Each step encodes its state in the next component's customId
// so nothing is held server-side. The "one character per element per ladder"
// rule is enforced both when listing elements and again at submit time.

function ladderSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('svs:register:signup_fmt')
      .setPlaceholder('Which ladder are you joining?')
      .addOptions(
        { label: 'HLD (Standard SvS)', value: 'main', emoji: '⚔️' },
        { label: 'LLD (Low Level Dueling)', value: 'lld', emoji: '🛡️' }
      )
  );
}

function elementSelectRow(ladderKey, available) {
  const opts = ALL_ELEMENTS.filter(e => available.includes(e)).map(e => ({
    label: e,
    value: e,
    emoji: elementEmojiMap[e],
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`svs:register:signup_elem:${ladderKey}`)
      .setPlaceholder('Choose your element')
      .addOptions(opts)
  );
}

function buildSelectRow(ladderKey, element) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`svs:register:signup_build:${ladderKey}:${element}`)
      .setPlaceholder('Choose your build')
      .addOptions(
        { label: 'Vita', value: 'Vita', emoji: '❤️' },
        { label: 'ES (Energy Shield)', value: 'ES', emoji: '🔵' }
      )
  );
}

function signupModal(ladderKey, element, spec) {
  const modal = new ModalBuilder()
    .setCustomId(`svs:register:signup_submit:${ladderKey}:${element}:${spec}`)
    .setTitle('Sign Up — Character Details');
  const name = new TextInputBuilder()
    .setCustomId('character_name')
    .setLabel('Character Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const notes = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(notes)
  );
  return modal;
}

async function handleSignup(interaction) {
  if (!hasDuelerRole(interaction)) {
    return ephemeral(
      interaction,
      'You need the **SvS Dueler** role to sign up. Ask a mod to assign it, then try again.'
    );
  }
  await interaction.deferReply({ ephemeral: true });
  return interaction.editReply({
    content: '📝 **Sign Up** — first, which ladder are you joining?',
    components: [ladderSelectRow()],
  });
}

async function handleSignupFmt(interaction) {
  await interaction.deferUpdate();
  const ladderKey = interaction.values[0];
  const ladder = LADDERS[ladderKey];
  if (!ladder) {
    return interaction.editReply({ content: 'Unknown ladder.', components: [] });
  }

  let taken = [];
  try {
    taken = await getTakenElements(ladder, interaction.user.id);
  } catch (error) {
    logError('Signup: getTakenElements failed', error);
    return interaction.editReply({
      content: 'Could not check your existing characters. Please try again later.',
      components: [],
    });
  }

  const available = ALL_ELEMENTS.filter(e => !taken.includes(e));
  if (!available.length) {
    return interaction.editReply({
      content: `You already have a character for every element on the **${ladder.displayName}** (one per element per ladder). Nothing to add here.`,
      components: [],
    });
  }

  return interaction.editReply({
    content: `Joining **${ladder.displayName}** — choose your element:`,
    components: [elementSelectRow(ladderKey, available)],
  });
}

async function handleSignupElem(interaction, ctx) {
  await interaction.deferUpdate();
  const ladderKey = ctx.ladderKey;
  const element = interaction.values[0];
  if (!LADDERS[ladderKey]) {
    return interaction.editReply({ content: 'Unknown ladder.', components: [] });
  }
  return interaction.editReply({
    content: `${elementEmojiMap[element] || ''} **${element}** selected — now choose your build:`,
    components: [buildSelectRow(ladderKey, element)],
  });
}

async function handleSignupBuild(interaction, ctx) {
  // showModal must be the FIRST response to this interaction — do NOT defer.
  const ladderKey = ctx.ladderKey;
  const element = ctx.extra[0];
  const spec = interaction.values[0];
  if (!LADDERS[ladderKey] || !element || !spec) {
    return interaction.reply({
      content: 'Something went wrong — please restart Sign Up.',
      ephemeral: true,
    });
  }
  return interaction.showModal(signupModal(ladderKey, element, spec));
}

async function handleSignupSubmit(interaction, ctx) {
  await interaction.deferReply({ ephemeral: true });
  if (!hasDuelerRole(interaction)) {
    return interaction.editReply({ content: 'You need the **SvS Dueler** role to sign up.' });
  }

  const ladderKey = ctx.ladderKey;
  const element = ctx.extra[0];
  const spec = ctx.extra[1];
  const ladder = LADDERS[ladderKey];
  if (!ladder || !element || !spec) {
    return interaction.editReply({ content: 'Something went wrong — please restart Sign Up.' });
  }

  const characterName = (interaction.fields.getTextInputValue('character_name') || '').trim();
  const notes = (interaction.fields.getTextInputValue('notes') || '').trim();
  if (!characterName) {
    return interaction.editReply({ content: 'Character name is required.' });
  }

  const lockKey = `svs:signup:lock:${ladderKey}:${interaction.user.id}:${element}`;
  const gotLock = await redisClient.acquireLock(lockKey, 30);
  if (!gotLock) {
    return interaction.editReply({
      content: 'You already have a Sign Up in progress for that element — give it a moment.',
    });
  }

  try {
    // Re-validate one-per-element-per-ladder against the sheet (source of truth)
    // in case another character was added between element pick and submit.
    const taken = await getTakenElements(ladder, interaction.user.id);
    if (taken.includes(element)) {
      return interaction.editReply({
        content: `You already have a **${element}** character on the **${ladder.displayName}** — only one per element per ladder is allowed.`,
      });
    }

    const { rank } = await writeNewCharacter(interaction.client, ladder, {
      characterName,
      spec,
      element,
      discUser: interaction.user.username,
      discUserId: interaction.user.id,
      notes,
    });

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('✨ Welcome to the Ladder!')
      .addFields(
        { name: 'Character', value: `**${characterName}** (Rank #${rank})` },
        { name: 'Ladder', value: ladder.displayName, inline: true },
        {
          name: 'Build',
          value: `${specEmojiMap[spec] || ''} ${spec} ${elementEmojiMap[element] || ''} ${element}`.trim(),
          inline: true,
        },
        { name: 'Notes', value: notes || 'None' }
      )
      .setFooter({ text: 'Status: Available • Good luck out there!' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logError('Signup: writeNewCharacter failed', error);
    return interaction.editReply({
      content: 'An error occurred while registering your character. Please try again later.',
    });
  } finally {
    await redisClient.releaseLock(lockKey);
  }
}

async function handle(interaction, ctx) {
  switch (ctx.action) {
    case 'signup':
      return handleSignup(interaction);
    case 'signup_fmt':
      return handleSignupFmt(interaction);
    case 'signup_elem':
      return handleSignupElem(interaction, ctx);
    case 'signup_build':
      return handleSignupBuild(interaction, ctx);
    case 'signup_submit':
      return handleSignupSubmit(interaction, ctx);
    case 'vacation':
      return handleVacation(interaction, 'to');
    case 'unvacation':
      return handleVacation(interaction, 'from');
    case 'vacpick':
      return handleVacationPick(interaction, 'to');
    case 'unvacpick':
      return handleVacationPick(interaction, 'from');
    case 'vacapprove':
      return handleVacationDecision(interaction, ctx, true);
    case 'vacdeny':
      return handleVacationDecision(interaction, ctx, false);
    case 'leave':
      return handleLeave(interaction);
    case 'leavepick':
      return handleLeavePick(interaction);
    case 'leaveconfirm':
      return handleLeaveConfirm(interaction, ctx);
    case 'leavecancel':
      await interaction.deferUpdate();
      return interaction.editReply({ content: 'Cancelled — no changes made.', components: [] });
    case 'extvac':
      return handleExtVac(interaction, 'extvac');
    case 'unextvac':
      return handleExtVac(interaction, 'unextvac');
    case 'extvacpick':
      return handleExtVacPick(interaction, 'extvac');
    case 'unextvacpick':
      return handleExtVacPick(interaction, 'unextvac');
    default: {
      logError('Register panel: unknown action', new Error(interaction.customId));
      return ephemeral(interaction, 'Unsupported action.');
    }
  }
}

module.exports = { handle };
