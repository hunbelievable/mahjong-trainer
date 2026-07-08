# Multiplayer Design — mixed CPU + human across browsers

**Status:** Draft v2 (architecture locked) · **Date:** 2026-06-29
**Locked decisions:**
- Authority model: **event-sourced** — an append-only action log is the source of truth; state is a fold over the log.
- Realtime backbone: **NATS JetStream** (durable streams = the log *and* pub/sub fan-out).
- Identity: **Auth.js (NextAuth v5)** with **Google** to start, Prisma adapter.
- Transport: **WebSockets** via a dedicated gateway.
- Ingress: **Cloudflare Tunnel** (no open ports); auth lives in the app, not at the edge.
- Scope: **MVP-first** — auto-play Charleston, auto-pass human claims; humans act only on draw→discard.

---

## 1. Guiding principles

1. **This refactor becomes the app's architecture going forward** — not a bolt-on
   kept at arm's length from single-player. Single-player mode keeps working (no
   reason to break a feature that works), but the deployment does not need to
   protect a separate zero-infra path. The added infra (a Node process serving
   both HTTP and WS, NATS, Postgres) is not cumbersome for a home-lab and isn't
   worth designing around.
   *(Earlier drafts of this doc stated single-player must stay zero-infra and
   multiplayer must be a strictly-additive sibling service. That was an inference
   from "single-player is lightweight today," not something asked for — corrected
   2026-07-01.)*
2. **One integrated app.** `lib/server/` (the game runtime built in P1) lives
   inside the Next app, and the WS upgrade is served by the same process via a
   custom server entrypoint — not a separate gateway package. `engine/` stays the
   shared, pure core either way.
3. **One backbone, many features.** The action log that powers multiplayer is the
   same substrate that already underlies Study replay and stats. We build it once.

---

## 2. Why the code is already shaped for this

- `gameReducer(state, action, ctx)` is **pure and serializable** — `state = fold(actions)` is exactly event sourcing.
- We already **persist a stream of moves and fold them back**: Study mode
  ([lib/useStudy.ts](../lib/useStudy.ts)) replays saved moves into a
  win-probability timeline. Multiplayer is one step from that — make the action
  stream the *source of truth* rather than a derived record.
- The engine already runs **headless server-side** (the observe test harness drives
  a full game with no UI).

What's missing: the engine assumes a single human (`EngineContext.humanSeat`), and
all realtime/identity/log infrastructure.

---

## 3. Deployment shape

One deployable app: a **custom Node server** (`server.ts`) that boots Next.js and
attaches a WS upgrade handler in the same process, so HTTP and WebSocket traffic
share one port and one container. Alongside it in Docker Compose:

| Component | Role |
|---|---|
| **App** (custom Node server) | Next.js pages/API + `lib/server/` game runtime + WS handling. Single-player and multiplayer are both served here. |
| **PostgreSQL** | Auth.js tables + domain projections (Room/Match/MatchPlayer/MatchGame) + existing single-player saves. |
| **NATS JetStream** | The action log + pub/sub fan-out. |

All reached through one **Cloudflare Tunnel**. Postgres and NATS are datastores,
not "another app instance" — this is the same shape a single-player-only deploy
would need for its database, plus one more container for the event log.

**Current constraint:** the in-memory `GameRoom`/`RoomManager` authority runs as
part of the single app process, so — until rooms are backed by NATS/DB state
rather than only process memory — the app runs as **one instance** for room
authority to stay consistent. Fine for a home-lab; NATS being durable is what
unlocks scaling this out later if it's ever needed.

---

## 4. Architecture overview

```
   Browser (seat W)      Browser (seat E)      Browser (seat S)
        │   WS (redacted views ▲ / commands ▼)        │
        └───────────────┬──────────────────────────────┘
                        ▼
            Cloudflare Tunnel (TLS, no open ports)
                        │
        ┌───────────────┴───────────────────────────────────┐
        │ Next app: Auth.js (Google) — issues session        │
        │ WS Gateway: authenticates upgrade via session,     │
        │             maps user→seat, pushes redacted views  │
        │ Game Service (authority): validates command →      │
        │   appends action → folds state → publishes view    │
        │   reuses engine/gameReducer                        │
        └───────────────┬───────────────────────────────────┘
                        ▼
        NATS JetStream  —  per-room durable stream  =  THE action log
          subjects: game.room.<id>.actions  (truth)
                    game.room.<id>.view.<seat>  (fan-out)
                        │
                        ▼
        PostgreSQL (Prisma) — projections: game summaries, per-user
        stats, profiles, finished-game archives for Study
```

