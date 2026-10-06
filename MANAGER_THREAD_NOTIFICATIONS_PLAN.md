# Manager Thread-Notification Overload — Plan

## 1. Problem

Managers are drowning in notifications from challenge coordination threads. A
manager (Alan) asked to be **removed from the SvS Manager role** purely to stop
the pings — he wants to stay a mod, but there is currently no way to see threads
without being pinged for every single one.

Reported by Lpc (relaying Alan) and Shreve:

> **Lpc:** "Alan asked to be removed as svs mod due to all the notifications for
> challenge threads. He doesn't want to be dropped as mod, but too many
> notifications and we can't silence them. Is there any other option where we
> can see threads without all the pings?"
>
> **Shreve:** "can we just have it add me, lpc, and gemmd to the threads
> specifically since we are handling the responsibilities atm?"

## 2. Root cause (grounded in code)

`services/challengeThreads.js → createChallengeThread()` fired **two separate
notifications to every SvS Manager on every challenge thread created**:

1. **Auto-add to the private thread** (lines ~140-153): the code called
   `findManagerMembers(guild)` (every non-bot holder of the `SvS Manager` role)
   and ran `thread.members.add(id)` for each. Adding a member to a **private**
   thread is the only way to grant them visibility — and it triggers a Discord
   "you were added to a thread" notification. There is no bot-side
   add-without-notify for private threads.

2. **Role mention in the pinned message** (lines ~158-174): the detail embed was
   posted with `content: <@&SvS Manager>`, pinging the **entire** manager role a
   second time, on every thread.

So each manager received **2 pings per challenge**. On an active ladder that is
a constant stream, and Discord offers no clean per-user "mute all these" short
of manually muting each thread. Both notification sources were hard-wired to the
`SvS Manager` role, so the only lever a manager had was to drop the role.

### Why the auto-add is no longer load-bearing

The auto-add existed so managers could (a) **see** the private thread and (b)
**action** dodge/extend/cancel requests. Point (b) is now handled elsewhere: the
dodge/extend/cancel/vacation **Approve-Deny cards post to the admin-panel
channel** (shipped, commit `787e784`, routed via the dashboard registry).
Managers get one actionable ping there *only when a decision is actually needed*
— they do **not** need to live inside every thread to do their job. The thread
is now just an optional coordination room.

## 3. Discord mechanics that constrain the options

- **Private threads** require explicit membership to view — EXCEPT for members
  with the **"Manage Threads"** permission (or Administrator), who can see and
  open every private thread in the channel from the thread list **without being
  added and without a ping**. *(Confirmed — granted; see §6.3.)*
- **Being added** to a thread always notifies the user. No override.
- **Role @mentions** always notify every role holder (barring per-user
  suppression). No override.
- Members *can* mute a channel's threads individually, but it does not scale and
  does not stop future auto-adds.

The practical levers are therefore: **(a) stop pinging the whole role, (b) stop
auto-adding the whole role, (c) give the role permission-based visibility so
they can look without being pinged, and/or (d) add+ping only an opt-in subset.**

## 4. Options

### Option A — Permission-based visibility (grant Manage Threads; drop auto-add + role ping)
Grant the `SvS Manager` role the **Manage Threads** permission on
`#issue-a-challenge`, then in `createChallengeThread`:
- remove the manager auto-add loop, and
- remove the `<@&SvS Manager>` mention from the pinned message.

Duelers are still added and still pinged. Managers see all threads in the
channel's thread list and open any one on demand — **zero pings**.

- **Pros:** Zero manager notifications; nobody drops the mod role. Net code
  *removal*. Scales perfectly. Directly answers Lpc's literal question. Action
  routing already handled by the admin-panel approval cards.
- **Cons:** No proactive ping when a thread is created (by design). Requires a
  one-time Discord permission change by a server admin. "Manage Threads" also
  lets mods rename/archive/delete any thread (a capability bump — likely fine
  for mods). Managers must browse the thread list rather than being pulled in.

### Option B — Opt-in "Thread Mod" subset role (Shreve's suggestion)
Create a new role, e.g. **`SvS Thread Mod`**. In `createChallengeThread`, add +
ping **only** that role's members instead of the whole `SvS Manager` role. The
`SvS Manager` role continues to govern approvals, permissions, and DMs. People
who want proactive thread involvement hold the extra role (Shreve, Lpc, gemmd);
Alan keeps `SvS Manager` only and gets **no** thread pings.

