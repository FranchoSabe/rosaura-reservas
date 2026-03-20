-- =============================================================================
-- RPC autogestión cliente (anon): búsqueda por teléfono normalizado + cancelación
-- con verificación de teléfono. Rate-limit: deuda documentada en app (Edge/captcha).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_reservations_by_phone(p_phone_digits text)
RETURNS SETOF public.reservations
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
  SELECT r.*
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
  'Anon: lista hasta 5 reservas futuras del tenant cuyo teléfono coincide en últimos 8 dígitos.';

-- Cancelación: código + verificación últimos 8 dígitos de teléfono; antelación mínima 2 h antes de starts_at.
CREATE OR REPLACE FUNCTION public.cancel_public_reservation(
  p_code text,
  p_phone_digits text
) RETURNS public.reservations
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

  UPDATE public.reservations
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  WHERE id = v_rec.id
    AND tenant_id = v_tenant
  RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_public_reservation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_public_reservation(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.cancel_public_reservation(text, text) IS
  'Anon: cancela reserva activa si el teléfono coincide (8 dígitos) y faltan >2h para starts_at.';
