"use client";

import { useState } from "react";
import { blindsAt, type BlindMode, GROWTH_OPTIONS, LIMITS, type Settings, settingsError, TURN_OPTIONS } from "@/lib/poker";

const input =
  "min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const MODE_LABEL: Record<BlindMode, string> = {
  hands: "La un număr fix de mâini",
  orbit: "După fiecare tură completă a dealer-ului",
  minutes: "La un interval de timp",
};

/** Explains the blind schedule in one sentence. */
export function scheduleText(s: Settings): string {
  if (s.blindMode === "hands") return `Blind-urile cresc la fiecare ${s.everyHands} ${s.everyHands === 1 ? "mână" : "mâini"}.`;
  if (s.blindMode === "minutes") return `Blind-urile cresc la prima mână după fiecare ${s.everyMinutes} ${s.everyMinutes === 1 ? "minut" : "minute"}.`;
  return "Blind-urile cresc de fiecare dată când host-ul face din nou cărțile. Dacă host-ul iese, următorul intrat la masă după el preia rolul.";
}

/**
 * Tournament settings. Controlled by the parent; number fields keep their own text while typing
 * and report a value only when it parses, so the host can clear a field and retype it.
 */
export function SettingsForm({
  value,
  onChange,
  disabled,
}: {
  value: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  const problem = settingsError(value);
  const levels = problem ? [] : [0, 1, 2, 3, 4].map((l) => blindsAt(value, l));

  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Buy-in (jetoane de start)"
        value={value.buyIn}
        min={LIMITS.buyIn[0]}
        max={LIMITS.buyIn[1]}
        disabled={disabled}
        onValue={(buyIn) => set({ buyIn })}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Small blind"
          value={value.smallBlind}
          min={LIMITS.smallBlind[0]}
          max={LIMITS.smallBlind[1]}
          disabled={disabled}
          onValue={(smallBlind) => set({ smallBlind, bigBlind: Math.max(value.bigBlind, smallBlind * 2) })}
        />
        <NumberField
          label="Big blind"
          value={value.bigBlind}
          min={LIMITS.bigBlind[0]}
          max={LIMITS.bigBlind[1]}
          disabled={disabled}
          onValue={(bigBlind) => set({ bigBlind })}
        />
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Când cresc blind-urile
        <select
          value={value.blindMode}
          disabled={disabled}
          onChange={(e) => set({ blindMode: e.target.value as BlindMode })}
          className={input}
        >
          {(Object.keys(MODE_LABEL) as BlindMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      {value.blindMode === "hands" && (
        <NumberField
          label="La câte mâini"
          value={value.everyHands}
          min={LIMITS.everyHands[0]}
          max={LIMITS.everyHands[1]}
          disabled={disabled}
          onValue={(everyHands) => set({ everyHands })}
        />
      )}
      {value.blindMode === "minutes" && (
        <NumberField
          label="La câte minute"
          value={value.everyMinutes}
          min={LIMITS.everyMinutes[0]}
          max={LIMITS.everyMinutes[1]}
          disabled={disabled}
          onValue={(everyMinutes) => set({ everyMinutes })}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Creștere pe nivel
          <select value={value.growth} disabled={disabled} onChange={(e) => set({ growth: Number(e.target.value) })} className={input}>
            {GROWTH_OPTIONS.map((g) => (
              <option key={g} value={g}>
                +{g}% (×{1 + g / 100})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Timp de gândire
          <select
            value={value.turnSeconds}
            disabled={disabled}
            onChange={(e) => set({ turnSeconds: Number(e.target.value) })}
            className={input}
          >
            {TURN_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === 0 ? "Fără limită" : `${t} secunde`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {problem ? (
        <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{problem}</p>
      ) : (
        <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p>{scheduleText(value)}</p>
          <p className="mt-1 font-mono">
            {levels.map((b) => `${b.sb}/${b.bb}`).join(" → ")} → …
          </p>
          <p className="mt-1">
            Fiecare jucător pornește cu {value.buyIn} jetoane ({Math.floor(value.buyIn / value.bigBlind)} big blind-uri).
            {value.turnSeconds > 0 && ` Cine nu acționează în ${value.turnSeconds} s dă automat check sau fold.`}
          </p>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onValue: (n: number) => void;
}) {
  // Local text while typing; follows the parent value whenever that changes from outside.
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isInteger(n)) onValue(n);
        }}
        className={input}
      />
    </label>
  );
}
