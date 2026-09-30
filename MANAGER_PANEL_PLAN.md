# Manager Panel — Design & Implementation Plan

A persistent, self-updating control panel that gives **SvS Managers** one-click
access to the moderation actions they perform today via slash commands. Modeled
directly on the existing shared `#register` control panel (`buildRegisterPayload`
in `dashboards/render.js` + `interactions/registerPanel.js`), it reuses the
dashboard "post once, edit forever" infrastructure, the `svs:{panel}:{action}`
router scheme, and the button/select/modal + confirmation patterns already
proven in the register and match panels.

> **Status:** planning only. No feature code is written yet. This document is the
> spec to build against. Ground truth for every behavior below is the existing
> code cited inline (file paths + functions).

---

## 1. Motivation

Managers currently run these as slash commands, each requiring exact typing of
ranks/names/ladders and remembering which command does what:

| Command | Manager action | Ladder arg |
|---|---|---|
| `/register` | Add a character for another user | `ladder` option (default main) |
| `/remove rank` | Permanently remove a character + re-rank | `ladder` option |
| `/bench rank` | Move to Extended Vacation (forfeits active challenge) | `ladder` option |
| `/insert player_name` | Return a benched character to the ladder | `ladder` option, autocompletes vacation tab |
| `/dodge rank` | Increment a player's dodge count (col K) | `ladder` option |
| `/cancelchallenge player` | Clear a challenge pair, archive its thread | inferred from channel |
| `/extendchallenge player` | +2 days to a challenge, bump Redis/thread TTL | inferred from channel |
| `/nullchallenges` | Nullify challenges older than the max age | (main-scoped today) |
| `/shuffle` | Shuffle/seed the ladder | (main-scoped today) |
| `/newseason`, `/titledefendmode` | Season lifecycle controls | — |

Pain points a panel solves:
- **Discoverability** — one embed lists every manager action with a button.
- **Fewer input errors** — pickers (select menus) replace free-text rank/name
  typing; the ladder is chosen in-wizard instead of remembered as an option.
- **Consistency** — destructive actions get a uniform confirm step; challenge
  actions get a uniform "pick the pair" step; everything is ephemeral to the
  clicker so the channel stays clean.
- **Auditability** — the panel is a fixed, known location; actions still emit the
  same public embeds (`/remove`, `/bench`, `/insert` post farewell/welcome embeds
  to the channel) so history is preserved.

The panel is **additive**: every slash command stays exactly as-is. The panel is a
second front-end that calls the SAME shared services (`removeCharacterByRank`,
`writeNewCharacter`, `forfeitActiveChallenge`, `setCharacterStatus`, the Redis
challenge helpers, `archiveChallengeThread` / `persistChallengeThread`) so there
is one code path per behavior.

---

## 2. Design principles (inherited from the codebase)

1. **Router scheme.** All components use `svs:{panel}:{action}:{ladderKey}[:extra...]`
   (`interactions/router.js` → `parseCustomId`). `parseCustomId` requires ≥3
   segments and tolerates a missing `ladderKey` (returns `null`). The new panel
   registers under panel key **`manager`** in the `handlers` map.

2. **Ladder rides in the customId** whenever a specific ladder is already known
   (per-pair/per-rank follow-ups), so no channel lookup is needed. Top-level
   buttons carry no ladder (the manager picks HLD/LLD in-wizard), exactly like the
   register panel's `svs:register:signup`.

3. **Shared, single-instance panel.** Like `#register`, the manager panel is one
   message in one channel serving both ladders. It is **static** (buttons only),
   so it is posted once at hydration and only re-posted if deleted — never
   mutation-refreshed. (`doRefreshShared` in `dashboards/refresh.js`.)

4. **No server-side wizard state.** Each step encodes its state in the next
   component's customId or select `value` (`${ladderKey}:${rank}` encoding from
   `characterSelectRow`). The final mutating step **re-reads the sheet** and
   re-verifies identity (by discordId+element or rank) before writing — never
   trusts a stale rank captured at render time. This mirrors
   `handleLeaveConfirm` and `handleVacationDecision`.

5. **Delegate to shared services.** The panel handlers must NOT re-implement sheet
   math. They call the existing services so `/remove` and the panel's Remove
   button are byte-for-byte identical, etc. Where a behavior only exists inside a
   command (dodge increment, cancel/extend challenge, insert), Phase work may
   extract a thin service first (see §7).

6. **Fail soft.** Every handler wraps its work in try/catch, logs via `logError`,
   and replies with a friendly ephemeral on error. The router already provides a
   last-resort catch.

