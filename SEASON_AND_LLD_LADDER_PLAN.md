# Season Tracking + LLD Ladder — Implementation Plan

**Status:** DRAFT / PROPOSAL — nothing implemented yet.
**Author:** planning pass (pre-implementation review).
**Requested by:** SvS mod (Shreve), relayed 8/10/2026.

> ⚠️ This document is a plan only. No code should be changed until the **Open
> Questions / Decisions** section is answered by the mods and the approach is
> approved.

> **Decisions locked (2026-09-09):**
> - Command UX = **single command set** — channel-inference for the challenge
>   commands + optional `ladder` arg (default `main`) everywhere else. No `/lld`
>   prefixed duplicates. (§4.3)
> - LLD `#lld-challenges` channel id = **`1547283140995719258`**. (§4.2)
> - LLD tab **columns confirmed identical** to the Standard ladder tab. (§2.2)
> - Season 1st-place log = **one shared `Season Champions` tab** for both ladders.
>   The mod has **manually created** it and will backfill past champions by hand
>   (the **9/1 reset already passed**); the bot appends future seasons to the same
>   tab. (§3.2-B)
> - Remaining blockers: §10 items 2–5, 7, 8, 11.

---

## 1. The Two Requests (verbatim intent)

1. **Seasonal #1-spot tracking + rollup to overall/all-time.**
   > "We are probably going to be resetting the ladder again 9/1 — is there a way
   > to have seasonal tracking of the #1 spot and then to also have it add to the
   > overall tracking?"

   Meaning: each time the ladder resets, capture *that season's* champion / title-
   defense record, then also keep a **persistent all-time total** that survives
   every reset.

2. **A second ladder for Low Level Dueling (LLD).**
   > "Is there a way to add a sheet for a potential lld svs ladder lol"

   The mod has already created a tab named **`LLD SvS Ladder`** (gid
   **`1724011514`**) in the same spreadsheet the bot is connected to. LLD =
   *low level dueling* — a parallel, independent ladder running alongside the
   main SvS ladder.

These two requests are **coupled**: the season system should be built *ladder-
aware* from day one so the LLD ladder inherits seasons for free (see §7).

---

## 2. Current-State Architecture (what exists today)

### 2.1 Data store
- **Google Sheets** is the system of record. `SPREADSHEET_ID` (env) points at one
  spreadsheet with multiple tabs.
- **Redis** (ioredis, DB 0) holds ephemeral state: challenges (TTL), warnings,
  cooldowns, and a couple of persistent config flags.

### 2.2 The main ladder tab — `SvS Ladder` (numeric `sheetId = 0`)
Row layout, columns `A2:K` (0-based array index in code shown in brackets):

| Col | Idx | Meaning |
|-----|-----|---------|
| A | 0 | Rank |
| B | 1 | Character Name |
| C | 2 | Spec (`Vita` / `ES`) |
| D | 3 | Element (`Fire` / `Light` / `Cold`) |
| E | 4 | Discord Username (display) |
| F | 5 | Status (`Available` / `Challenge` / `Vacation`) |
| G | 6 | Challenge Date (`cDate`) |
| H | 7 | Opponent Rank (`Opp#`) |
| I | 8 | Discord ID |
| J | 9 | Notes |
| K | 10 | Cooldown (dodge counter / notes) |

The literal string `'SvS Ladder'` and the numeric `sheetId = 0` are **hardcoded
in ~15 files** (see §6.2). The numeric id is required for `batchUpdate`
formatting calls (element background colors, bold names, data-validation copy).

> ✅ Confirmed by the mod: the **`LLD SvS Ladder`** tab (gid `1724011514`) uses an
> **identical column layout A:K**. This means ladder selection is a pure config
> lookup on a **single shared code path** — no per-ladder parsing differences.

### 2.3 The `Metrics` tab
Read by `stats.js` and `titledefends.js`; written by `reportwin.js`.

- **`Metrics!A1:F8`** — general stats block:
  - element distribution (≈ rows 3–6): `A`=element, `B`=count, `C`=percentage
  - player stats (≈ rows 3–7): `E`=label, `F`=value
    (`Total Characters`, `Unique Players`, `Multi-char Players`,
    `Active Challenges`, `Vacation Count`) — these are almost certainly
    in-sheet formulas.
