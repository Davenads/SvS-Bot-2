# LLD Data Migration Plan — Importing the Temp LLD Bot's Ladder

Migrating the 10-player LLD roster (and its in-flight challenges) from another
dev's **temporary** LLD bot spreadsheet into our bot's `LLD SvS Ladder` tab
(gid `1724011514`).

Source sheet: `1POVZdKM-z8BZGWg2fOv0xFd4hCBgzI7hZoov47YDRj4` (tab gid `585061764`)
Target: our `SPREADSHEET_ID` → tab `LLD SvS Ladder` (`config/ladders.js` → `lld`).

---

## TL;DR

Yes — the migration is *mostly* "paste the rows into our LLD tab, then run
`/syncredis ladder:LLD`". But three things need explicit handling:

1. **Formatting/validation does not travel with a values paste** — the Status
   dropdown, element cell colors, etc. must be re-applied (you already spotted
   the Status dropdown). Easiest: paste-special *format only* from our HLD tab.
2. **Threads are NOT created by `/syncredis`** — it rebuilds Redis challenge +
   warning keys only. The 3 in-flight challenges will have full expiry/report
   behavior but no coordination thread (safe — see §5).
3. **cDate age drives TTL** — migrate promptly; challenges already older than
   3 days will be treated as expired and auto-torn-down.

Cooldowns can't be migrated (they live only in the temp bot's Redis, not the
sheet). The column structures are identical through **A–K**; the temp bot has
two extra trailing columns our bot ignores.

---

## 1. Column structure comparison

Our bot reads/writes ladder rows by **position** (`A2:I` for challenge logic,
`A2:K` for the roster commands) — header *text* is never parsed, so header
wording differences are cosmetic.

| Col | Temp bot header | Our bot usage (by index) | Match? |
|-----|-----------------|--------------------------|--------|
| A `[0]` | Rank | rank | ✅ |
| B `[1]` | Name | name | ✅ |
| C `[2]` | spec | spec (Vita/ES) | ✅ |
| D `[3]` | element | element (Fire/Light/Cold) | ✅ |
| E `[4]` | discUser | disc username (display only) | ✅ |
| F `[5]` | Status | status (`Available`/`Challenge`/`Vacation`) | ✅ |
| G `[6]` | cDate | challengeDate (drives TTL) | ✅ |
| H `[7]` | Opp# | opponent rank | ✅ |
| I `[8]` | discord userid | **discordId — the identity everything keys on** | ✅ |
| J `[9]` | Notes | notes | ✅ |
| K `[10]` | Dodges | dodges (`dodge.js` reads `row[10]`) | ✅ |
| L `[11]` | DodgesAgainst | *not read by our bot* | ⚠️ inert |
| M `[12]` | Vacation… | *not read by our bot* | ⚠️ inert |

**Verdict:** structurally aligned. The only difference is the two extra trailing
columns (L `DodgesAgainst`, M `Vacation…`). Our commands operate on `A–K`, so
L/M migrate as inert data — harmless, and preserved because our writes never
extend past K. Keep them for parity if the mods want them, or drop them.

---

## 2. Things to account for (the "anything off?" answer)

1. **Status column is the identity of a challenge to the bot.** `/syncredis`
   selects rows where `row[5] === 'Challenge'` (exact string). The dropdown you
   noticed is missing is cosmetic to the *bot* — it reads the cell value, not
   the validation — BUT the strings must be spelled **exactly** `Available` /
   `Challenge` / `Vacation` (capitalized). Re-adding the dropdown just protects
   against typos on future manual edits.
2. **`discordId` (col I) is the source of truth**, not `discUser` (col E). Every
   Redis key is `{discordId}-{element}`. Confirm every migrated row has a valid
   ~18-digit numeric ID in I (the screenshot shows all 10 do). Blank/garbage in
   I = that player can't be challenged and won't sync.
