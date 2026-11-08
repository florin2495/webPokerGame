// Pure helpers for the seat order (host reorder) and the observers' queue. No I/O, unit-tested.

export interface Orderable {
  id: string;
  role: "player" | "observer";
  seat: number | null;
  joined_at: string;
  queued_at: string | null;
}

/** Players by their saved seat (never placed = last), then by join time. */
export function bySeat<T extends Orderable>(members: T[]): T[] {
  return [...members].sort((a, b) => {
    const sa = a.seat ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seat ?? Number.MAX_SAFE_INTEGER;
    return sa - sb || a.joined_at.localeCompare(b.joined_at);
  });
}

/** True when `order` is exactly a permutation of `playerIds` (no duplicates, nothing missing or extra). */
export function isPermutation(order: unknown, playerIds: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== playerIds.length) return false;
  if (!order.every((x) => typeof x === "string")) return false;
  const set = new Set(order as string[]);
  return set.size === playerIds.length && playerIds.every((id) => set.has(id));
}

/** Queued observers in the order they queued, at most `freeSeats` of them. */
export function promotable<T extends Orderable>(members: T[], freeSeats: number): T[] {
  return members
    .filter((m) => m.role === "observer" && m.queued_at !== null)
    .sort((a, b) => a.queued_at!.localeCompare(b.queued_at!) || a.joined_at.localeCompare(b.joined_at))
    .slice(0, Math.max(0, freeSeats));
}