**Command path:** client sends a *command* (intended action) → game service
validates legality against current folded state → **only if legal**, appends the
action to JetStream (the log holds applied, legal actions only) → fold advances →
a redacted view per seat is published → gateways push to clients.

---

## 5. Identity — Auth.js (Google)

- **Auth.js v5** in the Next app, **Prisma adapter** (you already run Prisma, so
  `User`/`Account`/`Session` tables drop in). **Google** provider first; Discord/
  GitHub/Microsoft are one-line additions later.
- The authenticated **user id is the player identity** — no passwords, no
  account-creation flow.
- **WS auth:** the gateway validates the Auth.js session cookie on the WebSocket
  upgrade; unauthenticated upgrades are rejected.
- **Seat ownership:** `seat → userId`. Only that user's commands are accepted for
  the seat. Reconnect = same user reclaims the same seat. This also gives us
  durable **profiles and cross-game stats** as a free side benefit.

---

## 6. Event-sourced core

- **Source of truth:** per-room JetStream stream of actions (subject
  `game.room.<id>.actions`). Append-only, ordered, durable, replayable.
- **State = fold(actions).** The game service folds with the existing reducer.
- **Determinism is a hard prerequisite.** The fold must be reproducible, so any
  randomness that affects state — wall shuffle, CPU tie-break `Math.random()` —
  must come from a **seeded PRNG**, and the seed is recorded as the first event
  (`init{seed, seats, patterns}`). Replays consume recorded events and never re-run
  timers or RNG. (Net-new engine work: thread a seeded RNG through `shuffleWall`
  and CPU strategies instead of `Math.random`.)
- **Validation before append:** commands are checked against current state; illegal
  ones are rejected and never logged, so the log stays clean and re-foldable.
- **Single writer per room** (the owning game-service instance) avoids races for
  MVP; JetStream optimistic concurrency (expected last sequence) is the path if we
  later shard rooms across instances.
- **Snapshots/projections:** to avoid re-folding from zero, periodically snapshot
  folded state (in JetStream KV or Postgres). Load = latest snapshot + tail of log.
- **Free wins:** crash resume (replay), audit, and **Study replay becomes a fold of
  the same log** — single-player and multiplayer games both become replayable the
  same way. Existing Postgres `moves` becomes a *projection*, not the truth.

---

## 7. Realtime transport — WebSocket gateway

- A dedicated **WS gateway service** (Node `ws`). On upgrade it authenticates via
  the Auth.js session and subscribes to the room's view subjects in NATS.
- **Server → client:** redacted `PlayerView` (full state on join, deltas after).
  Each carries the action-log **sequence number** as a cursor.
- **Client → server:** commands `{ roomId, seat, action, expectedSeq }`.
- **Reconnection:** client reconnects with its last-seen sequence; gateway replays
  missed views from the durable stream — no lost state.
- Cloudflare Tunnel proxies WS transparently; the browser's session cookie rides
  the same-origin upgrade.

---

## 8. Hidden-information redaction (security-critical)

Unchanged in spirit — folded `GameState` holds all four hands; clients must never
receive that. `redactStateForSeat(state, seat) → PlayerView`:

- **your** hand/melds: full detail
- **opponents:** hand **counts** only, plus public melds + discards
- **wall:** count only, never contents
- plus `currentSeat`, `phase`, `pendingActionForYou`, `winner`, public log

Redaction is the single chokepoint to clients and gets dedicated tests (assert no
foreign tile ids leak into any view). It runs at publish time, once per seat.

---

## 9. Engine changes

### MVP (small, contained): one human → many
`EngineContext.humanSeat: PlayerId` → **`humanSeats: Set<PlayerId>`**. The coupling
is ~6 spots keyed on `ctx.humanSeat`:
- `ADVANCE_CPU` `if (seat === ctx.humanSeat) return state` → `humanSeats.has(seat)` ([gameEngine.ts:546](../engine/gameEngine.ts))
- CPU-iteration skip `:609`
- deal/`finishCharleston` pending-action `:754`
- post-claim pending-action `:909` / `:950`
- `HUMAN_DISCARD` / `HUMAN_PASS` become **seat-addressed** (carry the acting seat)

