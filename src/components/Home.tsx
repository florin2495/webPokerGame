"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, clearSession, deviceId, listSessions, parseSession, readSessionRaw, saveSession } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import { DEFAULT_SETTINGS, MAX_OBSERVERS, MAX_PLAYERS, NICKNAME_MAX, type Settings, settingsError } from "@/lib/poker";
import type { Role, RoomListItem, RoomState } from "@/lib/types";
import { FeedbackButton } from "./FeedbackButton";
import { Rules } from "./Rules";
import { RoomList } from "./RoomList";
import { SettingsForm } from "./SettingsForm";
import { Button, Card, ErrorText, Field } from "./ui";

interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nickname defaults to the last one used on this device.
  const storedNickname = useStringPref(PREF_NICKNAME);
  const [typedNickname, setNickname] = useState<string | null>(null);
  const nickname = typedNickname ?? storedNickname ?? "";
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [role, setRole] = useState<Role>("player");
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<RoomListItem | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);

  function pickRoom(room: RoomListItem) {
    setPicked(room);
    setCode(room.code);
    setPassword("");
    setError("");
    if (room.status === "playing" || room.players >= MAX_PLAYERS) setRole("observer");
    nicknameRef.current?.focus();
  }

  // Password field is hidden only when the picked room is known to have none.
  const pickedNow = picked?.code === code ? picked : null;
  const showPassword = tab === "create" || !(pickedNow && !pickedNow.hasPassword);
  const onlyWatch = tab === "join" && pickedNow !== null && (pickedNow.status === "playing" || pickedNow.players >= MAX_PLAYERS);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const joinCode = code.trim().toUpperCase();
    // Already a member on this device: go back to the seat instead of joining again.
    if (tab === "join" && parseSession(readSessionRaw(joinCode))) {
      router.push(`/room/${joinCode}`);
      return;
    }
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res =
        tab === "create"
          ? await api<JoinResult>("/api/rooms", { body: { name: roomName, nickname, password, role, ...settings, deviceId: deviceId() } })
          : await api<JoinResult>(`/api/rooms/${encodeURIComponent(joinCode)}/join`, {
              body: { nickname, password, role: onlyWatch ? "observer" : role, deviceId: deviceId() },
            });
      saveSession(res.code, { playerId: res.playerId, token: res.token });
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        {/* Plain <a> on purpose: "/" is the hub zone (outside basePath), needs a full navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
          ← Back to haiLaTăt.icu hub
        </a>
        <FeedbackButton />
      </div>
      <header className="text-center">
        <h1 className="text-4xl font-black tracking-tight">Poker ♠♥</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Texas Hold&apos;em între prieteni, pe telefon. Până la {MAX_PLAYERS} jucători și {MAX_OBSERVERS} observatori.
        </p>
      </header>

      <RejoinCards onRejoin={(c) => router.push(`/room/${c}`)} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="tablist">
        {(["create", "join"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${tab === t ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {t === "create" ? "Creează cameră" : "Intră în cameră"}
          </button>
        ))}
      </div>

      {tab === "join" && (
        <Card>
          <h2 className="mb-3 font-bold">Camere deschise</h2>
          <RoomList selected={pickedNow?.code ?? null} onSelect={pickRoom} onRejoin={(c) => router.push(`/room/${c}`)} />
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {tab === "join" && (
            <Field
              label="Codul camerei"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ex. K7QM2X"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          )}
          {tab === "create" && (
            <Field label="Numele camerei" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
          )}
          <Field
            ref={nicknameRef}
            label="Nickname-ul tău"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            required
          />
          {showPassword && (
            <Field
              label={tab === "create" ? "Parolă (opțional)" : pickedNow ? "Parola camerei" : "Parolă (dacă are camera)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              autoComplete="off"
              required={tab === "join" && pickedNow?.hasPassword === true}
            />
          )}

          <RolePicker value={onlyWatch ? "observer" : role} onChange={setRole} lockedObserver={onlyWatch} />

          {tab === "create" && (
            <details className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800" open>
              <summary className="cursor-pointer text-sm font-bold">Reguli turneu (le poți schimba și în lobby)</summary>
              <div className="pt-3">
                <SettingsForm value={settings} onChange={setSettings} />
              </div>
            </details>
          )}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy || (tab === "create" && settingsError(settings) !== null)}>
            {busy ? "Se încarcă…" : tab === "create" ? "Creează camera" : onlyWatch || role === "observer" ? "Intră ca observator" : "Intră la masă"}
          </Button>
        </form>
      </Card>

      <Rules />
    </main>
  );
}

function RolePicker({ value, onChange, lockedObserver }: { value: Role; onChange: (r: Role) => void; lockedObserver: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1 text-sm font-medium">
      <legend className="mb-1">Cum intri</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["player", "observer"] as const).map((r) => (
          <label
            key={r}
            className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 text-center ${
              value === r ? "border-indigo-500 bg-indigo-50 font-semibold dark:bg-indigo-950" : "border-zinc-300 dark:border-zinc-700"
            } ${lockedObserver && r === "player" ? "cursor-not-allowed opacity-40" : ""}`}
          >
            <input
              type="radio"
              name="role"
              className="sr-only"
              checked={value === r}
              disabled={lockedObserver && r === "player"}
              onChange={() => onChange(r)}
            />
            {r === "player" ? "🃏 Joc la masă" : "👀 Doar mă uit"}
          </label>
        ))}
      </div>
      {lockedObserver && (
        <span className="text-xs font-normal text-zinc-500">Turneul a început sau masa e plină: poți intra doar ca observator.</span>
      )}
    </fieldset>
  );
}

/**
 * Rooms this device still has a valid seat in (lobby, running or finished tournament), shown on both tabs.
 * Stored sessions are checked once against /state; 401/404 ones are dropped.
 */
function RejoinCards({ onRejoin }: { onRejoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<{ code: string; name: string; playing: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        listSessions().map(async ({ code, session }) => {
          try {
            const s = await api<RoomState>(`/api/rooms/${code}/state`, { token: session.token });
            return { code, name: s.room.name, playing: s.room.status === "playing" };
          } catch (err) {
            if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) clearSession(code);
            return null;
          }
        }),
      );
      if (!cancelled) setRooms(checks.filter((r) => r !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rooms.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((r) => (
        <button
          key={r.code}
          type="button"
          onClick={() => onRejoin(r.code)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-left dark:border-indigo-800 dark:bg-indigo-950"
        >
          <span className="min-w-0">
            <span className="block font-bold">
              Revino în camera <span className="font-mono tracking-widest">{r.code}</span>
            </span>
            <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
              {r.name}
              {r.playing ? " · turneu în desfășurare" : ""}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Reintră →</span>
        </button>
      ))}
    </div>
  );
}
