/**
 * reservationService.js - Servicio Unificado de Reservas
 * 
 * Este archivo centraliza TODA la lógica de reservas:
 * ✅ Creación de reservas (admin + cliente)
 * ✅ Asignación automática de mesas UNIFICADA
 * ✅ Validaciones de cupos
 * ✅ Gestión de lista de espera
 * ✅ Lógica de cliente/admin unificada
 * 
 * ELIMINA duplicación de código y centraliza en un solo lugar.
 */

import {
  calculateRealTableStates,
  assignTableAutomatically,
  validateTableAvailability,
  assignTableToNewReservation
} from './tableManagementService';
import {
  insertReservationRecord,
  insertWaitlistRecord,
  fetchReservationScheduleForDateTurn,
  fetchTenantReservationConfigMap,
  fetchTableNumberToIdMap
} from './supabaseReservationRepository';
import {
  computeReservationWindow,
  slotsFromConfigRow,
  getStayMinutesForTurn
} from './reservationTimeWindows';
import { RESTAURANT_TIMEZONE } from '../../lib/defaultTenantId';
import {
  UNIFIED_TABLES_LAYOUT,
  UNIFIED_RESERVATION_ORDER,
  DEFAULT_WALKIN_TABLES
} from '../../utils/tablesLayout';
import { isTurnoClosed } from '../constants/operatingDays';
import { parsePhoneNumber } from 'react-phone-number-input';
import { formatDateToString } from '../../utils';
import { validateOnlineReservation } from '../../utils/timeValidation';

// =================== CONFIGURACIÓN ===================

let _configCache = { t: 0, map: null };
async function getTenantConfigCached() {
  if (Date.now() - _configCache.t < 60000 && _configCache.map) return _configCache.map;
  const map = await fetchTenantReservationConfigMap();
  _configCache = { t: Date.now(), map };
  return map;
}

function normalizeCreateArgs(arg1, arg2) {
  if (arg1 && typeof arg1 === 'object' && 'reservationData' in arg1) {
    const { reservationData, ...rest } = arg1;
    return { reservationData, options: rest };
  }
  return { reservationData: arg1, options: arg2 || {} };
}

// =================== FUNCIÓN PRINCIPAL ===================

/**
 * Crear reserva unificada (Supabase). Acepta (data, options) o un solo objeto { reservationData, ... }.
 */
export const createReservation = async (arg1, arg2 = {}) => {
  const { reservationData: rawData, options } = normalizeCreateArgs(arg1, arg2);
  const {
    isAdmin = false,
    existingReservations = [],
    existingOrders = [],
    manualBlocks = new Set()
  } = options;

  try {
    const validation = await validateReservationData(rawData, null, isAdmin);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const clientData = await prepareClientData(rawData.cliente);
    const clientPayload = { ...clientData };
    delete clientPayload.createdAt;
    delete clientPayload.updatedAt;

    const fechaString =
      typeof rawData.fecha === 'string' ? rawData.fecha : formatDateToString(rawData.fecha);

    const config = await getTenantConfigCached();
    const stay = getStayMinutesForTurn(config, rawData.turno);

    let overlapCtx = null;
    if (rawData.horario) {
      const win = computeReservationWindow(fechaString, rawData.horario, stay, RESTAURANT_TIMEZONE);
      overlapCtx = { id: '__new__', _startsMs: win.startsMs, _endsMs: win.endsMs };
    }

    const realTableStates = calculateRealTableStates(
      existingReservations,
      existingOrders,
      manualBlocks,
      fechaString,
      rawData.turno,
      new Set(),
      overlapCtx
    );

    const availability = validateTableAvailability(
      { personas: rawData.personas, fecha: fechaString, turno: rawData.turno },
      realTableStates
    );

    const shouldGoToWaitingList =
      !isAdmin && (rawData.willGoToWaitingList || !availability.hasAvailability);

    if (shouldGoToWaitingList) {
      return await createWaitingReservation({
        reservationData: { ...rawData, fecha: fechaString },
        clientData: clientPayload
      });
    }

    /** Cliente web (anon): mesa y ventana temporal vía RPC create_public_reservation (servidor). */
    if (!isAdmin) {
      const row = await insertReservationRecord({
        businessDate: fechaString,
        turno: rawData.turno,
        horario: rawData.horario,
        partySize: rawData.personas,
        cliente: clientPayload,
        mesaAsignadaLabel: null,
        tableId: null,
        configByTurno: config
      });

      const dataOut = {
        reservationId: row.reservationId,
        codigoReserva: row.reservationId,
        mesaAsignada: row.mesaAsignada || 'Sin asignar',
        fecha: fechaString,
        turno: rawData.turno,
        horario: rawData.horario,
        personas: rawData.personas,
        cliente: clientPayload,
        starts_at: row.starts_at,
        ends_at: row.ends_at
      };

      return {
        success: true,
        type: 'confirmed',
        data: dataOut,
        reservationId: row.reservationId,
        mesaAsignada: row.mesaAsignada,
        message: row.mesaAsignada
          ? `Reserva confirmada para la mesa ${row.mesaAsignada}`
          : 'Reserva confirmada; el restaurante asignará la mesa si hace falta.'
      };
    }

    const tempReservation = { ...rawData, fecha: fechaString };
    const mesaAsignada = assignTableAutomatically(tempReservation, realTableStates);

    if (!mesaAsignada) {
      throw new Error('No hay mesas disponibles para esta reserva.');
    }

    const mapNums = await fetchTableNumberToIdMap();
    let tableId = null;
    if (mesaAsignada && !String(mesaAsignada).includes('+')) {
      const n = parseInt(String(mesaAsignada), 10);
      if (!Number.isNaN(n)) tableId = mapNums.get(n) || null;
    }

    const label =
      mesaAsignada == null ? 'Sin asignar' : String(mesaAsignada);

    const row = await insertReservationRecord({
      businessDate: fechaString,
      turno: rawData.turno,
      horario: rawData.horario,
      partySize: rawData.personas,
      cliente: clientPayload,
      mesaAsignadaLabel: label === 'Sin asignar' ? null : label,
      tableId,
      configByTurno: config
    });

    const dataOut = {
      reservationId: row.reservationId,
      codigoReserva: row.reservationId,
      mesaAsignada: row.mesaAsignada || 'Sin asignar',
      fecha: fechaString,
      turno: rawData.turno,
      horario: rawData.horario,
      personas: rawData.personas,
      cliente: clientPayload
    };

    return {
      success: true,
      type: 'confirmed',
      data: dataOut,
      reservationId: row.reservationId,
      mesaAsignada: row.mesaAsignada,
      message: row.mesaAsignada
        ? `Reserva confirmada para la mesa ${row.mesaAsignada}`
        : 'Reserva confirmada sin asignación de mesa'
    };
  } catch (error) {
    console.error('❌ Error en creación de reserva:', error);
    throw error;
  }
};

