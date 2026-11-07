import "server-only";
import {
  blindsAt,
  BLIND_MODES,
  type BlindMode,
  DEFAULT_SETTINGS,
  type GameState,
  handsUntilLevelUp,
  isRoomExpired,
  minutesLabel,
  NEXT_HAND_DELAY_MS,
  options,
  PLAYING_IDLE_MINUTES,
  potTotal,
  ROOM_IDLE_MINUTES,
  type Settings,
  settingsError,
  turnDeadline,
  turnKey,
  TURN_OPTIONS,
  autoDeadline,
} from "@/lib/poker";
import type { PublicGame, PublicPlayer, RoomState } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, type PlayerRow, ROOM_COLUMNS, type RoomRow, T } from "./db";
import { ApiError, fail } from "./http";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every idle room (2 min for lobby/finished, 60 min for a game nobody has open). */
export async function cleanupExpiredRooms(): Promise<void> {
  const now = Date.now();
  const short = new Date(now - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const long = new Date(now - PLAYING_IDLE_MINUTES * 60_000).toISOString();
  const a = await db().from(T.rooms).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", short);
  if (a.error) console.error("cleanup failed", a.error);
  const b = await db().from(T.rooms).delete().eq("status", "playing").lt("last_activity_at", long);
  if (b.error) console.error("cleanup failed", b.error);
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(T.rooms).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  const room = await getRoomByCode(code);
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  return { room, player: data as PlayerRow };
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar host-ul camerei poate face asta.");
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Turneul nu a început încă.",
      playing: "Turneul este în desfășurare.",
      finished: "Turneul s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/**
 * Writes the room only if nobody else changed it since we read it (optimistic lock on
 * `version`). Two actions at the same time: one wins, the other gets a 409 and retries.
 */
export async function saveRoom(room: RoomRow, update: Partial<Omit<RoomRow, "id" | "version">>): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .update({ ...update, version: room.version + 1, updated_at: now, last_activity_at: now })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new VersionConflict();
}

/** Someone else wrote the room between our read and our write. */
export class VersionConflict extends ApiError {
  constructor() {
    super(409, "Altcineva a acționat între timp. Mai încearcă o dată.");
  }
}

/**
 * Runs `fn` on a freshly read room and retries a few times when another write got in first.
 * Every rule is re-checked on the fresh state, so a retry can never apply a stale action.
 */
export async function withRetry<C, T>(load: () => Promise<C>, fn: (ctx: C) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctx = await load();
    try {
      return await fn(ctx);
    } catch (err) {
      if (err instanceof VersionConflict && attempt < 3) continue;
      throw err;
    }
  }
}

/** Validates settings sent by the host; missing fields keep `current`. */
export function parseSettings(body: Record<string, unknown>, current: Settings = DEFAULT_SETTINGS): Settings {
  const num = (v: unknown, fallback: number) => (v === undefined ? fallback : Number(v));
  const mode = body.blindMode === undefined ? current.blindMode : body.blindMode;
  if (!BLIND_MODES.includes(mode as BlindMode)) fail(400, "Mod de creștere a blind-urilor invalid.");
  const s: Settings = {
    buyIn: num(body.buyIn, current.buyIn),
    smallBlind: num(body.smallBlind, current.smallBlind),
    bigBlind: num(body.bigBlind, current.bigBlind),
    blindMode: mode as BlindMode,
    everyHands: num(body.everyHands, current.everyHands),
    everyMinutes: num(body.everyMinutes, current.everyMinutes),
    growth: num(body.growth, current.growth),
    turnSeconds: num(body.turnSeconds, current.turnSeconds),
  };
  const problem = settingsError(s);
  if (problem) fail(400, problem);
  return s;
}

/** Settings stored before a field existed get the default for it. */
export function withDefaults(s: Partial<Settings> | null): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  // Rooms created before the 10-60 s turn timer get the default.
  if (!TURN_OPTIONS.includes(merged.turnSeconds)) merged.turnSeconds = DEFAULT_SETTINGS.turnSeconds;
  return merged;
}

const toPublic = (p: PlayerRow): PublicPlayer => ({ id: p.id, nickname: p.nickname, isHost: p.is_host, role: p.role });

function publicGame(g: GameState, meId: string): PublicGame {
  const seat = g.seats.indexOf(meId);
  const mySeat = seat >= 0 ? seat : null;
  const showdown = g.phase !== "betting" && g.last && !g.last.foldWin ? g.last.shown : [];
  const shownBySeat = new Map(showdown.map((h) => [h.seat, h.cards]));
  const s = g.settings;
  return {
    seats: g.seats.map((playerId, i) => ({
      playerId,
      name: g.names[i],
      stack: g.stacks[i],
      bet: g.bets[i],
      folded: g.folded[i],
      allIn: g.allIn[i],
      dealt: g.holes[i].length === 2,
      place: g.place[i],
      left: g.left[i],
      cards: i === mySeat && g.holes[i].length === 2 ? g.holes[i] : (shownBySeat.get(i) ?? null),
    })),
    mySeat,
    handNo: g.handNo,
    level: g.level,
    sb: g.sb,
    bb: g.bb,
    next: blindsAt(s, g.level + 1),
    blindMode: s.blindMode,
    handsLeft: s.blindMode === "hands" ? handsUntilLevelUp(g) : null,
    levelEndsAt: s.blindMode === "minutes" ? g.levelStartedAt + s.everyMinutes * 60_000 : null,
    anchor: g.anchor,
    dealer: g.dealer,
    sbSeat: g.sbSeat,
    bbSeat: g.bbSeat,
    board: g.board,
    street: g.street,
    pot: potTotal(g),
    currentBet: g.currentBet,
    turn: g.turn,
    turnKey: turnKey(g),
    turnDeadline: turnDeadline(g),
    autoAt: autoDeadline(g),
    myAuto: mySeat !== null ? { autoCheck: g.autoCheck?.[mySeat] ?? false, autoBlind: g.autoBlind?.[mySeat] ?? false } : null,
    phase: g.phase,
    nextHandAt: g.phase === "handover" ? g.handEndedAt + NEXT_HAND_DELAY_MS : null,
    log: g.log,
    last: g.last,
    winner: g.winner,
    options: mySeat !== null ? options(g, mySeat) : null,
  };
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const players = await listPlayers(room.id);
  let ordered = players;
  if (room.game) {
    const pos = new Map(room.game.seats.map((id, i) => [id, i]));
    ordered = [...players].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      settings: withDefaults(room.settings),
    },
    players: ordered.map(toPublic),
    me: toPublic(me),
    game: room.game ? publicGame(room.game, me.id) : null,
    serverNow: Date.now(),
  };
}
