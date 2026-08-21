-- =====================================================================
-- Code Blink Arena · Round 2
-- Host control, team approvals, submissions, per-team secrets, dark arena.
-- Paste the whole file into the Supabase SQL Editor and run it.
-- Idempotent: safe to run once; each statement is guarded.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Preflight: fail fast with a readable message if the base tables are
-- missing, so a confusing error like "column reference is ambiguous"
-- never hides a schema that never got its v1 foundation.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'rooms') THEN
    RAISE EXCEPTION 'Preflight: public.rooms is missing. Run the v1 migration (20260820155026) first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'teams') THEN
    RAISE EXCEPTION 'Preflight: public.teams is missing. Run the v1 migration (20260820155026) first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'code') THEN
    RAISE EXCEPTION 'Preflight: public.rooms has no code column. The base schema is unexpected; run the v1 migration (20260820155026) first.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'code') THEN
    RAISE NOTICE 'Preflight warning: public.teams already has a column named code. If a query reports "column reference code is ambiguous", rename or drop teams.code first (the app identifies teams by name, rooms by code).';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. rooms — host-configurable lives, pause/remaining-time, ended_at
-- ---------------------------------------------------------------------
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS max_lives integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS remaining_ms bigint,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. room_hosts — one secret per room, NEVER readable by clients.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_hosts (
  room_id uuid NOT NULL PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  host_secret text NOT NULL UNIQUE
);
REVOKE ALL ON public.room_hosts FROM anon, authenticated;
ALTER TABLE public.room_hosts ENABLE ROW LEVEL SECURITY;
-- no policies => no client access at all.

-- ---------------------------------------------------------------------
-- 3. teams — acceptance, pastel color, timings.
-- ---------------------------------------------------------------------
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#8EE7C2',
  ADD COLUMN IF NOT EXISTS accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS lives_granted integer NOT NULL DEFAULT 0;

-- The live (hidden) draft code lives in team_drafts, which clients can never
-- read. Keeping it off the teams table means realtime broadcasts of team
-- status/color/lives stay clean for everyone.
CREATE TABLE IF NOT EXISTS public.team_drafts (
  team_id uuid NOT NULL PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.team_drafts FROM anon, authenticated;
ALTER TABLE public.team_drafts ENABLE ROW LEVEL SECURITY;
-- no policies => no client access at all.

-- ---------------------------------------------------------------------
-- 4. team_hosts — one secret per team, NEVER readable by clients.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_hosts (
  team_id uuid NOT NULL PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  team_secret text NOT NULL UNIQUE
);
REVOKE ALL ON public.team_hosts FROM anon, authenticated;
ALTER TABLE public.team_hosts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 5. submissions — each end-of-turn code, judged by the host.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  member integer NOT NULL DEFAULT 1,
  code text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Submissions are never readable by clients. The host reads them through the
-- host_submissions RPC (secret-checked); the owning team pulls its own result
-- through get_submission_result (secret-checked). No direct SELECT, no realtime.
REVOKE ALL ON public.submissions FROM anon, authenticated;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
-- no policies => no client access at all.

-- ---------------------------------------------------------------------
-- 6. Tighten the existing tables: reads stay, writes move into RPCs.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.rooms FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.teams FROM anon, authenticated;
DROP POLICY IF EXISTS "rooms_public_insert" ON public.rooms;
DROP POLICY IF EXISTS "rooms_public_update" ON public.rooms;
DROP POLICY IF EXISTS "rooms_public_delete" ON public.rooms;
DROP POLICY IF EXISTS "teams_public_insert" ON public.teams;
DROP POLICY IF EXISTS "teams_public_update" ON public.teams;
DROP POLICY IF EXISTS "teams_public_delete" ON public.teams;

-- Existing test data from the old flow is treated as pending teams.
UPDATE public.teams SET status = 'pending', accepted = false WHERE status = 'joined';

-- Status vocabulary is now fixed.
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('lobby', 'running', 'paused', 'ended'));
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_status_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_status_check
  CHECK (status IN ('pending', 'accepted', 'typing', 'submitted', 'finished', 'kicked'));

-- ---------------------------------------------------------------------
-- 7. Helpers + RPCs. All SECURITY DEFINER so they run as the table owner
--    (bypasses RLS), with search_path pinned to prevent hijacking.
-- ---------------------------------------------------------------------

