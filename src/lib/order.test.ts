import { describe, expect, it } from "vitest";
import { bySeat, isPermutation, promotable, type Orderable } from "./order";

const m = (id: string, o: Partial<Orderable> = {}): Orderable => ({
  id,
  role: "player",
  seat: null,
  joined_at: `2026-01-01T00:00:0${id.length}Z`,
  queued_at: null,
  ...o,
});

describe("order", () => {
  it("bySeat: saved seats first, unplaced by join time", () => {
    const list = [m("c", { joined_at: "3" }), m("a", { joined_at: "1", seat: 1 }), m("b", { joined_at: "2", seat: 0 }), m("d", { joined_at: "0" })];
    expect(bySeat(list).map((x) => x.id)).toEqual(["b", "a", "d", "c"]);
  });
  it("isPermutation rejects duplicates, missing, extra and non-arrays", () => {
    expect(isPermutation(["a", "b"], ["b", "a"])).toBe(true);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "x"], ["a", "b"])).toBe(false);
    expect(isPermutation("ab", ["a", "b"])).toBe(false);
    expect(isPermutation([1, 2], ["a", "b"])).toBe(false);
  });
  it("promotable: queue order, capped by free seats, ignores unqueued and players", () => {
    const list = [
      m("o1", { role: "observer", queued_at: "2" }),
      m("o2", { role: "observer", queued_at: "1" }),
      m("o3", { role: "observer" }),
      m("p", { queued_at: "0" }),
      m("o4", { role: "observer", queued_at: "3" }),
    ];
    expect(promotable(list, 2).map((x) => x.id)).toEqual(["o2", "o1"]);
    expect(promotable(list, 0)).toEqual([]);
    expect(promotable(list, 10).map((x) => x.id)).toEqual(["o2", "o1", "o4"]);
  });
});
