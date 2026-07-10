# League build — session handoff & plan

> **Audience:** a fresh Claude session continuing this work with zero prior context.
> Written 2026-07-09, immediately after League Phase 0 was built and tested locally
> (284/284 vitest passing) but **not yet deployed or committed**.

---

## 1. Immediate tasks (do these first)

### 1a. Deploy the pending working tree

The lab box (`mahjong-dev` in `~/.ssh/config`, → 10.10.10.102, code at
`/opt/mahjong-trainer`, **no git on the box** — deploys are working-tree rsyncs):

```bash
cd ~/Documents/GitHub/mahjong-trainer
rsync -az --exclude .git --exclude node_modules --exclude .next ./ mahjong-dev:/opt/mahjong-trainer/
ssh mahjong-dev 'cd /opt/mahjong-trainer && docker compose up -d --build'
```

The compose `migrate` service runs `prisma db push --accept-data-loss` on boot; the
only schema change pending is **additive** (`MatchPlayer.vacatedAtGame Int?`), so
nothing is at risk. Verify after: `docker logs mahjong-trainer-app-1 --tail 20` shows
a clean boot; migrate logs mention the new column.

### 1b. Commit

The local tree holds TWO uncommitted, test-green changesets (the box is currently the
only place some of this runs — bad). Commit and push to origin
(`github.com/hunbelievable/mahjong-trainer`, branch `master`):

- **Previous session's fix** (already deployed, never committed): physical/wind
  seat-label fix — `PlayerView.yourPhysicalSeat` in `lib/server/redact.ts`,
  used by `StandingsPanel`/`ChatPanel` in `app/play/[room]/PlayRoomClient.tsx`,
  plus `tests/lib/unseenPool.test.ts` fixture update.
- **This session's Phase 0** (tested, NOT yet deployed): see §3.

One commit for both is fine, or two if you prefer clean history.

---

## 2. What this effort is (product decisions, already made with the user)

The next evolution of this app is a **mahjong league capability**. Decisions locked
in discussion with the user — do not relitigate, but flag genuine conflicts:

1. **League management is a separate *product*, not a separate *codebase* (yet).**
   It must deliver full value for a club that plays 100% physically and never opens
   the online game (comp: Golf Genius, $500–1,500/yr per golf club). Keep it a
   cleanly bounded module inside this app; physically split only if a second
   customer ever exists.
2. **Manual score entry is first-class, not a fallback.** The league layer's score
   record carries `source: "manual" | "online"`. Online-game auto-feed comes later
   (Phase 2) and is just another source.
3. **Hard module boundary:** league code references `User` and score records ONLY.
   Never `GameRoom`, never the engine. (The Match/MatchGame read-model layer already
   follows this discipline — inherit it.)
4. **NMJL card IP:** never reproduce the NMJL card. The app's own `HandPattern`
   system is original content; that's deliberate and load-bearing for any future
   commercial use ("bring your own card" is the market-proven lane, per I Love Mahj).
5. **Sequencing:** trust the data → create the league → connect the game →
   differentiate. Each phase independently useful.

**Open policy questions — ASK THE USER before building anything that depends on
them** (they shape schema/queries):
- How do CPU-substituted hands count in standings (count / count-against / excluded)?
  Phase 0's `vacatedAtGame` records the facts either way.
- League scoring model: cumulative payout points (what the data naturally supports)
  vs. win counts vs. per-session placement?
- How formal is scheduling? (A "league night" button vs. full calendar/RSVP.)

---

## 3. Phase 0 — DONE this session (persistence hardening)

Standings make Postgres load-bearing; previously all match writes were one-shot
fire-and-forget. What changed (all in the pending working tree):

- **`prisma/schema.prisma`:** `MatchPlayer.vacatedAtGame Int?` — game number during
  which a seat was kicked/forfeited to CPU. `userId` deliberately STAYS set on
  vacated rows (pre-vacate hands remain attributable; post-vacate policy is §2's
  open question). In-memory mirror on `roomManager.ts`'s `MatchPlayer` interface.
- **`lib/server/matchStore.ts` (rewritten):**
  - `withRetry` — bounded retries (500ms/2s/8s), unref'd timers, resolves (never
    rejects) so callers stay fire-and-forget. Defaults to a **single attempt under
    `process.env.VITEST`** (a vitest setupFile approach was tried and abandoned:
    vitest re-instantiates module subtrees when a dep is mocked, so a setup-file
    module instance isn't the test file's instance).
  - All writes are now **idempotent upserts** on unique keys (`Match.id`,
    `matchId_gameNumber`, `matchId_seat`) so a retry after an ambiguous success
    can't duplicate.
  - New `persistSeatVacated(matchId, seat, difficulty, vacatedAtGame)` — called from
    `RoomManager.convertToCpu` (the kick/forfeit path).
  - `persistMatchEnd` **replaced** by `reconcileMatch(MatchSnapshot)`:
    `RoomManager.closeRoom` builds a full snapshot (players incl. scores +
    vacatedAtGame, complete game history, endedAt) and reconcile upserts
    everything — backfills whatever a transient DB outage dropped mid-match.
  - Known remaining gap (deliberate, deferred): process crash **before** close can
    still lose results. The fix is resume/replay from the NATS event log
    (`lib/server/eventLog.ts` already writes it durably); don't build this without
    the user asking.