-- Drop every pre-existing overload of the RPC names first. Postgres treats
-- two functions with the same name but different parameter lists as separate
-- overloads, so a stale function (from an earlier version of this file, or a
-- different ordering of arguments) would otherwise linger and confuse
-- PostgREST with a "could not find the function … in the schema cache" error.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'create_room', 'join_room', 'update_draft', 'submit_turn',
         'get_submission_result', 'host_teams', 'host_submissions',
         'accept_team', 'kick_team', 'rename_team', 'set_team_color',
         'grant_life', 'review_submission', 'start_round', 'pause_round',
         'resume_round', 'increase_time', 'end_round', 'auto_end_expired',
         'is_room_host', 'is_team_owner', 'random_secret', 'random_code'
       )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.args);
  END LOOP;
END
$$;

-- Core-only randomness: gen_random_uuid() ships inside PostgreSQL 13+, so no
-- pgcrypto extension is needed (and search_path stays pinned to public).
CREATE OR REPLACE FUNCTION public.random_secret()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

CREATE OR REPLACE FUNCTION public.random_code()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5))
$$;

REVOKE ALL ON FUNCTION public.random_secret() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.random_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_room_host(p_room_id uuid, p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.room_hosts WHERE room_id = p_room_id AND host_secret = p_secret)
$$;

CREATE OR REPLACE FUNCTION public.is_team_owner(p_team_id uuid, p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_hosts WHERE team_id = p_team_id AND team_secret = p_secret)
$$;