- **Pros:** Matches Shreve's exact ask. Preserves proactive pings for the people
  actually handling matches. Granular, opt-in, self-documenting via role
  membership. Moderate, contained code change (new role constant + lookup helper
  + swap one call site + the mention).
- **Cons:** A second role to create and keep assigned. Subset members still get
  2 pings/thread (add + mention) — but that is exactly what they asked for.
  People *without* the subset role can't see threads at all unless combined with
  Option A's permission grant.

### Option C — Per-user notification preference store (opt-out toggle)
Persist each manager's thread-notify preference (Redis or a Sheet tab) with a
button/command to toggle it; add+ping only opted-in managers.

- **Pros:** Fully self-service; no role juggling.
- **Cons:** Most infrastructure (preference store + toggle UI + default policy +
  a place to surface it). Overkill for the current need; slower to ship.

### Option D — Minimal: drop just the role mention
Remove only the `<@&SvS Manager>` mention, keep the auto-add. Halves the noise
(1 ping/thread instead of 2).

- **Pros:** One-line change.
- **Cons:** Still one ping per thread — does **not** satisfy "without all the
  pings." Band-aid only.

## 5. Decision — LOCKED: Hybrid A + B

Confirmed with the team. **Grant `SvS Manager` the Manage Threads permission
(DONE) AND switch the thread add/ping from the full manager role to the new
`SvS Thread Mod` role (DONE — role created).**

Resulting behavior:

| Person | Roles | Thread pings | Thread access |
|---|---|---|---|
| Manager, not a thread mod | `SvS Manager` | **None** | Opens any thread on demand via Manage Threads (can view private threads) |
| Active thread handler | `SvS Manager` + `SvS Thread Mod` | Added — **one** ping at creation | Full, proactive (added as a member) |
| Change who's looped in | add/remove the `SvS Thread Mod` role | — | — |

This satisfies **both** requests at once: Lpc/Alan get "see threads without
pings," and the active handlers get "add us specifically." It's
forward-compatible — changing who gets pulled in is just a role assignment, no
redeploy. The admin-panel approval cards remain the single actionable ping for
everyone else.

## 6. Confirmed answers (from the team)

1. **Who gets added:** Not a fixed list — **only members of the new
   `SvS Thread Mod` role** (Shreve/Lpc/gemmd are just examples of current mods).
   Membership is managed purely by assigning the role.
2. **Thread occupants:** Threads contain **only the `SvS Thread Mod`s and the two
   participating duelers** — no other managers are added.
3. **Permission grant:** **Done.** `SvS Manager` now has *Manage Threads and
   Posts* ("they can also view private threads"), so every manager can browse any
   challenge thread on demand without being added or pinged.
4. **Ping count:** **A single ping.** Being added to the thread is that one ping;
   the separate `<@&SvS Manager>` role mention in the pinned message is removed.
5. **Role exists:** **`@SvS Thread Mod` created.** When the role is empty/missing,
   fall back to **duelers only** (safe — managers still see threads via Manage
   Threads).

## 7. Implementation (SHIPPED)

- **Discord (done by the team):**
  - `SvS Manager` granted **Manage Threads and Posts** ✓
  - Role **`SvS Thread Mod`** created ✓ (assign it to the active handlers)
- **`utils/managers.js`** ✓ — added `THREAD_MOD_ROLE_NAME = 'SvS Thread Mod'`,
  `findThreadModRole(guild)`, and `findThreadModMembers(guild)`. Refactored the
  force-fetch roster logic into a shared `membersForRole(guild, role)` helper so
  managers and thread mods share one battle-tested path (no "~80% dropped" bug).
- **`services/challengeThreads.js → createChallengeThread`** ✓ —
  - Add set is now **two duelers + `findThreadModMembers(guild)`** (was duelers +
    all `SvS Manager`s). Each add is the single creation ping.
  - **Removed** the `<@&SvS Manager>` role mention from the pinned message; the
    message now mentions **only the two duelers** so players are notified of
    their own match. Thread mods rely on the add-notification (one ping).
  - **Fallback:** if the role is absent/empty, `findThreadModMembers` returns `[]`
    and only the duelers are added — managers still reach threads via Manage
    Threads.
- **Out of scope / unchanged:** extended-vacation DMs still go to all
  `SvS Manager` holders (separate flow); approval-card routing already fixed
  (commit `787e784`).
- **Net effect on noise:** non-thread-mod managers go from **2 pings per
  challenge → 0**; thread mods go from **2 → 1**; duelers unchanged.