- **Tests:** new `tests/server/matchStore.test.ts` (retry, give-up-without-throw,
  idempotency, vacated payload, reconcile incl. mid-reconcile retry);
  `tests/server/roomManager.test.ts` now mocks matchStore wholesale (top-of-file
  `vi.mock`) + a "durable persistence" describe block asserting the wiring.
  **284/284 passing** via `npx vitest run` (~3.5 min, the engine suites are slow).

---

## 4. Phase 1 — NEXT: league domain core

Goal: leagues exist, with standings, runnable by the user's own circle as the market
test. All read-model + UI work; zero engine changes.

1. **Schema** (new models, `prisma/schema.prisma`, same style as the existing
   domain-projection section):
   - `League` — name, commissionerUserId, createdAt. (Scoring config later; don't
     speculative-build it.)
   - `Season` — leagueId, name, startsAt, endsAt nullable (open-ended, matching how
     matches already work).
   - `LeagueMember` — leagueId + userId unique, role (`commissioner | member`),
     joinedAt.
   - `LeagueSession` — seasonId, scheduledAt, label ("Tuesday night"). Keep minimal.
   - `ScoreRecord` — sessionId, userId, points, `source: "manual" | "online"`,
     optional matchGameId backref (null for manual), enteredByUserId, createdAt.
     This is the aggregation atom. Design so a Phase 2 auto-feed just inserts rows
     with `source: "online"`.
2. **League CRUD + membership UI** — new `app/league/` route group. Auth identity
   comes from `lib/server/currentUser.ts` (Cloudflare Access — see §6 gotchas).
   Commissioner-only mutations mirror the existing creator-only pattern
   (`RoomManager.closeRoom` et al.). Prisma-only Route Handlers belong in `app/api/`
   (precedent: `app/api/user/route.ts` + `tests/app/userRoute.test.ts`), NOT in the
   raw `server.ts`/`lib/server/roomApi.ts` plumbing (that's only for things needing
   the in-process RoomManager/wsHub singletons).
3. **Manual score entry** — commissioner enters a session's per-player results;
   mobile-friendly (league night = phones/iPads).
4. **Standings page** — per-user totals across a season's sessions. Recharts is
   already a dependency if a chart earns its place.

Milestone: the user runs their own league on it. Phase 2 (session→room table
assignment, online auto-feed, RSVP) reorders based on that experience.

---

## 5. Later phases (outline only — do not start unprompted)

- **Phase 2:** auto-feed finished `MatchGame`s into `ScoreRecord`s when a room is
  linked to a `LeagueSession`; "start league night" → N pre-seated rooms; player
  history pages.
- **Phase 3:** decision-quality rating from the evaluator (`MoveRecord`'s
  `winProbBefore/After` — a luck-independent "accuracy" score, the moat feature);
  handicaps/balanced tables; season archives.

---

## 6. Codebase conventions & gotchas (hard-won, respect these)

- **Physical vs wind seats:** `Room.seats`/`match.players`/`MatchGame` rows/chat are
  keyed by FIXED PHYSICAL seat (E/S/W/N = who sits where all match). The live game
  engine only speaks WIND labels, reassigned every game by dealer rotation.
  `match.windAssignment` bridges. Comparing across label spaces caused real bugs
  twice; `PlayerView.you` is wind, `PlayerView.yourPhysicalSeat` is physical.
- **Identity:** Cloudflare Access gates everything upstream; the app verifies the
  `Cf-Access-Jwt-Assertion` JWT (`lib/server/cfAccess.ts`) and find-or-creates a
  `User` by email. **There is NO local-dev identity bypass** — authenticated pages
  cannot be exercised in a local browser. Every multiplayer feature ships on
  unit/integration tests + remote boot-verify + the user's own live testing. Don't
  fight this; don't add a bypass without being asked.
- **Never-block-gameplay:** durable writes (event log, matchStore) are fire-and-
  forget side effects. In-memory `RoomManager` state is authoritative for live play;
  Postgres is the durable read model (now at-least-once, see §3).
- **Never leak identity/hand info:** views expose `isYou` flags, seat labels,
  handles — never emails/userIds of others; claim eligibility is redacted per seat.
  Extend this posture to league pages (handles, not emails, on standings).
- **Tests:** vitest, `tests/` mirrors source. Prisma-touching modules are mocked via
  `vi.mock("@/lib/prisma", ...)` per file (see `tests/app/userRoute.test.ts`);
  roomManager tests mock `@/lib/server/matchStore` wholesale. Suite must stay green;
  it's the primary verification given the no-local-auth constraint.
- **Docs:** `docs/multiplayer-design.md` is the architecture reference (§18 =
  match/rotation/scoring). Update it (or this file) when decisions change.
- **The user:** hands-on home-lab builder, tests live with real friends, gives fast
  clear feedback, prefers being asked before scope changes. Don't turn their
  descriptive musings into locked constraints without confirming.
