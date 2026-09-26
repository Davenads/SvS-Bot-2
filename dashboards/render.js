// dashboards/render.js
//
// Pure rendering for the persistent dashboard panels. Given a ladder config,
// each builder reads the live sheet and returns a discord.js message payload
// ({ embeds, components }) that the refresh engine either edits into the
// existing board message or posts fresh.
//
// The rankings panel mirrors the /leaderboard embed but is capped at the Top 10
// (the full ladder lives behind the sheet hyperlink; the per-viewer paginated
// ephemeral view is handled by interactions/rankingsPanel.js). See
// CHANNEL_DASHBOARDS_PLAN.md §5.2.

require('dotenv').config();
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { sheetTabUrl } = require('../config/ladders');
const { elementEmojiMap, statusEmojiMap } = require('../config/emoji');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const TOP_N = 10;

// Challenges expire 3 days after creation (matches the Redis TTL + expiry
// handler). The sheet stores the challenge date as a display string in this
// timezone, e.g. "9/26, 3:45 PM EDT". The true clock is the Redis TTL, but the
// board is sheet-only, so we reconstruct the countdown from that string rather
// than coupling the renderer to Redis.
const CHALLENGE_TZ = 'America/New_York';
const CHALLENGE_LIFETIME_DAYS = 3;

// Best-effort "expires in ~Xd Yh" from the stored challenge-date string.
// Returns null if the string can't be parsed (the board then just omits it).
function expiryCountdown(challengeDateStr) {
  if (!challengeDateStr) return null;
  // Drop the trailing timezone abbreviation ("EDT"/"EST"); moment parses the
  // zone from CHALLENGE_TZ instead (abbrev parsing is unreliable in moment).
  const cleaned = challengeDateStr.replace(/\s+[A-Za-z]{2,4}$/, '').trim();
  const created = moment.tz(cleaned, 'M/D, h:mm A', CHALLENGE_TZ);
  if (!created.isValid()) return null;

  // The stored string carries no year, so moment assumes the current one. If
  // that lands more than a day in the future, the challenge was actually made
  // last year (a Dec challenge read in Jan) — roll back one year.
  const now = moment.tz(CHALLENGE_TZ);
  if (created.isAfter(now.clone().add(1, 'day'))) created.subtract(1, 'year');

  const remainingMs = created.clone().add(CHALLENGE_LIFETIME_DAYS, 'days').diff(now);
  if (remainingMs <= 0) return 'expiring now';

  const dur = moment.duration(remainingMs);
  const days = Math.floor(dur.asDays());
  const hours = dur.hours();
  return days >= 1 ? `expires in ~${days}d ${hours}h` : `expires in ~${hours}h`;
}

// Persistent "View full ladder" button. The board is single-state (Top 10);
// this opens a per-viewer ephemeral paginated view (handled by the interaction
// router → interactions/rankingsPanel.js). The ladder key rides in the customId.
function rankingsComponents(ladder) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`svs:rankings:viewfull:${ladder.key}`)
        .setLabel('📋 View full ladder')
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function buildRankingsPayload(ladder) {
  const url = sheetTabUrl(ladder);
  const components = rankingsComponents(ladder);
  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle(`🏆 ${ladder.displayName} — Live Rankings 🏆`)
    .setURL(url)
    .setTimestamp()
    .setFooter({ text: 'Auto-updating • Top 10' });

  let validRows = [];
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!A2:H`,
    });
    validRows = (result.data.values || []).filter(row => row[0] && row[1]);
  } catch (error) {
    logError(`Dashboard render: failed reading ${ladder.sheetName}`, error);
    embed.setDescription('⚠️ Rankings are temporarily unavailable. Retrying shortly.');
    return { embeds: [embed], components };
  }

  if (!validRows.length) {
    embed.setDescription(
      `No players on the ${ladder.displayName} yet.\n\n**[Open the full ladder in Google Sheets](${url})**`
    );
    return { embeds: [embed], components };
  }

  const top = validRows.slice(0, TOP_N);
  embed.setDescription(
    `Top ${top.length} of ${validRows.length} — **[Open the full ladder in Google Sheets](${url})**`
  );
  top.forEach(row => {
    const rank = row[0] || 'N/A';
    const name = row[1] || 'Unknown';
    const element = row[3] || '';
    const status = row[5] || 'Available';
    embed.addFields({
      name: `#${rank} - ${name} ${elementEmojiMap[element] || ''}`,
      value: `Status: ${statusEmojiMap[status] || ''} ${status}`,
      inline: false,
    });
  });

  return { embeds: [embed], components };
}

// ---------------------------------------------------------------------------
// Persistent "Issue a Challenge" button. The ladder rides in the customId so
// the write flow (interactions/challengesPanel.js) never needs a channel lookup
// — critical because both boards share the #issue-a-challenge channel.
function challengesComponents(ladder) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`svs:challenges:new:${ladder.key}`)
        .setLabel('⚔️ Issue a Challenge')
        .setStyle(ButtonStyle.Success)
    ),
  ];
}

