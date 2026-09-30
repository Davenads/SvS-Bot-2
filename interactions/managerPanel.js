// interactions/managerPanel.js
//
// Handles the shared SvS Manager control panel's buttons via the global router.
// The panel lives in one manager-only channel and serves BOTH ladders, so the
// top-level button customIds carry no ladder segment (svs:manager:{action}); the
// ladder + target are chosen inside each wizard. Every action re-checks the SvS
// Manager role on click (buttons bypass the slash-command role gate) and re-reads
// the sheet before writing, so a stale rank can never be acted on.
//
// Delegates to the SAME shared services the slash commands use, so each behavior
// has one code path:
//   Add Character   -> registrationService.writeNewCharacter  (mirrors /register)
//   Remove Character -> removalService.removeCharacterByRank   (mirrors /remove)
//   Set Vacation     -> characterService.setCharacterStatus (+ forfeit)
//   Record Dodge     -> column K increment                     (mirrors /dodge)
//   Refresh Boards   -> dashboards/refresh.hydrateAll
//
// See MANAGER_PANEL_PLAN.md. Additional actions (bench/insert/cancel/extend/
// nullify/season) land in later phases behind service extractions.

require('dotenv').config();
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { logError } = require('../logger');
const { LADDERS, DASHBOARD_PANELS } = require('../config/ladders');
const { MANAGER_ROLE_NAME } = require('../utils/managers');
const { removeCharacterByRank } = require('../services/removalService');
const { setCharacterStatus } = require('../services/characterService');
const { forfeitActiveChallenge } = require('../services/matchResult');
const { writeNewCharacter, getTakenElements } = require('../services/registrationService');
const redisClient = require('../redis-client');
const { refreshDashboard, hydrateAll } = require('../dashboards/refresh');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const specEmojiMap = { Vita: '❤️', ES: '🔵' };
const statusEmojiMap = { Available: '✅', Challenge: '⚔️', Vacation: '🌴' };
const ALL_ELEMENTS = ['Fire', 'Light', 'Cold'];
const MAX_OPTIONS = 25;

// --- Small shared helpers --------------------------------------------------

// Reply to the clicker privately. Works whether or not the interaction was
// already deferred/acknowledged.
async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

function isManager(interaction) {
  return Boolean(
    interaction.member?.roles?.cache?.some(r => r.name === MANAGER_ROLE_NAME)
  );
}

// Read a ladder's full roster (A2:K) into structured rows, skipping blanks.
// rowNum is the 1-based sheet row so callers can write straight back.
async function readRoster(ladder) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`,
  });
  const rows = res.data.values || [];
  const chars = [];
  rows.forEach((row, i) => {
    if (row[0] && row[1]) {
      chars.push({
        ladderKey: ladder.key,
        ladder,
        rank: row[0],
        name: row[1],
        spec: row[2] || '',
        element: row[3] || '',
        discUsername: row[4] || '',
        status: row[5] || 'Available',
        opponent: row[7] || '',
        discordId: row[8] || '',
        dodges: row[10] || '',
        rowNum: i + 2,
      });
    }
  });
  return chars;
}

// A HLD/LLD ladder select whose value is the ladder key. `action` is the wizard
// action prefix (e.g. 'remove' -> customId 'svs:manager:remove_fmt'); an optional
// `extra` segment (e.g. an owner id) rides after an empty ladder slot.
function ladderSelectRow(action, extra) {
  const customId = extra
    ? `svs:manager:${action}_fmt::${extra}`
    : `svs:manager:${action}_fmt`;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Which ladder?')
      .addOptions(
        { label: 'HLD (Standard SvS)', value: 'main', emoji: '⚔️' },
        { label: 'LLD (Low Level Dueling)', value: 'lld', emoji: '🛡️' }
      )
  );
}

// A roster picker whose option values encode `${ladderKey}:${rank}`.
function rosterSelectRow(customId, placeholder, chars) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      chars.slice(0, MAX_OPTIONS).map(c => ({
        label: `#${c.rank} - ${c.name}`.slice(0, 100),
        description: `${statusEmojiMap[c.status] || ''} ${c.status} • ${c.spec} ${c.element}`
          .trim()
          .slice(0, 100),
        value: `${c.ladderKey}:${c.rank}`,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

function confirmRow(goCustomId, cancelCustomId, goLabel, danger) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(goCustomId)
      .setLabel(goLabel)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cancelCustomId)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

function ladderOrNull(ladderKey) {
  return LADDERS[ladderKey] || null;
}

