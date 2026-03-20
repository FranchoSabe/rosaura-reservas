import { getSupabaseClient } from '../../lib/supabaseClient';
import { DEFAULT_TENANT_ID, RESTAURANT_TIMEZONE } from '../../lib/defaultTenantId';
import { CLIENT_CANCEL_MIN_HOURS_BEFORE_START } from '../constants/clientReservation';
import {
  computeReservationWindow,
  slotsFromConfigRow,
  getStayMinutesForTurn,
  intervalsOverlap,
  parseMesaLabelToNumbers
} from './reservationTimeWindows';

function generatePublicCode(prefix = '') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = prefix;
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result.toUpperCase();
}

/** RPC search_reservations_by_phone: sin JSON cliente (privacidad). */
function phoneSearchRowToLegacy(row) {
  if (!row) return null;
  const stay = row.ends_at && row.starts_at
    ? Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000)
    : 120;
  const startsMs = row.starts_at ? new Date(row.starts_at).getTime() : 0;
  const endsMs = row.ends_at ? new Date(row.ends_at).getTime() : 0;
  return {
    id: row.id,
    fecha: row.business_date,
    business_date: row.business_date,
    turno: row.turno,
    horario: row.horario,
    personas: row.party_size,
    party_size: row.party_size,
    reservationId: row.reservation_code,
    reservation_code: row.reservation_code,
    status: row.status,
    mesaAsignada: row.mesa_asignada_label,
    mesa_asignada_label: row.mesa_asignada_label,
    cliente: {},
    estadoCheckIn: null,
    estado_check_in: null,
    horaLlegada: null,
    check_in_at: null,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    _startsMs: startsMs,
    _endsMs: endsMs,
    _stayMinutes: stay,
    _publicPhoneSummary: true
  };
}

/** RPC cancel_public_reservation: fila mínima post-cancelación. */
function cancelPublicRowToLegacy(row) {
  if (!row) return null;
  const startsMs = row.starts_at ? new Date(row.starts_at).getTime() : 0;
  const endsMs = row.ends_at ? new Date(row.ends_at).getTime() : 0;
  return {
    fecha: row.business_date,
    business_date: row.business_date,
    horario: row.horario,
    personas: row.party_size,
    party_size: row.party_size,
    reservationId: row.reservation_code,
    reservation_code: row.reservation_code,
    status: row.status,
    cliente: {},
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    _startsMs: startsMs,
    _endsMs: endsMs,
    _publicCancelSummary: true
  };
}

function rowToLegacyReservation(row) {
  if (!row) return null;
  const stay = row.ends_at && row.starts_at
    ? Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000)
    : 120;
  const startsMs = row.starts_at ? new Date(row.starts_at).getTime() : 0;
  const endsMs = row.ends_at ? new Date(row.ends_at).getTime() : 0;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    fecha: row.business_date,
    business_date: row.business_date,
    turno: row.turno,
    horario: row.horario,
    personas: row.party_size,
    party_size: row.party_size,
    reservationId: row.reservation_code,
    reservation_code: row.reservation_code,
    status: row.status,
    mesaAsignada: row.mesa_asignada_label,
    mesa_asignada_label: row.mesa_asignada_label,
    table_id: row.table_id,
    mesaReal: row.mesa_real,
    mesa_real: row.mesa_real,
    cliente: row.cliente || {},
    estadoCheckIn: row.estado_check_in || null,
    estado_check_in: row.estado_check_in,
    horaLlegada: row.check_in_at ? new Date(row.check_in_at) : null,
    check_in_at: row.check_in_at,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    _startsMs: startsMs,
    _endsMs: endsMs,
    _stayMinutes: stay
  };
}

