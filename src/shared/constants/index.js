// CONSTANTES GLOBALES DEL SISTEMA

// CONFIGURACION DE DIAS DE OPERACION

// TEMPORAL: Habilitar lunes para reservas
export const MONDAY_RESERVATIONS_ENABLED = true;

// Función para verificar si un día está cerrado
export const isDayClosed = (dayOfWeek) => {
  // dayOfWeek: 0=domingo, 1=lunes, 2=martes, etc.
  
  if (dayOfWeek === 1 && !MONDAY_RESERVATIONS_ENABLED) {
    return true; // Lunes cerrado (cuando está deshabilitado)
  }
  
  return false; // Otros días abiertos
};

// Función para verificar si un turno específico está cerrado
export const isTurnoClosed = (dayOfWeek, turno) => {
  // Lunes: depende de la configuración
  if (dayOfWeek === 1 && !MONDAY_RESERVATIONS_ENABLED) {
    return true; // Lunes cerrado ambos turnos (cuando está deshabilitado)
  }
  
  // Domingos: turno noche cerrado siempre
  if (dayOfWeek === 0 && turno === 'noche') {
    return true; // Domingos sin turno noche
  }
  
  return false;
};

// CONFIGURACION DE CONTACTO

export const RESTAURANT_CONFIG = {
  name: 'Rosaura',
  phone: '+5492213995351', // Número real de WhatsApp
  email: 'info@rosaura.com',
  address: 'Dirección del restaurante',
  
  // Horarios de atención
  hours: {
    mediodia: {
      start: '12:00',
      end: '16:00',
      lastReservation: '15:30'
    },
    noche: {
      start: '20:00', 
      end: '24:00',
      lastReservation: '23:30'
    }
  },
  
  // Capacidad del restaurante
  capacity: {
    maxPersonsPerReservation: 6,
    tablesCount: 24,
    walkInTables: [4, 5, 14, 24] // Mesas reservadas para walk-ins
  },

  // 🆕 LÍMITES DE RESERVAS ONLINE
  reservationLimits: {
    // Horarios límite para reservas online (horario de Argentina)
    cutoffTimes: {
      mediodia: '12:00', // Hasta las 12:00 se puede reservar mediodía online
      noche: '19:00'     // Hasta las 19:00 se puede reservar noche online
    },
    
    // Tiempo máximo para reservar (en días)
    maximumAdvanceDays: 30,
    
    // Mensajes para WhatsApp según el turno
    whatsappMessages: {
      mediodia: 'Hola! Quiero hacer una reserva para el turno mediodía. ',
      noche: 'Hola! Quiero hacer una reserva para el turno noche. '
    },
    
    // Explicaciones para mostrar al usuario
    explanations: {
      mediodia: 'Las reservas para mediodía se pueden hacer online hasta las 12:00 hs',
      noche: 'Las reservas para noche se pueden hacer online hasta las 19:00 hs'
    }
  }
};

// Exportar todas las constantes de modificadores
export * from './modifiers'; 