- **`Metrics!A11:C` (downward)** — title-defends table:
  `A`=Discord Username, `B`=Discord ID, `C`=defend count (**currently a single
  cumulative counter**).

### 2.4 Title-defend flow (today)
- `reportwin.js`: on a win where `winnerRank === 1` **and** title-defend mode is
  enabled, it finds the winner in `Metrics!A11:C` by matching Discord ID
  (`winnerRow[8]`) in column B, then increments column C (or appends a new row
  with count `1`).
- `/titledefendmode on|off|status` toggles a **single global** Redis flag
  `svs:titledefends:enabled` (default = enabled). Precedent for persistent config
  keys.
- `/titledefends` and `/stats` read `Metrics!A11:C` and sort by column C.

**Key observation:** there is *no season concept today*. Column C is an ever-
growing all-time counter that is never reset. A ladder "reset" (via `/shuffle`
or manual sheet edits) does **not** touch Metrics — so title defends already
behave like an all-time total, but there's no per-season slice and no champion
archive.

### 2.5 Challenge / cooldown Redis keys
- Challenge key: `challenge:{discordId1}-{element1}:{discordId2}-{element2}`
  (pair sorted for order-independence). Warning key mirrors it with
  `challenge-warning:` prefix. Cooldown key: `cooldown:{...}:{...}`.
- `challenge-expiry-handler.js` subscribes to `__keyevent@0__:expired`, and on a
  `challenge:` expiry it **parses the key** (`substring(10)` to strip
  `challenge:`, then split on `:` and `-`) to recover `discordId`+`element` for
  both players, looks them up in **`SvS Ladder`**, resets their status columns,
  and announces in the challenges channel `1330563945341390959`.
- `challenge-expiry-checker.js` + hourly `runSafetyCheck` are a backup sweep,
  also hardcoded to `SvS Ladder` / `sheetId 0`.

> ⚠️ These keys are **not ladder-scoped**. Element (`Fire`/`Light`/`Cold`) is the
> only per-character discriminator. A player who runs a Fire sorc on **both**
> ladders would collide on identical challenge/cooldown keys. This is the single
> biggest technical risk for request 2 (see §6.4). (Note: a prior key-format
> migration is documented in `REDIS_KEY_MIGRATION.md` — read it before touching
> key formats.)

### 2.6 Channel + role gating
- `/challenge` and `/reportwin` hard-refuse unless
  `interaction.channelId === '1330563945341390959'` (the `#challenges` channel).
- Command access: `SvS Dueler` role required for player commands (enforced
  globally in `index.js`); `SvS Manager` required for management commands.

### 2.7 Deployment
- `deploy-commands.js` loads every file in `commands/` and registers them per
  guild (`TEST_GUILD_ID`, `LIVE_GUILD_ID`). Adding options to existing commands
  or adding new command files just requires a redeploy.

---

## 3. Request 1 — Season / #1-Spot Tracking (detailed design)

### 3.1 Goal restated
- Track, **per season**, the title-defense record of the #1 spot (and who the
  reigning champion was when the season ended).
- Maintain an **all-time total** that accumulates across every reset.
- Provide views for both, and a clean, safe "start a new season" operation for
  the 9/1-style resets.

### 3.2 Data model

**A. Metrics title-defends table — expand `A11:C` → `A11:D`:**

| Col | Meaning |
|-----|---------|
| A | Discord Username |
| B | Discord ID |
| C | **Current-season** defends |
| D | **All-time** defends |

`reportwin` increments **both C and D** on a rank-1 defense. All-time (D) is the
source of truth for the persistent total; current-season (C) is what gets
archived and zeroed at each reset.

**B. Tab `Season Champions`** — THE "1st-place log". **One shared tab for both
ladders** (a `Ladder` column disambiguates); one row per completed season. The
mod has **already created this tab manually** and will backfill past seasons by
hand (the 9/1 reset already happened). Going forward the bot **appends future
seasons by position** on `/newseason`. Because the bot writes columns strictly
left-to-right A→K, the header order below is **exact and must not be reordered**.

