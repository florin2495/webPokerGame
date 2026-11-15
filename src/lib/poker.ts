// Pure Texas Hold'em rules (No-Limit, tournament / freezeout) - shared by server and client, no I/O.
// Everyone starts with the same buy-in in chips; blinds go up by levels; the last player with chips wins.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const MAX_OBSERVERS = 16;
export const NICKNAME_MAX = 12;
/** Lobby/finished rooms nobody has open are closed after this long. */
export const ROOM_IDLE_MINUTES = 10;
/** A running game nobody has open is closed after this long (6 hours, same as ROOM_ABANDONED_PLAYING_MS). */
export const PLAYING_IDLE_MINUTES = 360;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;
/** The result of a hand stays on screen this long before the next hand is dealt automatically. */
export const NEXT_HAND_DELAY_MS = 8_000;
/** Extra time on top of the turn timer, for network latency, before a turn can be forced. */
export const TIMEOUT_GRACE_MS = 1_500;
/** A player with auto-check / auto-blind on acts automatically this long into their turn. */
export const AUTO_DELAY_MS = 5_000;

/** "10 minute" / "60 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const idle = now - new Date(lastActivityAt).getTime();
  if (status === "playing") return idle > PLAYING_IDLE_MINUTES * 60_000;
  return idle > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A lobby / finished room is abandoned once its last activity is older than this AND no member (player or
 * observer) has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;
/** Same rule for a running tournament ("playing"), with a much longer limit: 6 hours. */
export const ROOM_ABANDONED_PLAYING_MS = 6 * 3600_000;

/** The abandoned-room limit for a room in this status. */
export function abandonedLimitMs(status: string): number {
  return status === "playing" ? ROOM_ABANDONED_PLAYING_MS : ROOM_ABANDONED_MS;
}

export function isRoomAbandoned(
  status: string,
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const limit = abandonedLimitMs(status);
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= limit;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

export class RuleError extends Error {}
const rule = (ok: unknown, message: string): void => {
  if (!ok) throw new RuleError(message);
};

// ---------------------------------------------------------------------------
// Cards: "<suit><rank>", rank 2..14 (11 J, 12 Q, 13 K, 14 A). Example: "H14" = A♥.
// ---------------------------------------------------------------------------
export type Suit = "S" | "H" | "D" | "C";
export type Card = string;
export const SUITS: Suit[] = ["S", "H", "C", "D"];
export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const suitOf = (c: Card): Suit => c[0] as Suit;
export const rankOf = (c: Card): number => Number(c.slice(1));
export const isRed = (s: Suit) => s === "H" || s === "D";
export function rankLabel(r: number): string {
  return ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] ?? String(r);
}
export const cardLabel = (c: Card) => `${rankLabel(rankOf(c))}${SUIT_SYMBOL[suitOf(c)]}`;

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push(`${s}${r}`);
  return deck;
}

/** Fisher-Yates. `random` returns [0, 1); injectable for tests (the server passes a crypto RNG). */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Hand evaluation. A score is [category, ...tiebreak ranks]; compare lexicographically.
// ---------------------------------------------------------------------------
export const HAND_NAMES = [
  "Carte mare",
  "Pereche",
  "Două perechi",
  "Trei de un fel",
  "Chintă",
  "Culoare",
  "Full house",
  "Careu",
  "Chintă de culoare",
];

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Score of exactly 5 cards. */
export function evaluate5(cards: Card[]): number[] {
  const ranks = cards.map(rankOf).sort((x, y) => y - x);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
  }
  if (straightHigh && flush) return [8, straightHigh];

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Groups by size, then by rank: [[rank, count], ...]
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  const order = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join("");

  if (shape === "41") return [7, ...order];
  if (shape === "32") return [6, ...order];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (shape === "311") return [3, ...order];
  if (shape === "221") return [2, ...order];
  if (shape === "2111") return [1, ...order];
  return [0, ...ranks];
}

export interface BestHand {
  score: number[];
  cards: Card[];
  name: string;
}

