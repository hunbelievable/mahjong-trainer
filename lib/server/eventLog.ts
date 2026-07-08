// =============================================================================
// EventLog — durable persistence for GameRoom's action log (Option B: concrete
// resolved outcomes, not replayed inputs/RNG — see docs/multiplayer-design.md
// §6). GameRoom appends every RoomEvent here as it happens, fire-and-forget
// (durability must never block or crash live gameplay).
//
// SCOPE (deliberately bounded): this wires WRITE + READ-BACK durability only —
// proving events really round-trip through JetStream. It does NOT yet rehydrate
// a room's live authority from a persisted log after a process restart; that's
// a distinct, larger piece (fold-from-log + snapshot strategy, design doc §6
// open question #4) left for a dedicated future "resume" step. Pub/sub
// fan-out-to-clients (the doc's `game.room.<id>.view.<seat>` subjects) is also
// out of scope here — wsHub already does that job correctly for one instance;
// NATS-backed fan-out only matters once the app needs to scale beyond it.
//
// NatsEventLog's exact API usage (connect/jetstream/jetstreamManager/consumers)
// was verified against the installed `nats` package's own .d.ts files, not
// reconstructed from memory.
// =============================================================================

import { connect, type NatsConnection, type JetStreamClient } from "nats";
import type { RoomEvent } from "./gameRoom";

export interface EventLog {
  /** Durably append one event for a room. */
  append(roomId: string, event: RoomEvent): Promise<void>;
  /** Read back every persisted event for a room, in log order. */
  readAll(roomId: string): Promise<RoomEvent[]>;
  close(): Promise<void>;
}

/** Used when NATS isn't configured — the app still runs, nothing persists. */
export class NoopEventLog implements EventLog {
  async append(_roomId: string, _event: RoomEvent): Promise<void> {}
  async readAll(_roomId: string): Promise<RoomEvent[]> {
    return [];
  }
  async close(): Promise<void> {}
}

const STREAM_NAME = "ROOM_EVENTS";
const STREAM_SUBJECTS = ["game.room.*.actions"];
const subjectFor = (roomId: string) => `game.room.${roomId}.actions`;

export class NatsEventLog implements EventLog {
  private constructor(
    private nc: NatsConnection,
    private js: JetStreamClient,
  ) {}

  static async connect(servers: string): Promise<NatsEventLog> {
    const nc = await connect({ servers });
    const jsm = await nc.jetstreamManager();

    // Idempotent stream creation: check-then-create rather than relying on
    // add() being a no-op on an existing stream (behavior there varies by
    // server version).
    try {
      await jsm.streams.info(STREAM_NAME);
    } catch {
      await jsm.streams.add({ name: STREAM_NAME, subjects: STREAM_SUBJECTS });
    }

    return new NatsEventLog(nc, nc.jetstream());
  }

  async append(roomId: string, event: RoomEvent): Promise<void> {
    await this.js.publish(subjectFor(roomId), JSON.stringify(event));
  }

  async readAll(roomId: string): Promise<RoomEvent[]> {
    // An ordered ephemeral consumer filtered to this room's subject, reading
    // from the start. A single generous fetch is enough here — one game's
    // event log (discards/claims/win) is at most a few hundred entries, nowhere
    // near this batch size.
    const consumer = await this.js.consumers.get(STREAM_NAME, {
      filterSubjects: subjectFor(roomId),
    });
    const messages = await consumer.fetch({ max_messages: 10_000, expires: 2_000 });

    const events: RoomEvent[] = [];
    for await (const m of messages) {
      events.push(JSON.parse(m.string()) as RoomEvent);
    }
    return events.sort((a, b) => a.seq - b.seq);
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }
}

/**
 * Connect to NATS if configured (env NATS_URL), else fall back to a no-op log
 * so the app runs without a NATS server present (local dev without infra).
 * Failures to connect are logged, not thrown — durability is a nice-to-have,
 * not a hard dependency for serving live gameplay.
 */
export async function createEventLog(): Promise<EventLog> {
  const servers = process.env.NATS_URL;
  if (!servers) {
    console.warn("[eventLog] NATS_URL not set — running without durable event persistence.");
    return new NoopEventLog();
  }
  try {
    return await NatsEventLog.connect(servers);
  } catch (err) {
    console.error("[eventLog] failed to connect to NATS, falling back to no-op:", err);
    return new NoopEventLog();
  }
}