CREATE OR REPLACE FUNCTION public.create_room(
  p_title text,
  p_statement text,
  p_duration_seconds integer,
  p_max_lives integer
)
RETURNS TABLE (code text, host_secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_room_id uuid;
  v_secret text;
BEGIN
  p_title     := nullif(btrim(coalesce(p_title, '')), '');
  p_statement := left(coalesce(p_statement, ''), 10000);
  p_duration_seconds := greatest(10, least(3600, coalesce(p_duration_seconds, 600)));
  p_max_lives := greatest(1, least(9, coalesce(p_max_lives, 4)));
  IF char_length(p_title) > 200 THEN
    RAISE EXCEPTION 'Problem title is too long';
  END IF;

  v_secret := public.random_secret();
  LOOP
    v_code := public.random_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code);
  END LOOP;

  INSERT INTO public.rooms (code, problem_title, problem_statement, duration_seconds, max_lives)
  VALUES (v_code, coalesce(p_title, 'Problem Statement'), p_statement, p_duration_seconds, p_max_lives)
  RETURNING id INTO v_room_id;

  INSERT INTO public.room_hosts (room_id, host_secret) VALUES (v_room_id, v_secret);

  RETURN QUERY SELECT v_code, v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room(
  p_code text,
  p_name text,
  p_prev_secret text
)
RETURNS TABLE (
  team_id uuid,
  room_id uuid,
  team_secret text,
  room_code text,
  max_lives integer,
  lives integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_secret text;
BEGIN
  p_code := upper(btrim(coalesce(p_code, '')));
  p_name := nullif(btrim(coalesce(p_name, '')), '');
  IF p_code = '' OR p_name IS NULL THEN
    RAISE EXCEPTION 'Room code and team name are required';
  END IF;
  IF char_length(p_name) > 40 THEN
    RAISE EXCEPTION 'Team name is too long';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No room with that code';
  END IF;
  IF v_room.status = 'ended' THEN
    RAISE EXCEPTION 'This round has already ended';
  END IF;

  -- Rejoin recovery: the same machine re-joins with the same name.
  SELECT * INTO v_team FROM public.teams WHERE room_id = v_room.id AND name = p_name LIMIT 1;
  IF NOT FOUND THEN
    -- Fresh team. Cap the roster so a room can't be flooded with spam teams.
    IF (SELECT count(*) FROM public.teams WHERE room_id = v_room.id) >= 24 THEN
      RAISE EXCEPTION 'This room is full';
    END IF;
    INSERT INTO public.teams (room_id, name, lives, status)
    VALUES (v_room.id, p_name, v_room.max_lives, 'pending')
    RETURNING * INTO v_team;
    v_secret := public.random_secret();
    INSERT INTO public.team_hosts (team_id, team_secret) VALUES (v_team.id, v_secret);
  ELSE
    -- Rejoining an existing name requires proof of the old secret. This stops
    -- a stranger from hijacking a known team, and keeps every open tab alive
    -- (the secret is never rotated on rejoin).
    IF NOT public.is_team_owner(v_team.id, coalesce(p_prev_secret, '')) THEN
      RAISE EXCEPTION 'That team name is already taken in this room';
    END IF;
    IF v_team.status = 'kicked' THEN
      -- A turned-away team can ask to be admitted again (host still approves).
      UPDATE public.teams
         SET status = 'pending', accepted = false, finished_at = NULL
       WHERE id = v_team.id;
    END IF;
    SELECT team_secret INTO v_secret FROM public.team_hosts WHERE team_id = v_team.id;
  END IF;

  RETURN QUERY SELECT v_team.id, v_room.id, v_secret, v_room.code, v_room.max_lives, v_team.lives;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_draft(
  p_team_id uuid,
  p_secret text,
  p_code text,
  p_char_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_code text;
BEGIN
  IF NOT public.is_team_owner(p_team_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized for this team';
  END IF;
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND OR NOT v_team.accepted OR v_team.status NOT IN ('accepted', 'typing') THEN
    RETURN; -- only accepted, idle-or-typing teams may write drafts
  END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_team.room_id;
  IF v_room.status <> 'running' THEN
    RETURN; -- paused / lobby / ended -> freeze typing
  END IF;
  IF now() > v_room.started_at + make_interval(secs => v_room.duration_seconds) THEN
    RETURN; -- deadline passed, freeze typing
  END IF;
  v_code := left(coalesce(p_code, ''), 100000);
  INSERT INTO public.team_drafts (team_id, code, updated_at)
  VALUES (p_team_id, v_code, now())
  ON CONFLICT (team_id) DO UPDATE
    SET code = EXCLUDED.code, updated_at = now();
  UPDATE public.teams
     SET char_count = char_length(v_code),
         status = 'typing'
   WHERE id = p_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_turn(
  p_team_id uuid,
  p_secret text,
  p_member integer,
  p_code text
)
RETURNS TABLE (submission_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_id uuid;
  v_code text;
BEGIN
  IF NOT public.is_team_owner(p_team_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized for this team';
  END IF;
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found'; END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_team.room_id;
  IF v_room.status <> 'running' THEN RAISE EXCEPTION 'The round is not running'; END IF;
  IF now() > v_room.started_at + make_interval(secs => v_room.duration_seconds) THEN
    RAISE EXCEPTION 'The round has ended';
  END IF;
  IF NOT v_team.accepted THEN RAISE EXCEPTION 'This team has not been accepted yet'; END IF;
  IF v_team.status <> 'accepted' AND v_team.status <> 'typing' THEN
    RAISE EXCEPTION 'This team already has a submission being reviewed';
  END IF;
  IF p_member IS NULL OR p_member <> v_team.current_member THEN
    RAISE EXCEPTION 'It is not member %''s turn', v_team.current_member;
  END IF;

  v_code := left(coalesce(p_code, ''), 100000);

  INSERT INTO public.submissions (team_id, member, code, status)
  VALUES (p_team_id, p_member, v_code, 'pending')
  RETURNING id INTO v_id;

  UPDATE public.teams
     SET status       = 'submitted',
         char_count   = char_length(v_code),
         current_member = least(greatest(v_team.lives, 1), v_team.current_member + 1)
   WHERE id = p_team_id;

  RETURN QUERY SELECT v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_submission_result(
  p_submission_id uuid,
  p_team_id uuid,
  p_secret text
)
RETURNS TABLE (
  status text,
  code text,
  char_count integer,
  reviewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.submissions%ROWTYPE;
BEGIN
  IF NOT public.is_team_owner(p_team_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized for this team';
  END IF;
  SELECT * INTO v_sub FROM public.submissions WHERE id = p_submission_id;
  IF NOT FOUND OR v_sub.team_id <> p_team_id THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF v_sub.status IN ('correct', 'revealed') THEN
    RETURN QUERY SELECT v_sub.status, v_sub.code, char_length(v_sub.code)::integer, v_sub.reviewed_at;
  ELSE
    RETURN QUERY SELECT v_sub.status, NULL::text, char_length(v_sub.code)::integer, v_sub.reviewed_at;
  END IF;
END;
$$;

-- ---------------------------- host RPCs ------------------------------

CREATE OR REPLACE FUNCTION public.host_teams(
  p_room_id uuid,
  p_secret text
)
RETURNS TABLE (
  id uuid,
  name text,
  status text,
  lives integer,
  lives_granted integer,
  current_member integer,
  char_count integer,
  color text,
  accepted boolean,
  draft_code text,
  started_at timestamptz,
  finished_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT t.id, t.name, t.status, t.lives, t.lives_granted, t.current_member, t.char_count,
           t.color, t.accepted, coalesce(d.code, '') AS draft_code,
           t.started_at, t.finished_at
      FROM public.teams t
      LEFT JOIN public.team_drafts d ON d.team_id = t.id
     WHERE t.room_id = p_room_id
     ORDER BY t.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.host_submissions(
  p_room_id uuid,
  p_secret text
)
RETURNS TABLE (
  id uuid,
  team_id uuid,
  member integer,
  code text,
  status text,
  submitted_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT s.id, s.team_id, s.member, s.code, s.status, s.submitted_at, s.reviewed_at
      FROM public.submissions s
      JOIN public.teams t ON t.id = s.team_id
     WHERE t.room_id = p_room_id
     ORDER BY s.submitted_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_team(
  p_room_id uuid,
  p_team_id uuid,
  p_color text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_color text;
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id AND room_id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found in this room'; END IF;
  IF v_team.accepted THEN RETURN; END IF;

  -- Always hand out the first palette color no other team in the room is using,
  -- so two teams can never end up with the same tint.
  SELECT c INTO v_color
    FROM unnest(ARRAY[
      '#8EE7C2', '#F4B9D3', '#F6C9A9', '#C7B8F2',
      '#A9C7F2', '#F4E0A2', '#A2E3DC', '#F5B2A3']) AS c
   WHERE NOT EXISTS (
      SELECT 1 FROM public.teams t
       WHERE t.room_id = p_room_id AND t.color = c AND t.id <> p_team_id
   )
   ORDER BY array_position(ARRAY[
      '#8EE7C2', '#F4B9D3', '#F6C9A9', '#C7B8F2',
      '#A9C7F2', '#F4E0A2', '#A2E3DC', '#F5B2A3'], c)
   LIMIT 1;
  v_color := coalesce(v_color, '#8EE7C2');

  UPDATE public.teams
     SET accepted = true,
         status = 'accepted',
         color = v_color,
         started_at = coalesce(started_at, now())
   WHERE id = p_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kick_team(
  p_room_id uuid,
  p_team_id uuid,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.teams
     SET accepted = false,
         status = 'kicked',
         finished_at = now()
   WHERE id = p_team_id AND room_id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_team(
  p_room_id uuid,
  p_team_id uuid,
  p_name text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'Name cannot be empty'; END IF;
  IF char_length(v_name) > 40 THEN RAISE EXCEPTION 'Name is too long'; END IF;
  BEGIN
    UPDATE public.teams SET name = v_name WHERE id = p_team_id AND room_id = p_room_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another team already uses that name';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_team_color(
  p_room_id uuid,
  p_team_id uuid,
  p_color text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_color IS NULL OR NOT (p_color = ANY (ARRAY[
      '#8EE7C2', '#F4B9D3', '#F6C9A9', '#C7B8F2',
      '#A9C7F2', '#F4E0A2', '#A2E3DC', '#F5B2A3'])) THEN
    RAISE EXCEPTION 'Invalid team color';
  END IF;
  UPDATE public.teams SET color = p_color WHERE id = p_team_id AND room_id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_life(
  p_room_id uuid,
  p_team_id uuid,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.teams
     SET lives = least(20, lives + 1),
         lives_granted = lives_granted + 1
   WHERE id = p_team_id AND room_id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_submission(
  p_submission_id uuid,
  p_room_id uuid,
  p_verdict text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.submissions%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_lives integer;
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_verdict NOT IN ('correct', 'rejected') THEN
    RAISE EXCEPTION 'Invalid verdict';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.submissions s
    JOIN public.teams t ON t.id = s.team_id
   WHERE s.id = p_submission_id AND t.room_id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission not found in this room'; END IF;
  IF v_sub.status <> 'pending' THEN RAISE EXCEPTION 'Submission already reviewed'; END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = v_sub.team_id;

  IF p_verdict = 'correct' THEN
    UPDATE public.submissions SET status = 'correct', reviewed_at = now() WHERE id = p_submission_id;
    UPDATE public.teams
       SET status = 'finished', finished_at = now()
     WHERE id = v_team.id;
  ELSE
    v_lives := greatest(0, v_team.lives - 1);
    UPDATE public.submissions SET status = 'rejected', reviewed_at = now() WHERE id = p_submission_id;
    UPDATE public.teams
       SET lives = v_lives,
           status = CASE WHEN v_lives <= 0 THEN 'finished' ELSE 'accepted' END,
           finished_at = CASE WHEN v_lives <= 0 THEN now() ELSE finished_at END
     WHERE id = v_team.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_round(
  p_room_id uuid,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.rooms
     SET status = 'running', started_at = now(), remaining_ms = NULL
   WHERE id = p_room_id AND status IN ('lobby', 'paused');
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_round(
  p_room_id uuid,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.rooms
     SET status = 'paused',
         remaining_ms = greatest(0, (
           EXTRACT(EPOCH FROM (
             started_at + make_interval(secs => duration_seconds) - now()
           )) * 1000
         )::bigint)
   WHERE id = p_room_id AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_round(
  p_room_id uuid,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.rooms
     SET status = 'running',
         started_at = now() - make_interval(secs =>
           (duration_seconds::bigint * 1000 - coalesce(remaining_ms, 0))::numeric / 1000),
         remaining_ms = NULL
   WHERE id = p_room_id AND status = 'paused';
END;
$$;

CREATE OR REPLACE FUNCTION public.increase_time(
  p_room_id uuid,
  p_seconds integer,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  p_seconds := greatest(1, least(3600, coalesce(p_seconds, 60)));
  UPDATE public.rooms
     SET started_at = started_at + make_interval(secs => p_seconds),
         remaining_ms = CASE
           WHEN status = 'paused' THEN coalesce(remaining_ms, 0) + p_seconds * 1000
           ELSE remaining_ms
         END
   WHERE id = p_room_id AND status IN ('running', 'paused');
END;
$$;

CREATE OR REPLACE FUNCTION public.end_round(
  p_room_id uuid,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.rooms
     SET status = 'ended', ended_at = now(), remaining_ms = NULL
   WHERE id = p_room_id AND status IN ('running', 'paused');
  -- Unreviewed submissions are revealed so teams can pull their final code.
  UPDATE public.submissions
     SET status = 'revealed', reviewed_at = coalesce(reviewed_at, now())
   WHERE team_id IN (SELECT id FROM public.teams WHERE room_id = p_room_id)
     AND status = 'pending';
  UPDATE public.teams
     SET status = CASE WHEN accepted THEN 'finished' ELSE status END,
         finished_at = CASE WHEN accepted AND finished_at IS NULL THEN now() ELSE finished_at END
   WHERE room_id = p_room_id AND status <> 'finished';
END;
$$;

-- ------------------------- auto-end at deadline ------------------------
-- If the host tab is closed or throttled, the round still ends when the
-- clock hits zero: a SECURITY DEFINER sweep + an optional pg_cron job.
CREATE OR REPLACE FUNCTION public.auto_end_expired()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_secret text;
BEGIN
  FOR v_room_id IN
    SELECT r.id
      FROM public.rooms r
     WHERE r.status = 'running'
       AND now() > r.started_at + make_interval(secs => r.duration_seconds)
  LOOP
    SELECT host_secret INTO v_secret FROM public.room_hosts WHERE room_id = v_room_id;
    PERFORM public.end_round(v_room_id, v_secret);
  END LOOP;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('code-blink-auto-end');
  PERFORM cron.schedule('code-blink-auto-end', '* * * * *', 'select public.auto_end_expired()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable; the deadline is still enforced inside submit/typing guards';
END $$;

-- ---------------------------- grants ------------------------------
GRANT EXECUTE ON FUNCTION public.create_room(text, text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_draft(uuid, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_turn(uuid, text, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_submission_result(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.host_teams(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.host_submissions(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kick_team(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_team(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_team_color(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_life(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_submission(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pause_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increase_time(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_round(uuid, text) TO anon, authenticated;
-- Helpers stay internal to the SECURITY DEFINER functions; clients never call them.
REVOKE ALL ON FUNCTION public.is_room_host(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_team_owner(uuid, text) FROM PUBLIC, anon, authenticated;

-- Realtime already covers rooms + teams (added in v1); keep the publication clean.