// Active Challenges board (one per ladder, both living in #issue-a-challenge).
//
// Reads the ladder sheet and lists every live Challenge pair. Mirrors the
// dedup logic of the /currentchallenges command: each pair shows once (a
// challenge writes BOTH players' rows to 'Challenge' with the opponent rank in
// column H, so the reverse pairing is skipped). The "Issue a Challenge" button
// is always attached so members can start a challenge straight from the board.
async function buildChallengesPayload(ladder) {
  const url = sheetTabUrl(ladder);
  const components = challengesComponents(ladder);
  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle(`⚔️ ${ladder.displayName} — Active Challenges ⚔️`)
    .setURL(url)
    .setTimestamp()
    .setFooter({ text: 'Auto-updating • Challenges expire after 3 days' });

  let rows = [];
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!A2:H`,
    });
    rows = result.data.values || [];
  } catch (error) {
    logError(`Dashboard render: failed reading challenges ${ladder.sheetName}`, error);
    embed.setDescription('⚠️ Challenges are temporarily unavailable. Retrying shortly.');
    return { embeds: [embed], components };
  }

  const challenges = rows.filter(row => row[5] === 'Challenge');
  if (!challenges.length) {
    embed.setDescription(
      `No active challenges on the ${ladder.displayName} right now.\n\n**[Open the full ladder in Google Sheets](${url})**`
    );
    return { embeds: [embed], components };
  }

  const processedPairs = new Set();
  let pairCount = 0;
  challenges.forEach(challenge => {
    const challengerRank = challenge[0];
    const challengerName = challenge[1] || 'Unknown';
    const challengerElement = challenge[3] || '';
    const challengedRank = challenge[7];
    const challengeDate = challenge[6] || 'Unknown';

    const pairKey = `${challengerRank}-${challengedRank}`;
    const reversePairKey = `${challengedRank}-${challengerRank}`;
    if (processedPairs.has(reversePairKey)) return;
    processedPairs.add(pairKey);

    const challengedPlayer = rows.find(row => row[0] === challengedRank);
    const challengedName = challengedPlayer ? challengedPlayer[1] : 'Unknown';
    const challengedElement = challengedPlayer ? challengedPlayer[3] : '';

    const countdown = expiryCountdown(challengeDate);
    embed.addFields({
      name: `Rank #${challengerRank} vs Rank #${challengedRank}`,
      value: `**${challengerName}** ${elementEmojiMap[challengerElement] || ''} 🆚 **${challengedName}** ${elementEmojiMap[challengedElement] || ''}\nChallenge Date: ${challengeDate}${countdown ? ` • ⏳ ${countdown}` : ''}`,
      inline: false,
    });
    pairCount += 1;
  });

  embed.setDescription(
    `${pairCount} active challenge${pairCount === 1 ? '' : 's'} — **[Open the full ladder in Google Sheets](${url})**`
  );

  return { embeds: [embed], components };
}

// ---------------------------------------------------------------------------
// #register control panel (SHARED across both ladders — the format is chosen
// inside each button's wizard, so no ladder rides in these top-level customIds;
// parseCustomId tolerates a missing ladder segment). This panel is static: it's
// posted once at hydration and only re-posted if deleted — the buttons carry all
// the behavior (interactions/registerPanel.js). See CHANNEL_DASHBOARDS_PLAN.md §5.1.
function buildRegisterPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('⚔️ Join the Ladder')
    .setDescription(
      [
        'Use the buttons below to manage your ladder presence. All actions are self-serve unless noted.',
        '',
        '**Sign Up** — register a new character (pick HLD/LLD, element, and build).',
        '**Leave Ladder** — permanently remove one of your characters.',
        '**Request / Return from Vacation** — flip your character to 🌴 Vacation and back.',
        '**Request / Return from Extended Vacation** — notifies the SvS Managers (bench/insert stays manager-run).',
        '',
        '_You must hold the **SvS Dueler** role to sign up. Ask an admin if you don\'t have it yet._',
      ].join('\n')
    )
    .setFooter({ text: 'One character per element per ladder • Vita ❤️ / ES 🔵' });

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('svs:register:signup')
        .setLabel('📝 Sign Up')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('svs:register:leave')
        .setLabel('👋 Leave Ladder')
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('svs:register:vacation')
        .setLabel('🌴 Request Vacation')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('svs:register:unvacation')
        .setLabel('☀️ Return from Vacation')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('svs:register:extvac')
        .setLabel('🏖️ Request Extended Vacation')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('svs:register:unextvac')
        .setLabel('🧳 Return from Extended Vacation')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];

  return { embeds: [embed], components };
}

module.exports = { buildRankingsPayload, buildChallengesPayload, buildRegisterPayload };
