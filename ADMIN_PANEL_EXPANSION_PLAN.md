# Admin Panel Expansion Plan

Expand the live **SvS Manager Panel** (currently 5 buttons) toward the richer
**League Manager Dashboard** mockup (13 buttons) — *within reason*, grounded in
what SvS-Bot-2's architecture actually supports today.

This document is the feasibility review + phasing roadmap. It supersedes nothing
in `MANAGER_PANEL_PLAN.md`; it extends it.

---

## 1. Where we are vs. the mockup

**Live today (`interactions/managerPanel.js`, posted to `#admin-panel`):**
Add Character · Remove Character · Set Vacation · Record Dodge · Refresh Boards

**Mockup target (13 buttons):**
Reset Ladder (End Season) · Remove Player · Ban Player · Unban ·
Force-Cancel Match · Set Rank · Pending Sign-ups · Vacation · Shuffle Ranks ·
Pause/Resume Ladder · Guide · Points Standing

Two mockup buttons are **already shipped** under different names:
- *Remove Player* = **Remove Character** (done)
- *Vacation* = **Set Vacation** (done)

So the real net-new ask is the remaining 11, assessed below.

---

## 2. Hard architecture constraints (must design around these)

1. **Discord component limits:** max **5 buttons per ActionRow**, max **5 rows
   per message** → **25 components hard cap**. Current 5 + proposed adds stays
   under the cap, but see §6 — some low-frequency actions should live behind a
   single "More…" string-select rather than eating button slots.
2. **Wizard pattern (established):** every action is a multi-step wizard that
   replaces slash-command args. **No server-side state** — each step encodes
   state in the *next* component's `customId`
   (`svs:manager:{action}:{ladderKey}[:extra...]`). Final mutating step
   **re-reads the sheet and re-verifies identity** (by rank *and* discordId+
   element) before writing.
3. **Role gate first:** `SvS Manager` check happens before any defer; non-
   managers get an ephemeral refusal. Already implemented in `handle()`.
4. **Reuse services, never duplicate mutation logic.** Existing shared services:
   `removalService`, `characterService`, `registrationService`,
   `challengeService`, `matchResult`. Command files that still hold logic inline
   must have it **extracted into a service** before a button can call it.
5. **Dashboard infra:** "post once, edit forever" via `dashboards/registry.js`
   + `refresh.js`. Panel mutations should `refreshDashboard(...)` the affected
   boards (RANKINGS / CHALLENGES), same as the slash commands do.
6. **Per-ladder (HLD/LLD):** every wizard opens with a ladder picker, exactly
   like the shipped actions. No action may assume a default ladder.

---

## 3. Button-by-button feasibility matrix

| # | Mockup button | Code basis today | Verdict | Complexity | Risk |
|---|---|---|---|---|---|
| 1 | Reset Ladder (End Season) | `newseason.js` + `shuffle.js` (composite) | Reuse (compose 2) | **High** | Destructive |
| 2 | Remove Player | `removalService` | **Shipped** | — | — |
| 3 | Ban Player | *none* | **Net-new infra** | **High** | Needs signup hook |
| 4 | Unban | *none* | **Net-new infra** | Medium | Pairs w/ Ban |
| 5 | Force-Cancel Match | `cancelchallenge.js` | Extract → service | Medium | Redis+sheet sync |
| 6 | Set Rank | `insert.js` (partial) | New re-rank logic | **High** | **Insert is buggy** |
| 7 | Pending Sign-ups | `signup.js` is info-only | **Net-new infra** | **High** | No queue exists |
| 8 | Vacation | `characterService` | **Shipped** | — | — |
| 9 | Shuffle Ranks | `shuffle.js` | Extract → service | Medium | No confirm today |
| 10 | Pause/Resume Ladder | *none* | **Net-new infra** | **High** | Timer-offset model |
| 11 | Guide | static embed | New (trivial) | **Low** | None |
| 12 | Points Standing | `stats.js` / metrics tab | Reuse (read-only) | **Low** | None |

Plus keep the three current extras not in the mockup: **Add Character**,
**Record Dodge**, **Refresh Boards**.

---

## 4. Detailed notes per action

### 4.1 Reuse-only (safe, do first)
- **Force-Cancel Match** — `cancelchallenge.js` already voids an active
  challenge pair with no rank change. Extract `cancelChallengePair(client,
  ladder, {discordId, element})` into a service, then wizard: ladder → active-
  challenge picker (list only `status==='Challenge'` rows) → confirm → cancel +
  refresh CHALLENGES board. No rank movement = low blast radius.
- **Shuffle Ranks** — `shuffle.js` is complete and battle-tested; it just lives
  inline in the command. Extract `shuffleLadder(client, ladder, {clearCooldowns})`
  into a service. Wizard: ladder → **warn if active challenges exist** → confirm
  (Danger) → shuffle. The mockup explicitly wants the active-challenge warning,
  which the slash command currently skips.
- **Points Standing** — read-only. Pull the Metrics/title-defends table (as
  `newseason.js` already does from `ladder.metricsTab` A11:D) or `stats.js`
  output, render an ephemeral embed. No mutation, no confirm. Safe filler for a
  button slot.
- **Guide** — static ephemeral embed (channels, rules, how-tos). Zero backend.

