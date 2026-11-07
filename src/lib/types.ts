import type { BlindMode, Card, HandSummary, LogEntry, Options, Settings, Street } from "./poker";

export type RoomStatus = "lobby" | "playing" | "finished";
export type Role = "player" | "observer";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  role: Role;
}

export interface PublicSeat {
  playerId: string;
  name: string;
  stack: number;
  /** Chips in front of the player on the current street. */
  bet: number;
  folded: boolean;
  allIn: boolean;
  /** Dealt in the current hand. */
  dealt: boolean;
  /** Final place once out of the tournament, null while still in. */
  place: number | null;
  left: boolean;
  /** Hole cards: only my own, or everyone's at showdown. */
  cards: Card[] | null;
}

/** What a member sees of the running tournament. Hole cards of others are never included before showdown. */
export interface PublicGame {
  seats: PublicSeat[];
  /** My seat, or null for observers (and for players who joined after the start). */
  mySeat: number | null;
  handNo: number;
  level: number;
  sb: number;
  bb: number;
  next: { sb: number; bb: number };
  blindMode: BlindMode;
  /** "hands" mode: hands left on this level, the current one included. */
  handsLeft: number | null;
  /** "minutes" mode: ms epoch when the next hand dealt goes to the next level. */
  levelEndsAt: number | null;
  /** "orbit" mode: seat whose next deal raises the blinds. */
  anchor: number;
  dealer: number;
  sbSeat: number;
  bbSeat: number;
  board: Card[];
  street: Street;
  pot: number;
  currentBet: number;
  turn: number;
  /** Identifies the current turn, sent back with a skip / timeout. */
  turnKey: string;
  /** ms epoch after which the turn may be forced, null without a timer. */
  turnDeadline: number | null;
  phase: "betting" | "handover" | "over";
  /** ms epoch when the next hand is dealt automatically (handover only). */
  nextHandAt: number | null;
  log: LogEntry[];
  last: HandSummary | null;
  winner: number | null;
  /** My legal options when it is my turn. */
  options: Options | null;
}

/** What GET /api/rooms/[code]/state returns to a member. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    settings: Settings;
  };
  /** Seat order while a game exists (observers last), join order in the lobby. */
  players: PublicPlayer[];
  me: PublicPlayer;
  game: PublicGame | null;
  /** Server clock, to correct timers on devices with a wrong clock. */
  serverNow: number;
  /** Client only: serverNow minus the device clock when this state arrived. */
  clockOffset?: number;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  status: RoomStatus;
  hasPassword: boolean;
  players: number;
  observers: number;
  settings: Settings;
}

export interface Session {
  playerId: string;
  token: string;
}