/** Best 5-card hand out of 5..7 cards. */
export function bestHand(cards: Card[]): BestHand {
  let best: BestHand | null = null;
  const n = cards.length;
  const pick = (start: number, chosen: Card[]) => {
    if (chosen.length === 5) {
      const score = evaluate5(chosen);
      if (!best || compareScores(score, best.score) > 0) best = { score, cards: [...chosen], name: "" };
      return;
    }
    for (let i = start; i <= n - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  const b = best as unknown as BestHand;
  b.name = b.score[0] === 8 && b.score[1] === 14 ? "Chintă roială" : HAND_NAMES[b.score[0]];
  return b;
}

// ---------------------------------------------------------------------------
// Settings and blind levels
// ---------------------------------------------------------------------------
/**
 * When the blinds go up:
 *  - "hands":   every `everyHands` hands
 *  - "orbit":   every time the anchor deals again. The anchor is the host (who deals the first
 *               hand); once the host is out, the next player who joined after them, and so on.
 *               So the blinds rise after every full orbit of the dealer button, whatever the
 *               number of players still in.
 *  - "minutes": the first hand dealt after `everyMinutes` minutes on the same level.
 */
export type BlindMode = "hands" | "orbit" | "minutes";
export const BLIND_MODES: BlindMode[] = ["hands", "orbit", "minutes"];

export interface Settings {
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  blindMode: BlindMode;
  everyHands: number;
  everyMinutes: number;
  /** Blind increase per level, in percent (50 = ×1.5). */
  growth: number;
  /** Seconds to act (10-60). When they run out, the player folds automatically. */
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  buyIn: 1000,
  smallBlind: 10,
  bigBlind: 20,
  blindMode: "hands",
  everyHands: 10,
  everyMinutes: 10,
  growth: 50,
  turnSeconds: 30,
};

export const LIMITS = {
  buyIn: [100, 1_000_000],
  smallBlind: [1, 100_000],
  bigBlind: [2, 200_000],
  everyHands: [1, 100],
  everyMinutes: [1, 120],
} as const;
export const GROWTH_OPTIONS = [25, 50, 100];
export const TURN_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

/** Problem with these settings, in Romanian, or null when valid. */
export function settingsError(s: Settings): string | null {
  const int = (v: number, [lo, hi]: readonly [number, number]) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(s.buyIn, LIMITS.buyIn)) return `Buy-in-ul trebuie să fie între ${LIMITS.buyIn[0]} și ${LIMITS.buyIn[1]} jetoane.`;
  if (!int(s.smallBlind, LIMITS.smallBlind)) return "Small blind invalid.";
  if (!int(s.bigBlind, LIMITS.bigBlind)) return "Big blind invalid.";
  if (s.bigBlind <= s.smallBlind) return "Big blind-ul trebuie să fie mai mare decât small blind-ul.";
  if (s.bigBlind * 2 > s.buyIn) return "Buy-in-ul trebuie să fie cel puțin 2 big blind-uri.";
  if (!BLIND_MODES.includes(s.blindMode)) return "Mod de creștere a blind-urilor invalid.";
  if (!int(s.everyHands, LIMITS.everyHands)) return `Numărul de mâini trebuie să fie între ${LIMITS.everyHands[0]} și ${LIMITS.everyHands[1]}.`;
  if (!int(s.everyMinutes, LIMITS.everyMinutes)) return `Minutele trebuie să fie între ${LIMITS.everyMinutes[0]} și ${LIMITS.everyMinutes[1]}.`;
  if (!GROWTH_OPTIONS.includes(s.growth)) return "Creștere invalidă.";
  if (!TURN_OPTIONS.includes(s.turnSeconds)) return "Timpul pe tură trebuie să fie între 10 și 60 de secunde.";
  return null;
}

/** Rounds to a "casino" value: 2 significant digits from 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8. */
export function niceChips(x: number): number {
  if (x <= 10) return Math.max(1, Math.round(x));
  const p = 10 ** Math.floor(Math.log10(x));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const m = x / p;
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - m) <= Math.abs(best - m)) best = s;
  return Math.round(best * p);
}