function scheduleRowToLegacy(row) {
  if (!row) return null;
  const startsMs = row.starts_at ? new Date(row.starts_at).getTime() : 0;
  const endsMs = row.ends_at ? new Date(row.ends_at).getTime() : 0;
  return {
    id: row.id,
    fecha: row.business_date,
    turno: row.turno,
    horario: row.horario,
    personas: row.party_size,
    status: row.status,
    mesaAsignada: row.mesa_asignada_label,
    mesaReal: null,
    estadoCheckIn: null,
    cliente: {},
    _startsMs: startsMs,
    _endsMs: endsMs
  };
}

function waitlistRowToLegacy(row) {
  if (!row) return null;
  return {
    id: row.id,
    waitingId: row.waiting_code,
    waiting_code: row.waiting_code,
    fecha: row.business_date,
    turno: row.turno,
    horario: row.horario,
    personas: row.party_size,
    cliente: row.cliente || {},
    status: row.status,
    notified: row.notified,
    notifiedAt: row.notified_at,
    contacted: row.contacted,
    contactedAt: row.contacted_at,
    awaitingConfirmation: row.awaiting_confirmation,
    confirmationDeadline: row.confirmation_deadline,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at
  };
}

async function setSessionFromRefreshToken(supabase, refreshToken) {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return { error: new Error('missing_supabase_env') };
  const res = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    return {
      error: new Error(json.error_description || json.msg || json.message || 'refresh_token_failed')
    };
  }
  return supabase.auth.setSession({
    access_token: json.access_token,
    refresh_token: json.refresh_token || refreshToken
  });
}

export async function ensureSupabaseStaffSession() {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: 'no_client' };
  const email = import.meta.env.VITE_SUPABASE_STAFF_EMAIL;
  const password = import.meta.env.VITE_SUPABASE_STAFF_PASSWORD;
  const refreshToken = import.meta.env.VITE_SUPABASE_STAFF_REFRESH_TOKEN?.trim();

  const { data: sessionData } = await supabase.auth.getSession();
  if (email && sessionData?.session?.user?.email === email) {
    return { ok: true };
  }

  if (refreshToken) {
    const { error } = await setSessionFromRefreshToken(supabase, refreshToken);
    if (!error) return { ok: true };
    if (import.meta.env.DEV) {
      console.warn('[Supabase] refresh token staff:', error.message);
    }
  }

  if (!email || !password) {
    return { ok: false, error: 'missing_staff_env' };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signOutSupabaseAuth() {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Lectura pública (anon): horas de antelación para cancelación online (columna tenants).
 */
export async function fetchPilotTenantClientSettings() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { clientCancelMinHoursBeforeStart: CLIENT_CANCEL_MIN_HOURS_BEFORE_START };
  }
  const { data, error } = await supabase
    .from('tenants')
    .select('client_cancel_min_hours_before_start')
    .eq('id', DEFAULT_TENANT_ID)
    .maybeSingle();
  if (error || !data) {
    return { clientCancelMinHoursBeforeStart: CLIENT_CANCEL_MIN_HOURS_BEFORE_START };
  }
  const h = data.client_cancel_min_hours_before_start;
  const n = typeof h === 'number' ? h : Number(h);
  return {
    clientCancelMinHoursBeforeStart: Number.isFinite(n) ? n : CLIENT_CANCEL_MIN_HOURS_BEFORE_START
  };
}

export async function fetchTenantReservationConfigMap() {
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('tenant_reservation_config')
    .select('*')
    .eq('tenant_id', DEFAULT_TENANT_ID);
  if (error) throw error;
  const map = {};
  (data || []).forEach((row) => {
    map[row.turno] = row;
  });
  return map;
}

export async function fetchTableNumberToIdMap() {
  const supabase = getSupabaseClient();
  if (!supabase) return new Map();
  const { data, error } = await supabase
    .from('restaurant_tables')
    .select('id, table_number')
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .eq('active', true);
  if (error) throw error;
  const m = new Map();
  (data || []).forEach((r) => m.set(r.table_number, r.id));
  return m;
}

/**
 * Reservas completas del día (staff / sesión con permiso SELECT en reservations).
 */
