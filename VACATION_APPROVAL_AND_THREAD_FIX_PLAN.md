# Vacation Approval + Challenge-Forfeit + Thread Membership — Plan

Three related requests from the SvS mods, planned as separate workstreams so
they can ship independently:

- **A. Thread membership bug** — challenge threads add ~80% of SvS Managers
  (some are missed). Switch to adding/pinging the **SvS Manager role**, and fix
  the underlying member-lookup bug.
- **B. Vacation becomes request + approval** — revert the instant self-serve
  vacation to a **"Request Vacation → a manager approves"** model (undoes the
  `Go on Vacation` rename from `0d804ba`).
- **C. Forfeit on vacation-while-in-challenge** — if a player goes on vacation
  while in an active challenge, **award the opponent the win**.

Nothing here is implemented yet.

---

## A. Thread membership bug — root cause & fix

### Findings (debugged)

The thread member add lives in `services/challengeThreads.js:105-118`:

```js
const managers = await findManagerMembers(channel.guild);
managers.forEach(m => memberIds.add(m.id));
...
for (const id of memberIds) {
  await thread.members.add(id).catch(...);
}
```

`findManagerMembers` (`utils/managers.js:13-26`) is the culprit:

```js
let members = role.members;
if (!members || members.size === 0) {   // <-- only fetches when FULLY empty
  await guild.members.fetch();
  members = role.members;
}
return [...members.values()].filter(m => !m.user.bot);
```

**Why some managers are missed:** `role.members` is derived from Discord.js's
**guild member cache**, which only contains members Discord has pushed to the
bot (recently active users, users who sent messages, or members explicitly
fetched). It is **not** the authoritative role roster. The guard only forces a
full `guild.members.fetch()` when the cached set is *completely empty*
(`size === 0`). In a live guild the cache is *partially* populated — some
managers are cached, some aren't — so:

1. `role.members` returns a **partial** set (the cached ~80%).
2. `size > 0`, so the empty-guard never fires and the full fetch never runs.
3. The uncached managers are silently dropped, and only the cached subset gets
   added to the thread.

This is a caching bug, not a permissions bug — it's non-deterministic and will
vary by who's been active. **The same bug affects the Extended-Vacation manager
DMs** (`registerPanel.js` → `notifyManagers` → `findManagerMembers`): those DMs
also only reach the cached ~80% of managers.

### Fix

**A1 — Thread: add + ping the role, not enumerated members.**
For a **private thread**, the reliable server-side way to pull in a whole role is
to post a message that **mentions the role** (`<@&roleId>`) with an explicit
`allowedMentions`. Discord resolves role membership server-side and adds every
holder to the private thread — no dependency on the bot's member cache.

- Resolve the role id once: `channel.guild.roles.cache.find(r => r.name === 'SvS Manager')`
  (or add `MANAGER_ROLE_ID` to config to avoid name lookups).
- After creating the thread, send a small mention line:
  `content: '<@&{managerRoleId}> — new challenge, coordinate here.'`
  with `allowedMentions: { roles: [managerRoleId], users: [challengerId, targetId] }`.
- Still add the **two duelers** explicitly via `thread.members.add` (guaranteed
  membership) — or include them in the same mention line.
- Drop the `findManagerMembers` enumeration + per-manager `thread.members.add`
  loop from this path.

Caveats to verify in QA:
- Bot must be allowed to mention the role: either the role is *mentionable*, or
  the bot holds **Mention @everyone, @here, and All Roles**. Passing the role id
  in `allowedMentions.roles` plus that permission is sufficient.
- Discord suppresses auto-add/ping for role mentions on **very large** roles
  (abuse guard). SvS Manager is a small role, so it's within limits — confirm.

