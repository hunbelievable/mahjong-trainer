import { describe, it, expect, afterEach } from "vitest";
import { NoopEventLog, createEventLog } from "@/lib/server/eventLog";

describe("NoopEventLog", () => {
  it("append resolves without doing anything observable", async () => {
    const log = new NoopEventLog();
    await expect(
      log.append("ROOM1", { seq: 0, at: Date.now(), type: "init" }),
    ).resolves.toBeUndefined();
  });

  it("readAll always returns an empty array", async () => {
    const log = new NoopEventLog();
    expect(await log.readAll("ROOM1")).toEqual([]);
  });

  it("close resolves cleanly", async () => {
    await expect(new NoopEventLog().close()).resolves.toBeUndefined();
  });
});

describe("createEventLog", () => {
  const prevUrl = process.env.NATS_URL;
  afterEach(() => {
    if (prevUrl === undefined) delete process.env.NATS_URL;
    else process.env.NATS_URL = prevUrl;
  });

  it("falls back to NoopEventLog when NATS_URL isn't set — no NATS server required to run the app", async () => {
    delete process.env.NATS_URL;
    const log = await createEventLog();
    expect(log).toBeInstanceOf(NoopEventLog);
  });

  // NatsEventLog's actual connect/publish/readAll behavior against a real
  // JetStream server is NOT covered here — no NATS daemon is available in this
  // environment. createEventLog()'s try/catch fallback-to-Noop-on-connect-
  // failure is exercised logically (see source) but not by an automated test.
});