**Exact column structure (row 1 = headers, data starts row 2):**

| Col | Header (row 1) | Type | Required? | Example | Notes |
|-----|----------------|------|-----------|---------|-------|
| A | `Season` | integer | **Required** | `1` | Oldest completed season = `1`, then `2`, `3`… Unique per ladder. |
| B | `Ladder` | text | **Required** | `Standard` | Must be exactly `Standard` or `LLD`. Bot maps `main`→`Standard`, `lld`→`LLD`. |
| C | `Start Date` | date | optional | `2026-06-01` | `YYYY-MM-DD`. Leave blank if unknown. |
| D | `End Date` | date | **Required** | `2026-09-01` | `YYYY-MM-DD`. The reset/rollover date. |
| E | `Champion` | text | **Required** | `Whirlwind` | Character name that held rank #1 when the season ended. |
| F | `Discord ID` | text | optional | `123456789012345678` | 17–19 digits. **Format this column as Plain text** so Sheets doesn't round it to scientific notation. Enables @mention. |
| G | `Element` | text | optional | `Fire` | `Fire` / `Light` / `Cold`. |
| H | `Spec` | text | optional | `Vita` | `Vita` / `ES`. |
| I | `Season Defends` | integer | optional | `7` | Title defenses the champ made that season. Leave blank if unknown for backfilled seasons. |
| J | `Runner-Up` | text | optional | `Frostbite` | Rank #2 character at reset. |
| K | `Notes` | text | optional | | Freeform / manual annotations. |

**Manual-fill guidance (for you + mods backfilling past seasons):**
- Only **A `Season`**, **B `Ladder`**, **D `End Date`**, and **E `Champion`** are
  truly required. Everything else can be left blank and edited later from memory.
- Keep **`Ladder`** exactly `Standard` or `LLD` (the bot filters/writes on these
  literal strings).
- Use `YYYY-MM-DD` for both date columns.
- Set column **F `Discord ID`** to **Plain text** formatting before entering IDs.
- **Do not reorder or insert columns** — the bot appends new season rows by
  position (A→K). Adding columns to the right of `K` is safe.
- One row per `(Season, Ladder)` pair — Standard Season 1 and LLD Season 1 are two
  separate rows.

> On first run the bot initializes its season pointer
> `svs:season:{ladder}:current` to **`(highest Season already in this tab for that
> ladder) + 1`**, so manual backfill and automated appends stay in sync.

**All-time rollup:** lives in each ladder's `Metrics` title-defends table as the
new **column D** (§3.2-A) — an incremental cumulative counter. **No separate
all-time tab is needed.** All-time = the persistent D value; per-season = the
archived C snapshots.

**C. (Optional — defer to v2) `Season Defends Archive`** — full per-player
snapshot per season, only if you later want deep historical leaderboards beyond
the champion. One shared tab, `Ladder` column. Skip for v1 unless wanted:

| Season | Ladder | Username | Discord ID | Defends |
|--------|--------|----------|------------|---------|

**D. Season pointer (Redis, persistent, mirrored to a `Seasons` tab for
durability):**
- `svs:season:{ladder}:current` → integer, default `1`.
- Optional `svs:season:{ladder}:startDate` → ISO date for display.
- A small `Seasons` tab (`Season`, `Ladder`, `Start Date`, `End Date`) is the
  durable mirror; Redis is the fast read path.

> Decision point: Sheet vs Redis as source of truth for the season number.
> **Recommendation:** the *sheet* (`Seasons` tab) is canonical (durable, human-
> visible, survives a Redis flush); Redis caches the current number. `/newseason`
> writes both.

### 3.3 New command — `/newseason` (Manager only)
Performs an **atomic, idempotent** season rollover for a selected ladder. Steps:

1. Resolve ladder (option, default `main`) and current season `N`.
2. **Idempotency guard:** if `Season Champions` already contains a row for
   `(N, ladder)`, refuse unless a `force:true` flag is passed. Present a
   confirmation button before doing anything destructive.
