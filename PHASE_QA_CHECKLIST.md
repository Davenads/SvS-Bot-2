# Channel Dashboards — Live QA Checklist

Run these in the live server after a deploy. Steps are ordered so each builds on
the last. All behavior below is grounded in the shipped code (see
`CHANNEL_DASHBOARDS_PLAN.md` §11). Everything runs against **live data** — no
isolated test-guild channels are wired, so use throwaway/test characters.

## 0. Prerequisites
- [ ] Only **one** bot instance running (Heroku dyno) — no local `npm start` alongside it (avoids double replies / duplicate threads).
- [ ] Bot role on `#issue-a-challenge` (`1553197193849081977`) has **Create Private Threads**, **Send Messages in Threads**, **Manage Threads**.
- [ ] Bot can post/edit in `#register`, `#hld-rankings`, `#lld-rankings`, `#challenges`, `#lld-challenges`.
- [ ] Persistent panels are present (rankings board, register panel, both Active Challenges boards, Issue-a-Challenge button). If missing, restart the dyno — hydration reposts them.
- [ ] Tester holds **SvS Dueler** (for signup); a second account with **SvS Manager** to verify manager DMs + manager paths.
- [ ] Bot can post in the **vacation-approval channel** (`VACATION_APPROVAL_CHANNEL_ID` in `config/ladders.js`, currently defaults to the command-log channel `1165300795277848587`) and mention the **SvS Manager** role there. The thread action-button requests (dodge/extension/cancel) post to the same channel.

## 1. Rankings board (Phase B / F)
- [ ] `#hld-rankings` shows Top 10 + "Open the full ladder in Google Sheets" link.
- [ ] **View full ladder** → ephemeral paginated view, 10/page; First/Prev/Next/Last work; buttons disable at ends; expires ~60s.
- [ ] One viewer paging does **not** move the shared board for others.

## 2. Sign Up wizard (Phase E)
- [ ] Click **Sign Up** without SvS Dueler → ephemeral role-gate message, no write.
- [ ] With the role: ladder → element → build → modal (name required, notes optional).
- [ ] Element list **omits** any element already held on that ladder.
- [ ] Submit → "Welcome to the Ladder!" embed; `#…-rankings` board auto-updates with the new character (confirmation is ephemeral by design).
- [ ] Re-run, pick the **same element** on the same ladder → rejected at submit ("one per element per ladder").

## 3. Challenge wizard + threads (Phase C / G)
- [ ] **Issue a Challenge** → challenger select if >1 char, else straight to targets.
- [ ] Target list only shows in-jump-range, non-vacation, non-challenged opponents.
- [ ] Complete → ephemeral "Challenge issued!"; announcement embed posts in `#challenges`/`#lld-challenges` (not `#issue-a-challenge`).
- [ ] `#issue-a-challenge` gets a **private thread** `⚔️ [HLD] A (#n) vs B (#m)`; both duelers + all SvS Managers pinged/added; pinned detail embed present, with 4 action buttons (Report Win, Request Dodge, Request Extension, Cancel Match).
- [ ] Active Challenges board shows the pair with `⏳ expires in ~Xd Yh`.

## 4. Teardown paths (Phase G2)
- [ ] `/reportwin` → thread gets result note + **archives** (not deleted); pair drops off the board; rankings update.
- [ ] New challenge → `/cancelchallenge` → thread archived with cancel note.
- [ ] New challenge → `/extendchallenge` → thread **persists** (extend note, no archive); board countdown resets.
- [ ] (If practical) let one hit the 3-day TTL → expiry handler archives via sidecar even though the challenge value is gone.

