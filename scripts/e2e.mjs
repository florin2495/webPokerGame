// End-to-end test of the Poker API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /poker]
// Plain fetch, no dependencies. Every room it creates is named e2e-test-... and removed at the end
// (everyone leaves; a DB delete with the service key is the safety net: env NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, e.g. the GitHub Actions secrets, else .env.local). Never writes feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/poker").replace(/\/$/, "");
const BUY_IN = 200;
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;
const chips = (g) => g.seats.reduce((a, s) => a + s.stack, 0) + g.pot;

async function http() {
  console.log("HTTP");
  const page = await fetch(BASE);
  const html = await page.text();
  check(page.status === 200, `page ${BASE} = ${page.status}`);
  const origin = new URL(BASE).origin;
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]+)"/g)].map((m) => m[1]))];
  const basePath = new URL(BASE).pathname;
  check(assets.length > 0 && assets.every((a) => a.startsWith(`${basePath}/_next/`)), `${assets.length} /_next assets under ${basePath}`);
  const statuses = await Promise.all(assets.map(async (a) => (await fetch(new URL(a, origin))).status));
  check(statuses.every((s) => s === 200), `all /_next assets 200 (${statuses.join(",")})`);
  // The settings panel (with the version) is on the room page: collect the JS chunks of both pages.
  const roomHtml = await (await fetch(`${BASE}/room/XXXXXX`)).text();
  const js = [...new Set((html + roomHtml).match(new RegExp(`${basePath}/_next/static/[^"'\\\\]+\\.js`, "g")) ?? [])];
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of js) if ((await (await fetch(origin + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version} (${js.length} chunks)`);
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url === `${basePath}/`, "manifest 200, start_url under basePath");
  for (const icon of [...(manifest?.icons ?? []).map((i) => i.src), `${basePath}/pwa-icons/apple`, `${basePath}/favicon.ico`]) {
    const r = await fetch(new URL(icon, origin));
    check(r.status === 200 && /image/.test(r.headers.get("content-type") ?? ""), `icon ${icon} = ${r.status}`);
  }
  const room = await fetch(`${BASE}/room/XXXXXX`);
  check(room.status === 200, `room page /room/XXXXXX = ${room.status}`);
  if (origin.includes("hailatat.icu")) {
    const direct = await fetch(`https://010web-poker-game.vercel.app${basePath}`);
    const directHtml = await direct.text();
    const chunks = (h) => [...h.matchAll(/src="([^"]*\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]).sort().join();
    check(direct.status === 200 && chunks(directHtml) === chunks(html), "vercel.app serves the same build");
  }
}