// --- Add Character (mirrors /register) -------------------------------------
// owner UserSelect -> ladder select -> element select -> build select ->
// name/notes modal -> writeNewCharacter. Each step encodes its state in the next
// component's customId so nothing is held server-side.

async function handleAddChar(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('svs:manager:addchar_user')
      .setPlaceholder('Who owns this character?')
      .setMinValues(1)
      .setMaxValues(1)
  );
  return interaction.editReply({
    content: '➕ **Add Character** — first, pick the member who will own it:',
    components: [row],
  });
}

async function handleAddCharUser(interaction) {
  await interaction.deferUpdate();
  const ownerId = interaction.values[0];
  if (!ownerId) {
    return interaction.editReply({ content: 'No member selected. Please try again.', components: [] });
  }
  return interaction.editReply({
    content: `Owner set to <@${ownerId}> — which ladder is this character on?`,
    components: [ladderSelectRow('addchar', ownerId)],
  });
}

async function handleAddCharFmt(interaction, ctx) {
  await interaction.deferUpdate();
  const ownerId = ctx.extra[0];
  const ladderKey = interaction.values[0];
  const ladder = ladderOrNull(ladderKey);
  if (!ladder || !ownerId) {
    return interaction.editReply({ content: 'Something went wrong — please restart Add Character.', components: [] });
  }

  let taken = [];
  try {
    taken = await getTakenElements(ladder, ownerId);
  } catch (error) {
    logError('Manager panel: getTakenElements failed', error);
    return interaction.editReply({ content: 'Could not check existing characters. Try again later.', components: [] });
  }

  const available = ALL_ELEMENTS.filter(e => !taken.includes(e));
  if (!available.length) {
    return interaction.editReply({
      content: `<@${ownerId}> already has a character for every element on the **${ladder.displayName}** (one per element per ladder).`,
      components: [],
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`svs:manager:addchar_elem:${ladderKey}:${ownerId}`)
      .setPlaceholder('Choose the element')
      .addOptions(available.map(e => ({ label: e, value: e, emoji: elementEmojiMap[e] })))
  );
  return interaction.editReply({
    content: `**${ladder.displayName}** — choose the element:`,
    components: [row],
  });
}

async function handleAddCharElem(interaction, ctx) {
  await interaction.deferUpdate();
  const ladderKey = ctx.ladderKey;
  const ownerId = ctx.extra[0];
  const element = interaction.values[0];
  if (!ladderOrNull(ladderKey) || !ownerId || !element) {
    return interaction.editReply({ content: 'Something went wrong — please restart Add Character.', components: [] });
  }
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`svs:manager:addchar_build:${ladderKey}:${ownerId}:${element}`)
      .setPlaceholder('Choose the build')
      .addOptions(
        { label: 'Vita', value: 'Vita', emoji: '❤️' },
        { label: 'ES (Energy Shield)', value: 'ES', emoji: '🔵' }
      )
  );
  return interaction.editReply({
    content: `${elementEmojiMap[element] || ''} **${element}** — now choose the build:`,
    components: [row],
  });
}