### 4.2 Compose existing (medium, needs a confirm modal)
- **Reset Ladder (End Season)** — this is the mockup's headline destructive
  action and is a **composite**, not a single existing command:
  1. cancel all active matches (loop `cancelChallengePair` or the shuffle
     clear-challenges step),
  2. randomize rank order (`shuffleLadder`),
  3. prompt for a **new season name** and archive via `newseason.js`'s
     `performRollover` (champion → Season Champions tab, reset col C defends,
     advance Redis pointer, mirror Seasons tab).
  The season that just ended keeps its existing tab untouched; all-time stats
  unaffected — matches `newseason.js` behavior exactly. **Gate behind a typed-
  confirmation modal** (type the ladder name) because it is irreversible.
  Recommend wiring this only after Force-Cancel + Shuffle services exist, since
  it reuses both.

### 4.3 Risky / overlaps the known-buggy insert path
- **Set Rank** — "move a player to an exact rank, shifting others." This is
  conceptually the same splice logic as `insert.js`, which is **flagged as
  historically buggy and QA-sensitive**. Do **not** build Set Rank on top of
  `insert.js` as-is. Plan: first extract and harden a single, tested
  `reRankCharacter(client, ladder, {discordId, element}, targetRank)` service
  with explicit re-index of every affected row, then build *both* the insert-
  from-vacation flow and Set Rank on it. **Requires dedicated QA before ship.**

### 4.4 Net-new infrastructure (biggest lifts — scope carefully)
- **Ban Player / Unban** — no ban concept exists. Needs:
  - a durable **ban store** (new hidden `Bans` sheet tab: scope, discordId,
    name, reason, bannedBy, date + Redis mirror),
  - an **enforcement hook** at the sign-up/registration path so banned users
    can't re-enter (the point of a ban),
  - Ban wizard: scope (HLD/LLD/both) → user picker → reason modal → (optionally
    also remove their live character via `removalService`) → confirm.
  - Unban wizard: scope → pick from active-bans list → confirm.
  Without the enforcement hook, Ban is just a fancy Remove — so this must ship
  as a unit, not half.
- **Pending Sign-ups** — `signup.js` is **informational only**; there is no
  intake queue. A real approve/deny flow needs an **intake pipeline** first
  (capture registration requests into a `Pending` tab/Redis list), *then* a
  panel wizard to list → approve (calls `writeNewCharacter`) / deny (with
  reason DM). This is a feature, not a button. Largest single item.
- **Pause/Resume Ladder** — no pause state exists. Needs:
  - a per-ladder **paused flag** (Redis + Dashboard tab),
  - challenge issuance **gated** on the flag in `challengeService`,
  - a **timer-offset model**: on pause, record `pausedAt`; on resume, add the
    paused duration to every active challenge's deadline and every cooldown
    (shift, don't reset). This touches the auto-null sweep and cooldown math.
  High correctness risk; design the time math separately before coding.

---

## 5. New infrastructure summary (what must be built before the hard buttons)

| Infra | Enables | Storage |
|---|---|---|
| `reRankCharacter` service (hardened, tested) | Set Rank, fixed Insert | sheet splice + Redis |
| Ban store + signup enforcement hook | Ban / Unban | `Bans` tab + Redis |
| Pending intake pipeline | Pending Sign-ups | `Pending` tab + Redis |
| Pause flag + timer-offset model | Pause/Resume | Redis + Dashboard tab |
| Service extractions | Force-Cancel, Shuffle, Reset | from command files |

---

## 6. Recommended layout (within reason)

Keep the panel readable; don't cram 13+ buttons as raw buttons. Proposed 5 rows:

- **Row 1 — Roster:** ➕ Add Character · 🗑️ Remove Character · 📊 Set Rank
- **Row 2 — Status:** 🌴 Set Vacation · 🏃 Record Dodge · ⛔ Force-Cancel Match
- **Row 3 — Bans:** 🔨 Ban Player · ♻️ Unban · 📥 Pending Sign-ups
- **Row 4 — Ladder ops:** 🎲 Shuffle Ranks · ⏸️ Pause/Resume · 🏁 Reset Season
- **Row 5 — Read-only:** 📈 Points Standing · 📖 Guide · 🔄 Refresh Boards

That is 15 components across 5 rows — exactly at a comfortable limit. If more are
added later, fold the read-only/rare items into a single "More…" string-select.

---

## 7. Phasing recommendation

**Phase 2A — Reuse & read-only (low risk, high value, ship first):**
Force-Cancel Match, Shuffle Ranks (with confirm), Points Standing, Guide.
All reuse/extract existing, well-tested logic. No new storage.

**Phase 2B — Compose:**
Reset Ladder (End Season) — once 2A's Force-Cancel + Shuffle services exist.
Typed-confirm modal.

**Phase 3 — Hardened re-rank:**
Extract + QA `reRankCharacter`, ship **Set Rank**, then fix **Insert-from-
vacation** on the same service. Gated on dedicated QA per the standing caution
that insert has always been buggy.

**Phase 4 — Net-new subsystems (each a mini-project):**
Ban/Unban (store + enforcement), Pause/Resume (timer-offset), Pending Sign-ups
(intake pipeline). Design docs per subsystem before coding.

---

## 8. QA callouts

- **Insert / Set Rank:** standing known-bug area — full splice/re-index QA on
  both ladders, with and without active challenges, before enabling the button.
- **Reset Season:** irreversible; typed-name confirmation mandatory; verify it
  archives to Season Champions and does *not* touch prior-season tabs.
- **Pause/Resume:** verify deadlines/cooldowns **shift** by paused duration, not
  reset; verify auto-null sweep respects the paused flag.
- **Ban:** verify a banned user genuinely cannot re-register (the enforcement
  hook is the whole point).
- Every mutating wizard must re-read the sheet and re-verify identity at the
  final step (never act on a stale rank).