/**
 * 🎯 Crear reserva en lista de espera
 */
const createWaitingReservation = async ({ reservationData, clientData }) => {
  try {
    const w = await insertWaitlistRecord({
      businessDate: reservationData.fecha,
      turno: reservationData.turno,
      horario: reservationData.horario || null,
      partySize: reservationData.personas,
      cliente: clientData
    });

    const dataOut = {
      waitingId: w.waitingId,
      willGoToWaitingList: true,
      fecha: reservationData.fecha,
      turno: reservationData.turno,
      personas: reservationData.personas,
      cliente: clientData
    };

    return {
      success: true,
      type: 'waiting',
      data: dataOut,
      waitingId: w.waitingId,
      message: 'Solicitud agregada a la lista de espera. Te contactaremos si hay disponibilidad.'
    };
  } catch (error) {
    console.error('❌ Error en creación de reserva en lista de espera:', error);
    throw error;
  }
};

// =================== FUNCIONES AUXILIARES ===================

/**
 * Validar datos de reserva
 */
const validateReservationData = async (reservationData, getAvailableSlots, isAdmin) => {
  try {
    // Validación básica de campos
    if (!reservationData.cliente?.nombre) {
      return { isValid: false, error: 'El nombre del cliente es obligatorio.' };
    }

    if (!reservationData.cliente?.telefono) {
      return { isValid: false, error: 'El teléfono del cliente es obligatorio.' };
    }

    if (!reservationData.personas || reservationData.personas < 1) {
      return { isValid: false, error: 'Debe especificar la cantidad de personas.' };
    }

    if (!reservationData.turno) {
      return { isValid: false, error: 'Debe especificar el turno.' };
    }

    // Para clientes (no admin), validar horario específico
    if (!isAdmin && !reservationData.horario) {
      return { isValid: false, error: 'Debe especificar el horario.' };
    }

    // 🆕 VALIDACIÓN DE RESERVA ONLINE (solo para clientes)
    if (!isAdmin) {
      const onlineValidation = validateOnlineReservation(
        reservationData.fecha, 
        reservationData.turno
      );
      
      if (!onlineValidation.isValid) {
        return { 
          isValid: false, 
          error: onlineValidation.error,
          needsWhatsApp: onlineValidation.needsWhatsApp,
          suggestion: onlineValidation.suggestion
        };
      }
    }

    // Validar teléfono de forma más permisiva
    if (reservationData.cliente.telefono) {
      try {
        // Intentar parsear el teléfono
        const phoneNumber = parsePhoneNumber(reservationData.cliente.telefono);
        if (phoneNumber && !phoneNumber.isValid()) {
          return { isValid: false, error: 'El formato del teléfono no es válido.' };
        }
        // Si parsePhoneNumber devuelve null/undefined, asumimos que es un formato local válido
      } catch {
        // Si hay error en el parseo, verificar que al menos tenga números
        const hasNumbers = /\d{6,}/.test(reservationData.cliente.telefono);
        if (!hasNumbers) {
          return { isValid: false, error: 'El teléfono debe contener al menos 6 dígitos.' };
        }
      }
    }

    return { isValid: true };

  } catch (error) {
    console.error('Error en validación:', error);
    return { isValid: false, error: 'Error de validación interno.' };
  }
};