export async function fetchReservationsForBusinessDate(businessDate) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .eq('business_date', businessDate)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToLegacyReservation);
}

/**
 * Sin datos de contacto (anon o RPC).
 */
export async function fetchReservationScheduleForDateTurn(businessDate, turno) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_reservations_for_date_turn', {
    p_date: businessDate,
    p_turno: turno
  });
  if (error) throw error;
  return (data || []).map(scheduleRowToLegacy);
}

export function subscribeToReservationsForBusinessDate(businessDate, callback) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return () => {};
  }

  const load = () => {
    fetchReservationsForBusinessDate(businessDate)
      .then(callback)
      .catch((e) => {
        console.error(e);
        callback([]);
      });
  };

  load();

  const channel = supabase
    .channel(`reservations:${businessDate}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reservations',
        filter: `business_date=eq.${businessDate}`
      },
      () => {
        load();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToWaitlistForBusinessDate(businessDate, callback) {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const load = () => {
    supabase
      .from('waitlist')
      .select('*')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('business_date', businessDate)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          callback([]);
          return;
        }
        callback((data || []).map(waitlistRowToLegacy));
      });
  };

  load();

  const channel = supabase
    .channel(`waitlist:${businessDate}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'waitlist',
        filter: `business_date=eq.${businessDate}`
      },
      () => load()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function insertReservationRecord({
  businessDate,
  turno,
  horario,
  partySize,
  cliente,
  mesaAsignadaLabel,
  tableId,
  configByTurno
}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');

  const {
    data: { session }
  } = await supabase.auth.getSession();

  /** Staff (authenticated): INSERT directo con asignación calculada en cliente. */
  if (session?.user) {
    const stay = getStayMinutesForTurn(configByTurno, turno);
    const { startsAt, endsAt } = computeReservationWindow(
      businessDate,
      horario,
      stay,
      RESTAURANT_TIMEZONE
    );

    let reservation_code = generatePublicCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = {
        tenant_id: DEFAULT_TENANT_ID,
        business_date: businessDate,
        turno,
        horario,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        party_size: partySize,
        reservation_code,
        status: 'active',
        table_id: tableId || null,
        mesa_asignada_label: mesaAsignadaLabel != null ? String(mesaAsignadaLabel) : null,
        cliente: cliente || {},
        source: 'web',
        estado_check_in: null
      };

      const { data, error } = await supabase.from('reservations').insert(row).select('*').single();
      if (!error) return rowToLegacyReservation(data);
      if (error.code === '23505') {
        reservation_code = generatePublicCode();
        continue;
      }
      throw error;
    }
    throw new Error('No se pudo generar código de reserva único');
  }

  /** Cliente público (anon): solo RPC con validación server-side (sin INSERT directo). */
  const { data: rpcData, error: rpcError } = await supabase.rpc('create_public_reservation', {
    p_business_date: businessDate,
    p_turno: turno,
    p_horario: horario,
    p_party_size: partySize,
    p_cliente: cliente || {}
  });
  if (rpcError) {
    const msg = rpcError.message || '';
    if (msg.includes('invalid_horario')) {
      throw new Error('El horario seleccionado no es válido para reservar online.');
    }
    if (msg.includes('invalid_business_date')) {
      throw new Error('La fecha no está disponible para reservar online.');
    }
    if (msg.includes('invalid_cliente')) {
      throw new Error('Revisá nombre y teléfono e intentá de nuevo.');
    }
    if (msg.includes('invalid_turno') || msg.includes('invalid_party_size')) {
      throw new Error('Los datos de la reserva no son válidos. Volvé a intentar.');
    }
    throw rpcError;
  }
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  return rowToLegacyReservation(row);
}

/**
 * Actualiza ventana temporal si cambia horario/fecha/turno (objeto completo legacy).
 */
