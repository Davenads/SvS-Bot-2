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

module.exports = {
  LADDERS,
  DEFAULT_LADDER_KEY,
  LADDER_CHOICES,
  SEASON_CHAMPIONS_TAB,
  SEASONS_TAB,
};
