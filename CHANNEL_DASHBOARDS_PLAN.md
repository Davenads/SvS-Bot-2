# Persistent Channel Dashboards — Plan / Proposal (v3)

**Status:** DRAFT / PROPOSAL — nothing implemented yet. Planning + open questions only.
**Author context:** Feature requested via phone screenshots of a bot named
**"SvS LLD League Bot"** (a *different developer's* codebase) showing persistent,
button-driven channel panels. We are building **our own iteration** of these panels
inside `SvS-Bot-2` — not porting that bot.
**Related:** builds on the ladder-aware foundation in `SEASON_AND_LLD_LADDER_PLAN.md`
(per-ladder config in `config/ladders.js`, Redis namespacing, channel inference).

> **v2 changes (from the requester's answers):**
> - **Q0 RESOLVED:** greenfield build in `SvS-Bot-2`; no port.
> - Buttons and slash commands **coexist** (both live side by side).
> - **No manager approval queue** — sign-up is *self-serve*, gated only by the
>   validation rule "**1 character of each element per ladder per user**"
>   (up to 3/ladder, 6 total across HLD+LLD). Old §6 approval subsystem removed.
> - **#rankings** shows the existing **`/leaderboard` embed** + a hyperlink to the
>   Google Sheet — **not** a generated image card.
> - Vacation buttons follow **"the same logic that exists currently"** (see §5.1 /
>   open question on self-serve vs manager-gated).
> - Multi-character users pick a character via a **select menu**.
> - **NEW:** an explicit **channel-topology review + recommendation** (§2) — 6
>   channels (a category per format) vs 3 shared channels with an LLD/HLD selector.
> - Documented the **multi-step sign-up flow** (Element → Build → Name+Notes modal),
>   with an optional preceding LLD/HLD select step if the shared-channel route wins.
>
> **v3 changes (requester's topology + vacation answers):**
> - **Topology RESOLVED → 4 channels:** split `#rankings` per format; **shared**
>   `#register` and **shared** `#issue-a-challenge` (format picked inside each wizard).
> - **Extended Vacation stays manager-only:** the two Extended-Vacation buttons now
>   **DM the managers** with the request instead of self-serving (`/bench`/`/insert`
>   remain manager commands). Regular Vacation stays self-serve.
> - Sign-up flow gains a required **Step 0 LLD/HLD select** (shared register channel).
> - Open flag: the shared challenge channel breaks *slash-command* channel→ladder
>   inference — needs a routing decision (§10 #2).
>
> **v4 changes (all remaining open questions answered + channel IDs in):**
> - DM target for Extended-Vacation requests = **every member with the `SvS Manager`
>   role** (§5.1, §10 #3).
> - **Leave Ladder** = full removal; a normal user removes their own character, a
>   **manager may remove any** character on the ladder (§5.1, §10 #10).
> - **Return from Extended Vacation** = a manager runs `/insert` (existing placement) —
>   no new placement rules (§10 #4).
> - **Rankings** persistent board shows the leaderboard's **Top 10 (page 1)** + sheet
>   hyperlink; a **View full ladder** button opens an **ephemeral paginated** view,
>   **10 players/page** (reuses `/leaderboard`'s First/Prev/Next/Last collector). A
>   shared persistent message can't be user-paginated, so full paging is ephemeral
>   (§5.2, §10 #6).
> - **Sheet links** provided (single spreadsheet, per-tab `#gid=`): HLD `#gid=0`,
>   LLD `#gid=1724011514` (§7, §10 #5).
> - **Refresh cadence:** event-driven per mutation (debounced ~2–3s) + a **10-min**
>   safety sweep; Active Challenges also refresh on the existing keyspace expiry event
>   (§8, §10 #7).
> - **Element/build options:** elements Fire/Cold/Light; builds **Vita / ES** (same for
>   both ladders) (§6, §10 #9).
> - **Spec emoji canon (D):** **Vita = 🟠 (orange)**, **ES = 🔵 (blue)** — this CHANGES
>   the current code (Vita is ❤️ today; ES is 🟠/🔵 inconsistently). Affects the register
>   wizard **and** existing challenge/reportwin/expiry embeds (§7, §10 #12).
> - **`SvS Dueler` role (C):** the bot never grants/removes it (no `roles.add` anywhere);
>   it's a manually-assigned prerequisite. Sign Up requires the clicker to already hold
>   it; Leave does not strip it (§5.1, §9, §10 #11).
> - Challenge **announcement embeds** post to the existing `#challenges` / `#challenges-lld`
>   (where expiry embeds already go), keeping `#issue-a-challenge` = button + 2 boards
>   only (§5.3, §7.1).

---

## 1. Goal

Give each format a set of **three dashboard channels** hosting **persistent,
self-updating bot messages** ("dashboards" / "control panels"):

1. **`#register`** — a control panel with buttons for player self-service:
   Sign Up, Leave Ladder, Request Vacation, Return from Vacation,
   Request Extended Vacation, Return from Extended Vacation.
2. **`#rankings`** (read-only) — an always-current leaderboard (the existing
   `/leaderboard` embed) plus a hyperlink to the full Google Sheet. Edited in place.
3. **`#issue-a-challenge`** — an **Issue a Challenge** button plus an always-current
   **Active Challenges** list.

The panels replace "type a slash command and read the response" with "click a button;
the shared board is always live" — far friendlier on mobile. **Slash commands stay**;
buttons are an additive surface.

### What the reference screenshots show
- **#register** — one embed titled *"Join the Ladder"* + 6 buttons
  (Sign Up = blurple, Leave Ladder = red, Request Vacation = grey,
  Return from Vacation = green, Request Extended Vacation = grey,
  Return from Extended Vacation = green).
  *(The reference bot's "a manager reviews every request" copy does NOT apply — we
  are self-serve; see §6.)*
- **#rankings** — embed with a hyperlink *"Open the full ladder in Google Sheets"*
  and a live Top-N list. Message is **edited in place** (shows *"(edited)"* + update
  stamp). We render this with the **`/leaderboard` embed**, not an image card.
- **#issue-a-challenge** — an *"Issue a Challenge"* embed + a single **Challenge**
  button (red), and a separate persistent **"⚔️ Active Challenges"** embed listing
  `Name (element, rank N) vs Name (element, rank N) — expires in X days — <short id>`.
- **Sign-up multi-step flow** (three additional screenshots):
  - **Step 1/3 — Element select:** *"Choose your element"* (Cold / Fire / Light).
  - **Step 2/3 — Build select:** *"element set to ❄️ Cold. Which build?"* (spec).
  - **Step 3/3 — modal:** *"Character name — What's this character's name?"*
    (required text input). **We add a Notes field beside/after the name input.**

---

## 2. Channel topology — review + recommendation (requested)

The requester is undecided between:

- **Option A — Six channels (a category per format):** `HLD ▸ #register / #rankings /
  #issue-a-challenge` and `LLD ▸ #register / #rankings / #issue-a-challenge`. Each
  channel/panel is single-format.
- **Option B — Three shared channels + an in-panel LLD/HLD selector:** one
  `#register`, one `#rankings`, one `#issue-a-challenge`, each serving both formats
  with a toggle/selector.

### 2.1 Tradeoffs

| Dimension | A. Six channels (category/format) | B. Three shared + selector |
|---|---|---|
| **Read-only boards (rankings, active challenges)** | Each channel shows exactly one ladder's live board — clean, always-correct, no per-viewer state. | A *persistent shared message is single-state*: it can only show one ladder at a time. To serve both you must **stack both ladders in one embed** (noisy) or use **per-viewer ephemeral toggles** (defeats the "always-live shared board" goal — an ephemeral is private, not persistent). |
| **Channel→ladder inference** | Preserved. `#issue-a-challenge` per format *is* the existing `challengeChannelId`; `/challenge`, `/reportwin`, expiry routing keep working unchanged. | **Breaks** current inference: a single shared challenge channel maps to *both* ladders, so `getLadderFromChannel` can't disambiguate. Every challenge/report/expiry path would need an explicit ladder arg or a per-message ladder tag — a wider blast radius. |
| **Sign-up / challenge write flows** | Ladder implied by channel; the multi-step flow starts at Element select. | Needs an **extra leading LLD/HLD select step** on every write flow; `customId` must always carry the ladder key (we do this anyway). |
| **Mobile clarity** | Two categories to scroll; each is unambiguous. | Fewer channels; but users must remember to pick the right format, and mis-picks are easy. |
| **Discord clutter / admin** | 6 channels + 2 categories to create & permission. | 3 channels, simpler tree. |
| **Refresh engine** | One board per (ladder, panel) = 6 boards. Simple. | Shared boards must re-render on *either* ladder's mutation; stacked content or toggle state complicates debounce. |
| **Consistency with existing design** | Matches `config/ladders.js` (per-ladder `challengeChannelId`) and everything already shipped. | Diverges; requires reworking channel inference that Phase-1/LLD work depends on. |

### 2.2 DECISION (chosen topology — 4 channels)

The requester chose a **4-channel hybrid** (a variant of the fallback below):

| Channel | Scope | Format handling |
|---|---|---|
| `#rankings` (HLD) | HLD only | Dedicated |
| `#rankings` (LLD) | LLD only | Dedicated |
| `#register` (shared) | Both | **Format chosen inside each button's wizard** (a leading LLD/HLD select step) |
| `#issue-a-challenge` (shared) | Both | **Format chosen inside the Challenge wizard** |

Rationale it holds up:
- **Rankings stay split** — the two *read-only* rankings boards are each single-format,
  so each persistent `/leaderboard` embed is single-state and always correct (no
  stacking, no ephemeral toggles).
- **Register + Challenge are shared** — both are *write* flows that were going to carry
  an explicit ladder pick anyway, so a leading LLD/HLD select step is natural and the
  `customId` carries the ladder key from step one.

**One tradeoff this creates — the shared `#issue-a-challenge` channel (§5.3, Risk #2):**
`/challenge`, `/reportwin`, `/cancelchallenge`, `/extendchallenge`, `/nullchallenges`
and the expiry handler currently infer the ladder **from the channel** (each ladder's
`challengeChannelId`). A single shared challenge channel is ambiguous for those *slash*
paths — in it, `getLadderFromChannel` can't tell HLD from LLD and would fall back to
the HLD default (wrong for LLD players). The button flow is fine (its wizard carries
the ladder), but we must decide how the slash commands behave. See open Q §10 #2.

Note the two **existing** dedicated challenge channels already configured in
`config/ladders.js` (`main` → `1330563945341390959`, `lld` → `1547283140995719258`)
— we need to decide whether they remain (for slash-command inference) or are retired in
favor of the single shared dashboard channel. See §10 #2.

Either way, **the `customId` always carries the ladder key**, so button routing never
depends on a channel lookup.

---

## 3. Current architecture (what we're extending)

- **`index.js`** loads every file in `commands/` into `client.commands` and handles
  `interactionCreate` for **only** `isCommand()` and `isAutocomplete()`. There is
  **no** `isButton()` / `isModalSubmit()` / `isStringSelectMenu()` path yet — this
  feature must add one.
- **`client.once('ready')`** starts the challenge-expiry handler and an **hourly**
  `runSafetyCheck`. This is the natural hook for **dashboard hydration + a periodic
  safety refresh** (mirror the existing event-driven + safety-net pattern).
- **`challenge-expiry-handler.js`** is the model to copy: event-driven updates via
  Redis keyspace events, backstopped by a timed safety sweep.
- **`config/ladders.js`** already holds per-ladder `challengeChannelId`,
  `sheetName`, `metricsTab`, `redisPrefix`, etc. — the right home for the new
  channel IDs and the sheet URL.
- **Intents** (`Guilds, GuildMembers, GuildMessages, MessageContent`) are already
  sufficient; button/modal interactions arrive over the gateway regardless.
- **Role gate:** slash commands require `SvS Dueler` (except `/talrasha`). Buttons
  will need their **own** equivalent gate since they bypass the command path.
- **`/register` today** is manager-only + instant, writes a full ladder row A→K with
  batchUpdate formatting (element background color, bold name, data-validation copy).
  The self-serve Sign Up button reuses this exact row-write + formatting logic, minus
  the manager gate, plus the validation rule in §6.
- **`/signup` today** is just an info embed stating the "1 character per element" rule.
  It has **no channel gate and no writes** — it can be run anywhere. Real signups are a
  social convention: players *post a text message* in `#svs-signups`, then a **manager**
  runs `/register`.
- **`/bench` + `/insert` today** move players to/from the Extended Vacation tab and are
  **manager-only**. There is currently **no self-serve regular-vacation command**.

### 3.1 Current ladder-gating reality (code-confirmed — drives §5.3 / §10 #2)
Two different mechanisms select the ladder today, and this is exactly why the shared
challenge channel is the only friction point:

| Command family | How ladder is chosen | Channel-gated? |
|---|---|---|
| Challenge family (`/challenge`, `/reportwin`, `/cancelchallenge`, `/extendchallenge`, `/nullchallenges`, `/currentchallenges`) | **`getLadderFromChannel(channelId)`** — matches the channel against each ladder's `challengeChannelId` | **Yes.** `/challenge` hard-rejects outside a challenge channel (*"This command can only be used in a challenge channel."*). The channel does double duty: gate **and** ladder selector. |
| Register / everything else (`/register`, `/leaderboard`, `/stats`, `/titledefends`, …) | **`getLadderFromOption(interaction)`** — a `ladder` option defaulting to HLD | **No.** Runs in any channel; `/register` is manager-gated by role, not by channel. |

Implication for the chosen topology:
- **Sharing `#register` is trivially safe** — the slash path never used the channel, so a
  shared register channel changes nothing for `/register`.
- **Sharing `#issue-a-challenge` is the sole friction** — `getLadderFromChannel` returns
  `null` in a channel that isn't a configured `challengeChannelId`, so the slash
  challenge family can't run / can't disambiguate there. Resolved by §10 #2 option (a):
  keep the two dedicated challenge channels for the slash commands; the shared dashboard
  channel hosts only the button (ladder in `customId`) + the two Active Challenges boards.

---

## 4. Proposed architecture

### 4.1 Persistent-message model ("post once, edit forever")
Each dashboard is a **single message** the bot owns. The bot must remember the
`(channelId, messageId)` so it can `messages.edit()` instead of reposting. On any
refresh it edits; it only (re)posts if the stored message is missing/deleted.

**Message registry (durability is mandatory — survives restarts and Redis flush):**
- **Primary store:** a hidden Google Sheet tab **`Dashboards`** with columns
  `Ladder | Panel | Channel ID | Message ID | Last Updated`. Durable, human-visible,
  survives a Redis wipe (consistent with the "sheet is canonical" choice we made for
  the season pointer).
- **Cache:** Redis keys `svs:dashboard:{prefix}:{panel}:msg` for fast reads.
- Panels: `register`, `rankings`, `challenges`.

### 4.2 Startup hydration
On `ready`, for each ladder × panel:
1. Read the registry (sheet → Redis).
2. `channel.messages.fetch(messageId)` to confirm it still exists.
3. If missing → repost, write the new message ID back to registry.
4. Render current content and edit once (so a restart always reconciles state).

### 4.3 Refresh engine
A central `refreshDashboard(ladder, panel)` + `refreshAll(ladder)`:
- **Event-driven triggers** — after any ladder mutation: register/signup, remove,
  reportwin, challenge, cancelchallenge, extendchallenge, nullchallenges, shuffle,
  bench, insert, vacation on/off. Each mutating command calls `refreshAll(ladder)`
  (or the specific affected panel) at the end.
- **Periodic safety refresh** — a timer (e.g., every 5–10 min) re-renders rankings +
  active challenges so drift/edits/manual deletions self-heal.
- **Debounce/queue** — coalesce bursts (a shuffle touches many rows) into one edit
  per panel per ~2–3s window to stay well under Discord's edit rate limits.
- **Isolation** — refreshes are per-ladder; an HLD change never edits LLD boards.

### 4.4 Interaction routing (new in `index.js`)
Add branches for `isButton()`, `isModalSubmit()`, `isStringSelectMenu()`. Route by a
**namespaced `customId`**:

```
svs:{panel}:{action}:{ladderKey}[:{extra}]
e.g. svs:register:signup:lld
     svs:register:vac_request:main
     svs:register:signup_elem:lld:cold      (step 1 → element chosen)
     svs:register:signup_build:lld:cold:vita (step 2 → build chosen)
     svs:challenge:new:lld
     svs:register:charpick:main:<rowRef>     (multi-char select)
```

Parse `customId` → `{ panel, action, ladderKey, extra[] }`, resolve the ladder via the
existing `getLadderByKey`, and dispatch to a handler module (e.g.
`interactions/registerPanel.js`, `interactions/challengePanel.js`). Keeps `index.js`
thin and mirrors the existing `commands/` loader style. **Ladder is inferred from the
`customId`, not the channel** (robust even if channels are renamed/merged — and this
is what makes the shared-channel Option B possible at all).

### 4.5 Reusing existing command logic
The button flows should call the **same underlying sheet/Redis helpers** the slash
commands use, not duplicate them. Ideal refactor: extract the core of `register`,
`challenge`, vacation, etc. into shared service functions that **both** the slash
command and the button handler invoke. (If we don't refactor, we risk two divergent
copies of the ladder rules — see Risks.)

---

## 5. Panel specifications

### 5.1 `#register` — control panel
Persistent embed + 6 buttons (as in the screenshot). Behaviors:

| Button | Flow | Gate |
|---|---|---|
| **Sign Up** | Multi-step self-serve flow (§6). Validates the "1 char per element per ladder" rule, then writes the ladder row + formatting (reuses `/register` core, no manager gate). | **Must already hold `SvS Dueler`** (re-checked in-handler). Bot does **not** grant the role — no `roles.add` exists in the codebase. |
| **Leave Ladder** | Confirm → **full removal** from the ladder (mirrors the existing `/remove` re-rank + "Farewell from the Ladder!" flow). **Normal user:** removes their *own* character (multi-char → pick which of own). **Manager:** may select **any** character on the ladder. | Self for normal users; managers unrestricted |
| **Request Vacation** | Sets the caller's char status = Vacation. | Self; must be registered |
| **Return from Vacation** | Clears Vacation status. | Self |
| **Request Extended Vacation** | **Does NOT self-serve.** Sends a **DM to the SvS Managers** with the caller's character + request; a manager then runs `/bench`. Caller gets an ephemeral "request sent." | Manager performs the actual `/bench` |
| **Return from Extended Vacation** | Same pattern — **DMs the managers** to request restoration; a manager runs `/insert`. | Manager performs the actual `/insert` |

**RESOLVED (requester):** `/bench` + `/insert` stay **manager-only**. A non-manager
clicking the two Extended-Vacation buttons **triggers a DM to the managers** informing
them of the request — it does **not** move the character itself. Regular Vacation
(status flag) remains self-serve.

*Design note (RESOLVED §10 #3):* "DM the managers" = DM **every member holding the
`SvS Manager` role** (fetch the role's members and DM each). No separate notify
channel/list.

Multi-character handling: when the caller owns >1 character on the ladder, the button
first presents a **select menu of their characters** (`svs:register:charpick:…`) and
the chosen row drives the action.

### 5.2 `#rankings` — read-only live board (one per format)
- Read-only channel (locked to @everyone send; bot posts/edits only).
- **Persistent board = the `/leaderboard` embed's Top 10 (page 1)** — the existing
  renderer already breaks pages at 10 fields — + a **hyperlink to the ladder's Google
  Sheet tab** (§7).
- **Pagination (RESOLVED §10 #6 — 10/page):** a shared persistent message is
  single-state, so it can't be *user*-paginated (one viewer's "Next" would change the
  board for everyone, and `/leaderboard`'s paging is a 60-second per-interaction
  collector). Resolution: the persistent board carries a **"View full ladder"** button
  that opens an **ephemeral, per-viewer paginated** leaderboard — **10 players/page**,
  reusing `/leaderboard`'s First/Prev/Next/Last collector. Each viewer pages their own
  private copy; the shared board stays fixed at Top 10.
- Refresh: on every rank-changing mutation + the periodic safety sweep (§8).

### 5.3 `#issue-a-challenge` — challenge panel (SHARED across both formats)
- Persistent **"Issue a Challenge"** embed + **Challenge** button.
- Clicking **Challenge** first presents an **LLD/HLD select** (since the channel is
  shared), then the challenge flow (validate caller is registered on that ladder →
  choose an in-reach opponent within jump rules → create challenge). Button-equivalent
  of `/challenge`; enforces the **same** jump rules (`top10MaxJump` / `regularMaxJump`
  / `top10Threshold`) and Redis cooldown checks. The chosen ladder rides in the
  `customId` for every subsequent step.
- **Two** persistent **"Active Challenges"** boards in this one channel — one titled
  *HLD Active Challenges*, one *LLD Active Challenges* — since a single persistent
  message is single-state. Each auto-updates with its ladder's open challenges
  (elements, ranks, expiry countdown, short id).
- **Challenge announcement embeds do NOT post here (RESOLVED §7.1).** When a challenge
  is issued, the "⚔️ New Challenge Initiated!" embed posts to the **existing per-format
  channel** — `#challenges` (HLD) or `#challenges-lld` (LLD) — exactly where the expiry
  handler already posts warnings/nullifications. This keeps `#issue-a-challenge` a
  **quiet** channel holding only `[Challenge button + HLD board + LLD board]`, so the
  boards never get buried.
- **Ladder inference caveat (see §2.2 / §10 #2):** this shared channel is *not* one of
  the per-ladder `challengeChannelId`s, so the *slash* challenge family stays in
  `#challenges` / `#challenges-lld`. Button routing is safe (ladder in `customId`).
- Interplay: `/reportwin`, `/cancelchallenge`, `/extendchallenge`, `/nullchallenges`
  all mutate challenges → each must trigger the correct ladder's `challenges` board
  refresh. Expiry auto-null (already event-driven) must also refresh.

---

## 6. Sign-up flow (self-serve — no approval queue)

Per the requester: **no manager approval.** Players sign up directly, bounded only by
the rules. Because `#register` is the **shared** channel, the flow begins with a format
pick:

1. Click **Sign Up**. Handler first re-checks the clicker holds **`SvS Dueler`** (the
   bot never grants it — §5.1/§9); non-holders get an ephemeral explaining how to get it.
2. **Step 0 — LLD/HLD select** (`svs:register:signup_fmt`): required (shared channel);
   the chosen ladder key rides in every later `customId`.
3. **Step 1/3 — Element select** (`svs:register:signup_elem:{ladder}`): Cold / Fire /
   Light.
4. **Step 2/3 — Build select** (`svs:register:signup_build:{ladder}:{element}`): the
   two spec options **Vita 🟠** / **ES 🔵** (same for both ladders; canonical emoji per
   §10 #12), with the confirming copy *"element set to ❄️ Cold. Which build?"*.
5. **Step 3/3 — Modal** (`showModal` off the select interaction): **Character Name
   (required)** + **Notes (optional)** text inputs.
6. **Validation (the only gate):** enforce **one character per element per ladder per
   user** — i.e. a user may hold at most Cold+Fire+Light (3) per ladder, 6 across
   HLD+LLD. If the caller already has a character of the chosen element on that ladder,
   reject with an ephemeral explaining the rule.
7. On success: assign next rank, write the ladder row A→K, apply the element-color /
   bold-name / data-validation formatting (reuse `/register` core), then
   `refreshAll(ladder)` so `#rankings` updates.

**Idempotency:** guard against double-submits (Redis short-lived lock keyed by
`{prefix}:{discordId}:{element}` during the write). The clicker's **own** Discord ID is
used as the row's Discord ID.

> Modal note: `showModal` is valid off a **button or a select-menu** interaction, so
> the Step 2 build-select → Step 3 modal transition is supported by Discord.

---

## 7. Data-model changes

- **`config/ladders.js`** — for the chosen 4-channel topology (IDs provided so far):
  ```
  // Per-ladder rankings (split):
  main.rankingsChannelId = '1330563876281913424'   // #hld-rankings
  main.sheetUrl = 'https://docs.google.com/spreadsheets/d/1Ay8YGTGk1vUSTpD2DteeWeUxXlTCLdtvB-uFKDWIYEU/edit#gid=0'
  lld.rankingsChannelId  = '1553185338556420136'   // #lld-rankings
  lld.sheetUrl  = 'https://docs.google.com/spreadsheets/d/1Ay8YGTGk1vUSTpD2DteeWeUxXlTCLdtvB-uFKDWIYEU/edit#gid=1724011514'

  // Shared (not per-ladder) — module-level constants / shared config block:
  SHARED_CHALLENGE_CHANNEL_ID = '1553197193849081977'  // #issue-a-challenge (NEW, button + boards)
  SHARED_REGISTER_CHANNEL_ID  = '1553201835026681976'  // #register (NEW, dedicated bot-only panel)
  ```
  **Existing dedicated challenge channels stay (Path 2 / §10 #2 option a):**
  `main.challengeChannelId = '1330563945341390959'` (#challenges),
  `lld.challengeChannelId  = '1547283140995719258'` (#challenges-lld) — these keep
  serving the *slash* challenge family's channel inference. The new
  `#issue-a-challenge` hosts only the dashboard button + the two Active Challenges
  boards.
  **`#svs-signups` (`1331293585227776080`) is NOT the register panel host** — it is
  too chatty (human text + per-registration confirmation embeds bury a persistent
  panel). The Register panel needs its **own dedicated bot-only channel** (see §7.1).
- **New sheet tab `Dashboards`** — message registry (§4.1).
- **Redis keys** — `svs:dashboard:{prefix}:{panel}:msg`; short-lived sign-up lock. All
  namespaced by existing `redisPrefix`.
- **New modules** — `dashboards/` (render + refresh engine), `interactions/`
  (button/modal/select handlers). No changes to the `commands/` loader contract.
- **No `Pending Registrations` tab** — approval queue removed.
- **Spec-emoji standardization (§10 #12)** — set **Vita 🟠 / ES 🔵** as canon. Files
  carrying the spec emoji map today: `register.js` (`ES:'🔵'`, Vita `❤️`),
  `challenge.js`, `reportwin.js`, `challenge-expiry-handler.js` (all `ES:'🟠'`, Vita
  `❤️`), plus any spec emoji in `stats.js` / challenge-listing commands. Update these at
  build time so the wizard and existing embeds agree.

### 7.1 Persistent panels require QUIET channels (clutter review)
A persistent dashboard is a single bottom-of-channel message the bot edits in place;
it only stays tap-able if **nothing else posts in that channel**. Consequences:
- **Register panel → dedicated bot-only channel** — created: `#register`
  (`1553201835026681976`). Do **not** reuse `#svs-signups`: it carries human "sign me up"
  text and a `New Character Registered!` embed per signup, both of which would bury the
  panel.
- **Signup confirmation → ephemeral.** The self-serve success message is shown only to
  the registrant, so the panel channel stays pristine. Public "new player" visibility
  comes from the `#rankings` board auto-refresh; optional audit log to `#svs-signups`
  or a `#svs-log`.
- **`#svs-signups`** reverts to legacy/social use (or is retired) — not a dashboard host.
- **`#issue-a-challenge` — RESOLVED:** the "New Challenge Initiated!" announcement is
  routed to the **existing per-format channel** (`#challenges` / `#challenges-lld`),
  matching where the expiry handler already posts. `#issue-a-challenge` therefore holds
  only `[Challenge button + HLD board + LLD board]` and never gets buried.
- **Rankings channels** are already read-only (bot-only) — no clutter risk.

---

## 8. Rate limits, concurrency, failure modes

- **Edit rate limits:** up to 6 persistent messages, potentially many rapid mutations
  (shuffle). Debounce per panel; batch a burst into a single edit. Global safety timer
  must not stampede all boards at once — stagger.
- **Double-clicks / race:** defer button interactions immediately
  (`deferUpdate` / ephemeral defer); guard state transitions (e.g., can't Request
  Vacation twice). Use Redis locks where a flow mutates the sheet (esp. sign-up).
- **Message deleted / channel purged:** hydration + safety sweep repost and rewrite the
  registry. Never crash if `messages.fetch` 404s.
- **Sheet vs board drift:** the sheet stays canonical; boards are a projection. A failed
  edit is logged and retried on the next sweep — never blocks a sheet write.
- **Partial outage:** if a Discord edit fails but the sheet write succeeded, the action
  still "counts"; the board reconciles later. Order writes sheet-first, board-second.

---

## 9. Security / permissions

- **Button auth:** re-check `SvS Dueler` (or the chosen role) inside each handler — the
  `index.js` command-level gate does **not** cover buttons.
- **`SvS Dueler` is a manual prerequisite** — the bot never assigns/removes it (no
  `roles.add`/`roles.remove` in the codebase). Sign Up requires the clicker to already
  hold it; Leave Ladder does not strip it.
- **Extended-Vacation buttons DM every `SvS Manager`** (no self-serve mutation); the
  actual `/bench` / `/insert` stay manager slash commands.
- **#rankings** locked so only the bot posts; players read.
- **Ownership checks:** vacation/leave buttons act only on the caller's own
  character(s); never let a click mutate another player's row.
- **Sign-up rule enforcement** is the sole gate on new characters (no manager review).

---

## 10. Open questions (consolidated)

1. **Topology — RESOLVED:** 4 channels — split `#rankings` per format, shared
   `#register`, shared `#issue-a-challenge` (§2.2).
2. **Shared challenge channel vs slash inference — RESOLVED (Path 2 / option a):** the
   requester **created a new `#issue-a-challenge`** (`1553197193849081977`) for the
   dashboard button + Active Challenges boards; the two existing dedicated challenge
   channels (`#challenges` `1330563945341390959`, `#challenges-lld`
   `1547283140995719258`) **stay** for the slash challenge family's channel inference.
   **All channel IDs now provided** — #register `1553201835026681976`, #hld-rankings
   `1330563876281913424`, #lld-rankings `1553185338556420136`, #issue-a-challenge
   `1553197193849081977`. Channel map is complete.
3. **Manager DM target — RESOLVED:** DM **every member holding the `SvS Manager`
   role** (fetch role members, DM each). No notify channel/list.
4. **Return-from-Extended-Vacation placement — RESOLVED:** handled by the existing
   **`/insert`** command "for now" — a manager runs it; no new placement rules.
5. **Sheet URLs — RESOLVED:** one spreadsheet, per-tab `#gid=` anchors —
   HLD `…/edit#gid=0`, LLD `…/edit#gid=1724011514` (see §7). *How to grab a tab link:*
   open the tab, then either copy the browser URL (its `#gid=…` = that tab) or
   right-click the tab at the bottom → **Copy link to this sheet**.
6. **Rankings depth — RESOLVED:** persistent board = Top 10 (leaderboard page 1) + a
   **View full ladder** button → **ephemeral paginated, 10/page** (§5.2). Full paging
   must be ephemeral because a shared persistent message is single-state.
7. **Refresh cadence — RESOLVED (recommendation):** mirror the existing event-driven +
   safety-net pattern. **Event-driven:** every mutating command calls
   `refreshDashboard(ladder, panel)`, debounced ~2–3s. **Safety sweep:** re-render
   rankings + active-challenges **every 10 minutes** (staggered) to catch manual sheet
   edits / missed events. Active Challenges also refresh on the existing
   `__keyevent@0__:expired` keyspace event (already wired). At ~30–60 active players
   this is a few board edits per sweep — negligible vs Discord's edit limits.
8. **Persistence store — EXPLAINED + RESOLVED:** the bot must remember *which message*
   is each dashboard so it **edits that message instead of posting a new one** every
   refresh (otherwise a restart would spam duplicate panels). Proposal: store each
   panel's `(channelId, messageId)` in a hidden **`Dashboards`** tab on the *same*
   spreadsheet (durable — survives restarts / Redis flush) + a Redis cache for fast
   reads. One extra hidden tab; no schema change to ladder rows. Confirmed OK.
9. **Element/build options — RESOLVED:** elements **Fire / Cold / Light**; builds
   **Vita / ES** — same for both ladders.
10. **Leave Ladder scope — RESOLVED:** full removal; a normal user removes their own
    character, a **manager may remove any** character (§5.1).
11. **`SvS Dueler` role — RESOLVED:** manual-only prerequisite; the bot never grants or
    removes it. Sign Up requires it; Leave doesn't strip it (§5.1, §9).
12. **Spec emoji canon — RESOLVED, note code impact:** **Vita = 🟠 (orange)**,
    **ES = 🔵 (blue)**. Differs from the code today (Vita is ❤️ everywhere; ES is 🔵 in
    `register.js` but 🟠 in `challenge.js` / `reportwin.js` /
    `challenge-expiry-handler.js`). Standardizing changes **both** the new register
    wizard **and** those existing embeds — apply during implementation (see the §7
    spec-emoji bullet).

---

## 11. Suggested phasing

- **Phase A — Infra:** interaction router in `index.js`; `Dashboards` registry
  (sheet+Redis); startup hydration; `refreshDashboard` engine + debounce; config
  channel IDs + sheet URLs.
- **Phase B — #rankings (read-only):** lowest risk, no writes. Reuse `/leaderboard`
  embed + sheet link, live refresh on mutations. Proves the persistence/refresh
  pipeline.
- **Phase C — #issue-a-challenge:** Challenge button (reuse challenge service) + Active
  Challenges board; wire refreshes into all challenge mutations + expiry.
- **Phase D — #register writes:** Leave, Vacation, Return buttons calling shared
  services (Extended-Vacation buttons gated per §10 #3).
- **Phase E — Self-serve Sign Up:** the multi-step Element → Build → Name+Notes flow +
  the "1 char per element per ladder" validation (§6).
- **Phase F — Polish:** copy, "view full ladder" button, screenshots.

Each phase deploys to `TEST_GUILD_ID` first, then live.

---

## 12. Risks

| # | Risk | Sev | Mitigation |
|---|------|-----|-----------|
| 1 | Duplicated ladder rules between slash + button paths drift apart | High | Extract shared service functions; both callers use them |
| 2 | Shared-channel topology (B) breaks channel→ladder inference | High | Recommend Option A; if B, thread explicit ladder arg everywhere |
| 3 | Edit rate-limit throttling on bursts (shuffle) | Med | Debounce/queue per panel; batch |
| 4 | Lost message IDs after restart / Redis flush | Med | Durable `Dashboards` sheet tab + hydration reconcile |
| 5 | Duplicate/double sign-up | Med | Redis lock + per-element rule check |
| 6 | Button auth bypass (no command-level role gate) | Med | Re-check roles in every handler |
| 7 | Cross-ladder bleed in refresh | Low | Ladder key in `customId`; per-ladder refresh |
| 8 | Extended-Vacation self-serve exposes manager-only behavior unintentionally | Med | Resolve §10 #3 before Phase D |

---

## 13. Non-goals (v1)
- No change to the underlying Google-Sheet schema for ladder rows.
- No manager approval queue (explicitly dropped).
- No generated image ranking card (use the `/leaderboard` embed).
- No replacement of the season/`Season Champions` system (already shipped).
- No web dashboard — Discord-native only.