/** Small / big blind of a level (level 0 = the starting blinds). Always strictly increasing. */
export function blindsAt(s: Pick<Settings, "smallBlind" | "bigBlind" | "growth">, level: number): { sb: number; bb: number } {
  let sb = s.smallBlind;
  let bb = s.bigBlind;
  const factor = 1 + s.growth / 100;
  const ratio = s.smallBlind / s.bigBlind;
  for (let k = 1; k <= level; k++) {
    const nextBb = Math.max(bb + 1, niceChips(s.bigBlind * factor ** k));
    const nextSb = Math.min(nextBb - 1, Math.max(sb + 1, niceChips(nextBb * ratio)));
    sb = nextSb;
    bb = nextBb;
  }
  return { sb, bb };
}

/**
 * Seat order: the host first (they deal the first hand), then everyone else in join order.
 * An observer host is simply not seated.
 */
export function seatOrder(playerIdsByJoin: string[], hostId: string | null): string[] {
  if (hostId && playerIdsByJoin.includes(hostId)) return [hostId, ...playerIdsByJoin.filter((id) => id !== hostId)];
  return [...playerIdsByJoin];
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
export type Street = "preflop" | "flop" | "turn" | "river";
export type ActionKind = "fold" | "check" | "call" | "raise" | "allin";

export interface LogEntry {
  seat: number;
  /** fold, check, call, bet, raise, allin, sb, bb, timeout */
  what: string;
  /** Amount for call; total bet ("to") for bet/raise/allin; posted chips for blinds. */
  amount?: number;
  street: Street;
}

export interface PotResult {
  amount: number;
  winners: number[];
  /** Shares paid out, parallel to `winners`. */
  shares: number[];
}

export interface ShownHand {
  seat: number;
  cards: Card[];
  best: Card[];
  name: string;
}

export interface HandSummary {
  handNo: number;
  board: Card[];
  /** True when everyone else folded: no cards are shown. */
  foldWin: boolean;
  pots: PotResult[];
  shown: ShownHand[];
  /** Chips won (net of refunds) per seat in this hand, for the result banner. */
  won: number[];
  /** Seats eliminated in this hand. */
  busted: number[];
}

export interface GameState {
  seats: string[];
  names: string[];
  settings: Settings;
  stacks: number[];
  /** Final place once out (1 = winner), null while still in the tournament. */
  place: (number | null)[];
  /** Left the room (or was kicked): out of the tournament, chips forfeited. */
  left: boolean[];
  handNo: number;
  level: number;
  /** handNo of the first hand of the current level. */
  levelHand: number;
  /** ms epoch when the current level started. */
  levelStartedAt: number;
  /** Seat whose deal raises the blinds in "orbit" mode (first seat still in). */
  anchor: number;
  dealer: number;
  sbSeat: number;
  bbSeat: number;
  /** Blinds of this hand (fixed when the hand is dealt). */
  sb: number;
  bb: number;
  deck: Card[];
  holes: Card[][];
  board: Card[];
  street: Street;
  folded: boolean[];
  allIn: boolean[];
  /** Chips put in on the current street. */
  bets: number[];
  /** Chips put in during the whole hand. */
  total: number[];
  /** Stacks when the hand was dealt (orders same-hand eliminations). */
  startStacks: number[];
  currentBet: number;
  /** Size of the last full raise on this street (minimum next raise increment). */
  minRaise: number;
  /** Acted since the last full raise. A player whose flag is set may only call or fold a short all-in. */
  acted: boolean[];
  /** Seat to act, -1 when nobody. */
  turn: number;
  turnStartedAt: number;
  phase: "betting" | "handover" | "over";
  handEndedAt: number;
  log: LogEntry[];
  last: HandSummary | null;
  winner: number | null;
  /** Per seat, chosen by each player: after AUTO_DELAY_MS check if free, otherwise fold. */
  autoCheck?: boolean[];
  /** Per seat: after AUTO_DELAY_MS, pre-flop with no raise yet, call the big blind (check if already in). */
  autoBlind?: boolean[];
}

const clone = (g: GameState): GameState => JSON.parse(JSON.stringify(g)) as GameState;

/** Still in the tournament (between hands: has chips and did not leave). */
export const isAlive = (g: GameState, i: number) => g.place[i] === null && !g.left[i] && g.stacks[i] > 0;
/** Dealt in this hand and not folded. */
export const inHand = (g: GameState, i: number) => g.holes[i]?.length === 2 && !g.folded[i];
export const potTotal = (g: GameState) => g.total.reduce((a, b) => a + b, 0);

function nextSeat(g: GameState, from: number, ok: (i: number) => boolean): number {
  const n = g.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (ok(i)) return i;
  }
  return -1;
}

