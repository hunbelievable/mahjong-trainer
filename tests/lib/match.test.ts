import { describe, it, expect } from "vitest";
import {
  computeWindAssignment,
  invertWindAssignment,
  nextDealer,
  computePayouts,
} from "@/lib/server/match";

describe("computeWindAssignment", () => {
  it("is the identity when the dealer is physical seat E", () => {
    expect(computeWindAssignment("E")).toEqual({ E: "E", S: "S", W: "W", N: "N" });
  });

  it("rotates winds so the dealer physical seat holds East", () => {
    const assignment = computeWindAssignment("S");
    expect(assignment.S).toBe("E");
    expect(assignment.W).toBe("S");
    expect(assignment.N).toBe("W");
    expect(assignment.E).toBe("N");
  });
});

describe("invertWindAssignment", () => {
  it("round-trips computeWindAssignment", () => {
    const assignment = computeWindAssignment("W");
    const inverted = invertWindAssignment(assignment);
    for (const physical of ["E", "S", "W", "N"] as const) {
      expect(inverted[assignment[physical]]).toBe(physical);
    }
  });
});

describe("nextDealer", () => {
  it("keeps the deal when the dealer (East) wins", () => {
    expect(nextDealer("E", "E", "discard")).toBe("E");
    expect(nextDealer("S", "S", "self_draw")).toBe("S");
  });

  it("keeps the deal on a wall game regardless of who's listed as winner", () => {
    expect(nextDealer("E", null, "wall")).toBe("E");
  });

  it("passes the deal to the next physical seat in turn order when someone else wins", () => {
    expect(nextDealer("E", "S", "discard")).toBe("S");
    expect(nextDealer("S", "N", "self_draw")).toBe("W");
    expect(nextDealer("N", "S", "discard")).toBe("E");
  });
});

describe("computePayouts", () => {
  it("wall game — no payment", () => {
    expect(computePayouts("wall", null, null, 25)).toEqual({ E: 0, S: 0, W: 0, N: 0 });
  });

  it("discard win — discarder pays 2x, other two pay 1x each, winner collects 4x", () => {
    const payouts = computePayouts("discard", "E", "S", 25);
    expect(payouts).toEqual({ E: 100, S: -50, W: -25, N: -25 });
    expect(Object.values(payouts).reduce((a, b) => a + b, 0)).toBe(0); // zero-sum
  });

  it("self-draw win — all three opponents pay 2x each, winner collects 6x", () => {
    const payouts = computePayouts("self_draw", "E", null, 25);
    expect(payouts).toEqual({ E: 150, S: -50, W: -50, N: -50 });
    expect(Object.values(payouts).reduce((a, b) => a + b, 0)).toBe(0); // zero-sum
  });
});
