# Multiplayer Design — mixed CPU + human across browsers

**Status:** Draft for review · **Date:** 2026-06-29
**Decisions locked:** Access via Cloudflare Zero Trust · MVP-first (auto-skip Charleston, auto-pass claims) · this doc is design-only, no code yet.

---

## 1. Goal & scope

Let 2–4 people, each on their own browser (potentially remote), play one NMJL
game together, with any unfilled seats played by CPUs. The server is the single
source of truth; each browser only ever sees its own hand.

**In scope (eventually):** rooms, seat selection, CPU fill, real-time play,
reconnection, full rules including multi-human Charleston and claims.

**MVP scope (v1):** one game, humans join and are assigned seats, **Charleston is
auto-played for all seats and the Second Charleston skipped**, **human claim
windows are auto-passed** (claims resolve among CPUs only). Humans act only on
their own draw→discard. This proves the entire networking spine before we take on
the multi-human Charleston/claim timing.

**Non-goals:** matchmaking, ranked play, mobile-native apps, spectator chat,
horizontal scaling beyond a single origin instance.

---

## 2. Why this fits the current code

The engine is already the right shape:

- `gameReducer(state, action, ctx)` ([engine/gameEngine.ts](../engine/gameEngine.ts)) is **pure and serializable** — the exact model for an authoritative server.
- The rules (`processDiscard`, `executeCharleston`, claim resolution, win detection) are **seat-agnostic**.
- We already run the engine **headless server-side** — the observe test harness drives a complete game with no UI.

What is *not* ready: the engine assumes exactly **one** human seat (`EngineContext.humanSeat`), and all realtime/transport/room infrastructure is absent (`next start` only, no socket deps).

---

## 3. Architecture overview

```
 Browser (seat W)          Browser (seat E)            Browser (seat S)
      │  SSE (state)            │                            │
      │  POST (actions)         │                            │
      └───────────┬─────────────┴──────────────┬─────────────┘
                  ▼                             ▼
        Cloudflare Access (identity)  +  Cloudflare Tunnel (TLS, no open ports)
                  │
                  ▼
        Home-lab origin — Next.js (next start), SINGLE instance
        ┌───────────────────────────────────────────────┐
        │ RoomManager (in-memory)                        │
        │   Room { canonical GameState, ctx, seatMap,    │
        │          subscribers[] }                       │
        │   ── reduce ── runCpuSteps ── redact ── push   │
        │ reuses engine/gameReducer unchanged in spirit  │
        └───────────────────────────────────────────────┘
                  │
                  ▼
        PostgreSQL (Prisma) — room metadata, optional state snapshots
```

The canonical `GameState` lives **in server memory**, one per room. Clients never
hold authority; they render whatever redacted view the server pushes and send
actions the server validates.

---

## 4. Deployment & access (Cloudflare Zero Trust)

- **Cloudflare Tunnel (`cloudflared`)** connects the home-lab origin to Cloudflare
  with no inbound ports opened. The browser hits `https://mahjong.<domain>`.
- **Cloudflare Access** sits in front and enforces an identity policy (Google /
  email OTP / etc.). Only authorized users reach the app at all.
- **Identity for free:** Access injects a signed JWT (`Cf-Access-Jwt-Assertion`)
  and `Cf-Access-Authenticated-User-Email` on every request. The origin
  **validates the JWT** against Cloudflare's Access public keys and trusts the
  email as the player identity. → **No login/accounts to build.**
- **Transport through CF:** both SSE and WebSockets are proxied by Cloudflare and
  carry the Access cookie automatically for same-domain browser connections.
- **Constraint:** because room state is in-memory, the origin must run as a
  **single instance** (no multi-worker/multi-replica) unless we later externalize
  state. Fine for a home-lab; documented as a scaling limit.
- **Trust boundary:** the origin should only be reachable via the tunnel, and must
  still validate the Access JWT so header spoofing is impossible even if the port
  were exposed.

---

## 5. Transport decision — **SSE + POST** (recommended)

| | SSE + POST (recommended) | WebSockets |
|---|---|---|
| Server | Pure Next route handlers (streamed `Response` + POST) — **no custom server** | Needs custom Node server or separate WS process |
| Fit for turn-based | Excellent (low message rate) | Excellent |
| Reconnection | `EventSource` auto-retry + `Last-Event-ID` cursor | Manual |
| Cloudflare | Proxied fine | Proxied fine |
| Bidirectional | Client→server via POST (fine for discrete actions) | Native |