/** Seat that raises the blinds in "orbit" mode: the first seat (host, then join order) still in. */
export function anchorSeat(g: GameState): number {
  return nextSeat(g, -1, (i) => isAlive(g, i));
}

export function newGame(
  seats: string[],
  names: string[],
  settings: Settings,
  now: number,
  random: () => number = Math.random,
): GameState {
  const n = seats.length;
  rule(n >= MIN_PLAYERS && n <= MAX_PLAYERS, `Poker se joacă în ${MIN_PLAYERS}-${MAX_PLAYERS} jucători.`);
  const g: GameState = {
    seats,
    names,
    settings,
    stacks: Array(n).fill(settings.buyIn),
    place: Array(n).fill(null),
    left: Array(n).fill(false),
    handNo: 0,
    level: 0,
    levelHand: 1,
    levelStartedAt: now,
    anchor: 0,
    dealer: 0,
    sbSeat: -1,
    bbSeat: -1,
    sb: settings.smallBlind,
    bb: settings.bigBlind,
    deck: [],
    holes: Array.from({ length: n }, () => []),
    board: [],
    street: "preflop",
    folded: Array(n).fill(false),
    allIn: Array(n).fill(false),
    bets: Array(n).fill(0),
    total: Array(n).fill(0),
    startStacks: Array(n).fill(settings.buyIn),
    currentBet: 0,
    minRaise: settings.bigBlind,
    acted: Array(n).fill(false),
    turn: -1,
    turnStartedAt: now,
    phase: "handover",
    handEndedAt: now,
    log: [],
    last: null,
    winner: null,
    autoCheck: Array(n).fill(false),
    autoBlind: Array(n).fill(false),
  };
  return dealHand(g, now, random, true);
}

/** Whether the blinds go up when hand number `handNo` is dealt by `dealer`. */
function levelUp(g: GameState, now: number): boolean {
  const s = g.settings;
  if (s.blindMode === "hands") return g.handNo - g.levelHand >= s.everyHands;
  if (s.blindMode === "orbit") return g.dealer === g.anchor;
  return now - g.levelStartedAt >= s.everyMinutes * 60_000;
}

/** Hands until the next level ("hands" mode), for the UI. */
export function handsUntilLevelUp(g: GameState): number {
  return Math.max(1, g.settings.everyHands - (g.handNo - g.levelHand));
}

function dealHand(src: GameState, now: number, random: () => number, first = false): GameState {
  const g = first ? src : clone(src);
  const n = g.seats.length;
  g.handNo += 1;
  g.anchor = anchorSeat(g);
  g.dealer = first ? 0 : nextSeat(g, g.dealer, (i) => isAlive(g, i));
  if (!first && levelUp(g, now)) {
    g.level += 1;
    g.levelHand = g.handNo;
    g.levelStartedAt = now;
  }
  const { sb, bb } = blindsAt(g.settings, g.level);
  g.sb = sb;
  g.bb = bb;

  g.deck = shuffle(fullDeck(), random);
  g.board = [];
  g.street = "preflop";
  g.folded = Array(n).fill(false);
  g.allIn = Array(n).fill(false);
  g.bets = Array(n).fill(0);
  g.total = Array(n).fill(0);
  g.acted = Array(n).fill(false);
  g.startStacks = [...g.stacks];
  g.log = [];
  g.phase = "betting";
  g.holes = Array.from({ length: n }, () => []);

  const alive = g.seats.map((_, i) => i).filter((i) => isAlive(g, i));
  for (let round = 0; round < 2; round++) {
    for (let k = 1; k <= n; k++) {
      const i = (g.dealer + k) % n;
      if (alive.includes(i)) g.holes[i].push(g.deck.pop()!);
    }
  }

  if (alive.length === 2) {
    g.sbSeat = g.dealer; // heads-up: the dealer posts the small blind and acts first preflop
    g.bbSeat = nextSeat(g, g.dealer, (i) => isAlive(g, i));
  } else {
    g.sbSeat = nextSeat(g, g.dealer, (i) => isAlive(g, i));
    g.bbSeat = nextSeat(g, g.sbSeat, (i) => isAlive(g, i));
  }
  post(g, g.sbSeat, sb, "sb");
  post(g, g.bbSeat, bb, "bb");
  g.currentBet = bb;
  g.minRaise = bb;

  g.turn = -1;
  return advance(g, g.bbSeat, now);
}