## 4b. Thread action buttons (matchPanel)
- [ ] Buttons render for **everyone** in the thread (both duelers and managers) regardless of role — buttons always show; only the handler gates who can act.
- [ ] **Report Win** as a participant → ephemeral "Who won?" 2-option select → confirm step → on confirm the result resolves (rank swap on a climb, cooldown, announcement embed posts in the ladder's challenges channel, thread archived) and the reply shows the outcome. A non-participant / non-manager → "Only a participant or an SvS Manager can report."
- [ ] Report Win **Cancel** button on the confirm step → "Cancelled — no result reported", no write.
- [ ] **Request Dodge** as a participant → ephemeral "sent to the SvS Managers"; a single Approve/Deny post lands in the approval channel (pings the manager role), listing the requester, opponent, and dodge target (the opponent).
- [ ] Approve a dodge request → opponent's dodge count (col K) increments by 1; approval post loses its buttons and shows "Approved by …"; requester gets a DM.
- [ ] **Request Extension** → on approve both rows' challenge date moves +2 days, the Redis challenge + thread TTL bump, the challenges board countdown resets, requester DM'd.
- [ ] **Cancel Match** → on approve both rows reset to Available (F:H cleared), Redis challenge removed, thread archived with a cancel note, boards refresh, requester DM'd.
- [ ] **Deny** on any request → no sheet change; requester gets a decline DM; post shows "Denied by …" with buttons removed.
- [ ] **Double-approve guard**: a second manager clicking the same request post while the first is processing → "Another manager is already handling this request" (short Redis lock on the message id); no double write.
- [ ] **Non-manager** clicks Approve/Deny on a request post → ephemeral "Only SvS Managers can act…"; the post is untouched.
- [ ] **Click after resolution**: any thread button clicked after the match already resolved/expired → graceful "This challenge is no longer active" (no crash, no write).

## 5. Register writes (Phase D)
- [ ] **Request Vacation** (Available char) → sheet is **not** mutated yet; caller sees "sent to the SvS Managers for approval"; a single Approve/Deny post lands in the approval channel (pings the SvS Manager role). **Return from Vacation** stays self-serve → flips 🌴 back to ✅ instantly.
- [ ] Multi-char account → picker appears and acts on the chosen one only.
- [ ] **Leave Ladder** → confirm step → removal re-ranks everyone below; board + challenges update. Cancel makes no changes.
- [ ] **Request Extended Vacation** → every SvS Manager gets a DM with the exact `/bench …` command; sheet is **not** mutated. **Return from Extended Vacation** → DM with `/insert …`.
- [ ] Manager with DMs closed → caller gets the "couldn't DM" fallback, not a crash.

## 5b. Vacation approval + forfeit (Phase 3 / 4)
- [ ] **Approve** an Available-char request → status flips to 🌴; `#…-rankings` updates; requester gets an approval DM; the mod post loses its buttons and shows "✅ Approved by …".
- [ ] **Deny** a request → no sheet change; requester gets a decline DM; post shows "❌ Denied by …" with buttons removed.
- [ ] **Second manager clicks** an already-actioned post → "Already handled — no action taken." (no double write).
- [ ] **Non-manager clicks** Approve/Deny → ephemeral "Only SvS Managers can act…"; the post is untouched.
- [ ] **Request Vacation while in a Challenge** → the eligible list includes the Challenge char; the approval embed shows the **⚠️ Active Challenge** forfeit warning.
- [ ] **Approve a mid-challenge request** → opponent is awarded the win (result embed posts in `#…-challenges`, ranks swap on a climb, thread archived, cooldown set), THEN the requester's char lands on 🌴 at its (possibly new) rank; approval note + DM append "…forfeited — {opponent} was awarded the win."
- [ ] **Challenge resolved before approval** (e.g. `/reportwin` first) → approve does **not** double-forfeit; char just goes 🌴.
- [ ] **`/bench` a mid-challenge player** → opponent gets the win (forfeit result announced), then the player is moved to Extended Vacation and ranks re-number correctly (benched player located by identity, not stale rank).
- [ ] Duplicate request → second **Request Vacation** for the same char before approval → "you already have a pending vacation request."

## 6. Resilience spot-checks
- [ ] Delete a persistent board message manually → next mutation or the ~10-min safety sweep reposts it.
- [ ] Rapid double-click a wizard button → no duplicate writes (defer + Redis lock on signup).

## Notes
- Thread creation is **best-effort**: if it fails (permissions/rate limit), the challenge still records. Check logs for `Challenge threads:` entries rather than expecting a user-facing error.
- The orphan sweep runs off the hourly `runSafetyCheck` — a thread whose challenge no longer exists gets archived and its sidecar dropped.
