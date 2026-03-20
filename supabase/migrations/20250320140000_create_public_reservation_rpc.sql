-- =============================================================================
-- RPC create_public_reservation: creación web (anon) con validación server-side.
-- Revoca INSERT directo en reservations para rol anon (solo SECURITY DEFINER).
-- =============================================================================

-- ¿La reserva usa esta mesa física (número visible) para solapes?
CREATE OR REPLACE FUNCTION public.reservation_covers_table_number(r public.reservations, p_num int)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  tid int;
  parts text[];
  p text;
BEGIN
  IF r.status IN ('cancelled', 'completed') THEN
    RETURN false;
  END IF;

  IF r.estado_check_in = 'confirmado' AND r.mesa_real IS NOT NULL THEN
    RETURN r.mesa_real = p_num;
  END IF;

  IF r.table_id IS NOT NULL THEN
    SELECT t.table_number INTO tid
    FROM public.restaurant_tables t
    WHERE t.id = r.table_id
    LIMIT 1;
    IF tid IS NOT NULL AND tid = p_num THEN
      RETURN true;
    END IF;
  END IF;

  IF r.mesa_asignada_label IS NULL OR length(trim(r.mesa_asignada_label)) = 0 THEN
    RETURN false;
  END IF;

  IF position('+' IN r.mesa_asignada_label) > 0 THEN
    parts := regexp_split_to_array(replace(trim(r.mesa_asignada_label), ' ', ''), '\+');
    FOREACH p IN ARRAY parts LOOP
      IF trim(p) ~ '^[0-9]+$' AND trim(p)::int = p_num THEN
        RETURN true;
      END IF;
    END LOOP;
    RETURN false;
  END IF;

  IF trim(r.mesa_asignada_label) ~ '^[0-9]+$' THEN
    RETURN trim(r.mesa_asignada_label)::int = p_num;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_covers_table_number(public.reservations, int) FROM PUBLIC;

