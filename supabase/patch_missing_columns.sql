-- =====================================================================
-- PATCH: Add missing columns to rooms table and re-create broken RPCs
-- =====================================================================

-- 1. Add missing columns to rooms table
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS max_lives integer NOT NULL DEFAULT 4;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS remaining_ms bigint;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- 2. Re-create functions that reference these columns

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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE rooms.code = v_code);
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

  SELECT * INTO v_room FROM public.rooms r WHERE r.code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No room with that code';
  END IF;
  IF v_room.status = 'ended' THEN
    RAISE EXCEPTION 'This round has already ended';
  END IF;

  SELECT * INTO v_team FROM public.teams t WHERE t.room_id = v_room.id AND t.name = p_name LIMIT 1;
  IF NOT FOUND THEN
    IF (SELECT count(*) FROM public.teams t WHERE t.room_id = v_room.id) >= 24 THEN
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
    SELECT th.team_secret INTO v_secret FROM public.team_hosts th WHERE th.team_id = v_team.id;
  END IF;

  RETURN QUERY SELECT v_team.id, v_room.id, v_secret, v_room.code, v_room.max_lives, v_team.lives;
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
   WHERE team_id IN (SELECT t.id FROM public.teams t WHERE t.room_id = p_room_id)
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
    SELECT rh.host_secret INTO v_secret FROM public.room_hosts rh WHERE rh.room_id = v_room_id;
    IF v_secret IS NOT NULL THEN
      PERFORM public.end_round(v_room_id, v_secret);
    END IF;
  END LOOP;
END;
$$;

-- 3. Add remove_life function
CREATE OR REPLACE FUNCTION public.remove_life(
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
     SET lives = greatest(0, lives - 1),
         status = CASE WHEN lives - 1 <= 0 THEN 'finished' ELSE status END,
         finished_at = CASE WHEN lives - 1 <= 0 THEN now() ELSE finished_at END
   WHERE id = p_team_id AND room_id = p_room_id;
END;
$$;

-- 4. Add additional host features (grant_life capped, reopen_team, decrease_time)
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
DECLARE
  v_max_lives integer;
BEGIN
  IF NOT public.is_room_host(p_room_id, p_secret) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT max_lives INTO v_max_lives FROM public.rooms WHERE id = p_room_id;
  UPDATE public.teams
     SET lives = least(v_max_lives, lives + 1),
         lives_granted = lives_granted + 1
   WHERE id = p_team_id AND room_id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrease_time(
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
  UPDATE public.rooms
     SET duration_seconds = greatest(10, duration_seconds - p_seconds)
   WHERE id = p_room_id AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_team(
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
     SET status = 'accepted',
         finished_at = NULL
   WHERE id = p_team_id AND room_id = p_room_id;
END;
$$;

-- 5. Re-grant execute permissions
GRANT EXECUTE ON FUNCTION public.create_room(text, text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pause_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increase_time(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrease_time(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_round(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_life(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_life(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_team(uuid, uuid, text) TO anon, authenticated;

-- 6. Fix submit_turn member limit logic
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
GRANT EXECUTE ON FUNCTION public.submit_turn(uuid, text, integer, text) TO anon, authenticated;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

