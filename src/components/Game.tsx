"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useNow } from "@/lib/client/clock";
import { PREF_AUTO_BLIND, PREF_AUTO_CHECK, PREF_CONFIRM_ALLIN, PREF_VIBRATE, readPref, useBoolPref } from "@/lib/client/prefs";
import { AUTO_DELAY_MS, bestHand, type Card, type LogEntry, type Options, TIMEOUT_GRACE_MS } from "@/lib/poker";
import type { PublicGame, RoomState } from "@/lib/types";
import { localKickMs } from "./KickModal";
import { CardSlot, PlayingCard } from "./PlayingCard";
import { Button, Card as Panel, ErrorText, OfflineBadge, Toggle } from "./ui";

/** Extra wait before a non-host device triggers a timeout / next hand, so the host's device goes first. */
const FALLBACK_SEATED_MS = 3_000;
const FALLBACK_OBSERVER_MS = 6_000;

const STREET_LABEL = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" } as const;

const fmt = (n: number) => n.toLocaleString("ro-RO");

function actionLabel(e: LogEntry): string {
  const a = e.amount !== undefined ? ` ${fmt(e.amount)}` : "";
  switch (e.what) {
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return `Call${a}`;
    case "bet":
      return `Bet${a}`;
    case "raise":
      return `Raise la${a}`;
    case "allin":
      return `All-in${a}`;
    case "sb":
      return `SB${a}`;
    case "bb":
      return `BB${a}`;
    case "timeout-fold":
    case "timeout-check":
      return "⏱ Fold (timp expirat)";
    case "auto-check":
      return "🤖 Auto check";
    case "auto-fold":
      return "🤖 Auto fold";
    case "auto-call":
      return `🤖 Auto big blind`;
    case "host-check":
      return "⏭ Check (sărit de host)";
    case "host-fold":
      return "⏭ Fold (sărit de host)";
    case "left":
      return "A plecat";
    default:
      return e.what;
  }
}

