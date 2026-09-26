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
- [ ] `#issue-a-challenge` gets a **private thread** `⚔️ [HLD] A (#n) vs B (#m)`; both duelers + all SvS Managers pinged/added; pinned detail embed present.
- [ ] Active Challenges board shows the pair with `⏳ expires in ~Xd Yh`.

## 4. Teardown paths (Phase G2)
- [ ] `/reportwin` → thread gets result note + **archives** (not deleted); pair drops off the board; rankings update.
- [ ] New challenge → `/cancelchallenge` → thread archived with cancel note.
- [ ] New challenge → `/extendchallenge` → thread **persists** (extend note, no archive); board countdown resets.
- [ ] (If practical) let one hit the 3-day TTL → expiry handler archives via sidecar even though the challenge value is gone.

## 5. Register writes (Phase D)
- [ ] **Request Vacation** (Available char) → flips to 🌴; board shows Vacation. **Return from Vacation** → back to ✅.
- [ ] Multi-char account → picker appears and acts on the chosen one only.
- [ ] **Leave Ladder** → confirm step → removal re-ranks everyone below; board + challenges update. Cancel makes no changes.
- [ ] **Request Extended Vacation** → every SvS Manager gets a DM with the exact `/bench …` command; sheet is **not** mutated. **Return from Extended Vacation** → DM with `/insert …`.
- [ ] Manager with DMs closed → caller gets the "couldn't DM" fallback, not a crash.

## 6. Resilience spot-checks
- [ ] Delete a persistent board message manually → next mutation or the ~10-min safety sweep reposts it.
- [ ] Rapid double-click a wizard button → no duplicate writes (defer + Redis lock on signup).

## Notes
- Thread creation is **best-effort**: if it fails (permissions/rate limit), the challenge still records. Check logs for `Challenge threads:` entries rather than expecting a user-facing error.
- The orphan sweep runs off the hourly `runSafetyCheck` — a thread whose challenge no longer exists gets archived and its sidecar dropped.