**A2 — Harden `findManagerMembers` for the DM path.**
The Extended-Vacation DM flow needs actual member objects (you can't DM a role),
so it still needs a correct enumeration. Fix the guard so it stops trusting the
partial cache:

- Always `await guild.members.fetch()` before reading `role.members` (one API
  call; results are cached afterward), **or** fetch whenever the cached size
  looks suspiciously low. Unconditional fetch is the simplest robust option and
  these events are infrequent.

Files: `services/challengeThreads.js`, `utils/managers.js`, (optional)
`config/ladders.js` for a `MANAGER_ROLE_ID`.

---

## B. Vacation → request + manager approval

Reverts the instant self-serve model. Going on vacation becomes a request that a
manager must approve before any sheet change happens.

### Changes

1. **Label revert** (undo `0d804ba`):
   - `dashboards/render.js:248` — `🌴 Go on Vacation` → `🌴 Request Vacation`.
   - `render.js:226`, `registerPanel.js:10`, `CHANNEL_DASHBOARDS_PLAN.md` — copy back.
2. **`handleVacation('to')` no longer writes the sheet.** Instead it:
   - Validates the caller has an eligible character (see C for the in-challenge
     case).
   - Records a pending request in Redis, e.g.
     `svs:vacation-request:{prefix}:{discordId}-{element}` (TTL ~7 days) to dedupe
     and let the approval handler resolve the character.
   - Notifies managers with **Approve / Deny** controls (reuse the
     `notifyManagers` embed shape from `registerPanel.js:272`).
   - Replies to the caller: "Your vacation request was sent to the SvS Managers."
3. **Approval handler** (new button routes, e.g.
   `svs:register:vacapprove:{ladderKey}:{discordId}:{element}` /
   `vacdeny:...`):
   - Guard: clicker must hold `SvS Manager`.
   - Re-read the sheet (source of truth). If the request/char is gone, report
     "already handled."
   - **Approve** → resolve any active challenge as a forfeit (Workstream C) →
     set status `Vacation` via `setCharacterStatus` → refresh rankings board →
     notify requester (DM or thread) → clear the pending Redis key → disable the
     buttons so a second manager can't double-process.
   - **Deny** → notify requester, clear the pending key, no sheet change.

### Open decisions (B)
- **Approval surface:** DM every manager (matches existing pattern, but "closed
  DMs" gaps and multi-manager double-clicks) **vs.** post one message with
  Approve/Deny buttons in a dedicated mod channel (single source of truth, any
  manager actions it, visible history). **Recommendation: mod-channel post with
  buttons.** Needs a channel id in config.
- **Return from Vacation:** does returning also require approval, or stay
  self-serve? **Recommendation: keep return self-serve** (low risk; a player
  coming back doesn't need gatekeeping). Confirm.
- **Double-processing guard:** the pending Redis key is the lock — first
  Approve/Deny wins and deletes it; later clicks see "already handled."

---

## C. Forfeit when vacationing mid-challenge

If an approved vacation request belongs to a character currently in a challenge,
the opponent is awarded the win before the vacationer is benched to Vacation.

### Behavior
- **Eligibility:** allow requesting vacation while status is `Challenge` (today
  only `Available` chars are eligible). The request embed to managers should
  **warn**: "Approving this forfeits {char}'s active challenge vs {opponent} —
  {opponent} will be awarded the win."
- **On approve, if in a challenge:**
  1. Identify the opponent from the challenger/opponent link — the Opp# column
     (`row[7]`) gives the opponent's rank; re-read the sheet at approval time
     (state may have changed since the request).
  2. Resolve as a win: **winner = opponent, loser = vacationer.** This reuses the
     exact `reportwin` mechanics (rank swap if it was a climb, reset both to
     `Available`, `removeChallenge` in Redis, `setCooldown`, archive the
     coordination thread, refresh both boards, post the result embed).
  3. **Then** set the vacationer's status to `Vacation` (look up their row by
     `discordId + element`, not by rank — a swap may have moved them).
- **If the challenge no longer exists** (opponent already reported, or it
  expired between request and approval): skip the forfeit, just set `Vacation`.

### Prerequisite refactor — extract win resolution
`reportwin.js` currently inlines the entire win-resolution (sheet batchUpdate,
Redis remove/cooldown, thread archive, board refresh, embed) in the command
body (`reportwin.js:96-472`). To avoid duplicating ~200 lines, **extract it into
a shared service** (e.g. `services/matchResult.js` — `resolveMatch(client,
ladder, { winnerRank, loserRank, announceChannel })`), matching the codebase's
existing pattern (`challengeService`, `registrationService`, `removalService`).

- Phase C-0: extract; rewire `/reportwin` to call it — **no behavior change.**
- Phase C-1: the vacation approval handler calls `resolveMatch(...)` for the
  forfeit, then sets Vacation.

### Open decisions (C)
- Should **Extended Vacation** (bench) apply the same forfeit rule? Likely yes
  for consistency — note that `/bench` already removes from the ladder, so decide
  whether bench should also auto-forfeit an active challenge. Flag for the mods.
- Cooldown after a forfeit: `reportwin` sets a cooldown between the two players.
  Confirm mods want a cooldown applied on a forfeit (probably yes).

---

## Phased rollout

| Phase | Scope | Risk | Status |
|---|---|---|---|
| **1** | A1 (thread role mention) + A2 (`findManagerMembers` fetch) | Low — isolated | ✅ done |
| **2** | C-0: extract `resolveMatch`, rewire `/reportwin` (no behavior change) | Low — refactor | ✅ done |
| **3** | B: label revert + request/approval flow + Redis pending key | Medium | ✅ done |
| **4** | C-1: allow Challenge-status requests + forfeit on approve + `/bench` auto-forfeit | Medium | ✅ done |
| **5** | QA pass (extend `PHASE_QA_CHECKLIST.md`) | — | ✅ done |

## QA checklist (add to PHASE_QA_CHECKLIST.md)
- [ ] New challenge thread pings the **role**; **every** manager lands in the
      thread (test with a manager who has never messaged / is uncached).
- [ ] Extended-Vacation DM reaches **all** managers, not a subset.
- [ ] Request Vacation (Available char) → no sheet change; managers get an
      Approve/Deny prompt; requester sees "sent."
- [ ] Approve → status flips to 🌴; board updates; requester notified; second
      manager click shows "already handled."
- [ ] Deny → no change; requester notified.
- [ ] Request Vacation while in a challenge → approval forfeits the challenge
      (opponent wins, ranks swap if climb, thread archived, cooldown set), THEN
      the requester goes to 🌴 Vacation.
- [ ] Challenge already resolved before approval → no double forfeit; just 🌴.
- [ ] `/reportwin` still behaves identically after the `resolveMatch` extraction.

## Risks / notes
- **Role-mention add limits** on large roles — SvS Manager is small; verify.
- **Bot role-mention permission** — ensure "Mention All Roles" or a mentionable
  role; use `allowedMentions.roles`.
- **Double forfeit** — if a manager manually `/reportwin`s and also approves the
  vacation, guard against resolving twice (the pending key + re-read of the live
  challenge state prevents this; approval must re-check the challenge still
  exists right before forfeiting).
- **Rank lookup after swap** — always set the vacationer's Vacation status by
  `discordId + element`, never by the pre-forfeit rank.
- **customIds unchanged** — `svs:register:vacation` still routes; only its
  handler behavior and the button label change, so no panel re-post is required
  (a dashboard refresh re-renders the new label).