export function Game({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const g = state.game!;
  const { room, me } = state;
  const isHost = room.hostPlayerId === me.id;
  const base = `/api/rooms/${room.code}`;
  const deviceNow = useNow();
  const now = deviceNow === 0 ? 0 : deviceNow + (state.clockOffset ?? 0); // server time
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [vibrate] = useBoolPref(PREF_VIBRATE, true);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  // Lazy timers: whoever has the page open triggers the turn timeout and the next hand.
  // The host's device goes first; seated players and then observers are fallbacks.
  const fired = useRef<string | null>(null);
  const fallback = isHost ? 0 : g.mySeat !== null ? FALLBACK_SEATED_MS : FALLBACK_OBSERVER_MS;
  useEffect(() => {
    if (now === 0) return;
    let key: string | null = null;
    let call: (() => Promise<unknown>) | null = null;
    const due =
      g.autoAt !== null ? g.autoAt : g.turnDeadline !== null ? g.turnDeadline + TIMEOUT_GRACE_MS : null;
    // My own auto option: my device fires it on time, without the fallback delay.
    const wait = g.autoAt !== null && g.turn === g.mySeat ? 0 : fallback;
    if (g.phase === "betting" && due !== null && now >= due + wait) {
      key = `t:${g.turnKey}`;
      call = () => api(`${base}/timeout`, { token, body: { turn: g.turnKey } });
    } else if (g.phase === "handover" && g.nextHandAt !== null && now >= g.nextHandAt + fallback) {
      key = `n:${g.handNo}`;
      call = () => api(`${base}/next`, { token, body: { handNo: g.handNo } });
    }
    if (!key || !call || fired.current === key) return;
    fired.current = key;
    call()
      .catch(() => undefined) // somebody else was faster: fine
      .finally(() => void refresh());
  }, [now, g.phase, g.autoAt, g.turn, g.mySeat, g.turnDeadline, g.turnKey, g.nextHandAt, g.handNo, fallback, base, token, refresh]);

  // Auto options are remembered on the device: apply them once to every new tournament.
  const synced = useRef<number | null>(null);
  useEffect(() => {
    if (!g.myAuto || g.phase === "over" || synced.current === room.round) return;
    synced.current = room.round;
    const want = { autoCheck: readPref(PREF_AUTO_CHECK) === "1", autoBlind: readPref(PREF_AUTO_BLIND) === "1" };
    if (want.autoCheck === g.myAuto.autoCheck && want.autoBlind === g.myAuto.autoBlind) return;
    api(`${base}/auto`, { token, body: want })
      .catch(() => undefined)
      .finally(() => void refresh());
  }, [g.myAuto, g.phase, room.round, base, token, refresh]);

  // Buzz once when the turn comes to me.
  const myTurn = g.phase === "betting" && g.mySeat !== null && g.turn === g.mySeat;
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    if (!myTurn || buzzed.current === g.turnKey) return;
    buzzed.current = g.turnKey;
    if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(200);
  }, [myTurn, g.turnKey, vibrate]);

  const mine = g.mySeat !== null ? g.seats[g.mySeat] : null;
  const winnerCards = new Set<Card>(
    g.phase !== "betting" && g.last && !g.last.foldWin
      ? g.last.shown.filter((h) => g.last!.pots[0]?.winners.includes(h.seat)).flatMap((h) => h.best)
      : [],
  );

  return (
    <>
      <BlindBar g={g} now={now} />

      <div className="rounded-2xl bg-emerald-800 p-3 text-white shadow-inner dark:bg-emerald-950">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-emerald-100">
          <span>
            Mâna #{g.handNo} · {g.phase === "betting" ? STREET_LABEL[g.street] : g.phase === "over" ? "Final" : "Rezultat"}
          </span>
          <span>Pot: {fmt(g.phase === "betting" ? g.pot : (g.last?.pots.reduce((a, p) => a + p.amount, 0) ?? 0))}</span>
        </div>
        <div className="flex justify-center gap-1.5">
          {Array.from({ length: 5 }, (_, i) =>
            g.board[i] ? (
              <PlayingCard key={i} card={g.board[i]} size="md" highlight={winnerCards.has(g.board[i])} />
            ) : (
              <CardSlot key={i} size="md" />
            ),
          )}
        </div>
      </div>

      {g.phase !== "betting" && g.last && <HandResult g={g} now={now} isHost={isHost} busy={busy} onNext={() => void run(() => api(`${base}/next`, { token, body: { handNo: g.handNo } }))} />}

      {g.phase === "over" && (
        <Standings g={g} isHost={isHost} busy={busy} onNewTournament={() => void run(() => api(`${base}/new-round`, { token, body: {} }))} />
      )}

      {mine && mine.cards && g.phase === "betting" && (
        <Panel className={myTurn ? "border-indigo-500 ring-2 ring-indigo-400" : ""}>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {mine.cards.map((c) => (
                <PlayingCard key={c} card={c} size="lg" dim={mine.folded} />
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-zinc-500">Mâna ta</p>
              {g.board.length >= 3 && !mine.folded && (
                <p className="font-bold">{bestHand([...mine.cards, ...g.board]).name}</p>
              )}
              <p className="text-sm">
                Jetoane: <span className="font-bold">{fmt(mine.stack)}</span>
              </p>
              {mine.folded && <p className="text-sm text-zinc-500">Ai dat fold.</p>}
              {mine.allIn && <p className="text-sm font-bold text-amber-600">ALL-IN</p>}
            </div>
          </div>
          {myTurn && g.options && (
            <ActionBar
              key={g.turnKey}
              g={g}
              options={g.options}
              busy={busy}
              onAct={(kind, amount) => void run(() => api(`${base}/action`, { token, body: { kind, amount } }))}
            />
          )}
        </Panel>
      )}

      {mine && g.myAuto && mine.place === null && g.phase !== "over" && (
        <AutoOptions
          value={g.myAuto}
          busy={busy}
          onChange={(v) => void run(() => api(`${base}/auto`, { token, body: v }))}
        />
      )}

      {g.mySeat === null && (
        <p className="rounded-lg bg-zinc-200 px-3 py-2 text-center text-sm dark:bg-zinc-800">
          👀 Ești observator: vezi masa, dar nu cărțile nimănui până la showdown.
        </p>
      )}
      {mine && mine.place !== null && g.phase !== "over" && (
        <p className="rounded-lg bg-zinc-200 px-3 py-2 text-center text-sm dark:bg-zinc-800">
          Ai ieșit din turneu pe locul {mine.place}. Rămâi și urmărești până la final.
        </p>
      )}

      <ErrorText>{error}</ErrorText>

      <Seats g={g} now={now} state={state} token={token} refresh={refresh} />

      {isHost && g.phase === "betting" && g.turn >= 0 && g.turn !== g.mySeat && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            const name = g.seats[g.turn].name;
            if (!window.confirm(`Sari tura lui ${name}? Dă automat check dacă poate, altfel fold.`)) return;
            void run(() => api(`${base}/timeout`, { token, body: { turn: g.turnKey } }));
          }}
        >
          ⏭ Sari tura lui {g.seats[g.turn].name}
        </Button>
      )}

      <HandLog g={g} />
    </>
  );
}

