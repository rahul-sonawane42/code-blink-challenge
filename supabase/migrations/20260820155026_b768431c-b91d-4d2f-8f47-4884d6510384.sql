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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms_public_read" ON public.rooms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rooms_public_insert" ON public.rooms FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rooms_public_update" ON public.rooms FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rooms_public_delete" ON public.rooms FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'joined',
  lives integer NOT NULL DEFAULT 4,
  current_member integer NOT NULL DEFAULT 1,
  char_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO anon, authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams_public_read" ON public.teams FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "teams_public_insert" ON public.teams FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "teams_public_update" ON public.teams FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "teams_public_delete" ON public.teams FOR DELETE TO anon, authenticated USING (true);

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