The play loop then natively supports multiple humans: pause on any human seat,
auto-run CPU seats.

### Built in P4 — but designed now (§16)
- **Multi-human Charleston** (simultaneous staging barrier) and **multi-human claim
  windows** (claim race + timeout) are the genuinely-new synchronous problems.
- MVP **auto-plays Charleston for all seats and auto-passes human claims**, so they
  don't block a playable v1 — but the MVP emits the **same event shapes** designed
  in §16, so enabling real multi-human play in P4 is additive, not a log migration.

---

## 10. NATS JetStream specifics

**Built** ([lib/server/eventLog.ts](../lib/server/eventLog.ts)): a `ROOM_EVENTS`
stream captures `game.room.*.actions` (idempotent create — checked via
`streams.info` before `streams.add`). `RoomManager` appends every new
`GameRoom` event (fire-and-forget; failures are logged, never block gameplay)
and can read a room's full persisted log back via an ordered consumer filtered
to that room's subject. This proves write+read durability round-trips through
JetStream. `NATS_URL` is optional — unset or unreachable falls back to a
`NoopEventLog` so the app runs without a NATS server present.

**Deliberately deferred:**
- **Resuming a room's live authority from the persisted log** after a process
  restart — needs a fold/snapshot strategy (see open question #4 below); today
  the log is written for durability/audit but not read back into a running
  `GameRoom`.
- **NATS-based pub/sub fan-out** on `…view.<seat>` subjects, replacing the
  in-process `wsHub` — not needed until the app must scale beyond one instance
  (see §3); `wsHub` already does this job correctly for a single instance.
- **Idempotent-append dedup** (`Nats-Msg-Id`) and **per-room compaction to
  Postgres** — worth adding once retention/storage actually becomes a concern,
  not before.

---

## 11. Wire protocol

**Client → gateway (WS):**
- `command` `{ roomId, seat, action, expectedSeq }` — `action` is an engine action.
- lobby: `claimSeat`, `setCpuDifficulty`, `ready`, `start`, `rematch`.

**Gateway → client (WS):**
- `view` `{ seq, playerView }` — full on join, delta after.
- `event` `{ seq, log }` — join/leave, claims, toasts.
- `error` `{ reason, expectedSeq? }` — rejected command (e.g. stale seq, illegal).

---

## 12. Service / module layout (as built)

```
engine/                      # shared, pure; humanSeats generalizes the play loop (done)
lib/server/redact.ts         # redactStateForSeat + tests (done)
lib/server/gameRoom.ts       # authority: validate → apply → log → drive CPUs (done)
lib/server/roomManager.ts    # lobby: rooms, seats, CPU fill, start, event-log wiring (done)
lib/server/eventLog.ts       # NATS JetStream durability: append + readAll, Noop fallback (done)
lib/server/wsHub.ts          # in-process WS connection registry + per-seat broadcast (done)
lib/server/sessionFromRequest.ts  # Auth.js session cookie → userId, for the raw WS upgrade (done)
lib/server/currentUser.ts    # Auth.js session → userId, for Route Handlers (done)
auth.ts + app/api/auth/[...nextauth]/  # Auth.js (Google) (done)
app/api/rooms/…              # lobby Route Handlers: create, view, claim/release/setCpu/start (done)
server.ts                    # custom Node entrypoint: Next + WS upgrade + NATS boot, one process (done)
app/play/[room]/page.tsx     # multiplayer client (renders PlayerView over WS) (next)
prisma/schema.prisma         # User/Account/Session (Auth.js) + projections (done)
docker-compose.yml           # app, postgres, nats (done)
```

Single-player simulation/live/study pages are untouched; multiplayer is a new
surface within the same app, sharing `engine/` and the redactor.

---

## 13. Security checklist

- Redaction is the only path to clients; never serialize raw `GameState`.
- Authenticate every WS upgrade and command via the Auth.js session.
- Seat ownership enforced by `userId`.
- All action legality decided **server-side** by the reducer before the log append.
- Action log is **append-only**; projections are rebuildable, the log is the truth.
- NATS secured (auth/TLS) and not exposed outside the compose network.
- Abuse/rate limiting at the Cloudflare edge.

---

## 14. Phase plan

| Phase | Deliverable | Proves |
|---|---|---|
| **P1 — done** | Room authority + redaction over WS; Auth.js/Google; durable action log (NATS, write+readback); `/multiplayer` + `/play/[room]` client; **auto Charleston + auto-pass claims**; draw→discard; CPU fill | The full event-sourced spine + multi-human turn loop, playable end-to-end once credentials/DB are live |
| **P2** | Reconnect via sequence replay (today: naive full-view-on-reconnect, no cursor); server-side CPU pacing; snapshots; **resume a room's live authority from the persisted log after a restart** (not yet built — see §10) | Real-time resilience |
| **P3 — partially done** | Lobby: ~~create/join, seat claim, CPU difficulty~~ done in P1; **ready-up, rematch** still open | Usable rooms |
| **P4** | Multi-human Charleston + claim windows with timeouts (event vocabulary designed in §16) | Full ruleset |
| **P5** | Disconnect→CPU takeover, spectators, **Study replays multiplayer games from the log** | Robustness + backbone payoff |

**P1 is built** — the remaining gap is exercising it live: needs `AUTH_SECRET` +
Google OAuth credentials, a running Postgres (`prisma db push`), and ideally NATS,
none of which were available in the environment this was built in. Everything
that could be verified without them was (live server boot, HTTP/WS coexistence,
auth-gated redirects, unauthenticated-WS rejection, 172 unit/integration tests
covering redaction, the authority, the lobby, and event-log persistence).

---

## 15. Open questions / risks

1. **Projection unification** — should single-player saves migrate onto the same
   log/projection model, or stay on the current Postgres `moves` path for Tier 0?
2. **Disconnect mid-turn** — MVP waits; auto-CPU-after-timeout in P5 (or earlier?).
3. **Claim timers (P4)** — how long to wait on remote humans before resolving.
4. **Snapshot cadence** — every N actions vs end-of-turn; storage in KV vs Postgres.
5. **Room sharding** — single writer per room is fine now; revisit when rooms
   outgrow one game-service instance (JetStream optimistic concurrency).
6. **CPU fairness** — server-side CPUs must only use information a fair player has
   (they already evaluate from their own hand).
7. **Claim tie-break rule (§16)** — confirm the deterministic order when two
   non-mahjong exposure claims race (proposed: nearest seat counterclockwise from
   the discarder).
8. **Default timeout durations** — claim window and disconnect grace period.

---

## 16. Synchronous coordination — designed now, built in P4

The single new problem multiplayer introduces: two or more humans must act at the
**same decision point**. Single-player never had this (the engine resolves every
non-human seat instantly). The design principle that makes it tractable:

> **Every resolution — including timeouts — is a recorded event.** Wall-clock time
> only ever lives in the authority; the moment it acts, it writes an event. Folds
> and replays consume recorded events and never re-run a timer or RNG.

The MVP emits these same event shapes (with the human cases auto-resolved), so P4 is
additive. The vocabulary:

**A. Charleston — a staging barrier.**
Each step collects `charleston_stage{seat, tileIds}` from every seat. The authority
emits `charleston_execute{step}` once **all required seats have staged**, or
`charleston_stage{seat, tileIds, by:"policy"}` if a seat's timer fires (a CPU-policy
pick is substituted and recorded). Blind passes are a `stage` variant flag. No turn
order to resolve — just the barrier.