function BlindBar({ g, now }: { g: PublicGame; now: number }) {
  let when = "";
  if (g.blindMode === "hands" && g.handsLeft !== null) when = `de la mâna #${g.handNo + g.handsLeft}`;
  else if (g.blindMode === "orbit") when = `când ${g.seats[g.anchor]?.name ?? "host-ul"} face din nou cărțile`;
  else if (g.levelEndsAt !== null) {
    const left = Math.max(0, g.levelEndsAt - now);
    when = left === 0 || now === 0 ? "de la mâna următoare" : `în ${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-200 px-3 py-2 text-sm dark:bg-zinc-800">
      <span>
        Blind-uri{" "}
        <span className="font-mono font-bold">
          {fmt(g.sb)}/{fmt(g.bb)}
        </span>{" "}
        <span className="text-xs text-zinc-500">nivel {g.level + 1}</span>
      </span>
      {g.phase !== "over" && (
        <span className="text-right text-xs text-zinc-600 dark:text-zinc-400">
          apoi {fmt(g.next.sb)}/{fmt(g.next.bb)} {when}
        </span>
      )}
    </div>
  );
}

function Seats({
  g,
  now,
  state,
  token,
  refresh,
}: {
  g: PublicGame;
  now: number;
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}) {
  const deviceNow = useNow();
  const canKick = state.room.hostPlayerId === state.me.id;
  const [kicking, setKicking] = useState<string | null>(null);
  const pendingMs = new Map(state.players.map((p) => [p.id, localKickMs(state, p.kickRemainingMs, deviceNow)]));
  const connected = new Map(state.players.map((p) => [p.id, p.connected]));

  async function kick(id: string, name: string) {
    if (!window.confirm(`Scoți jucătorul ${name} din cameră? Are 10 secunde să refuze; dacă nu, dă fold și pierde jetoanele.`)) return;
    setKicking(id);
    try {
      await api(`/api/rooms/${state.room.code}/kick`, { token, body: { playerId: id } });
    } catch {
      // already gone or not allowed: the refresh shows the real state
    } finally {
      setKicking(null);
      void refresh();
    }
  }

  // Last action of each seat on the current street.
  const lastBySeat = new Map<number, LogEntry>();
  for (const e of g.log) if (e.street === g.street || e.what === "left") lastBySeat.set(e.seat, e);
  const showdown = g.phase !== "betting" && g.last && !g.last.foldWin;
  const winners = new Set(g.phase !== "betting" && g.last ? g.last.pots.flatMap((p) => p.winners) : []);
  const handNames = new Map(showdown ? g.last!.shown.map((h) => [h.seat, h.name]) : []);

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {g.seats.map((s, i) => {
        const out = s.place !== null && !(g.phase === "over" && s.place === 1);
        const turn = g.phase === "betting" && g.turn === i;
        const last = lastBySeat.get(i);
        return (
          <li
            key={s.playerId}
            className={`flex flex-col gap-1 rounded-xl border p-2 text-sm ${
              turn
                ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-400 dark:bg-indigo-950"
                : winners.has(i)
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            } ${out || (s.folded && g.phase === "betting") ? "opacity-50" : ""} ${i === g.mySeat ? "outline-2 outline-offset-1 outline-emerald-500" : ""}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate font-semibold">
                {s.name}
                {i === g.mySeat && <span className="font-normal text-zinc-500"> (tu)</span>}
              </span>
              <span className="flex shrink-0 gap-0.5">
                {g.dealer === i && g.phase !== "over" && <Badge className="bg-white text-zinc-900 ring-1 ring-zinc-400">D</Badge>}
                {g.sbSeat === i && g.phase === "betting" && <Badge className="bg-sky-600 text-white">SB</Badge>}
                {g.bbSeat === i && g.phase === "betting" && <Badge className="bg-indigo-600 text-white">BB</Badge>}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className="font-mono">{out ? "—" : fmt(s.stack)}</span>
              {s.bet > 0 && g.phase === "betting" && (
                <span className="rounded-full bg-amber-200 px-1.5 font-mono text-xs font-bold text-amber-900">{fmt(s.bet)}</span>
              )}
            </div>
            <div className="flex min-h-9 items-center gap-1">
              {s.cards ? (
                s.cards.map((c) => <PlayingCard key={c} card={c} size="xs" />)
              ) : s.dealt && !s.folded && g.phase === "betting" ? (
                <>
                  <PlayingCard card={null} size="xs" />
                  <PlayingCard card={null} size="xs" />
                </>
              ) : null}
              <span className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
                {s.left
                  ? `a plecat${s.place ? ` · locul ${s.place}` : ""}`
                  : out
                    ? `eliminat · locul ${s.place}`
                    : handNames.get(i) ??
                      (s.allIn && g.phase === "betting" ? "ALL-IN" : s.folded && g.phase === "betting" ? "fold" : last ? actionLabel(last) : "")}
              </span>
            </div>
            {turn && <TurnTimer g={g} now={now} />}
            {!s.left && <OfflineBadge connected={connected.get(s.playerId)} className="self-start" />}
            {pendingMs.get(s.playerId) != null && (
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                iese în {Math.ceil((pendingMs.get(s.playerId) ?? 0) / 1000)} s
              </span>
            )}
            {canKick && i !== g.mySeat && !s.left && pendingMs.get(s.playerId) == null && (
              <button
                type="button"
                onClick={() => void kick(s.playerId, s.name)}
                disabled={kicking !== null}
                className="min-h-8 self-start rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                aria-label={`Scoate pe ${s.name}`}
              >
                {kicking === s.playerId ? "…" : "Scoate"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Badge({ children, className }: { children: string; className: string }) {
  return <span className={`rounded-full px-1.5 text-[10px] leading-4 font-bold ${className}`}>{children}</span>;
}

function TurnTimer({ g, now }: { g: PublicGame; now: number }) {
  const until = g.autoAt ?? g.turnDeadline;
  if (until === null || now === 0) return <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">la rând…</span>;
  const left = Math.max(0, until - now);
  return (
    <span className="text-xs font-semibold text-indigo-600 tabular-nums dark:text-indigo-400">
      la rând · {g.autoAt !== null ? "auto în " : ""}
      {Math.ceil(left / 1000)} s
    </span>
  );
}

function AutoOptions({
  value,
  busy,
  onChange,
}: {
  value: { autoCheck: boolean; autoBlind: boolean };
  busy: boolean;
  onChange: (v: { autoCheck: boolean; autoBlind: boolean }) => void;
}) {
  const [, setCheckPref] = useBoolPref(PREF_AUTO_CHECK, false);
  const [, setBlindPref] = useBoolPref(PREF_AUTO_BLIND, false);
  const secs = AUTO_DELAY_MS / 1000;
  return (
    <Panel className="py-2">
      <Toggle
        label="Auto check"
        hint={`Dacă nu răspunzi în ${secs} s: check dacă se poate; dacă cineva a mărit, fold.`}
        checked={value.autoCheck}
        disabled={busy}
        onChange={(v) => {
          setCheckPref(v);
          onChange({ ...value, autoCheck: v });
        }}
      />
      <Toggle
        label="Auto big blind"
        hint={`Dacă nu răspunzi în ${secs} s, înainte de flop și fără nicio mărire: plătești big blind-ul.`}
        checked={value.autoBlind}
        disabled={busy}
        onChange={(v) => {
          setBlindPref(v);
          onChange({ ...value, autoBlind: v });
        }}
      />
    </Panel>
  );
}

function ActionBar({
  g,
  options: o,
  busy,
  onAct,
}: {
  g: PublicGame;
  options: Options;
  busy: boolean;
  onAct: (kind: "fold" | "check" | "call" | "raise" | "allin", amount?: number) => void;
}) {
  const [confirmRisky] = useBoolPref(PREF_CONFIRM_ALLIN, true);
  const [to, setTo] = useState(o.minRaiseTo);
  const me = g.seats[g.mySeat!];
  const clamp = (x: number) => Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, Math.round(x)));
  const potAfterCall = g.pot + o.callAmount;
  const presets: [string, number][] = [
    ["Min", o.minRaiseTo],
    ["½ pot", clamp(g.currentBet + potAfterCall / 2)],
    ["Pot", clamp(g.currentBet + potAfterCall)],
    ["All-in", o.maxRaiseTo],
  ];
  const callIsAllIn = o.callAmount > 0 && o.callAmount >= me.stack;
  const raiseIsAllIn = to >= o.maxRaiseTo;
  const isBet = g.currentBet === 0;

  function fold() {
    if (confirmRisky && o.canCheck && !window.confirm("Poți da check gratis. Sigur dai fold?")) return;
    onAct("fold");
  }
  function call() {
    if (confirmRisky && callIsAllIn && !window.confirm(`Intri all-in cu ${fmt(me.stack)}?`)) return;
    onAct(o.canCheck ? "check" : "call");
  }
  function raise() {
    if (raiseIsAllIn) {
      if (confirmRisky && !window.confirm(`Intri all-in cu ${fmt(me.stack)}?`)) return;
      onAct("allin");
    } else onAct("raise", to);
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {o.canRaise && o.maxRaiseTo > o.minRaiseTo && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-1">
            {presets.map(([label, v]) => (
              <button
                key={label}
                type="button"
                onClick={() => setTo(v)}
                className={`min-h-9 rounded-md border text-xs font-semibold ${
                  to === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={o.minRaiseTo}
              max={o.maxRaiseTo}
              step={1}
              value={to}
              onChange={(e) => setTo(Number(e.target.value))}
              className="w-full accent-indigo-600"
              aria-label="Suma"
            />
            <input
              type="number"
              inputMode="numeric"
              min={o.minRaiseTo}
              max={o.maxRaiseTo}
              value={to}
              onChange={(e) => setTo(Number(e.target.value))}
              onBlur={() => setTo(clamp(to))}
              className="min-h-9 w-24 rounded-md border border-zinc-300 bg-white px-2 text-right font-mono dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Suma exactă"
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="danger" disabled={busy} onClick={fold}>
          Fold
        </Button>
        <Button variant="secondary" disabled={busy} onClick={call}>
          {o.canCheck ? "Check" : callIsAllIn ? `All-in ${fmt(o.callAmount)}` : `Call ${fmt(o.callAmount)}`}
        </Button>
        {o.canRaise ? (
          <Button disabled={busy || to < o.minRaiseTo || to > o.maxRaiseTo} onClick={raise}>
            {raiseIsAllIn ? `All-in ${fmt(o.maxRaiseTo)}` : `${isBet ? "Bet" : "Raise"} ${fmt(to)}`}
          </Button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function HandResult({ g, now, isHost, busy, onNext }: { g: PublicGame; now: number; isHost: boolean; busy: boolean; onNext: () => void }) {
  const last = g.last!;
  const name = (seat: number) => g.seats[seat]?.name ?? "?";
  const hands = new Map(last.shown.map((h) => [h.seat, h]));
  const left = g.nextHandAt !== null && now > 0 ? Math.max(0, Math.ceil((g.nextHandAt - now) / 1000)) : null;
  return (
    <Panel className="border-amber-400">
      <h2 className="mb-2 font-bold">Rezultatul mâinii #{last.handNo}</h2>
      {last.foldWin ? (
        <p>
          🏆 <span className="font-bold">{name(last.pots[0].winners[0])}</span> ia potul de {fmt(last.pots[0].amount)}: ceilalți au dat
          fold.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {last.pots.map((p, k) => (
            <li key={k}>
              <span className="text-zinc-500">{k === 0 ? "Pot" : `Side pot ${k}`} {fmt(p.amount)}:</span>{" "}
              {p.winners.map((w, j) => (
                <span key={w} className="font-bold">
                  {j > 0 && ", "}
                  🏆 {name(w)}
                  {p.winners.length > 1 && ` (${fmt(p.shares[j])})`}
                </span>
              ))}{" "}
              <span className="text-sm text-zinc-600 dark:text-zinc-400">cu {hands.get(p.winners[0])?.name}</span>
            </li>
          ))}
        </ul>
      )}
      {last.busted.length > 0 && (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">
          Eliminat: {last.busted.map((s) => `${name(s)} (locul ${g.seats[s].place})`).join(", ")}
        </p>
      )}
      {g.phase === "handover" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-sm text-zinc-500">{left !== null && left > 0 ? `Mâna următoare în ${left} s…` : "Se împart cărțile…"}</span>
          {isHost && (
            <Button className="min-h-9 py-1 text-sm" disabled={busy} onClick={onNext}>
              Împarte acum
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function Standings({ g, isHost, busy, onNewTournament }: { g: PublicGame; isHost: boolean; busy: boolean; onNewTournament: () => void }) {
  const ranked = g.seats.map((s, i) => ({ s, i })).sort((a, b) => (a.s.place ?? 99) - (b.s.place ?? 99));
  return (
    <Panel>
      <h2 className="mb-2 text-lg font-black">
        {g.winner !== null ? `🏆 ${g.seats[g.winner].name} a câștigat turneul!` : "Turneul s-a încheiat."}
      </h2>
      <ol className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {ranked.map(({ s, i }) => (
          <li key={s.playerId} className="flex justify-between py-1.5">
            <span>
              <span className="inline-block w-7 font-mono text-zinc-500">{s.place ?? "–"}.</span>
              {s.name}
              {i === g.mySeat && <span className="text-zinc-500"> (tu)</span>}
              {s.left && <span className="text-xs text-zinc-500"> · a plecat</span>}
            </span>
            {s.place === 1 && <span className="font-mono font-bold">{fmt(s.stack)}</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-zinc-500">{g.handNo} mâini jucate, ultimul nivel de blind-uri {fmt(g.sb)}/{fmt(g.bb)}.</p>
      <div className="mt-3">
        {isHost ? (
          <Button className="w-full" disabled={busy} onClick={onNewTournament}>
            Turneu nou (înapoi în lobby)
          </Button>
        ) : (
          <p className="text-center text-sm text-zinc-500">Host-ul poate porni un turneu nou.</p>
        )}
      </div>
    </Panel>
  );
}

function HandLog({ g }: { g: PublicGame }) {
  if (g.log.length === 0) return null;
  const entries = [...g.log].reverse().slice(0, 30);
  return (
    <Panel className="py-2">
      <details>
        <summary className="flex min-h-10 cursor-pointer items-center font-bold">Istoric mâna #{g.handNo}</summary>
        <ol className="flex flex-col gap-0.5 pb-1 text-sm">
          {entries.map((e, k) => (
            <li key={g.log.length - k} className="flex justify-between gap-2">
              <span className="truncate">{g.seats[e.seat]?.name}</span>
              <span className="shrink-0 text-zinc-600 dark:text-zinc-400">
                {actionLabel(e)} <span className="text-xs text-zinc-400">· {STREET_LABEL[e.street]}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}
