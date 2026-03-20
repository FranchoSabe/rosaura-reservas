-- =============================================================================
-- Endurecer superficie anon: RPC sin filas completas de reservations (menos PII).
-- - search_reservations_by_phone: solo columnas operativas (sin cliente JSON).
-- - cancel_public_reservation: confirmación mínima post-cancelación.
-- search_reservation_by_code / create_public_reservation: sin cambio (titular con código
-- o creación propia; documentado en PLAN §12).
-- =============================================================================

DROP FUNCTION IF EXISTS public.search_reservations_by_phone(text);

CREATE OR REPLACE FUNCTION public.search_reservations_by_phone(p_phone_digits text)
RETURNS TABLE (
  id uuid,
  reservation_code text,
  business_date date,
  turno text,
  horario text,
  party_size integer,
  starts_at timestamptz,
  ends_at timestamptz,
  mesa_asignada_label text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := pilot_tenant_id();
  v_tz text;
  v_today date;
  v_digits text;
BEGIN
  v_digits := regexp_replace(coalesce(p_phone_digits, ''), '\D', '', 'g');
  IF length(v_digits) < 8 THEN
    RAISE EXCEPTION 'invalid_phone_length';
  END IF;

  SELECT timezone INTO v_tz FROM public.tenants WHERE id = v_tenant;
  IF v_tz IS NULL THEN
    v_tz := 'America/Argentina/Buenos_Aires';
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  RETURN QUERY
  SELECT
    r.id,
    r.reservation_code,
    r.business_date,
    r.turno,
    r.horario,
    r.party_size,
    r.starts_at,
    r.ends_at,
    r.mesa_asignada_label,
    r.status
  FROM public.reservations r
  WHERE r.tenant_id = v_tenant
    AND r.status = 'active'
    AND r.business_date >= v_today
    AND length(regexp_replace(coalesce(r.cliente->>'telefono', ''), '\D', '', 'g')) >= 8
    AND right(regexp_replace(coalesce(r.cliente->>'telefono', ''), '\D', '', 'g'), 8) = right(v_digits, 8)
  ORDER BY r.business_date ASC, r.starts_at ASC
  LIMIT 5;
END;
$$;

REVOKE ALL ON FUNCTION public.search_reservations_by_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_reservations_by_phone(text) TO anon, authenticated;

COMMENT ON FUNCTION public.search_reservations_by_phone(text) IS
  'Anon: hasta 5 reservas futuras (últimos 8 dígitos teléfono). Sin JSON cliente ni email.';

-- ---------------------------------------------------------------------------

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
BEGIN
  v_digits := regexp_replace(coalesce(p_phone_digits, ''), '\D', '', 'g');
  IF length(v_digits) < 8 THEN
    RAISE EXCEPTION 'invalid_phone_length';
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

  IF v_rec.starts_at <= (now() + interval '2 hours') THEN
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
  'Anon: cancela si teléfono coincide (8 dígitos) y faltan >2h para starts_at. Respuesta sin cliente.';
