-- ============================================================================
-- Emulación MÍNIMA de Supabase para pruebas locales de BD (W1 · RC-35).
-- SOLO para el cluster desechable de supabase/tests/db/run.sh. Nunca producción.
--
-- Reproduce lo que las migraciones asumen del proyecto Supabase:
--   · roles anon / authenticated / service_role (service_role con BYPASSRLS)
--   · privilegios por defecto de Supabase: ALL a esos roles en public
--     (así las pruebas de RLS no pasan "por falta de GRANT", como en prod)
--   · auth.users + auth.uid() / auth.role() / auth.jwt() leyendo request.jwt.claims
--   · storage.buckets / storage.objects (RLS) / storage.foldername()
--   · publicación supabase_realtime
-- ============================================================================

-- Roles a nivel cluster (idempotente: una 2ª base del mismo cluster reutiliza los roles).
DO $$ BEGIN CREATE ROLE anon          NOLOGIN NOINHERIT;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Como en Supabase: extensiones en el esquema `extensions` (no en public) y en el search_path.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = "$user", public, extensions', current_database()); END $$;
SET search_path = "$user", public, extensions;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  created_at         timestamptz DEFAULT now()
);

-- Mismas definiciones que Supabase (GoTrue) para leer el JWT de la request.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean DEFAULT false,
  owner              uuid,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        text REFERENCES storage.buckets(id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;

CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------
SET client_min_messages = error;
CREATE PUBLICATION supabase_realtime;

-- ---------------------------------------------------------------------------
-- pg_cron (W6-A3): emulación MÍNIMA del esquema `cron` con la forma real de pg_cron
-- 1.6 (tablas job / job_run_details y schedule/unschedule por nombre). No ejecuta
-- nada: las pruebas insertan corridas a mano para simular lo que pg_cron registra.
-- Reproduce también el default de pg_cron de SELECT a PUBLIC (lo que A3.1 revoca).
-- ---------------------------------------------------------------------------
SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost', nodeport int NOT NULL DEFAULT 5432,
  database text NOT NULL DEFAULT current_database(), username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true, jobname text UNIQUE
);
CREATE TABLE cron.job_run_details (
  jobid bigint, runid bigserial PRIMARY KEY, job_pid int, database text, username text, command text,
  status text, return_message text, start_time timestamptz, end_time timestamptz
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO cron.job (schedule, command, jobname) VALUES (schedule, command, job_name)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command, active = true
  RETURNING jobid INTO v;
  RETURN v;
END $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN found;
END $$;
GRANT SELECT ON cron.job, cron.job_run_details TO PUBLIC;