export async function updateReservationFromLegacy(id, legacy) {
  const config = await fetchTenantReservationConfigMap();
  const businessDate =
    typeof legacy.fecha === 'string' ? legacy.fecha : legacy.business_date;
  const stay = getStayMinutesForTurn(config, legacy.turno);
  const { startsAt, endsAt } = computeReservationWindow(
    businessDate,
    legacy.horario,
    stay,
    RESTAURANT_TIMEZONE
  );

  let tableId = legacy.table_id ?? null;
  if (legacy.mesaAsignada != null && legacy.mesaAsignada !== 'Sin asignar') {
    const label = String(legacy.mesaAsignada);
    if (!label.includes('+')) {
      const map = await fetchTableNumberToIdMap();
      const num = parseInt(label, 10);
      if (!Number.isNaN(num)) tableId = map.get(num) || null;
    } else {
      tableId = null;
    }
  }

  const row = {
    business_date: businessDate,
    turno: legacy.turno,
    horario: legacy.horario,
    party_size: legacy.personas,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    cliente: legacy.cliente || {},
    mesa_asignada_label:
      legacy.mesaAsignada == null || legacy.mesaAsignada === 'Sin asignar'
        ? null
        : String(legacy.mesaAsignada),
    mesa_real:
      legacy.mesaReal == null || legacy.mesaReal === ''
        ? null
        : parseInt(legacy.mesaReal, 10),
    estado_check_in: legacy.estadoCheckIn ?? null,
    check_in_at: legacy.horaLlegada
      ? legacy.horaLlegada instanceof Date
        ? legacy.horaLlegada.toISOString()
        : legacy.horaLlegada
      : null,
    table_id: tableId,
    status: legacy.status || 'active'
  };

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('reservations')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .select('*')
    .single();
  if (error) throw error;
  return rowToLegacyReservation(data);
}

export async function fetchReservationById(id) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .maybeSingle();
  if (error) throw error;
  return rowToLegacyReservation(data);
}

/**
 * Check-in: mesa real + estado. Comprueba solape temporal con otras reservas activas en la misma mesa.
 */
export async function performReservationCheckIn(reservationId, mesaRealNumber) {
  const current = await fetchReservationById(reservationId);
  if (!current) throw new Error('Reserva no encontrada');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');

  const { data: dayRows, error: dayErr } = await supabase
    .from('reservations')
    .select('*')
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .eq('business_date', current.fecha)
    .eq('turno', current.turno)
    .neq('status', 'cancelled');

  if (dayErr) throw dayErr;

  const others = (dayRows || [])
    .filter((r) => r.id !== reservationId)
    .map(rowToLegacyReservation);

  const tableNum = Number(mesaRealNumber);
  for (const o of others) {
    const usesTable = (() => {
      if (o.estadoCheckIn === 'confirmado' && o.mesaReal != null) {
        return parseMesaLabelToNumbers(String(o.mesaReal)).includes(tableNum);
      }
      if (o.mesaAsignada && o.mesaAsignada !== 'Sin asignar') {
        return parseMesaLabelToNumbers(String(o.mesaAsignada)).includes(tableNum);
      }
      return false;
    })();
    if (!usesTable) continue;
    if (intervalsOverlap(current._startsMs, current._endsMs, o._startsMs, o._endsMs)) {
      throw new Error(
        `La mesa ${mesaRealNumber} ya está asignada en ese horario a otra reserva.`
      );
    }
  }

  const map = await fetchTableNumberToIdMap();
  const tableId = map.get(Number(mesaRealNumber)) || null;

  const mesaAsignadaLabel = current.mesaAsignada;
  const clearAssigned =
    mesaAsignadaLabel &&
    String(mesaAsignadaLabel) !== String(mesaRealNumber) &&
    !String(mesaAsignadaLabel).includes('+');

  const { data, error } = await supabase
    .from('reservations')
    .update({
      mesa_real: Number(mesaRealNumber),
      table_id: tableId,
      estado_check_in: 'confirmado',
      check_in_at: new Date().toISOString(),
      ...(clearAssigned ? { mesa_asignada_label: null } : {})
    })
    .eq('id', reservationId)
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .select('*')
    .single();

  if (error) throw error;
  return rowToLegacyReservation(data);
}