A turn-based trainer with a handful of players does not need a socket. **SSE for
server→client state push + POST route handlers for actions** keeps the whole thing
inside the existing Next app (one container behind the tunnel) and avoids a custom
server. WebSockets stay the documented upgrade path if we ever want sub-second
bidirectional interactions (e.g. live claim races with tight timers).

---

## 6. Authoritative server runtime

New module, e.g. `lib/server/roomManager.ts` (server-only):

```
Room {
  id: string
  state: GameState              // canonical, full information
  ctx: EngineContext            // strategies + patterns + humanSeats
  seats: Record<PlayerId, SeatAssignment>   // human(email) | cpu(difficulty) | open
  subscribers: Map<seat, SSEStream>
  version: number               // monotonically increasing, for cursors
}
```

**Action pipeline (the heart of it):**

1. **Receive** a POST action with the player's Access email + room id.
2. **Authorize** — map email → seat via `seats`; reject if the action's seat isn't
   theirs, or it isn't that seat's turn.
3. **Validate** — the action must be legal for the current `pendingAction`
   (the reducer already rejects illegal actions by returning the same state; we
   treat "no change" as rejected).
4. **Reduce** — `state = gameReducer(state, action, ctx)`.
5. **Run CPU steps** — loop: while the next actor is a CPU (or, in MVP, a human
   claim window we auto-pass), generate and apply that action server-side (reuse
   the observe-harness logic). Stop when a *human* decision is required or the game
   finishes.
6. **Persist + broadcast** — bump `version`, optionally snapshot to DB, and push a
   **redacted view** to each subscribed seat.

CPU pacing (the `setTimeout` delay currently in [useSimulation](../lib/useSimulation.ts))
moves server-side so all clients see the same timing.

---

## 7. Hidden-information redaction (security-critical)

`GameState` holds **all four hands**. We must never ship that to a client.
`redactStateForSeat(state, seat) → PlayerView`:

```
PlayerView {
  you: PlayerId
  yourHand: Tile[]                       // full detail
  yourMelds: Meld[]
  opponents: Record<PlayerId, {          // others
    handCount: number                    // counts only — no tile identities
    melds: Meld[]                        // exposed melds are public
    seatLabel, isCpu, connected
  }>
  discardPile: Record<PlayerId, Tile[]>  // public
  wallCount: number                      // public; never the wall contents
  currentSeat, phase, pendingActionForYou, lastDraw(self only), winner, log
}
```

Rules: a seat sees its own tiles fully; opponents only as counts + public melds +
discards; the wall as a count. The redactor is the single chokepoint for leaks and
gets its own unit tests (assert no foreign `Tile` ids appear in a view).

---

## 8. Identity & seat ownership

- **playerId = Access-authenticated email** (validated from the JWT).
- **Claiming a seat:** in the lobby a player claims an open seat; `seats[W] =
  { kind: "human", email }`. Re-entry with the same email **reclaims the same
  seat** — this is our reconnection story for free.
- **Unclaimed seats** at start become `{ kind: "cpu", difficulty }`.
- A POST action is honored only if `seats[action.seat].email === requester email`.

---

## 9. Room lifecycle

```
create → lobby (claim seats, pick CPU difficulty for open seats, ready-up)
       → start (fill open seats with CPUs, deal)
       → playing
       → finished → (rematch keeps seat assignments)
```

MVP can ship with a **single hardcoded room** and seat-by-URL (`/play?seat=W`) to
defer lobby UI; the room model above is built from the start so the lobby is
additive, not a rewrite.

---

## 10. Engine changes

### MVP (small, contained): one human → many

`EngineContext.humanSeat: PlayerId` → **`humanSeats: Set<PlayerId>`** (or a
`seatKind: Record<PlayerId, "human"|"cpu">`). The coupling is ~6 spots, all keyed
on `ctx.humanSeat`:

