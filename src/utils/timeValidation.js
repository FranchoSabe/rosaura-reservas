/**
 * timeValidation.js - Utilidades para validación de tiempo de reservas
 * 
 * Funciones para:
 * - Validar tiempo mínimo de anticipación
 * - Detectar reservas de último momento
 * - Generar mensajes para WhatsApp
 */

import { RESTAURANT_CONFIG } from '../shared/constants';
import { formatDateToString } from './index';

/**
 * Verificar si un turno específico está disponible para reservas online
 * Basado en horario límite por turno (12:00 para mediodía, 19:00 para noche)
 */
export const isTurnoAvailableForOnlineReservation = (fecha, turno) => {
  try {
    const fechaString = typeof fecha === 'string' ? fecha : formatDateToString(fecha);
    const today = formatDateToString(new Date());
    
    // Si es una fecha futura, siempre permitir
    if (fechaString > today) {
      return true;
    }
    
    // Si es fecha pasada, no permitir
    if (fechaString < today) {
      return false;
    }
    
    // Si es hoy, verificar horario límite
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    
    const cutoffTime = RESTAURANT_CONFIG.reservationLimits.cutoffTimes[turno];
    
    // Comparar hora actual con hora límite
    return currentTime <= cutoffTime;
  } catch (error) {
    console.error('Error en validación de turno:', error);
    return false;
  }
};

/**
 * Verificar si es una reserva que necesita WhatsApp (fuera de horario online)
 */
export const needsWhatsAppReservation = (fecha, turno) => {
  return !isTurnoAvailableForOnlineReservation(fecha, turno);
};

/**
 * Calcular información sobre el límite de reserva online para un turno
 */
export const getTurnoLimitInfo = (turno) => {
  const cutoffTime = RESTAURANT_CONFIG.reservationLimits.cutoffTimes[turno];
  const explanation = RESTAURANT_CONFIG.reservationLimits.explanations[turno];
  
  return {
    cutoffTime,
    explanation,
    turnoName: turno === 'mediodia' ? 'mediodía' : 'noche'
  };
};

/**
 * Generar mensaje de WhatsApp para reserva fuera de horario online
 */
export const generateWhatsAppMessage = (fecha, turno, personas = 1, nombre = '', horario = '') => {
  const fechaString = typeof fecha === 'string' ? fecha : formatDateToString(fecha);
  const fechaObj = new Date(fechaString + 'T00:00:00');
  const fechaFormateada = fechaObj.toLocaleDateString('es-AR', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });
  
  const baseMessage = RESTAURANT_CONFIG.reservationLimits.whatsappMessages[turno] || 
    `Hola! Quiero hacer una reserva para el turno ${turno}. `;
  
  const isToday = fechaString === formatDateToString(new Date());
  const dateText = isToday ? 'hoy' : fechaFormateada;
  
  let message = `${baseMessage}`;
  message += `Necesito una mesa para ${personas} ${personas === 1 ? 'persona' : 'personas'} `;
  message += `para ${dateText}`;
  
  if (horario) {
    message += ` a las ${horario} hs`;
  }
  message += '. ';
  
  if (nombre) {
    message += `A nombre de ${nombre}. `;
  }
  
  message += 'Gracias!';
  
  return message;
};

/**
 * Obtener información de límites para mostrar en UI
 */
export const getReservationLimitsInfo = () => {
  const limits = RESTAURANT_CONFIG.reservationLimits;
  
  return {
    mediodia: {
      cutoffTime: limits.cutoffTimes.mediodia,
      explanation: limits.explanations.mediodia,
      displayText: `hasta las ${limits.cutoffTimes.mediodia} hs`
    },
    noche: {
      cutoffTime: limits.cutoffTimes.noche,
      explanation: limits.explanations.noche,
      displayText: `hasta las ${limits.cutoffTimes.noche} hs`
    },
    maxDays: limits.maximumAdvanceDays
  };
};

/**
 * Validar si se puede hacer reserva online para una fecha/turno
 */
export const validateOnlineReservation = (fecha, turno) => {
  const fechaString = typeof fecha === 'string' ? fecha : formatDateToString(fecha);
  const today = formatDateToString(new Date());
  
  // Verificar que no sea en el pasado
  if (fechaString < today) {
    return {
      isValid: false,
      error: 'No se pueden hacer reservas para fechas pasadas',
      needsWhatsApp: false
    };
  }
  
  // Verificar límite máximo (30 días)
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + RESTAURANT_CONFIG.reservationLimits.maximumAdvanceDays);
  const maxDateString = formatDateToString(maxDate);
  
  if (fechaString > maxDateString) {
    return {
      isValid: false,
      error: `Solo se pueden hacer reservas hasta ${RESTAURANT_CONFIG.reservationLimits.maximumAdvanceDays} días de anticipación`,
      needsWhatsApp: false
    };
  }
  
  // Verificar si el turno está disponible para reserva online
  if (!isTurnoAvailableForOnlineReservation(fecha, turno)) {
    const limitsInfo = getReservationLimitsInfo();
    const limitText = limitsInfo[turno].explanation;
    
    return {
      isValid: false,
      error: limitText,
      needsWhatsApp: true,
      whatsappMessage: generateWhatsAppMessage(fecha, turno),
      suggestion: `Para reservas de último momento, contactanos por WhatsApp`
    };
  }
  
  return {
    isValid: true,
    needsWhatsApp: false
  };
}; 