3. Read the ladder's `Metrics` title-defends (`A:D`).
4. Read the ladder rank-#1 row → champion (name, id, element, their season
   defends). If no rank 1 exists, record champion as "—".
5. (v2, optional) If `Season Defends Archive` is enabled, append each defender as
   `[N, ladder, username, discordId, C]`.
6. Append the champion row to **`Season Champions`** (tab already exists — created
   manually by the mods; bot only appends by column position A→K).
7. **Zero column C** (current-season) for every defender; **leave D untouched**.
8. Increment season → `N+1` in Redis + `Seasons` tab; set new start date.
9. Post an announcement embed: season summary, champion, top-N season defenders.

**Important ordering:** the champion is read from the *live* ladder, so
`/newseason` MUST be run **before** the ladder standings are wiped/shuffled. This
is documented in the runbook (§9).

> Decision point: should `/newseason` also reset the ladder standings (ranks)?
> **Recommendation: NO — keep it decoupled.** `/newseason` handles season
> archival only. The rank reset stays a separate action (existing `/shuffle`, a
> manual sheet clear, or a future `/resetladder`). Optionally add a
> `also_reset_ladder:boolean=false` flag later. Coupling a destructive wipe into
> the same command is risky.

### 3.4 View commands
- **Extend `/titledefends`** with:
  - `scope: season | alltime` (default: **season**, since seasonal is the new
    primary ask — confirm with mods).
  - `ladder: main | lld` (default `main`).
  - Season view reads column C; all-time reads column D.
- **Extend `/stats`** to show the current season label and both counters.
- **New `/seasonhistory`** (a.k.a. `/champions`): paginated list of past
  champions from `Season Champions`, filterable by `ladder`.

### 3.5 Per-ladder title-defend mode
`svs:titledefends:enabled` becomes `svs:titledefends:{ladder}:enabled`. Add a
one-time migration that copies the legacy key into `main` and defaults `lld`.
`/titledefendmode` gains a `ladder` option.

### 3.6 Edge cases (request 1)
- **The 9/1 reset already happened (confirmed).** Past-season champions are being
  **manually backfilled by the mods** directly in the `Season Champions` tab (they
  already created it). The bot's season pointer is initialized to
  `last recorded Season + 1` per ladder, so the first automated `/newseason` picks
  up cleanly after the manual entries. No sheet-version-history archaeology needed.
- **Migration of existing Metrics data:** when adding column D, backfill
  `D = existing C` (existing count is the all-time value so far). Leave C as the
  season-to-date value.
- **Rank 1 empty / on vacation:** still record whoever holds rank 1; champion can
  be "—" if none.
- **Double-run of `/newseason`:** blocked by the idempotency guard + confirmation.
- **Ties** in season defends: stable sort; display order deterministic.
- **`reportwin` read range** must change from `Metrics!A11:C` → `A11:D` and
  increment both columns while still matching on column B (Discord ID).

---

## 4. Request 2 — LLD Ladder (detailed design)

### 4.1 Goal restated
Run a second, fully independent ladder (`LLD SvS Ladder`, gid `1724011514`) in
the same spreadsheet, with its own standings, challenges, cooldowns, metrics, and
seasons — without disturbing the main ladder.

### 4.2 Central config module — `config/ladders.js` (new)
Single source of truth that every ladder-scoped file imports:

```js
module.exports = {
  main: {
    key: 'main',
    displayName: 'SvS Ladder',
    sheetName: 'SvS Ladder',
    sheetId: 0,
    challengeChannelId: '1330563945341390959',
    metricsTab: 'Metrics',
    redisPrefix: 'main',        // used to namespace challenge/cooldown keys
    top10MaxJump: 2,
    regularMaxJump: 3,
    top10Threshold: 10,
  },
  lld: {
    key: 'lld',
    displayName: 'LLD SvS Ladder',
    sheetName: 'LLD SvS Ladder',
    sheetId: 1724011514,
    challengeChannelId: '1547283140995719258',  // #lld-challenges
    metricsTab: 'LLD Metrics',  // prerequisite: mod to create (see §4.6)
    redisPrefix: 'lld',
    top10MaxJump: 2,            // confirm LLD rules with mods
    regularMaxJump: 3,
    top10Threshold: 10,
  },
};
```