/**
 * Preparar datos del cliente
 */
const prepareClientData = async (clienteData) => {
  // Mantener el teléfono tal como viene desde el formulario
  // ya que el modal se encarga del formato correcto
  let formattedPhone = clienteData.telefono.trim();
  
  // Solo intentar formatear si realmente es necesario
  try {
    const phoneNumber = parsePhoneNumber(clienteData.telefono);
    if (phoneNumber && phoneNumber.isValid()) {
      formattedPhone = phoneNumber.formatInternational();
    }
  } catch {
    if (import.meta.env.DEV) {
      console.info('Usando teléfono sin formatear:', clienteData.telefono);
    }
  }

  return {
    nombre: clienteData.nombre.trim(),
    telefono: formattedPhone,
    email: clienteData.email?.trim() || null,
    comentarios: clienteData.comentarios?.trim() || null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
};

// =================== LÓGICA DE DISPONIBILIDAD Y ASIGNACIONES ===================

export const DEFAULT_HORARIOS = {
  mediodia: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00'],
  noche: ['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30']
};

export const calculateAvailableSlots = async (
  fecha,
  turno,
  personas = null,
  excludeReservationId = null,
  existingReservations = [],
  loadBlockedTables = null,
  isAdmin = false,
  preferPublicScheduleRpc = false
) => {
  try {
    const fechaObj = new Date(fecha + 'T00:00:00');

    if (!isAdmin && isTurnoClosed(fechaObj.getDay(), turno)) {
      return [];
    }

    let blockedTables = new Set();
    if (loadBlockedTables) {
      try {
        const blockedTablesForDate = await loadBlockedTables(fecha, turno);
        blockedTables = new Set(blockedTablesForDate || []);
        if (blockedTables.size === 0) {
          DEFAULT_WALKIN_TABLES.forEach((id) => blockedTables.add(id));
        }
      } catch (error) {
        console.error('Error al cargar bloqueos del mapa:', error);
        blockedTables = new Set(DEFAULT_WALKIN_TABLES);
      }
    }

    let reservasDelDia = existingReservations.filter(
      (r) => r.fecha === fecha && r.turno === turno && r.id !== excludeReservationId && r.status !== 'cancelled'
    );

    if (preferPublicScheduleRpc && !isAdmin) {
      try {
        reservasDelDia = await fetchReservationScheduleForDateTurn(fecha, turno);
        reservasDelDia = reservasDelDia.filter((r) => r.id !== excludeReservationId);
      } catch (e) {
        console.error('RPC schedule:', e);
      }
    }

    const config = await getTenantConfigCached();
    const cfgRow = config[turno];
    const fromCfg = cfgRow ? slotsFromConfigRow(cfgRow) : [];
    const slotList = fromCfg.length > 0 ? fromCfg : DEFAULT_HORARIOS[turno] || [];

    const capacidadDisponible = calculateCapacityByTables(blockedTables);
    const reservasPorCategoria = countReservationsByCategory(reservasDelDia);

    const hayCapacidad = personas
      ? checkCapacityForSize(personas, reservasPorCategoria, capacidadDisponible)
      : true;

    if (isAdmin || hayCapacidad) {
      return slotList.map((horario) => {
        const reservasHorario = reservasDelDia.filter((r) => r.horario === horario);
        const cuposOcupados = reservasHorario.reduce((t, r) => t + (r.personas || r.party_size || 0), 0);
        const maxCupos = calculateMaxCuposForHorario(capacidadDisponible);
        return {
          horario,
          cuposDisponibles: Math.max(0, maxCupos - cuposOcupados),
          disponible: isAdmin || maxCupos - cuposOcupados >= (personas || 1)
        };
      });
    }
    return [];
  } catch (error) {
    console.error('Error calculating available slots:', error);
    return [];
  }
};

export const assignTableAutomaticallyLegacy = async (
  reservationData,
  existingReservations = [],
  blockedTables = new Set()
) => {
  try {
    return await assignTableToNewReservation(reservationData, existingReservations, blockedTables);
  } catch (error) {
    console.error('Error en asignación automática:', error);
    return null;
  }
};

export const isValidReservationDate = (fecha, turno, isAdmin = false) => {
  if (isAdmin) return true;
  const fechaObj = new Date(fecha + 'T00:00:00');
  
  // Para comparaciones de fecha, usar medianoche (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Establecer a medianoche
  
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 1);
  maxDate.setHours(0, 0, 0, 0); // Establecer a medianoche
  
  return fechaObj >= today && fechaObj <= maxDate && !isTurnoClosed(fechaObj.getDay(), turno);
};