-- Normaliza "12:00" / "12:00:00" -> HH24:MI
CREATE OR REPLACE FUNCTION public.normalize_horario_slot(p_horario text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT to_char(
    to_timestamp(trim(p_horario), 'HH24:MI'),
    'HH24:MI'
  );
$$;

REVOKE ALL ON FUNCTION public.normalize_horario_slot(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_public_reservation(
  p_business_date date,
  p_turno text,
  p_horario text,
  p_party_size int,
  p_cliente jsonb
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := pilot_tenant_id();
  v_tz text;
  v_cfg record;
  v_stay int;
  v_slot text;
  v_slot_ok boolean := false;
  v_h_norm text;
  v_st timestamptz;
  v_en timestamptz;
  v_code text;
  v_cliente jsonb;
  v_blocked int[];
  v_walkin int[] := ARRAY[14, 24, 4, 5];
  v_today date;
  v_max date;
  t_rec public.restaurant_tables%ROWTYPE;
  v_cap int;
  v_overlap boolean;
  attempt int;
  i int;
  r_new public.reservations;
BEGIN
  IF p_turno IS NULL OR p_turno NOT IN ('mediodia', 'noche') THEN
    RAISE EXCEPTION 'invalid_turno';
  END IF;

  IF p_party_size IS NULL OR p_party_size < 1 OR p_party_size > 20 THEN
    RAISE EXCEPTION 'invalid_party_size';
  END IF;

  SELECT timezone INTO v_tz FROM public.tenants WHERE id = v_tenant;
  IF v_tz IS NULL THEN
    v_tz := 'America/Argentina/Buenos_Aires';
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;
  v_max := v_today + 31;

  IF p_business_date < v_today OR p_business_date > v_max THEN
    RAISE EXCEPTION 'invalid_business_date';
  END IF;

  SELECT * INTO v_cfg
  FROM public.tenant_reservation_config
  WHERE tenant_id = v_tenant AND turno = p_turno;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_tenant_config';
  END IF;

  v_stay := v_cfg.stay_minutes;
  v_h_norm := public.normalize_horario_slot(p_horario);

  FOR v_slot IN
    SELECT trim(x) FROM jsonb_array_elements_text(v_cfg.slots_wave_1) AS t(x)
    UNION ALL
    SELECT trim(x) FROM jsonb_array_elements_text(coalesce(v_cfg.slots_wave_2, '[]'::jsonb)) AS t(x)
    WHERE v_cfg.wave_count = 2
  LOOP
    IF public.normalize_horario_slot(v_slot) = v_h_norm THEN
      v_slot_ok := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT v_slot_ok THEN
    RAISE EXCEPTION 'invalid_horario';
  END IF;

  v_cliente := jsonb_build_object(
    'nombre', left(btrim(coalesce(p_cliente->>'nombre', '')), 200),
    'telefono', left(btrim(coalesce(p_cliente->>'telefono', '')), 80),
    'comentarios', left(coalesce(p_cliente->>'comentarios', ''), 2000),
    'email', left(coalesce(p_cliente->>'email', ''), 120)
  );

  IF length(v_cliente->>'nombre') < 2 THEN
    RAISE EXCEPTION 'invalid_cliente_nombre';
  END IF;

  IF length(v_cliente->>'telefono') < 6 THEN
    RAISE EXCEPTION 'invalid_cliente_telefono';
  END IF;

  v_st := (
    (p_business_date::text || ' ' || v_h_norm || ':00')::timestamp
    AT TIME ZONE v_tz
  );
  v_en := v_st + make_interval(mins => v_stay);

  SELECT blocked_table_numbers INTO v_blocked
  FROM public.venue_day_table_blocks
  WHERE tenant_id = v_tenant
    AND business_date = p_business_date
    AND turno = p_turno;

  IF v_blocked IS NULL OR coalesce(array_length(v_blocked, 1), 0) = 0 THEN
    v_blocked := v_walkin;
  END IF;

  v_cap := CASE WHEN p_party_size = 5 THEN 6 ELSE p_party_size END;

  <<v_table_loop>>
  FOR t_rec IN
    SELECT *
    FROM public.restaurant_tables
    WHERE tenant_id = v_tenant AND active = true
    ORDER BY table_number ASC
  LOOP
    IF t_rec.capacity < v_cap THEN
      CONTINUE;
    END IF;
    IF t_rec.table_number = ANY (v_blocked) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.tenant_id = v_tenant
        AND r.status = 'active'
        AND tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_st, v_en, '[)')
        AND public.reservation_covers_table_number(r, t_rec.table_number)
    ) INTO v_overlap;

    IF NOT v_overlap THEN
      FOR attempt IN 1..8 LOOP
        v_code := '';
        FOR i IN 1..6 LOOP
          v_code := v_code || substr(
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            1 + floor(random() * 36)::int,
            1
          );
        END LOOP;

        BEGIN
          INSERT INTO public.reservations (
            tenant_id,
            business_date,
            turno,
            horario,
            starts_at,
            ends_at,
            party_size,
            reservation_code,
            status,
            table_id,
            mesa_asignada_label,
            cliente,
            source,
            estado_check_in
          ) VALUES (
            v_tenant,
            p_business_date,
            p_turno,
            v_h_norm,
            v_st,
            v_en,
            p_party_size,
            v_code,
            'active',
            t_rec.id,
            t_rec.table_number::text,
            v_cliente,
            'web',
            NULL
          )
          RETURNING * INTO r_new;

          RETURN r_new;
        EXCEPTION
          WHEN unique_violation THEN
            NULL;
        END;
      END LOOP;

      CONTINUE v_table_loop;
    END IF;
  END LOOP;

  -- Sin mesa simple libre: crear sin asignación (staff asigna en admin)
  FOR attempt IN 1..8 LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        1 + floor(random() * 36)::int,
        1
      );
    END LOOP;

    BEGIN
      INSERT INTO public.reservations (
        tenant_id,
        business_date,
        turno,
        horario,
        starts_at,
        ends_at,
        party_size,
        reservation_code,
        status,
        table_id,
        mesa_asignada_label,
        cliente,
        source,
        estado_check_in
      ) VALUES (
        v_tenant,
        p_business_date,
        p_turno,
        v_h_norm,
        v_st,
        v_en,
        p_party_size,
        v_code,
        'active',
        NULL,
        NULL,
        v_cliente,
        'web',
        NULL
      )
      RETURNING * INTO r_new;

      RETURN r_new;
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'code_generation_failed';
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_reservation(date, text, text, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_reservation(date, text, text, int, jsonb) TO anon;

DROP POLICY IF EXISTS reservations_insert_anon ON public.reservations;