Plus a helper (e.g. `utils/ladder.js`):
`resolveLadder(interaction)` → returns the config object by reading the
`ladder` option (default `main`) and/or inferring from the channel.

### 4.3 Command routing — how a user picks a ladder
Three candidate approaches were considered:

| Approach | Pros | Cons |
|----------|------|------|
| **(a) `ladder` option on each command** (choices Main/LLD, default Main) | Explicit, discoverable, one command set, low maintenance | Slightly more typing; must validate against channel |
| **(b) Duplicate commands** (`/lldchallenge`, `/lldleaderboard`, …) | Zero ambiguity | ~15 commands duplicated → doubles maintenance & clutter; rejected |
| **(c) Channel-only inference** (LLD channel ⇒ LLD ladder) | Zero typing | Fragile for read commands used anywhere; rejected as sole mechanism |

**Decision (LOCKED): one command set — channel-inference for the challenge
commands, optional `ladder` arg (default `Main`) for everything else.** No `/lld`
prefixed duplicate commands. Because the LLD tab columns are **identical** to the
Standard tab (§2.2), ladder selection is a pure config lookup on a single code
path.

Concrete routing split:

- **Ladder inferred from channel (no arg):** `/challenge`, `/reportwin`,
  `/cancelchallenge`, `/extendchallenge`, `/nullchallenges`, `/currentchallenges`.
  `#challenges` (`1330563945341390959`) → Standard;
  `#lld-challenges` (`1547283140995719258`) → LLD. These stay channel-gated, which
  **structurally prevents** reporting an LLD result in the Standard channel (safer
  than a settable arg someone can mis-set).
- **Optional `ladder` arg, default `Main` (blank = Standard):** `/leaderboard`,
  `/currentvacations`, `/stats`, `/titledefends`, `/seasonhistory`, and the
  Manager ops `/register`, `/remove`, `/insert`, `/dodge`, `/shuffle`,
  `/syncredis`, `/bench`, `/newseason`, `/titledefendmode`. Choices:
  `Main (SvS)`→`main`, `LLD`→`lld`. Omitting it → Standard ladder → **100%
  backward-compatible** with every command people type today (purely additive).

Rejected: duplicated `/lld…` set (doubles ~15 commands, forces new muscle memory)
and subcommand groups (full UX rewrite, 25-subcommand cap, no nesting room).

### 4.4 Redis key namespacing (critical)
Change key generators to include the ladder prefix:

- Challenge: `challenge:{ladder}:{p1}:{p2}`
- Warning:   `challenge-warning:{ladder}:{p1}:{p2}`
- Cooldown:  `cooldown:{ladder}:{p1}:{p2}`

Impacts:
- `redis-client.js`: `generateChallengeKey` / `generateCooldownKey` /
  `setChallenge` / `setCooldown` / `removeChallenge` / `checkCooldown` etc. take a
  `ladder` argument.
- `challenge-expiry-handler.js`: still matches `startsWith('challenge:')`, but the
  parser must now extract the **ladder segment first**, then look up the correct
  `sheetName` / `sheetId` / `challengeChannelId` from `config/ladders.js` before
  updating the sheet and announcing.
- `challenge-expiry-checker.js` + `runSafetyCheck`: must iterate **all** ladders
  (or derive ladder from each key) instead of assuming `SvS Ladder`.
- **Migration:** existing un-prefixed keys must be migrated or drained. Cleanest
  is to let existing challenges expire naturally during a low-traffic window, or
  write a one-off migration that rewrites keys into the `main:` namespace. Cross-
  reference `REDIS_KEY_MIGRATION.md`.

> Without this namespacing, an LLD challenge/cooldown could silently overwrite or
> block a main-ladder one for the same player+element. This is mandatory.

### 4.5 Numeric `sheetId` for LLD
All `batchUpdate` formatting operations (element background colors, bold names,
data-validation copy in `register`; element recolor + cell writes in `reportwin`;
row shifts in `insert`/`remove`/`nullchallenges`; dodge counter) must use the LLD
tab's numeric id **`1724011514`** instead of the hardcoded `0`. This comes from
the ladder config.

