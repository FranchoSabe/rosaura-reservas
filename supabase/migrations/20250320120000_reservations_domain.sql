-- =============================================================================
-- Rosaura — dominio reservas (Fase 1 Supabase)
-- =============================================================================
-- Políticas (piloto single-tenant):
--   • anon: INSERT en reservas/lista de espera solo para tenant fijo;
--           sin SELECT directo en reservas (búsqueda vía RPC);
--           lectura de mesas, config de slots y bloqueos del día para armar UI pública.
--   • authenticated: CRUD completo sobre filas del tenant por defecto (staff vía
--           Supabase Auth; la app inicia sesión en Supabase tras login Firebase).
-- Producción: reemplazar políticas fijas por tenant_id desde staff_profiles / JWT.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- UUID fijo del tenant piloto (debe coincidir con VITE_DEFAULT_TENANT_ID)
CREATE OR REPLACE FUNCTION public.pilot_tenant_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Config slots / olas / estadía por turno
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenant_reservation_config (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  turno text NOT NULL CHECK (turno IN ('mediodia', 'noche')),
  stay_minutes integer NOT NULL DEFAULT 120 CHECK (stay_minutes > 0 AND stay_minutes <= 480),
  wave_count smallint NOT NULL DEFAULT 1 CHECK (wave_count IN (1, 2)),
  slots_wave_1 jsonb NOT NULL DEFAULT '[]'::jsonb,
  slots_wave_2 jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, turno)
);

-- ---------------------------------------------------------------------------
-- Mesas (PK uuid; UI muestra table_number)
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  table_number integer NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0 AND capacity <= 20),
  zone text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, table_number)
);

CREATE INDEX idx_restaurant_tables_tenant ON public.restaurant_tables (tenant_id);

-- ---------------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------------
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_date date NOT NULL,
  turno text NOT NULL CHECK (turno IN ('mediodia', 'noche')),
  horario text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  party_size integer NOT NULL CHECK (party_size > 0 AND party_size <= 20),
  reservation_code text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'completed', 'no_show')),
  table_id uuid REFERENCES public.restaurant_tables (id),
  mesa_asignada_label text,
  mesa_real integer,
  cliente jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text DEFAULT 'web',
  estado_check_in text CHECK (estado_check_in IS NULL OR estado_check_in IN ('pendiente', 'confirmado')),
  check_in_at timestamptz,
  cancelled_at timestamptz,
  pos_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reservation_code),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_reservations_tenant_business_date ON public.reservations (tenant_id, business_date);
CREATE INDEX idx_reservations_tenant_starts ON public.reservations (tenant_id, starts_at);
CREATE INDEX idx_reservations_table_time ON public.reservations (tenant_id, table_id, starts_at)
  WHERE table_id IS NOT NULL AND status = 'active';

-- ---------------------------------------------------------------------------
-- Lista de espera
-- ---------------------------------------------------------------------------
CREATE TABLE public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_date date NOT NULL,
  turno text NOT NULL CHECK (turno IN ('mediodia', 'noche')),
  party_size integer NOT NULL CHECK (party_size > 0 AND party_size <= 20),
  horario text,
  waiting_code text,
  cliente jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'contacted', 'rejected', 'converted')),
  notified boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  contacted boolean NOT NULL DEFAULT false,
  contacted_at timestamptz,
  awaiting_confirmation boolean NOT NULL DEFAULT false,
  confirmation_deadline timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_waitlist_tenant_date ON public.waitlist (tenant_id, business_date);

-- ---------------------------------------------------------------------------
-- Bloqueos admin por día y turno (números de mesa visibles)
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_day_table_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_date date NOT NULL,
  turno text NOT NULL CHECK (turno IN ('mediodia', 'noche')),
  blocked_table_numbers integer[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, business_date, turno)
);

-- ---------------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_reservations_updated
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

CREATE TRIGGER tr_waitlist_updated
  BEFORE UPDATE ON public.waitlist
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

CREATE TRIGGER tr_venue_blocks_updated
  BEFORE UPDATE ON public.venue_day_table_blocks
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