function post(g: GameState, seat: number, amount: number, what: string) {
  const paid = Math.min(amount, g.stacks[seat]);
  pay(g, seat, paid);
  g.log.push({ seat, what, amount: paid, street: g.street });
}

function pay(g: GameState, seat: number, chips: number) {
  g.stacks[seat] -= chips;
  g.bets[seat] += chips;
  g.total[seat] += chips;
  if (g.stacks[seat] === 0) g.allIn[seat] = true;
}

const canAct = (g: GameState, i: number) => inHand(g, i) && !g.allIn[i];

/** Whether seat i still has to act on this street. */
export function needsAction(g: GameState, i: number): boolean {
  if (!canAct(g, i)) return false;
  if (g.bets[i] < g.currentBet) return true;
  if (g.acted[i]) return false;
  // Nobody left to play against: the last player able to act who already matched does not act.
  const others = g.seats.some((_, j) => j !== i && canAct(g, j));
  return others;
}

/** Moves the turn to the next seat that must act after `from`, or closes the street. */
function advance(g: GameState, from: number, now: number): GameState {
  const next = nextSeat(g, from, (i) => needsAction(g, i));
  if (next >= 0) {
    g.turn = next;
    g.turnStartedAt = now;
    return g;
  }
  return endStreet(g, now);
}

function endStreet(g: GameState, now: number): GameState {
  g.turn = -1;
  if (g.street === "river") return showdown(g, now);
  g.bets = g.bets.map(() => 0);
  g.currentBet = 0;
  g.minRaise = g.bb;
  g.acted = g.acted.map(() => false);
  g.deck.pop(); // burn
  if (g.street === "preflop") {
    g.board.push(g.deck.pop()!, g.deck.pop()!, g.deck.pop()!);
    g.street = "flop";
  } else if (g.street === "flop") {
    g.board.push(g.deck.pop()!);
    g.street = "turn";
  } else {
    g.board.push(g.deck.pop()!);
    g.street = "river";
  }
  // Post-flop the first player left of the dealer acts. If nobody can (all-in), deal on.
  return advance(g, g.dealer, now);
}

/** Legal options of seat `i` right now (null when it is not their turn). */
export interface Options {
  canCheck: boolean;
  /** Chips to call (0 when checking is possible). Capped at the stack. */
  callAmount: number;
  canRaise: boolean;
  /** Bet/raise totals for this street ("raise to"). */
  minRaiseTo: number;
  maxRaiseTo: number;
}

export function options(g: GameState, i: number): Options | null {
  if (g.phase !== "betting" || g.turn !== i) return null;
  const toCall = Math.max(0, g.currentBet - g.bets[i]);
  const maxRaiseTo = g.bets[i] + g.stacks[i];
  const opponents = g.seats.some((_, j) => j !== i && canAct(g, j));
  const canRaise = !g.acted[i] && opponents && g.stacks[i] > toCall;
  const minRaiseTo = Math.min(maxRaiseTo, g.currentBet + g.minRaise);
  return {
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, g.stacks[i]),
    canRaise,
    minRaiseTo,
    maxRaiseTo,
  };
}

/**
 * Applies a betting action of `seat`.
 *  - raise: `amount` is the total bet on this street ("raise to"); `allin` puts the whole stack in.
 */
