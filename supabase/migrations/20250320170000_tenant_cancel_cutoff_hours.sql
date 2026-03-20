-- =============================================================================
-- Política cancelación online: antelación mínima configurable por tenant (horas).
-- Usada por cancel_public_reservation (SECURITY DEFINER); anon puede leer la
-- columna vía RLS existente en tenants (solo fila piloto).
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS client_cancel_min_hours_before_start smallint
  NOT NULL DEFAULT 2
  CHECK (client_cancel_min_hours_before_start >= 0 AND client_cancel_min_hours_before_start <= 168);

COMMENT ON COLUMN public.tenants.client_cancel_min_hours_before_start IS
  'Horas mínimas antes de starts_at para permitir cancelación vía cancel_public_reservation (0 = hasta el último momento permitido por la ventana).';

-- Recrear cancel: lee horas desde tenants (piloto).
DROP FUNCTION IF EXISTS public.cancel_public_reservation(text, text);

CREATE OR REPLACE FUNCTION public.cancel_public_reservation(
  p_code text,
  p_phone_digits text
) RETURNS TABLE (
  reservation_code text,
  status text,
  cancelled_at timestamptz,
  business_date date,
  horario text,
  party_size integer,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := pilot_tenant_id();
  v_rec public.reservations%ROWTYPE;
  v_digits text;
  v_phone_stored text;
  v_min_hours smallint;
BEGIN
  v_digits := regexp_replace(coalesce(p_phone_digits, ''), '\D', '', 'g');
  IF length(v_digits) < 8 THEN
    RAISE EXCEPTION 'invalid_phone_length';
  END IF;

  SELECT COALESCE(t.client_cancel_min_hours_before_start, 2)
  INTO v_min_hours
  FROM public.tenants t
  WHERE t.id = v_tenant;

  IF v_min_hours IS NULL THEN
    v_min_hours := 2;
  END IF;

  SELECT * INTO v_rec
  FROM public.reservations r
  WHERE r.tenant_id = v_tenant
    AND upper(trim(r.reservation_code)) = upper(trim(p_code))
    AND r.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;

  v_phone_stored := regexp_replace(coalesce(v_rec.cliente->>'telefono', ''), '\D', '', 'g');
  IF length(v_phone_stored) < 8 OR right(v_phone_stored, 8) != right(v_digits, 8) THEN
    RAISE EXCEPTION 'phone_mismatch';
  END IF;

  IF v_rec.starts_at <= (now() + (v_min_hours * interval '1 hour')) THEN
    RAISE EXCEPTION 'cancel_too_late';
  END IF;

  RETURN QUERY
  UPDATE public.reservations u
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  WHERE u.id = v_rec.id
    AND u.tenant_id = v_tenant
  RETURNING
    u.reservation_code,
    u.status,
    u.cancelled_at,
    u.business_date,
    u.horario,
    u.party_size,
    u.starts_at,
    u.ends_at;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_public_reservation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_public_reservation(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.cancel_public_reservation(text, text) IS
  'Anon: cancela si teléfono coincide (8 dígitos) y falta más tiempo que tenants.client_cancel_min_hours_before_start antes de starts_at. Respuesta sin cliente.';