CREATE TRIGGER tr_tenant_res_cfg_updated
  BEFORE UPDATE ON public.tenant_reservation_config
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPC: búsqueda pública por código (sin listar todas las reservas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_reservation_by_code(p_code text)
RETURNS SETOF public.reservations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.*
  FROM public.reservations r
  WHERE r.tenant_id = pilot_tenant_id()
    AND upper(trim(r.reservation_code)) = upper(trim(p_code))
    AND r.status = 'active'
    AND r.business_date >= (
      (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.search_reservation_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_reservation_by_code(text) TO anon, authenticated;

-- Cupos / solapes: expone agregados sin datos de contacto (anon + cliente web)
CREATE OR REPLACE FUNCTION public.list_reservations_for_date_turn(p_date date, p_turno text)
RETURNS TABLE (
  id uuid,
  business_date date,
  turno text,
  horario text,
  party_size integer,
  starts_at timestamptz,
  ends_at timestamptz,
  mesa_asignada_label text,
  table_id uuid,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.business_date, r.turno, r.horario, r.party_size, r.starts_at, r.ends_at,
         r.mesa_asignada_label, r.table_id, r.status
  FROM public.reservations r
  WHERE r.tenant_id = pilot_tenant_id()
    AND r.business_date = p_date
    AND r.turno = p_turno
    AND r.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.list_reservations_for_date_turn(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_reservations_for_date_turn(date, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed tenant + config + mesas (números alineados a tablesLayout.js)
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, slug, name)
VALUES (pilot_tenant_id(), 'default', 'Rosaura');

INSERT INTO public.tenant_reservation_config (tenant_id, turno, stay_minutes, wave_count, slots_wave_1, slots_wave_2)
VALUES
  (pilot_tenant_id(), 'mediodia', 120, 1,
   '["12:00","12:30","13:00","13:30","14:00","14:30","15:00"]'::jsonb, NULL),
  (pilot_tenant_id(), 'noche', 120, 1,
   '["19:00","19:30","20:00","20:30","21:00","21:30","22:00","22:30"]'::jsonb, NULL);

INSERT INTO public.restaurant_tables (tenant_id, table_number, capacity, zone)
SELECT pilot_tenant_id(), x.table_number, x.capacity, x.zone
FROM (VALUES
  (12, 4, NULL::text), (13, 4, NULL), (21, 2, NULL), (11, 2, NULL), (24, 2, NULL), (14, 2, NULL),
  (10, 4, NULL), (9, 4, NULL), (8, 2, NULL), (6, 4, NULL), (7, 6, NULL),
  (5, 4, NULL), (4, 4, NULL), (3, 4, NULL), (2, 2, NULL), (1, 2, NULL), (31, 2, NULL)
) AS x(table_number, capacity, zone);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_reservation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_day_table_blocks ENABLE ROW LEVEL SECURITY;

-- Tenants: lectura piloto
CREATE POLICY tenants_read_pilot ON public.tenants
  FOR SELECT TO anon, authenticated
  USING (id = pilot_tenant_id());

-- Config slots: lectura pública del tenant piloto
CREATE POLICY tenant_res_cfg_read ON public.tenant_reservation_config
  FOR SELECT TO anon, authenticated
  USING (tenant_id = pilot_tenant_id());

CREATE POLICY tenant_res_cfg_write_staff ON public.tenant_reservation_config
  FOR ALL TO authenticated
  USING (tenant_id = pilot_tenant_id())
  WITH CHECK (tenant_id = pilot_tenant_id());

-- Mesas: lectura pública piloto
CREATE POLICY restaurant_tables_read ON public.restaurant_tables
  FOR SELECT TO anon, authenticated
  USING (tenant_id = pilot_tenant_id());

CREATE POLICY restaurant_tables_write_staff ON public.restaurant_tables
  FOR ALL TO authenticated
  USING (tenant_id = pilot_tenant_id())
  WITH CHECK (tenant_id = pilot_tenant_id());

-- Reservas: anon solo inserta activas en piloto
CREATE POLICY reservations_insert_anon ON public.reservations
  FOR INSERT TO anon
  WITH CHECK (
    tenant_id = pilot_tenant_id()
    AND status = 'active'
  );

-- Staff: todo sobre piloto
CREATE POLICY reservations_staff_all ON public.reservations
  FOR ALL TO authenticated
  USING (tenant_id = pilot_tenant_id())
  WITH CHECK (tenant_id = pilot_tenant_id());

-- Waitlist
CREATE POLICY waitlist_insert_anon ON public.waitlist
  FOR INSERT TO anon
  WITH CHECK (tenant_id = pilot_tenant_id());

CREATE POLICY waitlist_staff_all ON public.waitlist
  FOR ALL TO authenticated
  USING (tenant_id = pilot_tenant_id())
  WITH CHECK (tenant_id = pilot_tenant_id());

-- Bloqueos: lectura anon (disponibilidad); escritura solo staff
CREATE POLICY venue_blocks_read ON public.venue_day_table_blocks
  FOR SELECT TO anon, authenticated
  USING (tenant_id = pilot_tenant_id());

CREATE POLICY venue_blocks_write_staff ON public.venue_day_table_blocks
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = pilot_tenant_id());

CREATE POLICY venue_blocks_update_staff ON public.venue_day_table_blocks
  FOR UPDATE TO authenticated
  USING (tenant_id = pilot_tenant_id())
  WITH CHECK (tenant_id = pilot_tenant_id());

CREATE POLICY venue_blocks_delete_staff ON public.venue_day_table_blocks
  FOR DELETE TO authenticated
  USING (tenant_id = pilot_tenant_id());

-- ---------------------------------------------------------------------------
-- Realtime (Supabase): agregar tablas a la publicación si existe
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_day_table_blocks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
