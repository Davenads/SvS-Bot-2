# Vacation Buttons — UX & Logic Review

Scope: the two self-serve vacation buttons on the shared `#register` panel
(**Request Vacation** / **Return from Vacation**), the "is the label
misleading?" question, and whether a return-to-Available path exists.

Files in play:
- `dashboards/render.js` — button definitions + panel copy (labels the user sees)
- `interactions/registerPanel.js` — button handlers (the actual logic)
- `services/characterService.js` — `setCharacterStatus`, `findUserCharacters`
- `CHANNEL_DASHBOARDS_PLAN.md` §5.1 / §6 — original design spec

---

## 1. Current state (what is actually wired up)

Four vacation-related buttons exist, in two tiers:

| Button (label) | customId | Handler | Sheet write? | Approval? |
|---|---|---|---|---|
| `🌴 Request Vacation` | `svs:register:vacation` | `handleVacation('to')` | **Yes, immediate** (Status → `Vacation`) | **None** — self-serve |
| `☀️ Return from Vacation` | `svs:register:unvacation` | `handleVacation('from')` | **Yes, immediate** (Status → `Available`) | **None** — self-serve |
| `🏖️ Request Extended Vacation` | `svs:register:extvac` | `handleExtVac('extvac')` | No — only DMs managers | Manager runs `/bench` |
| `🧳 Return from Extended Vacation` | `svs:register:unextvac` | `handleExtVac('unextvac')` | No — only DMs managers | Manager runs `/insert` |

The **regular** vacation tier (rows 1–2) is fully self-serve and edits the sheet
instantly. The **extended** tier (rows 3–4) is a request that notifies managers
and never touches the sheet. This split is intentional and correct.

---

## 2. Question A — Is "Request Vacation" a misleading label?

**Verdict: yes, mildly — and worth fixing.**

The word *"Request"* implies a pending action that someone else must approve.
That is exactly true for **Request Extended Vacation** (it DMs managers and waits
for `/bench`). But **Request Vacation** is instant and self-serve — nothing is
"requested," the status flips the moment the button is clicked.

The real problem is the **collision**: two buttons both start with "Request,"
but one is instant and one is pending. That trains users to expect the same
behavior from both and undercuts the meaningful distinction.

### Recommendation

Reserve the verb **"Request"** for the manager-gated tier only, and give the
instant tier an imperative verb:

| Current | Proposed |
|---|---|
| `🌴 Request Vacation` | **`🌴 Go on Vacation`** |
| `☀️ Return from Vacation` | `☀️ Return from Vacation` *(unchanged — already accurate)* |
| `🏖️ Request Extended Vacation` | `🏖️ Request Extended Vacation` *(unchanged)* |
| `🧳 Return from Extended Vacation` | `🧳 Return from Extended Vacation` *(unchanged)* |

Now the UX rule is legible at a glance: **"Request …" = a manager acts on it;
plain verb ("Go on / Return from") = instant self-serve.**

Alternatives if "Go on Vacation" reads oddly next to the others: `Start Vacation`
or `Take Vacation`. Avoid `Set Vacation` (too technical).

### Confirmation of the underlying model

I agree with your position: the regular in-ladder pause should **not** require
manager approval and should edit the sheet directly. That is already how it
works, and it matches the original spec — `CHANNEL_DASHBOARDS_PLAN.md:118` even
notes *"The reference bot's 'a manager reviews every request' copy does NOT apply
— we [self-serve]."* No behavior change is needed here; only the label.

---

## 3. Question B — Is there logic to return to Available from Vacation?

**Verdict: yes, it already exists and is correct. No new logic required.**

The `☀️ Return from Vacation` button (`svs:register:unvacation`) drives
`handleVacation(interaction, 'from')` in `registerPanel.js:94`:

1. Re-reads the caller's characters live (`findUserCharacters`).
2. Filters to `status === 'Vacation'` (only vacationing chars are eligible).
3. **0 eligible** → friendly "None of your characters are currently on
   vacation." (idempotent — clicking when already Available is harmless).
4. **1 eligible** → `applyStatus(... 'Available', 'is back from vacation')` →
   `setCharacterStatus(...'Available')` + `refreshDashboard(... RANKINGS)`.
5. **Multiple eligible** → character picker → `handleVacationPick('from')`,
   which **re-verifies** `status === 'Vacation'` before flipping (guards against
   stale state between menu render and click).

So the round trip is complete and symmetric:
`Available → 🌴 Vacation → ✅ Available`, both directions instant and self-serve,
both writing the sheet and refreshing the `#rankings` board.

### Edge cases (all already handled well)
- **Idempotent:** returning when not on vacation → clean no-op message.
- **Stale rank/status:** the pick handler re-reads and re-checks before writing.
- **In a challenge:** you can only go on vacation from `Available` (a challenged
  char is `Challenge`, not `Available`), so there's no conflict to unwind on
  return — return just sets `Available`.

---

## 4. Recommended changes (small, label-only)

Behavior is already right; this is a copy/label pass only.

1. **`dashboards/render.js:248`** — `.setLabel('🌴 Request Vacation')`
   → `.setLabel('🌴 Go on Vacation')`.
2. **`dashboards/render.js:226`** — panel help line
   `'**Request / Return from Vacation** — flip your character to 🌴 Vacation and back.'`
   → `'**Go on / Return from Vacation** — flip your character to 🌴 Vacation and back.'`
3. **`registerPanel.js:10`** (comment) & **`CHANNEL_DASHBOARDS_PLAN.md:102,115,316`**
   — update the "Request Vacation" references to "Go on Vacation" for consistency.
   Docs-only; no runtime impact.

Do **not** change:
- Any customId (`svs:register:vacation` / `unvacation`) — renaming the customId
  would break in-flight interactions and require re-posting the panel. Labels are
  cosmetic; customIds are the contract. Keep them.
- The extended-vacation tier labels — "Request" is accurate there.

Estimated effort: ~4 lines of real change + doc touch-ups. One commit.

---

## 5. Optional future enhancement (out of scope — flag only)

There is currently **no max vacation duration or auto-return**. A player can sit
on `Vacation` indefinitely, and managers get no nudge. If that ever becomes a
problem, a lightweight option:

- Stamp a vacation start (e.g. write the date into the char's notes/a Redis key
  `svs:vacation:{prefix}:{pair}` on flip), and surface stale vacations in an
  existing manager view (e.g. `/currentvacations`).

This is a genuinely new feature, not part of the current ask. Recommend
deferring unless the league wants a policy on vacation length.

---

## 6. Summary

- **"Request Vacation" is mildly misleading** → rename to **"Go on Vacation"** so
  "Request …" consistently means "a manager acts on it." Label-only change.
- **Self-serve, direct-edit, no approval** is the correct model and already in
  place. Keep it.
- **Return-to-Available already exists** (`☀️ Return from Vacation`) and is
  correct — symmetric, idempotent, re-validated. Nothing to build.
- **Do not touch customIds.** Only labels + docs.