**B. Claim windows — a bounded race.**
A `discard{seat, tile}` opens a window with a deadline. Eligible seats emit
`claim{seat, type}` or `pass{seat}`; CPU responses are computed and written
immediately. The authority closes the window when **all eligible seats have
responded OR the deadline passes** (it writes `claim_window_closed{reason}`), then
resolves deterministically and writes `claim_resolved{winner, type}` or
`claim_none`. Priority: **mahjong beats everything**; among equal exposure claims,
nearest seat counterclockwise from the discarder (open question #7). Because the
close + resolution are events, a replay is identical without the timer.

**C. Disconnect during a decision.**
`seat_timeout{seat}` → `cpu_substitute{seat}` lets play continue; `seat_resume{seat}`
on reconnect hands control back. Grace period configurable (open question #8).

**D. Stale / concurrent commands.**
Optimistic concurrency: a command carries `expectedSeq`. If the log has advanced,
the authority rejects it (`error{stale}`) and the client re-syncs from the latest
view. No locks; the single-writer-per-room authority serializes appends.

---

## 17. Fair information — redaction is not just wire-hiding

Your instinct is right and it goes one layer deeper than the network. Two layers:

1. **Wire redaction** — clients only ever receive `PlayerView` (§8); raw
   `GameState` never crosses the boundary.
2. **Analysis must be computed from the redacted view, not the full state.** The
   coaching panel (win probability, outs, pattern reachability) currently runs on
   the *full universe* — `evalWall` is built from all hands + wall + discards +
   melds. In multiplayer that would leak: a fair player does not know which specific
   tiles are in the wall vs. hidden in opponents' hands. So the evaluator must run
   on an **unseen-pool model**: for any tile type, `unseen = total − (your hand +
   all discards + all exposed melds)`, and outs/odds are computed against that pool,
   never against the known live wall.

**Enforcement is structural:** if the client only *has* the `PlayerView`, its
analysis is automatically fair — it cannot leak what it never received. So analysis
runs on the redacted view (client-side is fine; nothing secret is present).

**Bonus:** this also makes single-player coaching *more honest*. Today the evaluator
can "see" that your needed tile is specifically in the draw pile vs. an opponent's
hand — information a real player wouldn't have. Adopting the unseen-pool model fixes
that in both modes, so single-player and multiplayer share one fair evaluator.

---

## 18. Sessions, rotation & scoring

A **Room** hosts a **Session** (a series of games); each **Game** is one engine run.
Score is kept across the session.

### Hierarchy & the position-vs-wind split

```
Room    — up to 4 fixed physical seats (userId | cpu), durable for the session
 └ Session — config (rotation rule, length) + running standings projection
     └ Game — windAssignment {E,S,W,N → seat}, action log, result + payouts
```

**Key insight:** the engine always plays **East-first** with labels E/S/W/N and
never learns about rotation. Each Game carries a `windAssignment` mapping physical
seats onto E/S/W/N for that hand. Rotation = re-mapping who holds the "E" label.
The engine is untouched; the Session layer owns rotation.

### Rotation (NMJL default, configurable)

- Dealer = **East**; East deals and takes the first turn; play moves **to the
  right** (matches the engine: turn order E→S→W→N, `PASSES_TO.right` = E→S).
- **East carries no scoring bonus in NMJL** — the dealer role only affects deal /
  turn order, never points. (Unlike Chinese mahjong.)
- After a hand: **East keeps the deal on an East win or a wall game; otherwise the
  deal passes right** to the next physical seat — the "East" label travels; players
  never physically move. (Alternative some groups use: always rotate. Session
  setting; default = keep-on-win/wall.)
- A **round** = one full rotation (4 dealerships), for display only.
- **Session length: open-ended** — play until players stop; standings persist
  across the whole session. No fixed length.

### Scoring (NMJL)

Each win is worth its **card value** (`HandPattern.value`).

- **Win on a discard:** discarder pays **2×**; the other two pay **1×** each
  (winner +4×).
- **Win by self-draw:** all three opponents pay **2×** each (winner +6×).
- **Wall game:** no payment.
- Optional bonuses (no-joker double, etc.): configurable, **off for v1**.
- Zero-sum; the Session keeps a **running standings tally** per player.

### Event-sourcing fit (no new infrastructure)

- A game's result (winner, pattern, value, per-player payouts) is a **fold** of that
  game's action log.
- Game end writes a `game_result{winner, kind: discard|self_draw|wall, payouts,
  windAssignmentNext}` event; the next game's dealer is derived from it.
- **Session standings are a projection** over the session's `game_result` events.

### Engine / schema gaps to close

- **Propagate `value`** onto the concrete `HandPattern` — `instantiateTemplate`
  currently drops it ([patterns.ts](../engine/patterns.ts)); `HandPattern` has no
  `value` field. Prerequisite for any scoring.
- **Payout calculator** — discard-double / self-pick-all-double / wall-none. New.
- **Schema** — `Room`, `Session` (settings + standings), `Game` (windAssignment,
  result, payouts), player slots. Today's `Game.winner` is the only piece present.
- **Rotation resolver** in the Session layer (apply the keep-on-win/wall rule).
