import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// room.ts imports enforceExpiredKicks from membership (which imports room again); not used by the cleanup.
vi.mock("./membership", () => ({ enforceExpiredKicks: vi.fn() }));

// Minimal stand-in for the Supabase query builder used by cleanupAbandonedRooms:
//   select: from(rooms).select(...).lt("last_activity_at", cutoff).limit(n)       -> { data, error }
//   delete: from(rooms).delete().in("id", ids).lt("last_activity_at", cutoff)     -> { error }
const h = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[] | null, error: null as unknown },
  deleteResult: { error: null as unknown },
  calls: [] as { op: string; args: unknown[] }[],
}));

vi.mock("./db", () => {
  const chain = (kind: "select" | "delete") => {
    const q: Record<string, (...args: unknown[]) => unknown> = {};
    for (const op of ["select", "delete", "in", "eq", "lt", "limit"]) {
      q[op] = (...args: unknown[]) => {
        h.calls.push({ op: `${kind}.${op}`, args });
        if (kind === "select" && op === "limit") return Promise.resolve(h.selectResult);
        if (kind === "delete" && op === "lt") return Promise.resolve(h.deleteResult);
        return q;
      };
    }
    return q;
  };
  return {
    T: { rooms: "poker_rooms", players: "poker_players" },
    ROOM_COLUMNS: "",
    PLAYER_COLUMNS: "",
    db: () => ({
      from: () => ({
        select: (...args: unknown[]) => chain("select").select(...args),
        delete: (...args: unknown[]) => chain("delete").delete(...args),
      }),
    }),
  };
});

import { ROOM_ABANDONED_MS, ROOM_ABANDONED_PLAYING_MS } from "@/lib/poker";
import { cleanupAbandonedRooms } from "./room";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const old = ago(ROOM_ABANDONED_MS + 60_000);

const calls = (op: string) => h.calls.filter((c) => c.op === op);

describe("cleanupAbandonedRooms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.calls.length = 0;
    h.selectResult = { data: [], error: null };
    h.deleteResult = { error: null };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("only looks at rooms idle for longer than ROOM_ABANDONED_MS, and selects their status", async () => {
    await cleanupAbandonedRooms();
    expect(calls("select.lt")[0]?.args).toEqual(["last_activity_at", ago(ROOM_ABANDONED_MS)]);
    expect(String(calls("select.select")[0]?.args[0])).toContain("status");
    expect(calls("delete.delete")).toHaveLength(0);
  });

  it("keeps rooms with a recently seen member and deletes silent ones", async () => {
    h.selectResult = {
      data: [
        { id: "kept", status: "lobby", last_activity_at: old, players: [{ last_seen_at: old }, { last_seen_at: ago(30_000) }] },
        { id: "silent", status: "lobby", last_activity_at: old, players: [{ last_seen_at: old }, { last_seen_at: null }] },
        { id: "done", status: "finished", last_activity_at: old, players: [] },
      ],
      error: null,
    };
    await cleanupAbandonedRooms();
    expect(calls("delete.in").map((c) => c.args)).toEqual([["id", ["silent", "done"]]]);
  });

  it("re-checks the activity cutoff in the delete itself", async () => {
    h.selectResult = { data: [{ id: "silent", status: "lobby", last_activity_at: old, players: [] }], error: null };
    await cleanupAbandonedRooms();
    expect(calls("delete.lt").map((c) => c.args)).toEqual([["last_activity_at", ago(ROOM_ABANDONED_MS)]]);
  });

  it("keeps a running tournament nobody has open for less than 6 h", async () => {
    h.selectResult = {
      data: [
        { id: "running", status: "playing", last_activity_at: ago(5 * 3600_000), players: [{ last_seen_at: ago(5 * 3600_000) }] },
        { id: "recent", status: "playing", last_activity_at: old, players: [] },
      ],
      error: null,
    };
    await cleanupAbandonedRooms();
    expect(calls("delete.delete")).toHaveLength(0);
  });

  it("deletes a running tournament silent for more than 6 h, re-checking the 6 h cutoff", async () => {
    const stale = ago(ROOM_ABANDONED_PLAYING_MS + 60_000);
    h.selectResult = {
      data: [{ id: "running", status: "playing", last_activity_at: stale, players: [{ last_seen_at: stale }] }],
      error: null,
    };
    await cleanupAbandonedRooms();
    expect(calls("delete.in").map((c) => c.args)).toEqual([["id", ["running"]]]);
    expect(calls("delete.lt").map((c) => c.args)).toEqual([["last_activity_at", ago(ROOM_ABANDONED_PLAYING_MS)]]);
  });

  it("logs a select error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.selectResult = { data: null, error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(calls("delete.delete")).toHaveLength(0);
  });

  it("logs a delete error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.selectResult = { data: [{ id: "silent", status: "lobby", last_activity_at: old, players: [] }], error: null };
    h.deleteResult = { error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