export function act(src: GameState, seat: number, kind: ActionKind, amount: number | undefined, now: number): GameState {
  rule(src.phase === "betting", "Nu se licitează acum.");
  rule(src.turn === seat, "Nu e rândul tău.");
  const opt = options(src, seat)!;
  const g = clone(src);
  const street = g.street;

  if (kind === "fold") {
    g.folded[seat] = true;
    g.log.push({ seat, what: "fold", street });
    const left = g.seats.map((_, i) => i).filter((i) => inHand(g, i));
    if (left.length === 1) return foldWin(g, left[0], now);
  } else if (kind === "check") {
    rule(opt.canCheck, "Nu poți da check: trebuie să plătești sau să renunți.");
    g.log.push({ seat, what: "check", street });
  } else if (kind === "call") {
    rule(opt.callAmount > 0, "Nu ai ce plăti. Dă check.");
    pay(g, seat, opt.callAmount);
    g.log.push({ seat, what: g.allIn[seat] ? "allin" : "call", amount: g.allIn[seat] ? g.bets[seat] : opt.callAmount, street });
  } else {
    const to = kind === "allin" ? opt.maxRaiseTo : Number(amount);
    rule(Number.isInteger(to), "Sumă invalidă.");
    rule(to <= opt.maxRaiseTo, "Nu ai destule jetoane.");
    if (to <= g.currentBet) {
      // An all-in that does not even cover the call is a call for less.
      rule(kind === "allin", `Trebuie să mărești la cel puțin ${opt.minRaiseTo}.`);
      pay(g, seat, to - g.bets[seat]);
      g.log.push({ seat, what: "allin", amount: g.bets[seat], street });
    } else {
      rule(opt.canRaise, "Nu mai poți mări în runda asta, doar plăti sau renunța.");
      rule(to >= opt.minRaiseTo || to === opt.maxRaiseTo, `Trebuie să mărești la cel puțin ${opt.minRaiseTo}.`);
      const increment = to - g.currentBet;
      const wasBet = g.currentBet === 0;
      pay(g, seat, to - g.bets[seat]);
      if (increment >= g.minRaise) {
        // Full raise: reopens the betting for everyone else.
        g.minRaise = increment;
        g.acted = g.acted.map((a, j) => (j === seat ? a : false));
      }
      g.currentBet = to;
      g.log.push({ seat, what: g.allIn[seat] ? "allin" : wasBet ? "bet" : "raise", amount: to, street });
    }
  }
  g.acted[seat] = true;
  return advance(g, seat, now);
}

/**
 * Why a turn is played for the player:
 *  - "timeout": the turn timer ran out -> fold
 *  - "host":    the host skipped a stalled player -> check if free, otherwise fold
 *  - "auto":    the player's own auto-check / auto-blind option (see autoAction)
 */
export type ForceReason = "timeout" | "host" | "auto";

/** The automatic action the current player chose in advance, or null if none applies right now. */
export function autoAction(g: GameState): "check" | "call" | "fold" | null {
  if (g.phase !== "betting" || g.turn < 0) return null;
  const seat = g.turn;
  const o = options(g, seat);
  if (!o) return null;
  // Auto-blind: pre-flop, nobody raised yet (the bet is still the big blind) -> pay the big blind.
  if (g.autoBlind?.[seat] && g.street === "preflop" && g.currentBet === g.bb) return o.canCheck ? "check" : "call";
  if (g.autoCheck?.[seat]) return o.canCheck ? "check" : "fold";
  return null;
}

/** ms epoch when the current player's auto option fires, null when none applies. */
export function autoDeadline(g: GameState): number | null {
  return autoAction(g) ? g.turnStartedAt + AUTO_DELAY_MS : null;
}

export function forceAction(g: GameState, now: number, reason: ForceReason = "host"): GameState {
  rule(g.phase === "betting" && g.turn >= 0, "Nu așteaptă nimeni acum.");
  const seat = g.turn;
  const opt = options(g, seat)!;
  let kind: "check" | "call" | "fold";
  if (reason === "timeout") kind = "fold";
  else if (reason === "auto") {
    const a = autoAction(g);
    rule(a !== null, "Jucătorul nu are nicio acțiune automată activă.");
    kind = a!;
  } else kind = opt.canCheck ? "check" : "fold";
  const next = act(g, seat, kind, undefined, now);
  const entry = [...next.log].reverse().find((e) => e.seat === seat);
  if (entry) entry.what = `${reason}-${entry.what}`;
  return next;
}