async function handleAddCharBuild(interaction, ctx) {
  // showModal must be the FIRST response to this interaction — do NOT defer.
  const ladderKey = ctx.ladderKey;
  const ownerId = ctx.extra[0];
  const element = ctx.extra[1];
  const spec = interaction.values[0];
  if (!ladderOrNull(ladderKey) || !ownerId || !element || !spec) {
    return interaction.reply({ content: 'Something went wrong — please restart Add Character.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`svs:manager:addchar_submit:${ladderKey}:${ownerId}:${element}:${spec}`)
    .setTitle('Add Character — Details');
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
  return interaction.showModal(modal);
}

async function handleAddCharSubmit(interaction, ctx) {
  await interaction.deferReply({ ephemeral: true });
  const ladderKey = ctx.ladderKey;
  const ownerId = ctx.extra[0];
  const element = ctx.extra[1];
  const spec = ctx.extra[2];
  const ladder = ladderOrNull(ladderKey);
  if (!ladder || !ownerId || !element || !spec) {
    return interaction.editReply({ content: 'Something went wrong — please restart Add Character.' });
  }

  const characterName = (interaction.fields.getTextInputValue('character_name') || '').trim();
  const notes = (interaction.fields.getTextInputValue('notes') || '').trim();
  if (!characterName) {
    return interaction.editReply({ content: 'Character name is required.' });
  }

  const lockKey = `svs:manager:addchar:lock:${ladderKey}:${ownerId}:${element}`;
  const gotLock = await redisClient.acquireLock(lockKey, 30);
  if (!gotLock) {
    return interaction.editReply({ content: 'That character is already being added — give it a moment.' });
  }

  try {
    // Re-validate one-per-element-per-ladder against the sheet (source of truth).
    const taken = await getTakenElements(ladder, ownerId);
    if (taken.includes(element)) {
      return interaction.editReply({
        content: `<@${ownerId}> already has a **${element}** character on the **${ladder.displayName}** — only one per element per ladder.`,
      });
    }

    // Resolve the owner's username for the sheet's Discord-username column.
    let discUser = ownerId;
    try {
      const ownerUser = await interaction.client.users.fetch(ownerId);
      discUser = ownerUser.username;
    } catch {
      // Fall back to the id string if the user can't be fetched.
    }

    const { rank } = await writeNewCharacter(interaction.client, ladder, {
      characterName,
      spec,
      element,
      discUser,
      discUserId: ownerId,
      notes,
    });

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('✨ Character Added')
      .addFields(
        { name: 'Character', value: `**${characterName}** (Rank #${rank})` },
        { name: 'Owner', value: `<@${ownerId}>`, inline: true },
        { name: 'Ladder', value: ladder.displayName, inline: true },
        {
          name: 'Build',
          value: `${specEmojiMap[spec] || ''} ${spec} ${elementEmojiMap[element] || ''} ${element}`.trim(),
          inline: true,
        },
        { name: 'Notes', value: notes || 'None' }
      )
      .setFooter({ text: 'Status: Available' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logError('Manager panel: writeNewCharacter failed', error);
    return interaction.editReply({ content: 'An error occurred while adding the character. Please try again later.' });
  } finally {
    await redisClient.releaseLock(lockKey);
  }
}

// --- Remove Character (mirrors /remove) ------------------------------------

async function handleRemove(interaction) {
  await interaction.deferReply({ ephemeral: true });
  return interaction.editReply({
    content: '🗑️ **Remove Character** — which ladder?',
    components: [ladderSelectRow('remove')],
  });
}

async function handleRemoveFmt(interaction) {
  await interaction.deferUpdate();
  const ladderKey = interaction.values[0];
  const ladder = ladderOrNull(ladderKey);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const chars = await readRoster(ladder);
  if (!chars.length) {
    return interaction.editReply({ content: `No characters on the ${ladder.displayName}.`, components: [] });
  }
  return interaction.editReply({
    content: `Select the character to **permanently remove** from the ${ladder.displayName}:`,
    components: [rosterSelectRow(`svs:manager:remove_pick:${ladderKey}`, 'Select a character to remove', chars)],
  });
}

async function handleRemovePick(interaction, ctx) {
  await interaction.deferUpdate();
  const [ladderKey, rank] = String(interaction.values[0]).split(':');
  const ladder = ladderOrNull(ladderKey);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const chars = await readRoster(ladder);
  const char = chars.find(c => String(c.rank) === String(rank));
  if (!char) {
    return interaction.editReply({ content: 'That character could no longer be found. Please try again.', components: [] });
  }
  return interaction.editReply({
    content: `⚠️ Remove **${char.name}** (Rank #${char.rank}, ${ladder.displayName})? This is permanent and re-ranks everyone below.`,
    components: [confirmRow(`svs:manager:remove_go:${ladderKey}:${rank}`, 'svs:manager:remove_cancel', 'Yes, remove', true)],
  });
}

async function handleRemoveGo(interaction, ctx) {
  await interaction.deferUpdate();
  const ladderKey = ctx.ladderKey;
  const rank = parseInt(ctx.extra[0]);
  const ladder = ladderOrNull(ladderKey);
  if (!ladder || Number.isNaN(rank)) {
    return interaction.editReply({ content: 'Unknown ladder or rank.', components: [] });
  }

  // Re-verify the rank still maps to a character before the irreversible remove.
  const chars = await readRoster(ladder);
  const char = chars.find(c => String(c.rank) === String(rank));
  if (!char) {
    return interaction.editReply({
      content: 'That rank no longer holds that character (the ladder may have shifted). Please try again.',
      components: [],
    });
  }

  try {
    const result = await removeCharacterByRank(interaction.client, ladder, rank);
    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.reason}`, components: [] });
    }
    return interaction.editReply({
      content: `👋 **${result.player.name}** was removed from the ${ladder.displayName}. All affected rankings and challenges were updated.`,
      components: [],
    });
  } catch (error) {
    logError('Manager panel: remove failed', error);
    return interaction.editReply({ content: 'An error occurred while removing the character. Please try again later.', components: [] });
  }
}

// --- Set Vacation (setCharacterStatus + optional forfeit) ------------------

async function handleSetVac(interaction) {
  await interaction.deferReply({ ephemeral: true });
  return interaction.editReply({
    content: '🌴 **Set Vacation** — which ladder?',
    components: [ladderSelectRow('setvac')],
  });
}

async function handleSetVacFmt(interaction) {
  await interaction.deferUpdate();
  const ladderKey = interaction.values[0];
  const ladder = ladderOrNull(ladderKey);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const chars = await readRoster(ladder);
  if (!chars.length) {
    return interaction.editReply({ content: `No characters on the ${ladder.displayName}.`, components: [] });
  }
  return interaction.editReply({
    content: `Select a character to toggle Vacation on the ${ladder.displayName}:`,
    components: [rosterSelectRow(`svs:manager:setvac_pick:${ladderKey}`, 'Select a character', chars)],
  });
}

async function handleSetVacPick(interaction, ctx) {
  await interaction.deferUpdate();
  const [ladderKey, rank] = String(interaction.values[0]).split(':');
  const ladder = ladderOrNull(ladderKey);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const chars = await readRoster(ladder);
  const char = chars.find(c => String(c.rank) === String(rank));
  if (!char) {
    return interaction.editReply({ content: 'That character could no longer be found. Please try again.', components: [] });
  }

  const target = char.status === 'Vacation' ? 'Available' : 'Vacation';
  let warn = '';
  if (target === 'Vacation' && char.status === 'Challenge') {
    warn = '\n\n⚠️ This character is in an active challenge — setting Vacation will **forfeit** it (the opponent is awarded the win).';
  }
  const verb = target === 'Vacation' ? 'Set 🌴 Vacation' : 'Return ☀️ to Available';
  return interaction.editReply({
    content: `**${char.name}** (Rank #${char.rank}, ${ladder.displayName}) is currently **${char.status}**.\n${verb}?${warn}`,
    components: [confirmRow(`svs:manager:setvac_go:${ladderKey}:${rank}:${target}`, 'svs:manager:setvac_cancel', verb, target === 'Vacation')],
  });
}

async function handleSetVacGo(interaction, ctx) {
  await interaction.deferUpdate();
  const ladderKey = ctx.ladderKey;
  const rank = ctx.extra[0];
  const target = ctx.extra[1];
  const ladder = ladderOrNull(ladderKey);
  if (!ladder || !rank || !target) {
    return interaction.editReply({ content: 'Something went wrong — please try again.', components: [] });
  }

  const chars = await readRoster(ladder);
  let char = chars.find(c => String(c.rank) === String(rank));
  if (!char) {
    return interaction.editReply({ content: 'That character is no longer at that rank. Please try again.', components: [] });
  }

  let forfeitNote = '';
  try {
    if (target === 'Vacation' && char.status === 'Challenge') {
      const f = await forfeitActiveChallenge(interaction.client, ladder, {
        discordId: char.discordId,
        element: char.element,
      });
      if (f && f.forfeited) {
        forfeitNote = ` Their active challenge was forfeited — **${f.winnerName}** was awarded the win.`;
        // A forfeit may swap ranks; re-locate the character by identity.
        const fresh = await readRoster(ladder);
        const relocated = fresh.find(c => c.discordId === char.discordId && c.element === char.element);
        if (relocated) char = relocated;
      }
    }

    await setCharacterStatus(ladder, char.rowNum, target);
    refreshDashboard(interaction.client, ladderKey, DASHBOARD_PANELS.RANKINGS);

    const icon = target === 'Vacation' ? '🌴' : '☀️';
    const state = target === 'Vacation' ? 'is now on vacation' : 'is back to Available';
    return interaction.editReply({
      content: `${icon} **${char.name}** (Rank #${char.rank}, ${ladder.displayName}) ${state}.${forfeitNote}`,
      components: [],
    });
  } catch (error) {
    logError('Manager panel: set vacation failed', error);
    return interaction.editReply({ content: 'An error occurred while updating the status. Please try again later.', components: [] });
  }
}

// --- Record Dodge (mirrors /dodge) -----------------------------------------

async function handleDodge(interaction) {
  await interaction.deferReply({ ephemeral: true });
  return interaction.editReply({
    content: '🏃 **Record Dodge** — which ladder?',
    components: [ladderSelectRow('dodge')],
  });
}

async function handleDodgeFmt(interaction) {
  await interaction.deferUpdate();
  const ladderKey = interaction.values[0];
  const ladder = ladderOrNull(ladderKey);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const chars = await readRoster(ladder);
  if (!chars.length) {
    return interaction.editReply({ content: `No characters on the ${ladder.displayName}.`, components: [] });
  }
  return interaction.editReply({
    content: `Select the player who dodged on the ${ladder.displayName} (dodge count +1):`,
    components: [rosterSelectRow(`svs:manager:dodge_pick:${ladderKey}`, 'Select a player', chars)],
  });
}

async function handleDodgePick(interaction, ctx) {
  await interaction.deferUpdate();
  const [ladderKey, rank] = String(interaction.values[0]).split(':');
  const ladder = ladderOrNull(ladderKey);
  if (!ladder) return interaction.editReply({ content: 'Unknown ladder.', components: [] });

  const chars = await readRoster(ladder);
  const char = chars.find(c => String(c.rank) === String(rank));
  if (!char) {
    return interaction.editReply({ content: 'That player could no longer be found. Please try again.', components: [] });
  }

  let count = 0;
  if (char.dodges && !Number.isNaN(Number(char.dodges))) count = parseInt(char.dodges);
  count += 1;

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!K${char.rowNum}`,
      valueInputOption: 'RAW',
      resource: { values: [[count.toString()]] },
    });
    return interaction.editReply({
      content: `🏃 Recorded a dodge for **${char.name}** (Rank #${char.rank}, ${ladder.displayName}). New dodge count: **${count}**.`,
      components: [],
    });
  } catch (error) {
    logError('Manager panel: dodge update failed', error);
    return interaction.editReply({ content: 'An error occurred while recording the dodge. Please try again later.', components: [] });
  }
}

// --- Refresh Boards --------------------------------------------------------

async function handleRefreshBoards(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    await hydrateAll(interaction.client);
    return interaction.editReply({ content: '🔄 All dashboards were reconciled.' });
  } catch (error) {
    logError('Manager panel: refresh boards failed', error);
    return interaction.editReply({ content: 'An error occurred while refreshing the boards.' });
  }
}

// --- Router entry ----------------------------------------------------------

async function handle(interaction, ctx) {
  // Single role gate for the whole panel. Runs before any defer so a non-manager
  // gets a clean ephemeral with no side effects. (showModal actions also rely on
  // this being the first response for non-managers.)
  if (!isManager(interaction)) {
    return interaction.reply({
      content: `Only **${MANAGER_ROLE_NAME}s** can use the manager panel.`,
      ephemeral: true,
    });
  }

  switch (ctx.action) {
    case 'addchar':
      return handleAddChar(interaction);
    case 'addchar_user':
      return handleAddCharUser(interaction);
    case 'addchar_fmt':
      return handleAddCharFmt(interaction, ctx);
    case 'addchar_elem':
      return handleAddCharElem(interaction, ctx);
    case 'addchar_build':
      return handleAddCharBuild(interaction, ctx);
    case 'addchar_submit':
      return handleAddCharSubmit(interaction, ctx);

    case 'remove':
      return handleRemove(interaction);
    case 'remove_fmt':
      return handleRemoveFmt(interaction);
    case 'remove_pick':
      return handleRemovePick(interaction, ctx);
    case 'remove_go':
      return handleRemoveGo(interaction, ctx);
    case 'remove_cancel':
      await interaction.deferUpdate();
      return interaction.editReply({ content: 'Cancelled — no changes made.', components: [] });

    case 'setvac':
      return handleSetVac(interaction);
    case 'setvac_fmt':
      return handleSetVacFmt(interaction);
    case 'setvac_pick':
      return handleSetVacPick(interaction, ctx);
    case 'setvac_go':
      return handleSetVacGo(interaction, ctx);
    case 'setvac_cancel':
      await interaction.deferUpdate();
      return interaction.editReply({ content: 'Cancelled — no changes made.', components: [] });

    case 'dodge':
      return handleDodge(interaction);
    case 'dodge_fmt':
      return handleDodgeFmt(interaction);
    case 'dodge_pick':
      return handleDodgePick(interaction, ctx);

    case 'refreshboards':
      return handleRefreshBoards(interaction);

    default: {
      logError('Manager panel: unknown action', new Error(interaction.customId));
      return ephemeral(interaction, 'Unsupported action.');
    }
  }
}

module.exports = { handle };