### 4.6 LLD tab prerequisites (mod-side setup)
For the bot to operate on `LLD SvS Ladder` the tab must mirror the main tab:
- ✅ Same **column layout A:K** (Rank…Cooldown) — confirmed identical.
- ⬜ A formatted **template row 2** with the spec/element/status **data-validation
  dropdowns** (because `register` copies formatting/validation from row 2 of the
  target sheet). *Still to verify.*
- ⬜ A dedicated **`LLD Metrics`** tab (mirror of `Metrics`, incl. the `A11:D`
  title-defends table) so LLD stats/title-defends/seasons have somewhere to write.
  *Still to create.*
- ✅ A dedicated **LLD `#lld-challenges` channel** — provided:
  `1547283140995719258`.

### 4.7 Files that become ladder-aware (change inventory)
Read+write ladder tab: `leaderboard`, `challenge`, `reportwin`, `register`,
`remove`, `insert`, `dodge`, `currentchallenges`, `currentvacations`,
`cancelchallenge`, `extendchallenge`, `nullchallenges`, `shuffle`, `syncredis`,
`bench`. Metrics/seasons: `stats`, `titledefends`, `titledefendmode`, new
`newseason`, new `seasonhistory`. Infra: `redis-client.js`,
`challenge-expiry-handler.js`, `challenge-expiry-checker.js`. Docs: `help`,
`README`. (`extendedvacations` uses its own `Extended Vacation` tab; `signup`,
`talrasha`, and debug commands are ladder-agnostic or handled separately.)

### 4.8 Edge cases (request 2)
- Same player+element on both ladders → covered by key namespacing (§4.4).
- A main cooldown must **not** block an LLD challenge → per-ladder cooldown keys.
- `register` autocompletes `disc_user` from guild members (ladder-agnostic — fine).
- Jump rules may differ for LLD → constants live in ladder config (§4.2).
- `reportwin`/`challenge` channel mismatch → validated against the ladder's
  configured channel.
- Deploy: new options + new commands require `node deploy-commands.js` to both
  test and live guilds.

---

## 5. How the Two Requests Fit Together

Build the **ladder-aware foundation first**, then layer seasons on top,
parameterized by ladder. That way LLD gets the season system automatically, and
the main ladder's 9/1 season need is met on a clean base. Season storage
(`Season Champions`, `Season Defends Archive`, `Seasons`) carries a `Ladder`
column so both ladders share the same tabs without collision.

---

## 6. Consolidated Risk Register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | Redis key collision across ladders | **High** | Mandatory key namespacing (§4.4) + migration |
| R2 | Expiry handler updates wrong sheet for LLD | High | Parse ladder from key; route via config |
| R3 | 9/1 reset already happened before tooling exists | **Resolved** | Mods manually backfill champions in `Season Champions`; bot season pointer starts at `last recorded + 1` |
| R4 | Metrics column-C semantic change breaks `/titledefends` & `/stats` | Med | Add column D; update all readers together; backfill D=C |
| R5 | Wrong numeric `sheetId` corrupts formatting on LLD | Med | Drive `sheetId` from config; test on test guild first |
| R6 | LLD tab missing template row / validation | Med | Mod prerequisite checklist (§4.6) before enabling LLD |
| R7 | Regression in main ladder from refactor | Med | Phase 0 ships with only `main` active → behavior-neutral |
| R8 | `/newseason` run twice or before champion read | Med | Idempotency guard + confirmation + runbook ordering |
| R9 | Hardcoded channel IDs | Low | Move to config; LLD channel captured (`1547283140995719258`) |

---

## 7. Phased Delivery

**Phase 0 — Ladder-aware foundation (behavior-neutral).**
`config/ladders.js`, `utils/ladder.js`, refactor all hardcoded
`SvS Ladder`/`sheetId 0` reads through config with default `main`, namespace
Redis keys + migration, make the expiry handler/checker ladder-aware. Ship with
only `main` wired → **no user-visible change**; regression-test the full main-
ladder flow on the test guild.