export const autoAssignAllPendingReservations = async (
  reservations,
  fecha,
  turno,
  blockedTables,
  onUpdateReservation,
  showNotification
) => {
  try {
    const reservasSinMesa = reservations.filter(
      r =>
        r.fecha === fecha &&
        r.turno === turno &&
        (!r.mesaAsignada || r.mesaAsignada === 'Sin asignar') &&
        r.estadoCheckIn !== 'confirmado'
    );

    if (reservasSinMesa.length === 0) {
      showNotification?.('info', 'No hay reservas pendientes de asignación');
      return;
    }

    let asignadas = 0;
    let noAsignadas = [];

    for (const reserva of reservasSinMesa) {
      const tableStates = calculateRealTableStates(
        reservations,
        [],
        blockedTables,
        fecha,
        turno,
        new Set(),
        reserva
      );
      const mesaAsignada = assignTableAutomatically(reserva, tableStates);
      if (mesaAsignada) {
        await onUpdateReservation(reserva.id, { mesaAsignada }, true);
        asignadas++;
      } else {
        noAsignadas.push(reserva.cliente?.nombre || 'Sin nombre');
      }
    }

    if (asignadas > 0) {
      showNotification?.('success', `${asignadas} reservas asignadas automáticamente`);
    }
    if (noAsignadas.length > 0) {
      showNotification?.(
        'warning',
        `${noAsignadas.length} reservas no pudieron asignarse: ${noAsignadas.join(', ')}`
      );
    }
  } catch (error) {
    console.error('Error en autoasignación:', error);
    showNotification?.('error', 'Error al autoasignar reservas');
  }
};

export const clearAllTableAssignments = async (
  reservations,
  fecha,
  turno,
  onUpdateReservation,
  showNotification
) => {
  try {
    const reservasConMesa = reservations.filter(
      r =>
        r.fecha === fecha &&
        r.turno === turno &&
        r.mesaAsignada &&
        r.estadoCheckIn !== 'confirmado'
    );

    if (reservasConMesa.length === 0) {
      showNotification?.('info', 'No hay asignaciones para limpiar');
      return;
    }

    for (const reserva of reservasConMesa) {
      await onUpdateReservation(reserva.id, { mesaAsignada: null }, true);
    }

    showNotification?.('success', `${reservasConMesa.length} asignaciones limpiadas`);
  } catch (error) {
    console.error('Error al limpiar asignaciones:', error);
    showNotification?.('error', 'Error al limpiar asignaciones');
  }
};

function calculateCapacityByTables(blockedTables) {
  const capacidad = { pequena: 0, mediana: 0, grande: 0 };
  UNIFIED_TABLES_LAYOUT.forEach(mesa => {
    if (!blockedTables.has(mesa.id)) {
      if (mesa.capacity <= 2) capacidad.pequena++;
      else if (mesa.capacity <= 4) capacidad.mediana++;
      else capacidad.grande++;
    }
  });
  const mesa2Available = !blockedTables.has(2);
  const mesa3Available = !blockedTables.has(3);
  if (mesa2Available && mesa3Available) {
    capacidad.grande++;
  }
  return capacidad;
}

function countReservationsByCategory(reservas) {
  const count = { pequena: 0, mediana: 0, grande: 0 };
  reservas.forEach(reserva => {
    if (reserva.personas <= 2) count.pequena++;
    else if (reserva.personas <= 4) count.mediana++;
    else count.grande++;
  });
  return count;
}

function checkCapacityForSize(personas, reservasPorCategoria, capacidadDisponible) {
  if (personas <= 2) return reservasPorCategoria.pequena < capacidadDisponible.pequena;
  if (personas <= 4) return reservasPorCategoria.mediana < capacidadDisponible.mediana;
  return reservasPorCategoria.grande < capacidadDisponible.grande;
}

function calculateMaxCuposForHorario(capacidadDisponible) {
  return capacidadDisponible.pequena * 2 + capacidadDisponible.mediana * 4 + capacidadDisponible.grande * 6;
}

// =================== EXPORTS ===================

export default {
  createReservation,
  validateReservationData,
  prepareClientData,
  calculateAvailableSlots,
  assignTableAutomaticallyLegacy,
  isValidReservationDate,
  autoAssignAllPendingReservations,
  clearAllTableAssignments
};