/** A player turns their own auto-check / auto-blind options on or off (any time during the tournament). */
export function setAuto(src: GameState, seat: number, flags: { autoCheck?: boolean; autoBlind?: boolean }): GameState {
  rule(src.phase !== "over", "Turneul s-a terminat.");
  const g = clone(src);
  const n = g.seats.length;
  g.autoCheck = g.autoCheck ?? Array(n).fill(false);
  g.autoBlind = g.autoBlind ?? Array(n).fill(false);
  if (flags.autoCheck !== undefined) g.autoCheck[seat] = flags.autoCheck;
  if (flags.autoBlind !== undefined) g.autoBlind[seat] = flags.autoBlind;
  return g;
}

/** Splits `amount` between `winners`; odd chips go to the first winners left of the dealer. */
function split(g: GameState, amount: number, winners: number[]): number[] {
  const n = g.seats.length;
  const ordered = [...winners].sort((a, b) => ((a - g.dealer - 1 + n) % n) - ((b - g.dealer - 1 + n) % n));
  const base = Math.floor(amount / winners.length);
  let odd = amount - base * winners.length;
  const shares = new Map<number, number>();
  for (const w of ordered) {
    shares.set(w, base + (odd > 0 ? 1 : 0));
    if (odd > 0) odd--;
  }
  return winners.map((w) => shares.get(w)!);
}

/** Gives back the part of the biggest contribution nobody matched. */
function refundUncalled(g: GameState): number[] {
  const refunds = g.seats.map(() => 0);
  const order = g.total.map((t, i) => [t, i]).sort((a, b) => b[0] - a[0]);
  if (order.length < 2) return refunds;
  const [[top, seat], [second]] = order;
  if (top > second) {
    refunds[seat] = top - second;
    g.total[seat] -= refunds[seat];
    g.stacks[seat] += refunds[seat];
  }
  return refunds;
}

function foldWin(g: GameState, winner: number, now: number): GameState {
  refundUncalled(g);
  const pot = potTotal(g);
  g.stacks[winner] += pot;
  const won = g.seats.map(() => 0);
  won[winner] = pot;
  return finishHand(g, { handNo: g.handNo, board: [...g.board], foldWin: true, pots: [{ amount: pot, winners: [winner], shares: [pot] }], shown: [], won, busted: [] }, now);
}

