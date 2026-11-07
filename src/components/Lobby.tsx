"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { MAX_OBSERVERS, MAX_PLAYERS, MIN_PLAYERS, minutesLabel, ROOM_IDLE_MINUTES, type Settings, settingsError } from "@/lib/poker";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { SettingsForm } from "./SettingsForm";
import { Button, Card, ErrorText } from "./ui";

export function Lobby({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me, players } = state;
  const isHost = room.hostPlayerId === me.id;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Host edits a local draft and saves it once, instead of a request per keystroke.
  const [draft, setDraft] = useState<Settings | null>(null);
  const settings = draft ?? room.settings;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(room.settings);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const seated = players.filter((p) => p.role === "player");
  const watching = players.filter((p) => p.role === "observer");
  const n = seated.length;
  const canStart = n >= MIN_PLAYERS && n <= MAX_PLAYERS && !dirty;

  const saveSettings = async () => {
    if (await run(() => api(`${base}/settings`, { token, body: settings }))) setDraft(null);
  };
  const switchRole = () => run(() => api(`${base}/role`, { token, body: { role: me.role === "player" ? "observer" : "player" } }));
  const start = () => run(() => api(`${base}/start`, { token, body: {} }));

  return (
    <>
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold">🃏 La masă</h2>
          <span className="text-sm text-zinc-500">
            {n}/{MAX_PLAYERS}
          </span>
        </div>
        <Members list={seated} state={state} token={token} refresh={refresh} empty="Nimeni la masă încă." />
        {n < MIN_PLAYERS && (
          <p className="mt-2 text-sm text-zinc-500">
            Mai trebuie {MIN_PLAYERS - n} {MIN_PLAYERS - n === 1 ? "jucător" : "jucători"}. Apasă pe cod (sus) ca să trimiți invitația.
          </p>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold">👀 Observatori</h2>
          <span className="text-sm text-zinc-500">
            {watching.length}/{MAX_OBSERVERS}
          </span>
        </div>
        <Members list={watching} state={state} token={token} refresh={refresh} empty="Niciun observator. Poate intra oricine și în timpul turneului." />
      </Card>

      <Button variant="secondary" onClick={() => void switchRole()} disabled={busy}>
        {me.role === "player" ? "👀 Mă ridic de la masă (doar mă uit)" : "🃏 Mă așez la masă"}
      </Button>

      <Card>
        <h2 className="mb-3 font-bold">
          Reguli turneu {!isHost && <span className="text-xs font-normal text-zinc-500">(le alege host-ul)</span>}
        </h2>
        <SettingsForm value={settings} onChange={setDraft} disabled={!isHost || busy} />
        {isHost && dirty && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
              Renunță
            </Button>
            <Button onClick={() => void saveSettings()} disabled={busy || settingsError(settings) !== null}>
              Salvează regulile
            </Button>
          </div>
        )}
      </Card>

      <ErrorText>{error}</ErrorText>
      {isHost ? (
        <Button onClick={() => void start()} disabled={busy || !canStart}>
          {dirty
            ? "Salvează întâi regulile"
            : n < MIN_PLAYERS
              ? `Ai nevoie de cel puțin ${MIN_PLAYERS} jucători la masă`
              : `Începe turneul (${n} jucători)`}
        </Button>
      ) : (
        <p className="text-center text-sm text-zinc-500">Așteptăm ca host-ul să înceapă turneul…</p>
      )}
      <p className="text-center text-xs text-zinc-500">
        Camera se închide după {minutesLabel(ROOM_IDLE_MINUTES)} în care nimeni nu o are deschisă.
      </p>
    </>
  );
}

function Members({
  list,
  state,
  token,
  refresh,
  empty,
}: {
  list: PublicPlayer[];
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  empty: string;
}) {
  const { me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function kick(id: string, nickname: string) {
    if (!window.confirm(`Scoți pe ${nickname} din cameră?`)) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/kick`, { token, body: { playerId: id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  if (list.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {list.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">
                {p.nickname}
                {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              {p.isHost && (
                <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>
              )}
            </span>
            {canKick && p.id !== me.id && (
              <button
                type="button"
                onClick={() => void kick(p.id, p.nickname)}
                disabled={busy !== null}
                className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                aria-label={`Scoate pe ${p.nickname}`}
              >
                {busy === p.id ? "…" : "Scoate"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
