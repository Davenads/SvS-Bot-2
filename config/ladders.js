// Central ladder configuration — single source of truth for every ladder the
// bot operates on. Every ladder-scoped file (commands, redis-client, expiry
// handlers) should import from here instead of hardcoding sheet names, sheet
// ids, channel ids, or jump rules.
//
// See SEASON_AND_LLD_LADDER_PLAN.md §4.2 for the design rationale.
//
// IMPORTANT: `sheetId` is the numeric gid required by spreadsheets.batchUpdate
// for formatting (element colors, bold names, data-validation copy). The main
// ladder tab is gid 0; the LLD tab is gid 1724011514 (confirmed by the mods).

const LADDERS = {
  main: {
    key: 'main',
    displayName: 'SvS Ladder',
    // Label written into the shared Season Champions tab (Ladder column).
    seasonLabel: 'Standard',
    sheetName: 'SvS Ladder',
    sheetId: 0,
    challengeChannelId: '1330563945341390959',
    // Read-only rankings dashboard channel (persistent leaderboard board).
    rankingsChannelId: '1330563876281913424', // #hld-rankings
    metricsTab: 'Metrics',
    // Extended Vacation tab (bench/insert). Only the tab NAME is used today
    // (values.get/update/clear by range string); no numeric gid is required
    // because nothing formats this tab via batchUpdate.
    vacationTab: 'Extended Vacation',
    // Namespace used for challenge / cooldown / warning Redis keys so the two
    // ladders never collide for the same player + element.
    redisPrefix: 'main',
    // Challenge jump rules.
    top10MaxJump: 2,
    regularMaxJump: 3,
    top10Threshold: 10,
  },
  lld: {
    key: 'lld',
    displayName: 'LLD SvS Ladder',
    seasonLabel: 'LLD',
    sheetName: 'LLD SvS Ladder',
    sheetId: 1724011514,
    challengeChannelId: '1547283140995719258', // #lld-challenges
    // Read-only rankings dashboard channel (persistent leaderboard board).
    rankingsChannelId: '1553185338556420136', // #lld-rankings
    metricsTab: 'LLD Metrics',
    // LLD Extended Vacation tab (gid 612474986, confirmed by the mods).
    vacationTab: 'LLD Extended Vacation',
    vacationSheetId: 612474986,
    redisPrefix: 'lld',
    // Jump rules assumed identical to main until the mods confirm otherwise
    // (plan §10 #8). Change here if LLD uses different values.
    top10MaxJump: 2,
    regularMaxJump: 3,
    top10Threshold: 10,
  },
};

// Default ladder used whenever a `ladder` option is omitted (backward compatible
// with every command people type today).
const DEFAULT_LADDER_KEY = 'main';

// Season tabs are SHARED across both ladders — a `Ladder` column (values
// `Standard` / `LLD`, matching each ladder's seasonLabel) disambiguates the rows.
// See SEASON_AND_LLD_LADDER_PLAN.md §3.2. The bot appends to Season Champions by
// column position A→K, so the header order in the sheet must not be reordered.
const SEASON_CHAMPIONS_TAB = 'Season Champions';
// Durable mirror of the per-ladder season pointer (Season, Ladder, Start Date,
// End Date). Redis caches the current number; this tab is the source of truth.
const SEASONS_TAB = 'Seasons';

// Slash-command option choices for the `ladder` argument.
const LADDER_CHOICES = [
  { name: 'Main (SvS)', value: 'main' },
  { name: 'LLD', value: 'lld' },
];

// --- Channel dashboards (persistent, self-updating panels) -----------------
// See CHANNEL_DASHBOARDS_PLAN.md. The two rankings boards are per-ladder (the
// `rankingsChannelId` fields above). The register panel and the issue-a-
// challenge panel are SHARED across both ladders — the format is chosen inside
// each button's wizard, and the ladder key rides in every customId.
const SHARED_REGISTER_CHANNEL_ID = '1553201835026681976';  // #register (bot-only panel)
const SHARED_CHALLENGE_CHANNEL_ID = '1553197193849081977'; // #issue-a-challenge

// Hidden tab that durably maps each dashboard panel to the (channel, message)
// the bot edits in place, so a restart reconciles state instead of reposting.
// Columns A->E: Ladder | Panel | Channel ID | Message ID | Last Updated.
// NOTE: the live tab is named `Dashboard` (singular) — must match exactly.
const DASHBOARDS_TAB = 'Dashboard';

// Panel identifiers — shared by customIds, Redis keys, and the Dashboards tab.
const DASHBOARD_PANELS = {
  RANKINGS: 'rankings',
  REGISTER: 'register',
  CHALLENGES: 'challenges',
};

// Deep-link to a specific ladder's sheet tab. `sheetId` is the tab gid, so the
// URL always targets the correct tab; SPREADSHEET_ID is read at call time so the
// spreadsheet id lives only in the environment (not duplicated in config).
function sheetTabUrl(ladder) {
  return `https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}/edit#gid=${ladder.sheetId}`;
}

module.exports = {
  LADDERS,
  DEFAULT_LADDER_KEY,
  LADDER_CHOICES,
  SEASON_CHAMPIONS_TAB,
  SEASONS_TAB,
  SHARED_REGISTER_CHANNEL_ID,
  SHARED_CHALLENGE_CHANNEL_ID,
  DASHBOARDS_TAB,
  DASHBOARD_PANELS,
  sheetTabUrl,
};