- `ADVANCE_CPU`: `if (seat === ctx.humanSeat) return state` → `if (ctx.humanSeats.has(seat)) return state` ([gameEngine.ts:546](../engine/gameEngine.ts)).
- CPU-iteration skip at `:609`.
- Deal/`finishCharleston` pending-action: `ctx.humanSeat === "E" ? human_discard : null` → `humanSeats.has(currentSeat) ? … ` ([:754](../engine/gameEngine.ts)).
- Post-claim pending-action at `:909` / `:950`.
- Human actions (`HUMAN_DISCARD`, `HUMAN_PASS`) become **seat-addressed** (carry the acting seat, or infer from `currentSeat`) so the server can attribute them.

With this, the **play loop** already supports multiple humans: it simply pauses
whenever the current seat is human and resumes CPUs otherwise.

### Deferred to P4 (the genuinely harder part)

- **Multi-human Charleston:** collect each human seat's 3 tiles before
  `executeCharleston`; only auto-stage CPU seats. Today the flow is "one human
  stages → auto-stage everyone else" — it needs to await N humans per step.
- **Multi-human claim windows:** a single discard may be claimable by several
  humans; open a window, collect responses within a **timeout**, resolve by the
  existing claim priority. Today `claim_window` models one human claimant.

MVP avoids both by auto-playing Charleston for all seats and auto-passing human
claims — so these refactors don't block a playable v1.

---

## 11. Wire protocol

**Client → server (POST `/api/rooms/:id/action`):**
`{ seat, action }` where `action` is an existing engine action (discard, etc.).
Lobby: `JOIN`, `CLAIM_SEAT`, `SET_CPU_DIFFICULTY`, `READY`, `START`.

**Server → client (SSE `/api/rooms/:id/stream`):**
- `state` — a full `PlayerView` (sent on connect and after every change).
- `event` — log lines / toasts (someone joined, a claim happened).
- `error` — rejected action with reason.
Each message carries the room `version` as the SSE id for `Last-Event-ID` resume.

---

## 12. File / module layout (proposed)

```
engine/gameEngine.ts        # humanSeat → humanSeats (MVP change)
lib/server/roomManager.ts   # rooms, action pipeline, CPU stepping (server-only)
lib/server/redact.ts        # redactStateForSeat + tests
lib/server/access.ts        # validate Cf-Access JWT → email
app/api/rooms/route.ts                 # create/list rooms
app/api/rooms/[id]/stream/route.ts     # SSE state stream
app/api/rooms/[id]/action/route.ts     # POST actions
app/play/[room]/page.tsx               # multiplayer client (renders PlayerView)
prisma/schema.prisma                   # Room (+ optional GameSnapshot)
```

The existing single-player simulation page stays untouched; multiplayer is a new
surface that shares the engine.

---

## 13. Security checklist

- Redaction is the only path to clients; never serialize raw `GameState`.
- Validate the Access JWT on every request; trust email only after validation.
- All action legality is decided **server-side** by the reducer; the client is
  never trusted.
- Seat ownership enforced by email match.
- Rate limiting / abuse handled at the Cloudflare edge.

---

## 14. Phase plan

| Phase | Deliverable | Proves |
|---|---|---|
| **P1** | Server runtime + redaction; 1 room; humans by URL; **auto Charleston, auto-pass claims**; draw→discard only; CPUs fill | The whole spine: authority, redaction, multi-human turn loop |
| **P2** | SSE push + reconnection by email; server-side CPU pacing | Real-time + resilience |
| **P3** | Lobby: create/join, seat claim, CPU difficulty, ready-up, rematch | Usable rooms |
| **P4** | Multi-human Charleston + claim windows with timeouts | Full ruleset |
| **P5** | Disconnect → CPU takeover, spectators, DB resume | Robustness |

P1 is the meaningful milestone — two browsers finishing a game against CPUs.

---

## 15. Open questions / risks

1. **Single-instance memory** — acceptable for home-lab; revisit if we ever scale.
2. **Disconnect mid-turn** — MVP: turn just waits. P5: auto-CPU after a timeout.
3. **Claim timers (P4)** — how long to wait for human claims before resolving?
4. **Persistence depth** — snapshot every action (full resume) vs metadata only?
5. **Charleston UX for remote humans (P4)** — simultaneous staging needs a clear
   "waiting for others" state.
6. **Bot fairness** — CPUs run server-side with full info; ensure they only use
   information a fair player would (they already evaluate from their own hand).
```
