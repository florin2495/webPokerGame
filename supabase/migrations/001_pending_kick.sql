-- Pending kick: a host's kick during a running tournament starts a 10 s countdown (null = no pending kick).
alter table public.poker_players add column if not exists kick_requested_at timestamptz;

notify pgrst, 'reload schema';