**Phase 1 — Season / #1 tracking for the main ladder (satisfies request 1).**
Metrics `A11:D`, per-ladder title-defend key, `Seasons` / `Season Champions` /
`Season Defends Archive` tabs, `/newseason`, `/seasonhistory`, updated
`/titledefends` + `/stats` + `/titledefendmode`. Backfill migration. This is the
**time-sensitive** piece for the 9/1 reset — can ship independently of LLD.

**Phase 2 — Activate the LLD ladder (satisfies request 2).**
Add `ladder` option to all commands, wire LLD `sheetId`/channel/`LLD Metrics`,
confirm LLD tab prerequisites, deploy. LLD inherits seasons from Phase 1
automatically.

**Phase 3 — Polish.**
Update `/help`, `README.md`, portfolio screenshots; optional per-ladder
dashboards.

---

## 8. Testing Plan
- All development against **`TEST_GUILD_ID`** first; deploy to live only after
  sign-off.
- **Phase 0 regression:** run full main-ladder lifecycle (register → challenge →
  warning → expiry auto-null → report win → title defend → cooldown →
  cancel/extend → shuffle) and confirm identical behavior to today.
- **Redis migration:** verify old challenges drain/migrate; confirm no orphan keys
  and that expiry still auto-nulls correctly.
- **Season:** simulate a season with several rank-1 defenses, run `/newseason`,
  verify archive rows, champion row, C zeroed, D preserved, season number
  incremented, idempotency guard blocks a second run.
- **LLD isolation:** create a player with the same element on both ladders; open a
  challenge on each; confirm independent keys, independent cooldowns, correct
  sheet updates, correct channel announcements, correct expiry routing.
- **Deploy:** `node deploy-commands.js` and confirm new options/commands appear in
  both guilds.

---

## 9. Operational Runbook — performing a reset (mods)
1. Ensure title-defend mode was **on** during the season (so defenses were
   counted). `/titledefendmode status ladder:<x>`.
2. Run **`/newseason ladder:<x>`** — this archives the season + records the
   champion from the **current** rank-1 holder. **Do this BEFORE any rank wipe.**
3. Verify the announcement embed and the new rows in `Season Champions` /
   `Season Defends Archive`.
4. Now perform the actual **ladder reset** (`/shuffle`, manual clear, or future
   `/resetladder`) as desired.
5. Confirm the season number advanced (`/stats` shows the new season).

---

## 10. Open Questions / Decisions Needed (blockers)

**Request 1 (seasons):**
1. ✅ **RESOLVED** — the 9/1 reset already happened. Mods manually backfill past
   champions in the `Season Champions` tab; the bot's season pointer starts at
   `last recorded Season + 1` per ladder.
2. Does "#1-spot tracking" mean **title-defense counts per season** (assumed), or
   literally **who ended each season at rank 1** (the champion), or **both**?
   (Plan currently captures both.)
3. Default `scope` for `/titledefends` — **season** or **all-time**?
4. Should `/newseason` stay **decoupled** from the rank wipe (recommended), or
   also reset standings?
5. Source of truth for the season number — **sheet** (recommended) or Redis?

**Request 2 (LLD):**
6. ✅ **RESOLVED** — LLD channel = `#lld-challenges` (`1547283140995719258`).
7. ⬜ Confirm/create a dedicated **`LLD Metrics`** tab mirroring `Metrics` (incl.
   the `A11:D` title-defends table) — still needed.
8. ⬜ Are the **challenge jump rules** the same for LLD (top-10 max jump 2, regular
   3, threshold 10), or different?
9. ⚠️ **PARTIAL** — `LLD SvS Ladder` **columns A:K confirmed identical**. Still to
   verify: a formatted **template row 2** with spec/element/status **data-
   validation dropdowns** (required by `/register`).
10. ✅ **RESOLVED** — single command set: channel-inference on the challenge
    commands + optional `ladder` arg (default `main`) elsewhere (§4.3).

**Cross-cutting:**
11. Redis key migration window — is a brief low-traffic window acceptable to
    drain/migrate existing challenge keys?

---

*End of plan. Await answers to §10 before implementation.*
