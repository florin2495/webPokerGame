"use client";

import { type Card, cardLabel, isRed, rankLabel, rankOf, SUIT_SYMBOL, suitOf } from "@/lib/poker";

const SIZES = {
  xs: "h-9 w-6.5 text-[11px] rounded",
  sm: "h-12 w-9 text-sm rounded-md",
  md: "h-16 w-11 text-base rounded-lg",
  lg: "h-24 w-17 text-2xl rounded-xl",
} as const;

export type CardSize = keyof typeof SIZES;

/** One playing card face, or its back when `card` is null. */
export function PlayingCard({ card, size = "md", highlight, dim }: { card: Card | null; size?: CardSize; highlight?: boolean; dim?: boolean }) {
  if (!card) {
    return (
      <span
        aria-label="carte cu fața în jos"
        className={`${SIZES[size]} inline-block shrink-0 border-2 border-white bg-[repeating-linear-gradient(45deg,#4338ca_0_4px,#6366f1_4px_8px)] shadow-sm dark:border-zinc-700`}
      />
    );
  }
  const suit = suitOf(card);
  const color = isRed(suit) ? "text-rose-600" : "text-zinc-900";
  return (
    <span
      aria-label={cardLabel(card)}
      className={`${SIZES[size]} ${color} flex shrink-0 flex-col items-center justify-center border-2 bg-white leading-none font-black shadow-sm ${
        highlight ? "border-amber-400 ring-2 ring-amber-300" : "border-zinc-300"
      } ${dim ? "opacity-40" : ""}`}
    >
      <span>{rankLabel(rankOf(card))}</span>
      <span>{SUIT_SYMBOL[suit]}</span>
    </span>
  );
}

/** Empty board slot. */
export function CardSlot({ size = "md" }: { size?: CardSize }) {
  return <span className={`${SIZES[size]} inline-block shrink-0 border-2 border-dashed border-white/30`} />;
}