/** Plays the player on turn: shove when allowed (unless passive), else call, else check. */
async function shove(code, s, byId, passive = false) {
  const p = byId[s.game.seats[s.game.turn].playerId];
  const mine = await state(code, p);
  const o = mine.game.options;
  const kind = o.canRaise && !passive ? "allin" : o.callAmount > 0 ? "call" : "check";
  return call(`/api/rooms/${code}/action`, { token: p.token, body: { kind } });
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await http();

  console.log("Room, join, rejoin, settings");
  const dev = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID(), E: randomUUID(), O: randomUUID() };
  const name = `e2e-test-${Date.now().toString(36)}`;
  const r = await call("/api/rooms", { body: { name, nickname: "Ana", password: "pw", deviceId: dev.A, buyIn: BUY_IN, smallBlind: 10, bigBlind: 20, blindMode: "hands", everyHands: 3, growth: 100, turnSeconds: 10 } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  const join = async (nickname, deviceId, role) => ({ ...(await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId, role } })).data, name: nickname });
  const B = await join("Bob", dev.B);
  const C = await join("Cris", dev.C);
  const D = await join("Dan", dev.D);
  const E = await join("Eli", dev.E);
  const O = await join("Obs", dev.O, "observer");
  check(B.role === "player" && C.role === "player" && D.role === "player" && E.role === "player" && O.role === "observer", "4 players + 1 observer joined");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: randomUUID() } })).status === 409, "nickname of a connected member from another device = 409");
  const list = await call("/api/rooms");
  check(list.data.rooms?.some((x) => x.code === code && x.hasPassword && x.players === 5 && x.observers === 1), "room in public list (password, 5 players, 1 observer)");

  const oldB = B.token;
  const re = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: dev.B } });
  check(re.status === 200 && re.data.playerId === B.playerId && re.data.token !== oldB, "rejoin from the same device keeps the player id, new token");
  B.token = re.data.token;
  check((await call(`/api/rooms/${code}/state`, { token: oldB })).status === 401, "old token after rejoin = 401");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 200, "saved new token works");
  check((await call(`/api/rooms/${code}/state`, { token: "bogus" })).status === 401, "bad token = 401");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "no token = 401");

  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { turnSeconds: 20 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 33 } })).status === 400, "33 s turn = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { bigBlind: 150 } })).status === 400, "buy-in < 2 BB = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 60 } })).status === 200, "host sets 60 s");
  check((await call(`/api/rooms/${code}/role`, { token: O.token, body: { role: "player" } })).status === 200, "observer sits down");
  check((await call(`/api/rooms/${code}/role`, { token: O.token, body: { role: "observer" } })).status === 200, "and stands up again");

  console.log("Start");
  check((await call(`/api/rooms/${code}/action`, { token: A.token, body: { kind: "check" } })).status === 409, "action in the lobby = 409");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start twice = 409");
  const byId = { [A.playerId]: A, [B.playerId]: B, [C.playerId]: C, [D.playerId]: D, [E.playerId]: E };
  const players = [A, B, C, D, E];
  let s = await state(code, A);
  check(s.room.status === "playing" && s.game.seats.length === 5 && s.game.seats[0].name === "Ana" && s.game.dealer === 0, "5 seats, host first and dealer");
  check(s.game.sbSeat === 1 && s.game.bbSeat === 2 && s.game.turn === 3 && s.game.pot === 30, "SB Bob, BB Cris, Dan to act, pot 30");
  for (const p of players) {
    const v = await state(code, p);
    const own = v.game.seats[v.game.mySeat];
    check(own.cards?.length === 2 && v.game.seats.filter((x, i) => i !== v.game.mySeat).every((x) => x.cards === null), `${p.name} sees only own 2 cards`);
  }
  const so = await state(code, O);
  check(so.game.mySeat === null && so.game.seats.every((x) => x.cards === null) && so.game.options === null, "observer sees no cards, has no options");
  check(!JSON.stringify(so).includes('"deck"') && !JSON.stringify(so).includes('"holes"'), "no deck / holes in the public state");
  const all = players.map(() => null);
  for (const p of players) {
    const v = await state(code, p);
    all[v.game.mySeat] = v.game.seats[v.game.mySeat].cards;
  }
  check(new Set(all.flat()).size === 10, "10 distinct hole cards");

  console.log("Invalid moves");
  check((await call(`/api/rooms/${code}/action`, { token: A.token, body: { kind: "call" } })).status === 409, "wrong turn = 409");
  check((await call(`/api/rooms/${code}/action`, { token: O.token, body: { kind: "fold" } })).status === 403, "observer action = 403");
  check((await call(`/api/rooms/${code}/action`, { token: "bogus", body: { kind: "fold" } })).status === 401, "bad token action = 401");
  check((await call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "dance" } })).status === 400, "unknown kind = 400");
  check((await call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "check" } })).status === 409, "check facing the BB = 409");
  check((await call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "raise", amount: 30 } })).status === 409, "raise below min (40) = 409");
  check((await call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "raise", amount: 999 } })).status === 409, "raise above stack = 409");
  check((await call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "raise", amount: 40.5 } })).status === 409, "fractional raise = 409");
  check((await call(`/api/rooms/${code}/timeout`, { token: B.token, body: { turn: s.game.turnKey } })).status === 403, "non-host skip before the timer = 403");
  check((await call(`/api/rooms/${code}/next`, { token: A.token, body: { handNo: 1 } })).status === 409, "next hand during betting = 409");

  console.log("Hand 1: raise, double click, host skip, calls to showdown");
  const [r1, r2] = await Promise.all([
    call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "raise", amount: 40 } }),
    call(`/api/rooms/${code}/action`, { token: D.token, body: { kind: "raise", amount: 40 } }),
  ]);
  check([r1.status, r2.status].sort().join() === "200,409", `double click: one applied, one rejected (${r1.status},${r2.status})`);
  check((await call(`/api/rooms/${code}/action`, { token: E.token, body: { kind: "call" } })).status === 200, "Eli calls 40");
  s = await state(code, B);
  check(s.game.currentBet === 40 && s.game.turn === 0 && s.game.pot === 110, "Dan raised to 40, Eli called, Ana to act");
  const skipKey = s.game.turnKey;
  check((await call(`/api/rooms/${code}/timeout`, { token: A.token, body: { turn: skipKey } })).status === 200, "host skips own stalled turn (fold)");
  check((await call(`/api/rooms/${code}/timeout`, { token: A.token, body: { turn: skipKey } })).status === 409, "repeated skip = 409 (no-op)");
  s = await state(code, A);
  check(s.game.seats[0].folded && s.game.turn === 1, "Ana folded, Bob to act");
  check((await call(`/api/rooms/${code}/action`, { token: A.token, body: { kind: "call" } })).status === 409, "folded player acts = 409");
  let guard = 0;
  while (s.game.phase === "betting" && guard++ < 30) {
    const res = await shove(code, s, byId, true);
    if (res.status !== 200) {
      check(false, `action failed: ${res.status} ${res.data.error}`);
      break;
    }
    s = await state(code, O);
    if (s.game.phase === "betting") check(chips(s.game) === 5 * BUY_IN, `chips conserved (hand ${s.game.handNo}, ${s.game.street})`);
  }
  check(s.game.phase !== "betting" && s.game.last?.handNo === 1, "hand 1 finished");
  if (!s.game.last.foldWin) {
    check(s.game.board.length === 5 && s.game.last.shown.length >= 2, "showdown: 5 board cards, hands shown");
    check(s.game.seats.filter((x) => s.game.last.shown.some((h) => h.seat === s.game.seats.indexOf(x))).every((x) => x.cards?.length === 2), "observer sees shown hands at showdown");
    check(s.game.seats[0].cards === null, "folded hand stays hidden");
  }
  check(s.game.seats.reduce((a, x) => a + x.stack, 0) === 5 * BUY_IN && s.game.pot === 0, "pot paid out, chips conserved");
  check(s.game.last.pots.every((p) => p.shares.reduce((a, b) => a + b, 0) === p.amount), "pot shares add up");
  if (s.game.phase === "over") return finish(code, s, { A, B, C, D, E, O, byId });

  console.log("Next hand");
  const h = s.game.handNo;
  check((await call(`/api/rooms/${code}/next`, { token: B.token, body: { handNo: h } })).status === 409, "non-host early next = 409");
  check((await call(`/api/rooms/${code}/next`, { token: A.token, body: { handNo: h + 5 } })).status === 409, "stale handNo = 409");
  check((await call(`/api/rooms/${code}/next`, { token: A.token, body: { handNo: h } })).status === 200, "host deals now");
  check((await call(`/api/rooms/${code}/next`, { token: A.token, body: { handNo: h } })).status === 409, "repeated next = 409");
  s = await state(code, A);
  check(s.game.handNo === h + 1 && s.game.phase === "betting", `hand ${h + 1} dealt`);

  console.log("Auto options");
  check((await call(`/api/rooms/${code}/auto`, { token: O.token, body: { autoCheck: true } })).status === 403, "observer auto = 403");
  check((await call(`/api/rooms/${code}/auto`, { token: A.token, body: { autoCheck: "yes" } })).status === 400, "bad auto value = 400");
  const alivePlayer = players.find((p) => s.game.seats[s.game.seats.findIndex((x) => x.playerId === p.playerId)].place === null && p !== A) ?? B;
  check((await call(`/api/rooms/${code}/auto`, { token: alivePlayer.token, body: { autoCheck: true } })).status === 200, "auto-check on");
  check((await state(code, alivePlayer)).game.myAuto?.autoCheck === true, "auto-check stored");
  await call(`/api/rooms/${code}/auto`, { token: alivePlayer.token, body: { autoCheck: false } });

  console.log("Mid-game observer, kick with Ignoră, leave");
  const late = await join("Eva", randomUUID(), "player");
  check(late.role === "observer", "joining mid-game = observer");
  check((await call(`/api/rooms/${code}/action`, { token: late.token, body: { kind: "fold" } })).status === 403, "late observer action = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: C.playerId } })).status === 403, "non-host kick = 403");
  const seatOf = (p) => s.game.seats.find((x) => x.playerId === p.playerId);
  const alive = players.slice(1).filter((p) => seatOf(p).place === null).sort((x, y) => seatOf(x).stack - seatOf(y).stack);
  const victim = alive[0] ?? D;
  const leaver = alive.find((p) => p !== victim && p !== alivePlayer);
  if (leaver) {
    const before = (await state(code, O)).game;
    const ls = before.seats.findIndex((x) => x.playerId === leaver.playerId);
    check((await call(`/api/rooms/${code}/leave`, { token: leaver.token, body: {} })).status === 200, `${leaver.name} leaves mid-hand`);
    const after = (await state(code, O)).game;
    check(after.seats[ls].left && (after.phase !== "betting" || after.seats[ls].folded) && after.turn !== ls, "leaver folded, out, not on turn");
    check(after.pot >= before.pot, "leaver's chips in the pot stay there");
    check((await call(`/api/rooms/${code}/state`, { token: leaver.token })).status === 401, "leaver token = 401");
    delete byId[leaver.playerId];
    s = await state(code, A);
  }
  const k = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: victim.playerId } });
  check(k.status === 200 && k.data.pending === true, `kick of ${victim.name} in game is pending`);
  check((await state(code, victim)).me.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: victim.token, body: {} })).status === 200, "Ignoră");
  check((await state(code, victim)).me.kickRemainingMs === null, "kick cleared");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: victim.playerId } });
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: victim.token })).status === 401, "kick enforced after 12 s");
  s = await state(code, A);
  const vSeat = s.game.seats.findIndex((x) => x.playerId === victim.playerId);
  check(s.game.seats[vSeat].left && s.game.seats[vSeat].stack === 0, "kicked player out, chips forfeited");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: late.playerId } })).status === 200, "observer kicked at once");
  check((await call(`/api/rooms/${code}/state`, { token: late.token })).status === 401, "kicked observer = 401");
  delete byId[victim.playerId];

  console.log("Play to the end");
  guard = 0;
  while (s.room.status === "playing" && guard++ < 300) {
    if (s.game.phase === "handover") {
      const res = await call(`/api/rooms/${code}/next`, { token: s.room.hostPlayerId === A.playerId ? A.token : byId[s.room.hostPlayerId]?.token ?? A.token, body: { handNo: s.game.handNo } });
      if (res.status !== 200) {
        check(false, `next failed: ${res.status} ${res.data.error}`);
        break;
      }
    } else if (s.game.phase === "betting") {
      const res = await shove(code, s, byId);
      if (res.status !== 200) {
        check(false, `action failed: ${res.status} ${res.data.error}`);
        break;
      }
    }
    s = await state(code, O);
  }
  return finish(code, s, { A, B, C, D, E, O, byId, victim });
}

async function finish(code, s, { A, B, C, D, E, O, victim }) {
  check(s.room.status === "finished" && s.game.phase === "over", `tournament over after hand ${s.game.handNo}`);
  const places = s.game.seats.map((x) => x.place);
  check(places.every((p) => p !== null) && new Set(places).size === places.length, `unique places ${places.join(",")}`);
  const w = s.game.seats[s.game.winner];
  check(w?.place === 1 && w.stack > 0, `winner ${w?.name} has all the chips left (${w?.stack})`);
  check(s.game.seats.every((x, i) => i === s.game.winner || x.stack === 0), "everyone else at 0");
  if (victim) check(s.game.seats.find((x) => x.playerId === victim.playerId).place > 1, "kicked player not first");

  console.log("New round");
  check((await call(`/api/rooms/${code}/new-round`, { token: O.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  s = await state(code, O);
  check(s.room.status === "lobby" && s.room.round === 2 && s.game === null, "back in the lobby, round 2");

  console.log("Feedback (no rows written)");
  check((await call("/api/feedback", { body: { message: "", nickname: "e2e" } })).status === 400, "empty feedback = 400");

  console.log("Cleanup");
  for (const p of [B, C, D, E, O].filter((p) => p !== victim)) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/poker_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