/** Main pot + side pots from the hand contributions. Folded chips count, folded players cannot win. */
export function buildPots(total: number[], eligible: (i: number) => boolean): { amount: number; eligible: number[] }[] {
  const levels = [...new Set(total.filter((t) => t > 0))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  let carry = 0;
  for (const level of levels) {
    const amount = total.reduce((sum, t) => sum + Math.max(0, Math.min(t, level) - prev), 0) + carry;
    const who = total.map((t, i) => [t, i]).filter(([t, i]) => t >= level && eligible(i)).map(([, i]) => i);
    prev = level;
    if (who.length === 0) {
      carry = amount; // only folded players reached this level: roll into the next pot
      continue;
    }
    carry = 0;
    const same = pots[pots.length - 1];
    if (same && same.eligible.length === who.length && same.eligible.every((x, k) => x === who[k])) same.amount += amount;
    else pots.push({ amount, eligible: who });
  }
  if (carry > 0 && pots.length > 0) pots[pots.length - 1].amount += carry;
  return pots;
}

function showdown(g: GameState, now: number): GameState {
  g.turn = -1;
  refundUncalled(g);
  const live = g.seats.map((_, i) => i).filter((i) => inHand(g, i));
  const hands = new Map(live.map((i) => [i, bestHand([...g.holes[i], ...g.board])]));
  const won = g.seats.map(() => 0);
  const pots: PotResult[] = [];
  for (const pot of buildPots(g.total, (i) => inHand(g, i))) {
    let best: number[] | null = null;
    let winners: number[] = [];
    for (const i of pot.eligible) {
      const score = hands.get(i)!.score;
      const c = best ? compareScores(score, best) : 1;
      if (c > 0) {
        best = score;
        winners = [i];
      } else if (c === 0) winners.push(i);
    }
    const shares = split(g, pot.amount, winners);
    winners.forEach((w, k) => {
      g.stacks[w] += shares[k];
      won[w] += shares[k];
    });
    pots.push({ amount: pot.amount, winners, shares });
  }
  const shown: ShownHand[] = live.map((i) => {
    const h = hands.get(i)!;
    return { seat: i, cards: [...g.holes[i]], best: h.cards, name: h.name };
  });
  return finishHand(g, { handNo: g.handNo, board: [...g.board], foldWin: false, pots, shown, won, busted: [] }, now);
}

/** Records eliminations; ends the tournament when one player is left. */
function finishHand(g: GameState, summary: HandSummary, now: number): GameState {
  g.turn = -1;
  g.bets = g.bets.map(() => 0);
  g.total = g.total.map(() => 0); // everything is paid out
  g.currentBet = 0;
  summary.busted = eliminate(g);
  g.last = summary;
  g.handEndedAt = now;
  return checkOver(g);
}

/** Gives a final place to every seat that just went out. Bigger stack at the start of the hand = better place. */
function eliminate(g: GameState): number[] {
  const out = g.seats
    .map((_, i) => i)
    .filter((i) => g.place[i] === null && (g.stacks[i] === 0 || g.left[i]))
    .sort((a, b) => g.startStacks[b] - g.startStacks[a]);
  const stillIn = g.seats.filter((_, i) => isAlive(g, i)).length;
  out.forEach((i, k) => {
    g.place[i] = stillIn + 1 + k;
    g.stacks[i] = 0;
  });
  return out;
}

function checkOver(g: GameState): GameState {
  const alive = g.seats.map((_, i) => i).filter((i) => isAlive(g, i));
  if (alive.length <= 1) {
    g.phase = "over";
    g.winner = alive[0] ?? null;
    if (g.winner !== null) g.place[g.winner] = 1;
  } else {
    g.phase = "handover";
  }
  return g;
}

/** Deals the next hand after a hand result. */
export function nextHand(g: GameState, now: number, random: () => number = Math.random): GameState {
  rule(g.phase === "handover", "Mâna nu s-a terminat încă.");
  return dealHand(g, now, random);
}

/**
 * A player leaves the room (or is kicked) during the tournament: out for good, chips behind forfeited.
 * Chips already in the pot stay there. Mid-hand they fold; the hand goes on without them.
 */
export function removeSeat(src: GameState, seat: number, now: number): GameState {
  if (src.left[seat] || src.phase === "over") return src;
  const g = clone(src);
  g.left[seat] = true;
  g.stacks[seat] = 0;
  if (g.phase === "betting" && inHand(g, seat)) {
    g.folded[seat] = true;
    g.log.push({ seat, what: "left", street: g.street });
    const live = g.seats.map((_, i) => i).filter((i) => inHand(g, i));
    if (live.length === 1) return foldWin(g, live[0], now);
    if (g.turn === seat) return advance(g, seat, now);
    // Somebody else's turn: the street may have been waiting only on them.
    if (g.turn >= 0 && !needsAction(g, g.turn)) return advance(g, g.turn, now);
    return g;
  }
  if (g.phase === "handover") {
    eliminate(g);
    return checkOver(g);
  }
  return g;
}

/** ms epoch after which the current turn may be forced (null when there is no turn timer). */
export function turnDeadline(g: GameState): number | null {
  if (g.phase !== "betting" || g.turn < 0 || !g.settings.turnSeconds) return null;
  return g.turnStartedAt + g.settings.turnSeconds * 1000;
}

/** Identifies one specific turn: a forced skip names it, so a late duplicate cannot skip the next player too. */
export const turnKey = (g: Pick<GameState, "handNo" | "turn" | "log">) => `${g.handNo}:${g.turn}:${g.log.length}`;
