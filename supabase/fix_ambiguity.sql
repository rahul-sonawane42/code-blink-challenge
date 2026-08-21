-- =====================================================================
-- Code Blink Arena · AMBIGUITY FIX & RE-MIGRATION SCRIPT
-- ---------------------------------------------------------------------
-- This script cleans up any lingering Lovable views, drops any accidental
-- `code` column on `teams`, and re-runs the Round 2 schema cleanly.
-- Run this in the Supabase SQL Editor.
-- =====================================================================

-- 1. Drop any views in public schema (our app uses tables & RPCs, never views).
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT table_name
      FROM information_schema.views
     WHERE table_schema = 'public'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE;', v.table_name);
  END LOOP;
END
$$;

-- 2. Ensure public.teams does NOT have an accidental `code` column.
ALTER TABLE public.teams DROP COLUMN IF EXISTS code CASCADE;

-- 3. Drop app tables first so their triggers (depending on touch_updated_at) are removed.
DROP TABLE IF EXISTS public.team_drafts CASCADE;
DROP TABLE IF EXISTS public.team_hosts  CASCADE;
DROP TABLE IF EXISTS public.room_hosts  CASCADE;
DROP TABLE IF EXISTS public.submissions CASCADE;
DROP TABLE IF EXISTS public.teams       CASCADE;
DROP TABLE IF EXISTS public.rooms       CASCADE;

-- 4. Drop all app RPC overloads and touch_updated_at now that triggers are gone.
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
         'is_room_host', 'is_team_owner', 'random_secret', 'random_code',
         'touch_updated_at'
       )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.args);
  END LOOP;
END
$$;

-- 5. Recreate base tables (rooms + teams) without any ambiguity.
CREATE TABLE public.rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  problem_title text NOT NULL DEFAULT 'Problem Statement',
  problem_statement text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 600,
  max_lives integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'lobby',
  started_at timestamptz,
  ended_at timestamptz,
  remaining_ms bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  lives integer NOT NULL DEFAULT 4,
  lives_granted integer NOT NULL DEFAULT 0,
  current_member integer NOT NULL DEFAULT 1,
  char_count integer NOT NULL DEFAULT 0,
  color text,
  accepted boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, name)
);

-- 6. Secondary tables.
CREATE TABLE public.room_hosts (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE PRIMARY KEY,
  host_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.team_drafts (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE PRIMARY KEY,
  code text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.team_hosts (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE PRIMARY KEY,
  team_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  member integer NOT NULL,
  code text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

-- 7. Security / RLS / Realtime.
GRANT SELECT ON public.rooms TO anon, authenticated;
GRANT SELECT ON public.teams TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
GRANT ALL ON public.teams TO service_role;
GRANT ALL ON public.room_hosts TO service_role;
GRANT ALL ON public.team_drafts TO service_role;
GRANT ALL ON public.team_hosts TO service_role;
GRANT ALL ON public.submissions TO service_role;

REVOKE INSERT, UPDATE, DELETE ON public.rooms FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.teams FROM anon, authenticated;
REVOKE ALL ON public.room_hosts FROM anon, authenticated;
REVOKE ALL ON public.team_drafts FROM anon, authenticated;
REVOKE ALL ON public.team_hosts FROM anon, authenticated;
REVOKE ALL ON public.submissions FROM anon, authenticated;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rooms_public_read" ON public.rooms;
CREATE POLICY "rooms_public_read" ON public.rooms FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "teams_public_read" ON public.teams;
CREATE POLICY "teams_public_read" ON public.teams FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_touch_updated_at ON public.rooms;
CREATE TRIGGER rooms_touch_updated_at BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS teams_touch_updated_at ON public.teams;
CREATE TRIGGER teams_touch_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.teams REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 8. Core helpers & security check functions.
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

CREATE OR REPLACE FUNCTION public.is_room_host(p_room_id uuid, p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_hosts
     WHERE room_id = p_room_id AND host_secret = coalesce(p_secret, '')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_team_owner(p_team_id uuid, p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_hosts
     WHERE team_id = p_team_id AND team_secret = coalesce(p_secret, '')
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_room_host(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_team_owner(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.random_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.random_code() FROM PUBLIC, anon, authenticated;

-- 9. RPC Functions.
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

  SELECT * INTO v_team FROM public.teams WHERE room_id = v_room.id AND name = p_name LIMIT 1;
  IF NOT FOUND THEN
    IF (SELECT count(*) FROM public.teams WHERE room_id = v_room.id) >= 24 THEN
      RAISE EXCEPTION 'This room is full';
    END IF;
    INSERT INTO public.teams (room_id, name, lives, status)
    VALUES (v_room.id, p_name, v_room.max_lives, 'pending')
    RETURNING * INTO v_team;
    v_secret := public.random_secret();
    INSERT INTO public.team_hosts (team_id, team_secret) VALUES (v_team.id, v_secret);
  ELSE
    IF NOT public.is_team_owner(v_team.id, coalesce(p_prev_secret, '')) THEN
      RAISE EXCEPTION 'That team name is already taken in this room';
    END IF;
    IF v_team.status = 'kicked' THEN
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
    RETURN;
  END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_team.room_id;
  IF v_room.status <> 'running' THEN
    RETURN;
  END IF;
  IF now() > v_room.started_at + make_interval(secs => v_room.duration_seconds) THEN
    RETURN;
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
         current_member = least(v_room.max_lives, v_team.current_member + 1)
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
    IF v_secret IS NOT NULL THEN
      PERFORM public.end_round(v_room_id, v_secret);
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('code-blink-auto-end');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('code-blink-auto-end', '* * * * *', 'select public.auto_end_expired()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END $$;

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

NOTIFY pgrst, 'reload schema';
