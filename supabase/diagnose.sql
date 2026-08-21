-- =====================================================================
-- Code Blink Arena · schema diagnosis
-- Run this whole file in the Supabase SQL Editor, then paste the full
-- output back. It shows exactly what the database actually contains so
-- confusing runtime errors (e.g. "column reference is ambiguous") can be
-- traced to a schema mismatch.
-- =====================================================================

-- 1. Every public table and its columns, in order -----------------------
SELECT t.table_name, c.ordinal_position, c.column_name, c.data_type
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position;

-- 2. Every public function and its exact signature ----------------------
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 3. Constraints on the core tables --------------------------------------
SELECT tc.table_name, tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('rooms','teams','submissions','team_drafts','room_hosts','team_hosts')
ORDER BY tc.table_name, tc.constraint_name;

-- 4. Tables in the supabase_realtime publication --------------------------
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 5. Triggers -------------------------------------------------------------
SELECT event_object_table AS table_name, trigger_name
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;

-- 6. Row level security state ----------------------------------------------
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('rooms','teams','submissions','team_drafts','room_hosts','team_hosts')
ORDER BY c.relname;

-- 7. RLS policies -----------------------------------------------------------
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;