7. **Manager-gated at the handler, not the button.** Buttons render for whoever
   can see the channel; the handler checks the role on click (same as
   `handleVacationDecision` / matchPanel decisions). The panel channel SHOULD be
   permission-locked to managers regardless (defense in depth), but the code must
   not assume it.

8. **Emojis are fine here** — the existing panels use them heavily
   (`buildRegisterPayload`, embeds). (Note: the repo-wide "no emojis" rule is for
   commit messages and code the user hasn't asked to decorate; the dashboards
   already use emoji labels, so the panel matches that established UI.)

---

## 3. Architecture & wiring

### 3.1 `config/ladders.js`
Add:
```js
// New shared dashboard panel: the SvS Manager control panel. Lives in its own
// manager-only channel. Static (buttons only) — hydrated once, reposted if deleted.
const SHARED_MANAGER_CHANNEL_ID = '<TODO: mod-only channel id>';
```
Extend `DASHBOARD_PANELS`:
```js
const DASHBOARD_PANELS = {
  RANKINGS: 'rankings',
  REGISTER: 'register',
  CHALLENGES: 'challenges',
  MANAGER: 'manager',   // NEW
};
```
Export `SHARED_MANAGER_CHANNEL_ID` in `module.exports`.

> The panel channel should be a **new, manager-only** channel (View + Send locked
> to the SvS Manager role + bot). Do NOT reuse `VACATION_APPROVAL_CHANNEL_ID`
> (the command-log) — approval posts already land there and would clutter the
> panel. This is a `TODO(mods)` value to fill in, like the existing approval
> channel default.

### 3.2 `dashboards/render.js` — `buildManagerPayload()`
A pure builder returning `{ embeds, components }`, sibling to
`buildRegisterPayload()`. Static content; no sheet read. See §5 for the full
button list and rows. Export it from `module.exports`.

### 3.3 `dashboards/refresh.js`
- Import `SHARED_MANAGER_CHANNEL_ID` and `buildManagerPayload`.
- Extend `doRefreshShared` with a `MANAGER` branch:
  ```js
  if (panel === DASHBOARD_PANELS.MANAGER) {
    plan = {
      scope: 'shared',
      channelId: SHARED_MANAGER_CHANNEL_ID,
      payload: buildManagerPayload(),
    };
  }
  ```
- In `hydrateAll`, after the register panel:
  ```js
  await doRefreshShared(client, DASHBOARD_PANELS.MANAGER);
  ```
- No `refreshDashboard` (debounced/mutation) calls are needed — the panel is
  static, exactly like register. The ~10-min safety sweep (`hydrateAll` re-run)
  reposts it if someone deletes the message. Registry storage uses
  `scope='shared', panel='manager'` in the hidden `Dashboard` tab, so a restart
  reconciles it (`dashboards/registry.js`).

### 3.4 `interactions/router.js`
Add to the `handlers` map:
```js
manager: require('./managerPanel'),
```
Nothing else changes — `routeComponent` already dispatches by `ctx.panel`.

### 3.5 `interactions/managerPanel.js` (new)
Exports `async handle(interaction, ctx)` with a `switch (ctx.action)` dispatcher
(same shape as `registerPanel.js`). Contains a **single shared manager-role gate**
run at the top of `handle` (see §4), then per-action handlers. Reuses helpers
lifted/duplicated from `registerPanel.js`:
- `ephemeral(interaction, content)`
- `characterSelectRow(customId, placeholder, chars)` (value = `${ladderKey}:${rank}`)
- ladder-select and confirm-row builders

To avoid a circular/duplication smell, consider extracting `ephemeral`,
`characterSelectRow`, and the element/spec emoji maps into a small
`interactions/_shared.js` (or `utils/panelUi.js`) that both `registerPanel.js`
and `managerPanel.js` import. This is a Phase-0 refactor (see §8) and is optional
— duplicating the two tiny helpers is acceptable if we want zero risk to the
shipped register panel.

---

## 4. Permission model

Single gate at the top of `managerPanel.handle`, before any `defer`:

```js
const isManager = interaction.member?.roles?.cache?.some(
  r => r.name === MANAGER_ROLE_NAME            // 'SvS Manager' from utils/managers.js
);
if (!isManager) {
  return interaction.reply({
    content: `Only **${MANAGER_ROLE_NAME}s** can use the manager panel.`,
    ephemeral: true,
  });
}
```

Notes:
- This matches every existing manager command's check and
  `handleVacationDecision`.