3. **Multi-character owners are fine.** Several rows share a discordId across
   different elements (e.g. Lpc owns Envy/Cold #4, Reign/Fire #6, Amp/Light #8;
   Aspect owns Lava/Fire #3, Elsa/Cold #7). Keys are `discordId-element`, so
   these never collide, and the jump-rule engine already excludes a challenger's
   own alts.
4. **cDate format must be `M/D, h:mm A TZ`** (e.g. `9/25, 12:23 AM EDT`). The
   temp bot's format matches ours exactly, so `calculateTTLFromChallengeDate`
   parses it and computes `cDate + 3 days` TTL. ✅
5. **Rank contiguity.** Ranks must be a gapless 1..N (they are: 1–10). The jump
   math and opponent lookups assume contiguous ranks.
6. **Opp# reciprocity.** `/syncredis` only creates a challenge when both players
   point at each other (`opponent[7] === rank`). Matching cDates identify the
   three intended pairs — verify Opp# reciprocity before the real run (dry-run
   logs a `WARNING: Challenge mismatch` for any that don't line up).

---

## 3. Formatting & data validation (the Status dropdown)

A **values-only** paste (recommended) will *not* bring the dropdown or colors.
Cleanest fix, in order of preference:

- **Option A (recommended):** After pasting values, select the equivalent
  formatted range on the **HLD tab** (e.g. `F2:F11` for Status, or `A2:M11` for
  everything), copy, then on the LLD tab **Edit → Paste special → Paste format
  only** over the matching range. This transfers the Status dropdown, element
  color rules, and header styling in one shot.
- **Option B (manual, your stated fallback):** Add data validation on `F2:F`
  → *List of items* → `Available,Challenge,Vacation`, and re-add element
  conditional formatting by hand.

Either way the **bot works regardless** — this is for mod-editing safety and
visual parity, not bot function.

---

## 4. Migration procedure

### Phase 0 — Pre-flight
- [ ] Confirm you hold the **SvS Manager** role (required for `/syncredis`).
- [ ] If our LLD tab currently holds any test data, **duplicate the tab** first
      (right-click → Duplicate) as a rollback snapshot.
- [ ] Check for leftover LLD test challenges in Redis:
      `/syncredis ladder:LLD dry_run:true` (also lists what it *would* do).

### Phase 1 — Copy the data
- [ ] In the temp sheet, copy `A2:M11` (the 10 player rows).
- [ ] In our `LLD SvS Ladder` tab, click `A2` → **Paste special → Values only**.
- [ ] Confirm columns land A–K aligned (spot-check I has numeric IDs, F reads
      exactly `Available`/`Challenge`).
- [ ] Apply formatting/validation per **§3** (paste format-only from HLD).
- [ ] Final sanity sweep: ranks 1–10 gapless, cDate strings intact, 3 challenge
      pairs visible.

### Phase 2 — Dry run (no writes)
- [ ] `/syncredis ladder:LLD dry_run:true`
- [ ] Expect **"Challenge pairs found: 3"**. Watch Heroku logs for any
      `WARNING: Challenge mismatch` / `Could not find opponent` — fix Opp# in the
      sheet and re-dry-run until clean.

### Phase 3 — Real sync
- [ ] If Phase 0 showed stale LLD challenges in Redis, run with force to
      overwrite: `/syncredis ladder:LLD force:true`
      (otherwise plain `/syncredis ladder:LLD`).
- [ ] `setChallenge` writes, per pair: the `challenge:lld:…` key **and** its
      `challenge-warning:lld:…` sibling, both with TTL derived from cDate
      (`cDate + 3 days`; warning fires 24 h before). No thread/sidecar is made.
- [ ] Confirm the result embed: `synced: 3`, `errors: 0`.

### Phase 4 — Threads (choose one — see §5)
- [ ] Default: do nothing.
- [ ] Optional: backfill coordination threads.

### Phase 5 — Dashboards & verification
- [ ] The `#lld-rankings` board reads the sheet but only re-renders on bot
      events — a manual paste doesn't trigger it. **Restart the Heroku dyno** to
      re-hydrate all dashboards, or issue any LLD write command to force a
      RANKINGS refresh.
- [ ] Verify `#lld-rankings` shows all 10 players in order.
- [ ] `/currentchallenges ladder:LLD` → shows the 3 active pairs.
- [ ] Optional TTL spot-check: `/syncredis ladder:LLD dry_run:true` /
      `/redisstatus` and confirm remaining hours look right (≈ 3 days minus age).

---

## 5. Challenge threads for the in-flight challenges

`/syncredis` rebuilds Redis state only — it never calls `createChallengeThread`,
so **no coordination threads and no `challenge-thread:` sidecars** are created
for the migrated challenges.

Detected in-flight pairs (matched by cDate):

| Pair | cDate |
|------|-------|
| Gem (#2) ↔ Lava (#3) | 9/25, 12:23 AM EDT |
| Reign (#6) ↔ Elsa (#7) | 9/25, 12:22 AM EDT |
| Amp (#8) ↔ test1 (#10) | 9/25, 4:19 PM EDT |

**Why "no threads" is safe:**
- Teardown (`/reportwin`, `/cancelchallenge`, expiry) calls
  `archiveChallengeThread`, which looks up the sidecar, finds none
  (`getChallengeThread` → null) and returns cleanly. No errors.
- The orphan sweep only walks existing sidecars, so there's nothing to trip on.
- The temp bot had no threads either → zero regression for the players.

### Option A — Do nothing (recommended)
These are ≤3-day challenges already in progress; players are coordinating where
they always were. Threads are a post-hoc convenience. Zero risk, zero work.

### Option B — Backfill threads (only if mods want the rooms)
Add a one-off `create_threads` boolean to `/syncredis` (or a small admin script)
that, for each synced pair, calls
`createChallengeThread(client, ladder, { challengerRow, targetRow, challengerRank, targetRank, challengeDate })`
using the rows it already parsed. That spawns the private thread, pings both
duelers + managers, pins the detail embed, and writes the 4-day sidecar. This is
a code change (not a config step) — implement only if requested.

### Option C — Re-issue via the bot (NOT recommended)
Cancelling and re-`/challenge`-ing would spawn threads but **resets cDate/TTL**,
re-posts announcements, and disrupts in-flight matches. Avoid.

---

## 6. Known caveats / gaps

- **Cooldowns are not migratable.** Post-match rematch cooldowns live only in the
  temp bot's Redis (never in the sheet), so any active cooldowns are lost — two
  players who just fought could immediately rematch. Usually acceptable for a
  fresh import; flag to the mods if it matters.
- **Stale cDates auto-resolve.** `calculateTTLFromChallengeDate` clamps a past
  expiry to a 5-minute minimum TTL. Any challenge whose `cDate + 3 days` is
  already in the past will sync, then expire within minutes and get auto-torn
  down (sheet reset to Available). Migrate promptly, or scrub obviously-old
  challenges first.
- **L/M columns are inert.** `DodgesAgainst` / `Vacation…` aren't read by our
  commands; keep or drop them freely.
- **Header text is ignored** by the bot but keep it readable for mods.

---

## 7. Rollback

- **Sheet:** delete the pasted rows / restore from the Phase-0 duplicate tab.
- **Redis:** the migrated keys are TTL'd (self-expire in ≤3 days). To purge
  immediately, remove each `challenge:lld:*` (and matching `challenge-warning:`)
  pair — or simply let them expire; the expiry handler cleanly resets the sheet
  rows to `Available`.
