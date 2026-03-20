/**
 * Capa de datos del dominio reserva (Supabase). Reemplaza Firestore para este módulo.
 */
import { getSupabaseClient } from '../../lib/supabaseClient';
import {
  subscribeToReservationsForBusinessDate,
  subscribeToWaitlistForBusinessDate,
  updateReservationFromLegacy,
  cancelReservationById,
  searchReservationByCodePublic,
  searchReservationsByPhonePublic,
  cancelPublicReservationByCodeAndPhone,
  insertWaitlistRecord,
  deleteWaitlistRecord,
  confirmWaitlistToReservation,
  loadVenueBlocks,
  saveVenueBlocks,
  fetchTableNumberToIdMap
} from '../services/supabaseReservationRepository';

function requireClient() {
  if (!getSupabaseClient()) {
    throw new Error(
      'Supabase no está configurado. Definí VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.'
    );
  }
}

export const subscribeToReservationsByDate = (callback, targetDate) => {
  if (!getSupabaseClient()) {
    if (import.meta.env.DEV) {
      console.warn('[reservas] Supabase no configurado: suscripción deshabilitada.');
    }
    callback([]);
    return () => {};
  }
  return subscribeToReservationsForBusinessDate(targetDate, callback);
};

export const subscribeToWaitingReservationsByDate = (callback, businessDate) => {
  if (!getSupabaseClient()) {
    if (import.meta.env.DEV) {
      console.warn('[waitlist] Supabase no configurado: suscripción deshabilitada.');
    }
    callback([]);
    return () => {};
  }
  return subscribeToWaitlistForBusinessDate(businessDate, callback);
};

export const updateReservation = async (documentId, reservationData) => {
  requireClient();
  return updateReservationFromLegacy(documentId, {
    ...reservationData,
    fecha: reservationData.fecha,
    personas: reservationData.personas,
    turno: reservationData.turno,
    horario: reservationData.horario,
    cliente: reservationData.cliente,
    mesaAsignada: reservationData.mesaAsignada,
    mesaReal: reservationData.mesaReal,
    estadoCheckIn: reservationData.estadoCheckIn,
    horaLlegada: reservationData.horaLlegada,
    status: reservationData.status
  });
};

export const deleteReservation = async (documentId) => {
  requireClient();
  await cancelReservationById(documentId);
  return true;
};

export const searchReservation = async (searchData) => {
  requireClient();
  const { mode = 'code', reservationId, phoneDigits } = searchData || {};
  if (mode === 'phone') {
    return searchReservationsByPhonePublic(phoneDigits);
  }
  return searchReservationByCodePublic(reservationId);
};

export const cancelReservationPublic = async (code, phoneDigits) => {
  requireClient();
  return cancelPublicReservationByCodeAndPhone(code, phoneDigits);
};

export const addWaitingReservation = async (reservationData) => {
  requireClient();
  const row = await insertWaitlistRecord({
    businessDate: reservationData.fecha,
    turno: reservationData.turno,
    horario: reservationData.horario,
    partySize: reservationData.personas,
    cliente: reservationData.cliente
  });
  return { id: row.id, waitingId: row.waitingId };
};

export const confirmWaitingReservation = async (waitingReservationId, waitingData) => {
  requireClient();
  let tableId = null;
  const ma = waitingData.mesaAsignada;
  if (ma != null && ma !== 'Sin asignar' && !String(ma).includes('+')) {
    const n = parseInt(String(ma), 10);
    if (!Number.isNaN(n)) {
      const m = await fetchTableNumberToIdMap();
      tableId = m.get(n) || null;
    }
  }
  const legacy = { ...waitingData, id: waitingReservationId, fecha: waitingData.fecha };
  return confirmWaitlistToReservation(
    legacy,
    waitingData.horario,
    ma != null ? String(ma) : null,
    tableId
  );
};

export const deleteWaitingReservation = async (waitingReservationId) => {
  requireClient();
  await deleteWaitlistRecord(waitingReservationId);
  return true;
};

export const markWaitingAsNotified = async (waitingReservationId) => {
  requireClient();
  const { updateWaitlistRecord } = await import('../services/supabaseReservationRepository');
  await updateWaitlistRecord(waitingReservationId, {
    notified: true,
    notified_at: new Date().toISOString()
  });
  return true;
};

export const contactWaitingClient = async (waitingReservationId) => {
  requireClient();
  const { updateWaitlistRecord } = await import('../services/supabaseReservationRepository');
  await updateWaitlistRecord(waitingReservationId, {
    contacted: true,
    contacted_at: new Date().toISOString(),
    awaiting_confirmation: true,
    confirmation_deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  });
  return true;
};

export const rejectWaitingReservation = async (waitingReservationId, reason = '') => {
  requireClient();
  const { updateWaitlistRecord } = await import('../services/supabaseReservationRepository');
  await updateWaitlistRecord(waitingReservationId, {
    status: 'rejected',
    rejected_at: new Date().toISOString(),
    rejection_reason: reason || null
  });
  return true;
};

export const saveTableBlocksForDateTurno = async (fecha, turno, blockedTables = []) => {
  requireClient();
  await saveVenueBlocks(fecha, turno, Array.from(blockedTables));
  return { success: true };
};

export const loadTableBlocksForDateTurno = async (fecha, turno) => {
  requireClient();
  const nums = await loadVenueBlocks(fecha, turno);
  return {
    blockedTables: new Set(nums || []),
    exceptions: new Set(),
    lastUpdated: null
  };
};