- Because it runs before defer, a non-manager gets a clean ephemeral with no
  side-effects.
- The panel channel itself SHOULD also be role-locked, but the handler is the
  source of truth (buttons in a mis-permissioned channel still can't act).
- Destructive-action follow-ups (pick → confirm) do NOT need to re-check the role
  every step, because only a manager could have opened the ephemeral in the first
  place and ephemeral component interactions are scoped to that user. The final
  mutating step still re-reads the SHEET for data freshness (not for auth).

---

## 5. Recommended button set (complete)

Discord allows max **5 buttons per ActionRow** and **5 rows per message** (25
buttons total). The recommended set is **13 buttons across 4 rows**, grouped by
concern. Every button label carries an emoji consistent with the existing embeds
(`🎭 ⚔️ 🏖️ 🧳 🏃 ⏳ 🧹 🔀 🏆`).

### Row 1 — Roster
| Label | customId | Style | Flow (§5.x) |
|---|---|---|---|
| ➕ Add Character | `svs:manager:addchar` | Success | §5.1 |
| 🗑️ Remove Character | `svs:manager:remove` | Danger | §5.2 |

### Row 2 — Vacation / bench
| Label | customId | Style | Flow |
|---|---|---|---|
| 🏖️ Bench (Extended Vacation) | `svs:manager:bench` | Secondary | §5.3 |
| 🧳 Return from Extended Vac | `svs:manager:insert` | Secondary | §5.4 |
| 🌴 Set Vacation | `svs:manager:setvac` | Secondary | §5.5 |

### Row 3 — Challenge admin
| Label | customId | Style | Flow |
|---|---|---|---|
| ❌ Cancel Challenge | `svs:manager:cancel` | Danger | §5.6 |
| ⏳ Extend Challenge | `svs:manager:extend` | Secondary | §5.7 |
| 🏃 Record Dodge | `svs:manager:dodge` | Secondary | §5.8 |
| 🧹 Nullify Old Challenges | `svs:manager:nullold` | Secondary | §5.9 |

### Row 4 — Season / ladder maintenance (Phase 3, higher-risk)
| Label | customId | Style | Flow |
|---|---|---|---|
| 🔀 Shuffle Ladder | `svs:manager:shuffle` | Danger | §5.10 |
| 🏆 New Season | `svs:manager:newseason` | Danger | §5.11 |
| 🛡️ Title-Defend Mode | `svs:manager:titledefend` | Secondary | §5.12 |
| 🔄 Refresh Boards | `svs:manager:refreshboards` | Secondary | §5.13 |

> If mods want a leaner v1, ship Rows 1–3 (Phases 1–2) and defer Row 4. Row 4
> actions are the ones with the widest blast radius and are the least frequent.

Common two-step shape for the ladder-scoped actions:
1. **Top-level button** (no ladder) → ephemeral: choose ladder OR (for
   per-character actions) show a combined picker across both ladders.
2. **Follow-up select/confirm** whose customId carries `{ladderKey}[:rank]` →
   re-read sheet, act, reply.

---

### 5.1 Add Character — `svs:manager:addchar`
Mirror of `/register` (manager-only) using the **Sign Up wizard** shape but with
an extra "who owns it" step, since a manager registers on someone else's behalf.

Flow:
1. `addchar` → `interaction.showModal(...)` is NOT first here; instead defer + show
   a **ladder select** (`svs:manager:addchar_fmt`) — reuse `ladderSelectRow`
   shape.
2. `addchar_fmt` (select) → element select (`svs:manager:addchar_elem:{lk}`).
   Unlike self-serve signup, the manager may register any element (a manager can
   legitimately need to override) — but we SHOULD still surface which elements a
   target already holds once the owner is chosen. Simplest: keep the
   one-per-element check at submit via `getTakenElements(ladder, discUserId)`.
3. `addchar_elem` → build select (`svs:manager:addchar_build:{lk}:{elem}`).
4. `addchar_build` (select) → `showModal` (`svs:manager:addchar_submit:{lk}:{elem}:{spec}`)
   with fields: **Character Name** (required), **Discord user id or @mention**
   (required — a modal can't do user autocomplete, so accept an id/mention and
   resolve it; alternatively use a Discord **UserSelectMenu** as a step before the
   modal to pick the owner from the guild), **Notes** (optional).
   - **Recommended:** insert a `UserSelectMenu`
     (`svs:manager:addchar_user:{lk}:{elem}:{spec}`) step BEFORE the modal so the
     manager picks the owner from a native member picker; then the modal only
     needs name + notes. This avoids fragile id/mention parsing. The chosen user
     id rides in the modal customId.
5. `addchar_submit` (modal) → re-check `getTakenElements`, acquire the same
   `svs:signup:lock:...` style Redis lock, call
   `writeNewCharacter(client, ladder, { characterName, spec, element, discUser, discUserId, notes })`,
   post the "New Character Registered" embed (public, matching `/register`), reply
   ephemeral confirmation. `writeNewCharacter` already refreshes the rankings
   board.

Effects: writes new bottom-rank row; rankings board auto-refresh (inside the
service). No Redis challenge changes.

Edge cases: target lacks **SvS Dueler** role → warn but allow (managers override);
duplicate element on that ladder → reject at submit like signup does.

### 5.2 Remove Character — `svs:manager:remove`
Mirror of `/remove` but rank chosen from a picker rather than typed.

Flow:
1. `remove` → defer, show a **ladder select** (`svs:manager:remove_fmt`).
   (Two ladders can have overlapping ranks, so pick ladder first.)
2. `remove_fmt` → read that ladder's `A2:B` (`sheetName!A2:H` for status too),
   build a rank/name select `svs:manager:remove_pick:{lk}` with values
   `{lk}:{rank}` (cap 25 options — see §6 pagination note).
3. `remove_pick` → confirm step (`svs:manager:remove_go:{lk}:{rank}` + a
   `svs:manager:remove_cancel`) showing the character name, rank, ladder, and
   "permanent + re-ranks everyone below" warning (same copy as `leaveConfirmRow`).
4. `remove_go` → re-verify the rank still maps to a character, call
   `removeCharacterByRank(client, ladder, rank)`. On success, post the public
   farewell embed (matching `/remove`) and reply ephemeral. The service already
   handles re-rank, opponent cleanup, Redis challenge removal, and refreshes both
   boards.

Effects: identical to `/remove`. Note `removeCharacterByRank` does **not** archive
a coordination thread for a removed player's active challenge — it only clears the
opponent + Redis. If thread cleanup is desired here, add it as a Phase-2
enhancement to the shared service (out of scope for v1 to keep parity).

### 5.3 Bench (Extended Vacation) — `svs:manager:bench`
Mirror of `/bench` (which forfeits an active challenge first).

Flow:
1. `bench` → defer, ladder select (`svs:manager:bench_fmt`).
2. `bench_fmt` → rank/name picker `svs:manager:bench_pick:{lk}` from `A2:K`
   (label shows status; flag `Challenge` rows with ⚔️ so the manager sees the
   forfeit consequence).
3. `bench_pick` → confirm (`svs:manager:bench_go:{lk}:{rank}`) — warn that a
   mid-challenge bench **forfeits** to the opponent.
4. `bench_go` → the `/bench` core: if status is `Challenge`,
   `forfeitActiveChallenge(client, ladder, { discordId, element, announceChannel })`,
   re-read + relocate by identity, move the row to `vacationTab`, delete from
   ladder, re-rank, clear opponent, Redis cleanup, post farewell embed.

> **Refactor note:** `/bench`'s body is ~200 lines inline. For the panel to reuse
> it cleanly, extract a `benchCharacter(client, ladder, { rank | identity })`
> into a service (e.g. `services/benchService.js`) during Phase 2, then have BOTH
> `/bench` and the button call it. Until then, the button can locate the row and
> call `forfeitActiveChallenge` + a copy of the move/delete logic, but duplicating
> that math violates principle §2.5 — prefer the extraction.

Effects: character removed from ladder → `vacationTab`; opponent freed; ranks
re-numbered; boards refreshed (the extracted service must call
`refreshDashboard(RANKINGS)` + `(CHALLENGES)` like `removalService` does — the
current `/bench` refreshes implicitly via `forfeitActiveChallenge` only, so the
extraction should add explicit board refreshes).

### 5.4 Return from Extended Vacation — `svs:manager:insert`
Mirror of `/insert`. The candidate list comes from the ladder's `vacationTab`.

Flow:
1. `insert` → defer, ladder select (`svs:manager:insert_fmt`).
2. `insert_fmt` → read `vacationTab!A2:E`, build a picker
   `svs:manager:insert_pick:{lk}` with options `{name} ({rank})`, value
   `{lk}:{vacationRowName}` (name is the `/insert` key; encode carefully — name
   may contain `:`; safer to encode the vacation-tab row index instead, e.g.
   `{lk}:{vacRowIndex}` and resolve name from that row on submit).
3. `insert_pick` → confirm (`svs:manager:insert_go:{lk}:{vacRowIndex}`) showing
   name, original rank, "will re-enter as a Challenge at rank N".
4. `insert_go` → re-read vacation tab, run the `/insert` core (splice at original
   rank, re-rank, set status `Challenge`, set challenge date + Opp# to own rank,
   clear the vacation row), post the public "Welcome Back" embed, refresh boards.

> **Refactor note:** same as bench — extract `insertFromVacation(client, ladder,
> { vacationRowIndex | playerName })` into `services/benchService.js` (or
> `vacationService.js`) so `/insert` and the button share it. The current
> `/insert` does NOT call `refreshDashboard` — add board refreshes in the
> extraction.

### 5.5 Set Vacation (regular 🌴) — `svs:manager:setvac`
A manager-initiated version of the self-serve vacation flip. Unlike the register
panel's request-and-approve flow (a member requests; a manager approves), a
manager using the panel can set/return vacation directly for ANY character. This
covers the case where a member can't self-serve or a manager needs to fix state.

Flow:
1. `setvac` → defer, ladder select (`svs:manager:setvac_fmt`).
2. `setvac_fmt` → picker `svs:manager:setvac_pick:{lk}` across that ladder's
   `A2:K`; label shows current status (✅ Available / 🌴 Vacation / ⚔️ Challenge).
3. `setvac_pick` → the picked character's current status decides the toggle:
   - Available/Challenge → confirm "Set 🌴 Vacation?" (`svs:manager:setvac_go:{lk}:{rank}`).
     If Challenge, warn it forfeits (call `forfeitActiveChallenge` first, mirroring
     `handleVacationDecision`'s approve path), then `setCharacterStatus(ladder,
     rowNum, 'Vacation')`.
   - Vacation → confirm "Return ☀️ to Available?" → `setCharacterStatus(..., 'Available')`.
4. `setvac_go` → re-read by identity (discordId+element from the picked row),
   optionally forfeit, `setCharacterStatus`, `refreshDashboard(RANKINGS)`.

Effects: status cell (col F) flip; possible forfeit; rankings board refresh. Reuses
`setCharacterStatus` + `forfeitActiveChallenge` — no new sheet math.

> This intentionally bypasses the approval post (the manager IS the approver).
> Keep the member-facing request/approve flow in the register panel unchanged.

### 5.6 Cancel Challenge — `svs:manager:cancel`
Mirror of `/cancelchallenge`, but pick the pair from a list instead of typing a
name.

Flow:
1. `cancel` → defer, ladder select (`svs:manager:cancel_fmt`).
2. `cancel_fmt` → read `A2:K`, build the deduped list of live `Challenge` pairs
   (same dedup as `buildChallengesPayload`: skip the reverse pairing). Options
   labeled `#a NameA vs #b NameB`, value `{lk}:{aRank}:{bRank}` — cap 25.
3. `cancel_pick` → confirm (`svs:manager:cancel_go:{lk}:{aRank}:{bRank}`).
4. `cancel_go` → re-read, verify both rows still point at each other, clear F:H on
   both rows to `Available/''/''`, `redisClient.removeChallenge(p1, p2, ladder)`,
   `archiveChallengeThread(client, ladder, p1, p2, note)`, post the public
   "Challenge Canceled" embed, `refreshDashboard(RANKINGS + CHALLENGES)`.

> **Refactor note:** extract `cancelChallengePair(client, ladder, { aRank, bRank |
> playerName })` from `/cancelchallenge` so both share it. Until then the handler
> can replicate the small F:H clear + Redis + thread archive.

### 5.7 Extend Challenge — `svs:manager:extend`
Mirror of `/extendchallenge` (+2 days).

Flow:
1. `extend` → defer, ladder select (`svs:manager:extend_fmt`).
2. `extend_fmt` → same deduped live-pair picker as cancel, customId
   `svs:manager:extend_pick:{lk}`, value `{lk}:{aRank}:{bRank}`.
3. `extend_pick` → confirm (`svs:manager:extend_go:{lk}:{aRank}:{bRank}`) showing
   current challenge date.
4. `extend_go` → re-read, verify the pair, parse the challenge date (luxon,
   `America/New_York`, formats `M/d, h:mm a` / `M/d/yyyy, h:mm a`), add 2 days,
   write col G on both rows, `redisClient.updateChallenge(p1, p2, formattedDate,
   ladder)`, `persistChallengeThread(client, ladder, p1, p2, note)` (keeps thread
   alive, bumps TTL), post "Challenge Extended" embed,
   `refreshDashboard(CHALLENGES)`.

> **Refactor note:** extract `extendChallengePair(...)` from `/extendchallenge`.

### 5.8 Record Dodge — `svs:manager:dodge`
Mirror of `/dodge` (increment col K).

Flow:
1. `dodge` → defer, ladder select (`svs:manager:dodge_fmt`).
2. `dodge_fmt` → rank/name picker `svs:manager:dodge_pick:{lk}` from `A2:K`
   (show current dodge count in the description).
3. `dodge_pick` → immediately act (no confirm needed — it's a low-risk +1, and is
   reversible by editing the sheet). Re-read the row by rank, parse col K, `+1`,
   write `K{row}`, reply ephemeral with the new count. Optionally post a small
   public "Dodge Recorded" embed to match `/dodge`.

Effects: col K increment only; no rank/status change; no board refresh needed
(dodge count isn't shown on the boards). Reuse `/dodge`'s exact increment logic
(or extract `recordDodge(ladder, rank)`).

### 5.9 Nullify Old Challenges — `svs:manager:nullold`
Mirror of `/nullchallenges` (nullify challenges older than the max age; batch F:H
clear; archive threads).

Flow:
1. `nullold` → defer, ladder select (`svs:manager:nullold_fmt`) — since
   `/nullchallenges` is main-scoped today, this is an improvement: let the manager
   choose the ladder (or add an "All ladders" option).
2. `nullold_fmt` → run the nullify routine for that ladder (read A2:K, find
   `Challenge` rows whose date exceeds `MAX_CHALLENGE_DAYS`, batchUpdate F:H to
   Available, remove Redis challenges, archive threads), reply ephemeral summary
   ("Nullified N stale challenge(s)"), refresh both boards.

> **Refactor note:** `/nullchallenges` logic should be extracted into a service
> the button and command share; this also lets the automated hourly sweep reuse
> it. Verify the command's current ladder scoping before wiring the "All ladders"
> option.

Confirm step recommended (Danger) because it can clear many pairs at once:
`svs:manager:nullold_go:{lk}`.

### 5.10 Shuffle Ladder — `svs:manager:shuffle` (Phase 3)
Mirror of `/shuffle`. **Highest blast radius** — reorders/seeds the whole ladder.
Require a **typed confirmation** modal ("type SHUFFLE to confirm") rather than a
one-click confirm, because it's destructive and irreversible.

Flow: `shuffle` → ladder select → `showModal` with a confirm text field
(`svs:manager:shuffle_go:{lk}`) → on exact match run the shuffle core → refresh
boards. Defer to Phase 3; read `commands/shuffle.js` fully before implementing to
capture its exact semantics (seeding vs. randomize) and side effects.

### 5.11 New Season — `svs:manager:newseason` (Phase 3)
Mirror of `/newseason`. Season lifecycle (writes Season Champions / Seasons tabs,
resets state). Also destructive/rare → typed-confirm modal. Read
`commands/newseason.js` fully first; season logic touches the shared
`Season Champions` / `Seasons` tabs and the per-ladder `seasonLabel`. Likely needs
a ladder choice AND clear messaging about what resets. Defer to Phase 3.

### 5.12 Title-Defend Mode — `svs:manager:titledefend` (Phase 3)
Mirror of `/titledefendmode` (toggles a mode flag). Low-risk toggle: `titledefend`
→ show current state + Enable/Disable buttons
(`svs:manager:titledefend_go:{lk}:{on|off}`). Read `commands/titledefendmode.js`
to confirm whether the flag is per-ladder or global before deciding whether a
ladder select is needed.

### 5.13 Refresh Boards — `svs:manager:refreshboards`
Utility: force-reconcile every persistent dashboard (rankings, challenges,
register, manager) without waiting for the safety sweep. Handler calls
`hydrateAll(client)` (or per-panel `doRefresh`/`doRefreshShared`) and replies
ephemeral "Boards refreshed." Handy after manual sheet edits. Low-risk; include
in Phase 1 since it's trivial and useful for testing the other buttons.

---

## 6. Shared helpers & UI details

- **`characterSelectRow`** already encodes `${ladderKey}:${rank}` — reuse verbatim
  for rank pickers. For pair pickers (cancel/extend), add a small
  `pairSelectRow(customId, placeholder, pairs)` whose value is
  `${lk}:${aRank}:${bRank}`.
- **25-option cap.** A StringSelectMenu holds max 25 options. Large ladders exceed
  this for remove/bench/setvac/dodge pickers. Options:
  1. **Rank-range paging** — a first select "Ranks 1–25 / 26–50 / …" then the
     character select. Simple, deterministic.
  2. **Modal rank entry** — for actions where the manager already knows the rank
     (remove/bench/dodge), offer a "Type a rank" modal as an alternative entry so
     they aren't forced through a picker at all. This is the most robust for big
     ladders and closest to today's slash-command UX.
  - **Recommendation:** provide the rank picker for convenience but ALSO accept a
    typed rank via modal for remove/bench/dodge (challenge pair pickers are always
    small — # of live challenges — so no paging needed there).
- **Confirm rows** reuse the `leaveConfirmRow` shape: a Danger "Yes" carrying the
  encoded target and a Secondary "Cancel" (`svs:manager:<action>_cancel`) that
  `deferUpdate` + edits to "Cancelled — no changes made." with `components: []`.
- **Ladder select** reuse the `ladderSelectRow()` shape (HLD/LLD options).
- **Emoji maps** `elementEmojiMap` / `specEmojiMap` / `statusEmojiMap` already
  exist (`config/emoji.js`, and inline maps in the panels) — import from
  `config/emoji.js` to avoid re-declaring.

`buildManagerPayload()` embed copy (draft):
> **🛠️ SvS Manager Panel** — manager-only controls. All actions are ephemeral to
> you and re-read the sheet before writing. Destructive actions ask for
> confirmation.
> Lists each button group with a one-line description (Roster / Vacation /
> Challenge / Season).

---

## 7. Service extractions this plan implies (to honor §2.5)

To keep one code path per behavior, the following should be extracted into shared
services and consumed by BOTH the existing slash command and the new button.
Ordered by how much duplication they remove:

| Extract | From | New home | Consumers |
|---|---|---|---|
| `benchCharacter(client, ladder, {rank})` | `commands/bench.js` | `services/vacationService.js` | `/bench`, panel §5.3 |
| `insertFromVacation(client, ladder, {rowIndex\|name})` | `commands/insert.js` | `services/vacationService.js` | `/insert`, panel §5.4 |
| `cancelChallengePair(client, ladder, {aRank,bRank})` | `commands/cancelchallenge.js` | `services/challengeAdmin.js` | `/cancelchallenge`, panel §5.6 |
| `extendChallengePair(client, ladder, {aRank,bRank})` | `commands/extendchallenge.js` | `services/challengeAdmin.js` | `/extendchallenge`, panel §5.7 |
| `recordDodge(ladder, rank)` | `commands/dodge.js` | `services/challengeAdmin.js` | `/dodge`, panel §5.8 |
| `nullifyOldChallenges(client, ladder)` | `commands/nullchallenges.js` | `services/challengeAdmin.js` | `/nullchallenges`, sweep, panel §5.9 |

Already shared (no work): `removeCharacterByRank` (removalService),
`writeNewCharacter` / `getTakenElements` (registrationService),
`setCharacterStatus` / `findUserCharacters` (characterService),
`forfeitActiveChallenge` / `resolveMatch` (matchResult), Redis challenge helpers,
`archiveChallengeThread` / `persistChallengeThread` (challengeThreads),
`refreshDashboard` / `hydrateAll` (refresh).

> The extractions are the bulk of the real work; the button handlers are thin
> wrappers once the services exist. Each extraction must add the `refreshDashboard`
> calls the current commands sometimes omit (bench/insert) so the boards update
> from either front-end.

---

## 8. Phased rollout

**Phase 0 — plumbing (no user-visible buttons yet).**
- `config/ladders.js`: add `SHARED_MANAGER_CHANNEL_ID` + `DASHBOARD_PANELS.MANAGER`.
- `dashboards/render.js`: `buildManagerPayload()` with buttons but handlers may be
  stubs.
- `dashboards/refresh.js`: `doRefreshShared` MANAGER branch + `hydrateAll` call.
- `interactions/router.js`: register `manager` handler.
- `interactions/managerPanel.js`: role gate + `handle` skeleton + `refreshboards`
  (§5.13) working end-to-end as the smoke test.
- Confirm the panel posts to the manager channel and survives a restart (registry).

**Phase 1 — safe, high-frequency actions.**
- §5.2 Remove, §5.5 Set Vacation, §5.8 Record Dodge, §5.13 Refresh Boards.
  (Remove reuses the existing shared service; dodge/setvac are tiny.)

**Phase 2 — actions needing service extraction.**
- §5.1 Add Character, §5.3 Bench, §5.4 Insert, §5.6 Cancel, §5.7 Extend,
  §5.9 Nullify. Do the §7 extractions first, wire the slash commands to them
  (verifying parity), then add the buttons.

**Phase 3 — high-blast-radius / rare.**
- §5.10 Shuffle, §5.11 New Season, §5.12 Title-Defend. Typed-confirm modals; read
  each source command fully before implementing.

Each phase is independently shippable and adds buttons without touching the ones
already live.

---

## 9. Edge cases & guards

- **Stale rank / shifted ladder.** Every mutating step re-reads the sheet and
  re-locates by identity (discordId+element) or re-verifies the rank maps to the
  expected character before writing (pattern from `handleLeaveConfirm`,
  `handleVacationDecision`, `/bench` post-forfeit re-read).
- **Concurrent managers.** Two managers acting on the same target: destructive
  panel actions SHOULD acquire a short Redis lock keyed on the target
  (e.g. `svs:manager:lock:{ladderKey}:{rank}` or `:{discordId}:{element}`, 30s),
  mirroring the signup lock and the matchPanel decision lock, so a double-click or
  two managers don't double-apply. The second caller gets "Another manager is
  already handling that."
- **Mid-challenge vacation/bench.** Forfeit-first (award opponent the win) before
  parking the character, exactly as `handleVacationDecision` and `/bench` do, then
  re-locate the (possibly re-ranked) character.
- **Challenge pair no longer valid.** Cancel/extend verify both rows still point
  at each other (Opp# reciprocity) like `/extendchallenge` does; otherwise reply
  "That pair is no longer in a challenge."
- **Empty candidate lists.** "No characters on that ladder" / "No active
  challenges" / "Extended Vacation is empty" ephemerals, matching the register
  panel's empty-state replies.
- **Interaction expiry / already-acknowledged.** Use the `ephemeral()` helper that
  branches on `deferred || replied` (from `registerPanel.js`).
- **Board refresh is fire-and-forget.** Never `await`-block the reply on a board
  refresh; `refreshDashboard` is debounced and self-logging.
- **Modal-first rule.** `showModal` must be the FIRST response to its interaction
  — do NOT `deferUpdate`/`deferReply` before it (see `handleSignupBuild`). Applies
  to Add Character build→modal and any typed-confirm modals.
- **customId 100-char limit.** `svs:manager:cancel_go:{lk}:{aRank}:{bRank}` etc.
  stay well under 100 chars. Never encode names in customIds (may contain `:` and
  overflow) — encode ranks / row indices and resolve names from a fresh read.

---

## 10. Open questions for the mods

1. **Panel channel.** Create a dedicated manager-only channel for the panel? What
   id? (Fill `SHARED_MANAGER_CHANNEL_ID`.)
2. **Add Character owner-picker.** OK to use a native Discord UserSelect for the
   owner (any guild member), or restrict to **SvS Dueler** holders like
   `/register`'s autocomplete does?
3. **Set Vacation direct vs. approval.** Confirm managers want the panel's Set
   Vacation to apply immediately (bypassing the member request/approve flow). Yes
   is assumed above.
4. **Nullify & Shuffle & New Season ladder scope.** Should Nullify offer "All
   ladders"? Is Shuffle/New Season per-ladder or global? (Read the commands to
   confirm; may affect whether a ladder select is shown.)
5. **Which buttons make v1?** Recommend Phases 0–2 (everything except
   Shuffle/New Season/Title-Defend) for the first ship.

---

## 11. Summary

- New shared, static, manager-only dashboard panel (`DASHBOARD_PANELS.MANAGER`),
  wired through the existing dashboard hydration + `svs:manager:*` router scheme.
- New `interactions/managerPanel.js` with a single role gate and per-action
  handlers following the register/match panel patterns (ladder select → picker →
  confirm → shared service).
- **13 recommended buttons** in 4 rows: Add / Remove (roster); Bench / Insert /
  Set Vacation; Cancel / Extend / Dodge / Nullify (challenge admin); Shuffle /
  New Season / Title-Defend / Refresh Boards (maintenance).
- The real work is **extracting six shared services** (§7) so each behavior has
  one code path used by both the slash command and the button. Everything else
  (removal, registration, status flips, forfeits, Redis, threads, board refresh)
  is already shared and reused as-is.
- Phased so each drop is independently shippable and never disturbs the existing
  slash commands or panels.
