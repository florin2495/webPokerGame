-- Poker 003: host-chosen seat order (reorder) and the observers' queue for the next tournament.
-- Additive. Run in the Supabase SQL editor.
alter table public.poker_players add column if not exists seat integer;            -- order of the players in the lobby (null = not placed yet, sorts last)
alter table public.poker_players add column if not exists queued_at timestamptz;   -- observer wants to play the next tournament (null = not queued)
notify pgrst, 'reload schema';