export async function cancelReservationById(id) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', DEFAULT_TENANT_ID);
  if (error) throw error;
}

export async function searchReservationByCodePublic(reservationId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('search_reservation_by_code', {
    p_code: (reservationId || '').trim()
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return rowToLegacyReservation(row);
}

/**
 * Anon: hasta 5 reservas futuras cuyo teléfono coincide en los últimos 8 dígitos.
 */
export async function searchReservationsByPhonePublic(phoneDigits) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('search_reservations_by_phone', {
    p_phone_digits: phoneDigits || ''
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map(phoneSearchRowToLegacy);
}

/**
 * Anon: cancelación con código + verificación de teléfono (RLS no permite UPDATE directo).
 */
export async function cancelPublicReservationByCodeAndPhone(code, phoneDigits) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const { data, error } = await supabase.rpc('cancel_public_reservation', {
    p_code: (code || '').trim(),
    p_phone_digits: phoneDigits || ''
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return cancelPublicRowToLegacy(row);
}

export async function insertWaitlistRecord({
  businessDate,
  turno,
  horario,
  partySize,
  cliente
}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');
  let waiting_code = generatePublicCode('W');
  for (let i = 0; i < 5; i++) {
    const row = {
      tenant_id: DEFAULT_TENANT_ID,
      business_date: businessDate,
      turno,
      horario: horario || null,
      party_size: partySize,
      waiting_code,
      cliente: cliente || {},
      status: 'pending'
    };
    const { data, error } = await supabase.from('waitlist').insert(row).select('*').single();
    if (!error) return waitlistRowToLegacy(data);
    if (error.code === '23505') {
      waiting_code = generatePublicCode('W');
      continue;
    }
    throw error;
  }
  throw new Error('No se pudo crear lista de espera');
}

export async function deleteWaitlistRecord(id) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const { error } = await supabase.from('waitlist').delete().eq('id', id).eq('tenant_id', DEFAULT_TENANT_ID);
  if (error) throw error;
}

export async function updateWaitlistRecord(id, patch) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const { error } = await supabase
    .from('waitlist')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', DEFAULT_TENANT_ID);
  if (error) throw error;
}

export async function confirmWaitlistToReservation(waitingLegacy, selectedHorario, mesaAsignadaLabel, tableId) {
  const config = await fetchTenantReservationConfigMap();
  const created = await insertReservationRecord({
    businessDate: waitingLegacy.fecha,
    turno: waitingLegacy.turno,
    horario: selectedHorario,
    partySize: waitingLegacy.personas,
    cliente: waitingLegacy.cliente,
    mesaAsignadaLabel,
    tableId,
    configByTurno: config
  });
  await deleteWaitlistRecord(waitingLegacy.id);
  return { id: created.id, reservationId: created.reservationId };
}

export async function loadVenueBlocks(businessDate, turno) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('venue_day_table_blocks')
    .select('blocked_table_numbers')
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .eq('business_date', businessDate)
    .eq('turno', turno)
    .maybeSingle();
  if (error) throw error;
  return data?.blocked_table_numbers || [];
}

export async function saveVenueBlocks(businessDate, turno, blockedTableNumbers) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const { error } = await supabase.from('venue_day_table_blocks').upsert(
    {
      tenant_id: DEFAULT_TENANT_ID,
      business_date: businessDate,
      turno,
      blocked_table_numbers: blockedTableNumbers,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'tenant_id,business_date,turno' }
  );
  if (error) throw error;
}

export {
  rowToLegacyReservation,
  phoneSearchRowToLegacy,
  cancelPublicRowToLegacy,
  scheduleRowToLegacy,
  slotsFromConfigRow,
  getStayMinutesForTurn
};
