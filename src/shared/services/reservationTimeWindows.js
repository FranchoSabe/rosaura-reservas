import { addMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

/**
 * @param {string} businessDate YYYY-MM-DD
 * @param {string} horario HH:mm
 * @param {number} stayMinutes
 * @param {string} timeZone IANA
 */
export function computeReservationWindow(businessDate, horario, stayMinutes, timeZone) {
  const [h, m] = horario.split(':').map((x) => parseInt(x, 10));
  const localWall = new Date(
    `${businessDate}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00`
  );
  const startsAt = fromZonedTime(localWall, timeZone);
  const endsAt = addMinutes(startsAt, stayMinutes);
  return { startsAt, endsAt, startsMs: startsAt.getTime(), endsMs: endsAt.getTime() };
}

export function intervalsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

/** "12", "2+3", "Sin asignar" -> [12] o [2,3] */
export function parseMesaLabelToNumbers(label) {
  if (label == null || label === '' || label === 'Sin asignar') return [];
  const s = String(label);
  if (s.includes('+')) {
    return s
      .split('+')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => !Number.isNaN(n));
  }
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? [] : [n];
}

export function reservationBlocksTableNumbers(reservation) {
  const nums = new Set();
  const assigned = reservation.mesaAsignada ?? reservation.mesa_asignada_label;
  const real = reservation.mesaReal ?? reservation.mesa_real;
  if (reservation.estadoCheckIn === 'confirmado' && real != null) {
    parseMesaLabelToNumbers(String(real)).forEach((n) => nums.add(n));
  } else {
    parseMesaLabelToNumbers(assigned).forEach((n) => nums.add(n));
  }
  return [...nums];
}

/**
 * Dos reservas compiten por alguna mesa física y se solapan en tiempo.
 */
export function reservationsTimeOverlapOnTables(a, b) {
  if (a.id && b.id && a.id === b.id) return false;
  const statusA = a.status || 'active';
  const statusB = b.status || 'active';
  if (statusA === 'cancelled' || statusB === 'cancelled') return false;
  if (a.estadoCheckIn === 'completado' || b.estadoCheckIn === 'completado') return false;

  const sa = a._startsMs ?? 0;
  const ea = a._endsMs ?? 0;
  const sb = b._startsMs ?? 0;
  const eb = b._endsMs ?? 0;
  if (!sa || !ea || !sb || !eb) return false;
  if (!intervalsOverlap(sa, ea, sb, eb)) return false;

  const tablesA = reservationBlocksTableNumbers(a);
  const tablesB = reservationBlocksTableNumbers(b);
  if (tablesA.length === 0 || tablesB.length === 0) return false;
  return tablesA.some((t) => tablesB.includes(t));
}

/**
 * Slots desde fila tenant_reservation_config (jsonb arrays).
 */
function asSlotArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function slotsFromConfigRow(row) {
  if (!row) return [];
  const w1 = asSlotArray(row.slots_wave_1);
  if (row.wave_count === 2 && row.slots_wave_2) {
    const w2 = asSlotArray(row.slots_wave_2);
    return [...w1, ...w2];
  }
  return [...w1];
}

export function getStayMinutesForTurn(configByTurno, turno) {
  const row = configByTurno?.[turno];
  return row?.stay_minutes ?? 120;
}
