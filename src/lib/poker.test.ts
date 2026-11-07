import { describe, expect, it } from "vitest";
import {
  act,
  bestHand,
  blindsAt,
  buildPots,
  compareScores,
  DEFAULT_SETTINGS,
  evaluate5,
  forceAction,
  type GameState,
  inHand,
  newGame,
  nextHand,
  niceChips,
  options,
  potTotal,
  removeSeat,
  seatOrder,
  type Settings,
  settingsError,
} from "./poker";

/** Deterministic RNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const start = (n: number, s: Partial<Settings> = {}, seed = 1) =>
  newGame(ids(n), ids(n).map((x) => x.toUpperCase()), { ...DEFAULT_SETTINGS, ...s }, 0, rng(seed));
const chips = (g: GameState) => g.stacks.reduce((a, b) => a + b, 0) + potTotal(g);

describe("hand evaluation", () => {
  const score = (s: string) => evaluate5(s.split(" "));
  it("ranks categories", () => {
    expect(score("S14 S13 S12 S11 S10")[0]).toBe(8);
    expect(score("S9 H9 D9 C9 S2")[0]).toBe(7);
    expect(score("S9 H9 D9 C2 S2")[0]).toBe(6);
    expect(score("S2 S5 S9 S11 S13")[0]).toBe(5);
    expect(score("S14 H2 D3 C4 S5")).toEqual([4, 5]); // wheel
    expect(score("S10 H11 D12 C13 S14")).toEqual([4, 14]);
    expect(score("S9 H9 D9 C2 S3")[0]).toBe(3);
    expect(score("S9 H9 D2 C2 S3")[0]).toBe(2);
    expect(score("S9 H9 D2 C4 S3")[0]).toBe(1);
    expect(score("S9 H8 D2 C4 S3")[0]).toBe(0);
  });
  it("breaks ties by kickers", () => {
    expect(compareScores(score("S9 H9 D14 C4 S3"), score("D9 C9 S13 C12 S11"))).toBeGreaterThan(0);
    expect(compareScores(score("S14 H14 D2 C2 S3"), score("D13 C13 S12 C12 S14"))).toBeGreaterThan(0);
    expect(compareScores(score("S14 H2 D3 C4 S5"), score("S6 H2 D3 C4 S5"))).toBeLessThan(0);
    expect(compareScores(score("S9 H9 D2 C4 S3"), score("C9 D9 H2 S4 H3"))).toBe(0);
  });
  it("finds the best 5 of 7", () => {
    const b = bestHand("H14 H13 H12 H11 H10 S2 C2".split(" "));
    expect(b.name).toBe("Chintă roială");
    expect(bestHand("S2 S3 H4 D5 C9 H13 S14".split(" ")).score).toEqual([4, 5]);
    expect(bestHand("S2 H2 D2 C3 H3 S3 C9".split(" ")).score).toEqual([6, 3, 2]);
  });
});

describe("settings and blinds", () => {
  it("validates", () => {
    expect(settingsError(DEFAULT_SETTINGS)).toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, bigBlind: 10 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, buyIn: 30 })).not.toBeNull();
  });
  it("rounds to casino values and always increases", () => {
    expect(niceChips(45)).toBe(50);
    expect(niceChips(112)).toBe(120);
    for (const growth of [25, 50, 100]) {
      let prev = blindsAt({ smallBlind: 10, bigBlind: 20, growth }, 0);
      expect(prev).toEqual({ sb: 10, bb: 20 });
      for (let l = 1; l < 40; l++) {
        const b = blindsAt({ smallBlind: 10, bigBlind: 20, growth }, l);
        expect(b.bb).toBeGreaterThan(prev.bb);
        expect(b.sb).toBeGreaterThanOrEqual(prev.sb);
        expect(b.sb).toBeLessThan(b.bb);
        prev = b;
      }
    }
  });
  it("seats the host first", () => {
    expect(seatOrder(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(seatOrder(["a", "b"], "x")).toEqual(["a", "b"]);
  });
});

describe("betting", () => {
  it("heads-up: dealer posts SB and acts first preflop, BB first after the flop", () => {
    const g = start(2);
    expect(g.dealer).toBe(0);
    expect(g.sbSeat).toBe(0);
    expect(g.bbSeat).toBe(1);
    expect(g.turn).toBe(0);
    let s = act(g, 0, "call", undefined, 0);
    expect(s.turn).toBe(1); // BB option
    s = act(s, 1, "check", undefined, 0);
    expect(s.street).toBe("flop");
    expect(s.board).toHaveLength(3);
    expect(s.turn).toBe(1);
  });

  it("3 players: host deals, UTG acts first, everyone folds to the BB", () => {
    const g = start(3);
    expect([g.dealer, g.sbSeat, g.bbSeat, g.turn]).toEqual([0, 1, 2, 0]);
    let s = act(g, 0, "fold", undefined, 0);
    s = act(s, 1, "fold", undefined, 0);
    expect(s.phase).toBe("handover");
    expect(s.stacks).toEqual([1000, 990, 1010]);
    expect(s.last?.foldWin).toBe(true);
    s = nextHand(s, 1, rng(2));
    expect([s.dealer, s.sbSeat, s.bbSeat]).toEqual([1, 2, 0]);
  });

  it("enforces the minimum raise and reopens only on a full raise", () => {
    let s = start(3, { buyIn: 1000 });
    expect(() => act(s, 0, "raise", 30, 0)).toThrow(); // min raise to 40
    s = act(s, 0, "raise", 60, 0); // raise by 40
    expect(options(s, 1)?.minRaiseTo).toBe(100);
    s = act(s, 1, "call", undefined, 0);
    s = act(s, 2, "call", undefined, 0);
    expect(s.street).toBe("flop");
    expect(potTotal(s)).toBe(180);
  });

  it("a short all-in does not reopen the betting", () => {
    const g = start(3, { buyIn: 1000 });
    g.stacks[2] = 50; // BB short: 20 posted, 50 behind
    let s = act(g, 0, "raise", 60, 0);
    s = act(s, 1, "fold", undefined, 0);
    s = act(s, 2, "allin", undefined, 0); // to 70: +10, less than a full raise of 40
    expect(s.turn).toBe(0);
    const o = options(s, 0)!;
    expect(o.canRaise).toBe(false);
    expect(o.callAmount).toBe(10);
    s = act(s, 0, "call", undefined, 0);
    expect(s.phase).toBe("handover"); // ran out to showdown
    expect(s.board).toHaveLength(5);
    expect(s.stacks.reduce((a, b) => a + b, 0)).toBe(1000 + 990 + 50 + 30); // chips conserved
  });

  it("forced action checks when free, folds otherwise", () => {
    let s = start(3);
    s = forceAction(s, 0); // UTG facing BB -> fold
    expect(s.folded[0]).toBe(true);
    s = act(s, 1, "call", undefined, 0);
    s = forceAction(s, 0); // BB option -> check
    expect(s.street).toBe("flop");
  });
});

describe("pots", () => {
  it("builds main and side pots", () => {
    // A all-in 100, B all-in 300, C and D 500 each, D folded at the end.
    const pots = buildPots([100, 300, 500, 500], (i) => i !== 3);
    expect(pots).toEqual([
      { amount: 400, eligible: [0, 1, 2] },
      { amount: 600, eligible: [1, 2] },
      { amount: 400, eligible: [2] },
    ]);
  });
  it("returns uncalled chips and pays a side pot to the right player", () => {
    const g = start(3, { buyIn: 1000 }, 7);
    g.stacks = [80, 980, 980]; // seat 0 short (blinds already posted by 1 and 2)
    g.holes = [
      ["S14", "H14"],
      ["S13", "H13"],
      ["S2", "H7"],
    ];
    g.deck = ["D3", "C4", "S9", "D11", "C5", "D12", "H6", "D8", "C10"]; // popped from the end
    let s = act(g, 0, "allin", undefined, 0); // to 80
    s = act(s, 1, "raise", 500, 0);
    s = act(s, 2, "call", undefined, 0);
    // Post-flop: 1 and 2 check it down.
    while (s.phase === "betting") s = act(s, s.turn, "check", undefined, 0);
    expect(s.last?.pots.map((p) => p.amount)).toEqual([240, 840]);
    expect(s.last?.pots[0].winners).toEqual([0]); // aces win the main pot
    expect(s.last?.pots[1].winners).toEqual([1]); // kings beat 7-2 for the side pot
    expect(s.stacks.reduce((a, b) => a + b, 0)).toBe(80 + 980 + 980 + 10 + 20);
  });
});

describe("blind levels", () => {
  it("'hands' mode: every N hands", () => {
    let s = start(3, { blindMode: "hands", everyHands: 2 });
    const levels: number[] = [s.level];
    for (let h = 0; h < 5; h++) {
      while (s.phase === "betting") s = forceAction(s, 0);
      s = nextHand(s, 0, rng(h));
      levels.push(s.level);
    }
    expect(levels).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("'orbit' mode: rises when the host deals again, then follows the next seat once the host is out", () => {
    let s = start(4, { blindMode: "orbit" });
    const seen: [number, number][] = [[s.dealer, s.level]];
    for (let h = 0; h < 4; h++) {
      while (s.phase === "betting") s = forceAction(s, 0);
      s = nextHand(s, 0, rng(h));
      seen.push([s.dealer, s.level]);
    }
    expect(seen).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
    ]);
    // Host busts: seat 1 becomes the anchor.
    while (s.phase === "betting") s = forceAction(s, 0);
    s = removeSeat(s, 0, 0);
    expect(s.place[0]).toBe(4);
    const lvl = s.level;
    const dealers: [number, number][] = [];
    for (let h = 0; h < 3; h++) {
      s = nextHand(s, 0, rng(10 + h));
      dealers.push([s.dealer, s.level - lvl]);
      while (s.phase === "betting") s = forceAction(s, 0);
    }
    expect(dealers).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });

  it("'minutes' mode: the first hand after the interval", () => {
    let s = start(3, { blindMode: "minutes", everyMinutes: 5 });
    while (s.phase === "betting") s = forceAction(s, 0);
    s = nextHand(s, 4 * 60_000, rng(1));
    expect(s.level).toBe(0);
    while (s.phase === "betting") s = forceAction(s, 0);
    s = nextHand(s, 5 * 60_000, rng(2));
    expect(s.level).toBe(1);
  });
});

describe("leaving", () => {
  it("folds a leaving player and passes the turn", () => {
    let s = start(4);
    expect(s.turn).toBe(3);
    s = removeSeat(s, 3, 0);
    expect(s.turn).toBe(0);
    expect(s.left[3]).toBe(true);
  });
  it("ends the tournament when one player is left", () => {
    const s = removeSeat(start(2), 1, 0);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    expect(s.place).toEqual([1, 2]);
  });
});

describe("random tournaments", () => {
  it.each([2, 3, 6, 16])("%i players play to a single winner, chips conserved", (n) => {
    for (let seed = 1; seed <= 15; seed++) {
      const r = rng(seed * 97 + n);
      let s = start(n, { buyIn: 500, smallBlind: 5, bigBlind: 10, blindMode: "hands", everyHands: 3, growth: 100 }, seed);
      const total = n * 500;
      let forfeited = 0;
      let guard = 0;
      while (s.phase !== "over") {
        expect(++guard).toBeLessThan(20_000);
        if (s.phase === "handover") {
          s = nextHand(s, guard, r);
          continue;
        }
        // Sometimes somebody leaves mid-hand.
        if (r() < 0.002) {
          const alive = s.seats.map((_, i) => i).filter((i) => !s.left[i] && s.place[i] === null);
          const who = alive[Math.floor(r() * alive.length)];
          forfeited += s.stacks[who];
          s = removeSeat(s, who, guard);
          expect(chips(s) + forfeited).toBe(total);
          continue;
        }
        const seat = s.turn;
        expect(inHand(s, seat)).toBe(true);
        const o = options(s, seat)!;
        const x = r();
        if (x < 0.15 && !o.canCheck) s = act(s, seat, "fold", undefined, guard);
        else if (x < 0.25 && o.canRaise) s = act(s, seat, "allin", undefined, guard);
        else if (x < 0.45 && o.canRaise) {
          const to = o.minRaiseTo + Math.floor(r() * (o.maxRaiseTo - o.minRaiseTo + 1));
          s = act(s, seat, "raise", to, guard);
        } else s = act(s, seat, o.canCheck ? "check" : "call", undefined, guard);
        expect(chips(s) + forfeited).toBe(total);
        expect(s.stacks.every((c) => c >= 0)).toBe(true);
      }
      expect(s.winner).not.toBeNull();
      expect(s.left[s.winner!]).toBe(false);
      expect(s.place[s.winner!]).toBe(1);
      expect(s.stacks[s.winner!]).toBe(total - forfeited);
      // Places are a permutation of 1..n.
      expect([...s.place].sort((a, b) => a! - b!)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});
