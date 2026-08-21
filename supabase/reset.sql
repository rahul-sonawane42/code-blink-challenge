-- =====================================================================
-- Code Blink Arena · FACTORY RESET (DESTRUCTIVE)
-- ---------------------------------------------------------------------
-- If you have been hitting "column reference "code" is ambiguous" (or
-- other schema-confusion errors), your database's tables do not match
-- what the app expects. This script wipes EVERYTHING the app owns and
-- recreates the exact base schema, so a fresh run of the Round 2
-- migration always works.
--
--   ⚠ This DELETES rooms, teams and all submissions. Only run it on a
--     project you are happy to reset (e.g. still in setup).
--
-- Usage:
--   1. Run this file in the Supabase SQL Editor.
--   2. Then run supabase/migrations/20260820200000_code_blink_round2.sql
--      in the same project.
-- =====================================================================

-- 1. Drop every table the app owns (CASCADE removes triggers/policies too).
--    Tables go first so the triggers they own are gone before the functions.
DROP TABLE IF EXISTS public.team_drafts CASCADE;
DROP TABLE IF EXISTS public.team_hosts  CASCADE;
DROP TABLE IF EXISTS public.room_hosts  CASCADE;
DROP TABLE IF EXISTS public.submissions CASCADE;
DROP TABLE IF EXISTS public.teams       CASCADE;
DROP TABLE IF EXISTS public.rooms       CASCADE;

-- 2. Drop every app function (any signature, including stale overloads).
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

-- 3. Recreate the v1 base schema (rooms + teams + RLS + realtime + triggers)
--    exactly as the Round 2 migration expects.
CREATE TABLE public.rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  problem_title text NOT NULL DEFAULT 'Problem Statement',
  problem_statement text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 600,
  status text NOT NULL DEFAULT 'lobby',
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  lives integer NOT NULL DEFAULT 4,
  current_member integer NOT NULL DEFAULT 1,
  char_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms_public_read" ON public.rooms
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO anon, authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams_public_read" ON public.teams
  FOR SELECT TO anon, authenticated USING (true);

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

CREATE TRIGGER rooms_touch_updated_at BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER teams_touch_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.teams REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;

-- Done. Now run supabase/migrations/20260820200000_code_blink_round2.sql.