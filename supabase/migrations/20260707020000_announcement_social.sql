-- Interacción social de ANUNCIOS (Vista Común): comentarios, reacciones ("Me
-- sirve") y acuse de lectura ("leído") — persistentes POR USUARIO. Antes eran solo
-- estado local (se perdían al recargar). Staff-only (los doctores no ven el hub).

-- ---------------- COMENTARIOS ----------------
CREATE TABLE IF NOT EXISTS announcement_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author text,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ann_comments_idx ON announcement_comments (announcement_id, created_at);
ALTER TABLE announcement_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ann_comments_read ON announcement_comments;
CREATE POLICY ann_comments_read ON announcement_comments FOR SELECT TO authenticated
  USING (public.auth_role() <> 'doctor');
DROP POLICY IF EXISTS ann_comments_insert ON announcement_comments;
CREATE POLICY ann_comments_insert ON announcement_comments FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() <> 'doctor' AND user_id = auth.uid());
DROP POLICY IF EXISTS ann_comments_delete ON announcement_comments;
CREATE POLICY ann_comments_delete ON announcement_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.auth_role() = 'admin');

-- ---------------- REACCIONES ("Me sirve") ----------------
CREATE TABLE IF NOT EXISTS announcement_reactions (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);
ALTER TABLE announcement_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ann_reactions_read ON announcement_reactions;
CREATE POLICY ann_reactions_read ON announcement_reactions FOR SELECT TO authenticated
  USING (public.auth_role() <> 'doctor');
DROP POLICY IF EXISTS ann_reactions_own ON announcement_reactions;
CREATE POLICY ann_reactions_own ON announcement_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.auth_role() <> 'doctor');
DROP POLICY IF EXISTS ann_reactions_del ON announcement_reactions;
CREATE POLICY ann_reactions_del ON announcement_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------- LECTURAS ("leído") ----------------
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ann_reads_read ON announcement_reads;
CREATE POLICY ann_reads_read ON announcement_reads FOR SELECT TO authenticated
  USING (public.auth_role() <> 'doctor');
DROP POLICY IF EXISTS ann_reads_own ON announcement_reads;
CREATE POLICY ann_reads_own ON announcement_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.auth_role() <> 'doctor');
