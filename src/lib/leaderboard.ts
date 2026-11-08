// Pure part of the leaderboard reporting (contract C): who gets +1 game / +1 win for a finished tournament.

export interface LeaderboardEntry {
  playerKey: string;
  displayName: string;
  win: boolean;
}

/** No accounts: the same nickname (lower-case, trimmed) is the same person. */
export function playerKey(nickname: string): string {
  return nickname.trim().toLowerCase();
}

/** Everyone who started the tournament (also those who left) gets a game; the winning seat also a win. */
export function leaderboardEntries(names: string[], winner: number | null): LeaderboardEntry[] {
  const byKey = new Map<string, LeaderboardEntry>();
  names.forEach((name, seat) => {
    const key = playerKey(name);
    if (!key) return;
    const prev = byKey.get(key);
    byKey.set(key, { playerKey: key, displayName: name.trim(), win: (prev?.win ?? false) || seat === winner });
  });
  return [...byKey.values()];
}
