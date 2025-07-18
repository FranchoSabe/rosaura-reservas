/*
  Utilidades centralizadas para la lógica de mesas y cupos.
  Cualquier cambio sobre layout, bloqueos o auto-asignación se realiza aquí
  y queda compartido por todas las vistas.
  
  CORRECCIONES REALIZADAS:
  - Orden de mesas corregido: 
    * Para 2 personas: 2 -> 8 -> 11 -> 21 -> 1 -> 31
    * Para 4 personas: 9 -> 10 -> 6 -> 12 -> 13 -> 3
  - Mesas bloqueadas por defecto: 4, 5, 14, 24
  - Mejorada validación de conflictos para evitar asignaciones duplicadas
*/

// Layout de mesas UNIFICADO - importado desde el archivo centralizado
import { 
  UNIFIED_TABLES_LAYOUT, 
  UNIFIED_RESERVATION_ORDER, 
  UNIFIED_TABLE_COMBINATIONS, 
  UNIFIED_DEFAULT_BLOCKED_TABLES 
} from './tablesLayout';

// Re-exportar con nombres compatibles (para compatibilidad con código existente)
export const TABLES_LAYOUT = UNIFIED_TABLES_LAYOUT;
export const RESERVATION_ORDER = UNIFIED_RESERVATION_ORDER;
export const TABLE_COMBINATIONS = UNIFIED_TABLE_COMBINATIONS;
export const DEFAULT_BLOCKED_TABLES = UNIFIED_DEFAULT_BLOCKED_TABLES;

export const setsAreEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Lógica para redistribuir bloqueos dinámicamente - SIMPLIFICADA
// Ya no se realizan bloqueos automáticos, solo se respetan las mesas marcadas manualmente como bloqueadas
export const redistribuirBloqueos = (assignments, occupiedTables, blockedTables) => {
  // Esta función ahora simplemente respeta los bloqueos manuales
  // Sin lógica automática de redistribución para evitar interferencias
  // con las asignaciones de reservas
  
  // Se mantiene solo para compatibilidad con el código existente
  // pero sin realizar cambios automáticos en los bloqueos
};

// Función para calcular cupos walk-in
export const calculateWalkInQuotas = (blockedTables) => {
  return [...blockedTables].reduce((acc, id) => {
    const mesa = TABLES_LAYOUT.find((t) => t.id === id);
    return acc + (mesa ? mesa.capacity : 0);
  }, 0);
};

// Función para detectar cambios en cupos walk-in
export const detectWalkInQuotaChanges = (originalBlocked, newBlocked) => {
  const originalQuota = calculateWalkInQuotas(originalBlocked);
  const newQuota = calculateWalkInQuotas(newBlocked);
  
  if (originalQuota !== newQuota) {
    const mesasLiberadas = [...originalBlocked].filter(id => !newBlocked.has(id));
    const mesasBloqueadas = [...newBlocked].filter(id => !originalBlocked.has(id));
    
    return {
      hasChanges: true,
      originalQuota,
      newQuota,
      difference: newQuota - originalQuota,
      mesasLiberadas,
      mesasBloqueadas,
      message: `Los cupos walk-in cambiarán de ${originalQuota} a ${newQuota} personas (${newQuota > originalQuota ? '+' : ''}${newQuota - originalQuota}). ¿Confirmar cambios?`
    };
  }
  
  return { hasChanges: false };
};

// Función principal de auto-asignación pura con soporte solo para combinación 2+3
export const calculateAutoAssignments = (reservas, currentBlocked) => {
  const assignments = {};
  const occupiedTables = new Set();
  const newBlocked = new Set(currentBlocked);

  // Orden cronológico
  const ordenadas = [...reservas].sort((a, b) => a.horario.localeCompare(b.horario));

  // Primero optimizar asignación de mesas grandes (5-6 personas) para preservar mesa 2+3
  const largeTableOptimization = optimizeLargeTableAssignment(ordenadas, occupiedTables, newBlocked);
  Object.assign(assignments, largeTableOptimization.assignments);
  largeTableOptimization.occupiedTables.forEach(id => occupiedTables.add(id));

  for (const reserva of ordenadas) {
    // Omitir reservas que ya fueron asignadas por la optimización de mesas grandes
    if (assignments[reserva.id]) {
      continue;
    }

    let capacidadObjetivo = reserva.personas === 5 ? 6 : reserva.personas;

    let posibleOrden = RESERVATION_ORDER[capacidadObjetivo];
    if (!posibleOrden) {
      for (const cap of [4, 6]) {
        if (cap >= reserva.personas && RESERVATION_ORDER[cap]) {
          posibleOrden = RESERVATION_ORDER[cap];
          break;
        }
      }
    }

    let asignada = false;

    // 1. Intentar asignar mesa individual no bloqueada
    if (posibleOrden) {
      for (const id of posibleOrden) {
        if (!occupiedTables.has(id) && !newBlocked.has(id)) {
          assignments[reserva.id] = id;
          occupiedTables.add(id);
          asignada = true;
          break;
        }
      }
    }

    // 2. Si no se logró asignar mesa individual, intentar mesas bloqueadas (liberándolas)
    if (!asignada && posibleOrden) {
      for (const id of posibleOrden) {
        if (!occupiedTables.has(id) && newBlocked.has(id)) {
          assignments[reserva.id] = id;
          occupiedTables.add(id);
          newBlocked.delete(id);
          asignada = true;
          break;
        }
      }
    }

    // 3. Si se necesita capacidad 4 y no se pudo asignar, intentar combinaciones
    if (!asignada && capacidadObjetivo === 4) {
      const availableCombination = findAvailableCombination(4, occupiedTables, newBlocked);
      if (availableCombination) {
        assignments[reserva.id] = availableCombination.tables.join('+');
        // Marcar ambas mesas como ocupadas
        availableCombination.tables.forEach(tableId => occupiedTables.add(tableId));
        asignada = true;
      }
    }

    // 4. Si se necesita capacidad 6 y no se pudo asignar, intentar combinación 2+3
    if (!asignada && capacidadObjetivo === 6) {
      const combination23Available = !occupiedTables.has(2) && !occupiedTables.has(3) && 
                                    !newBlocked.has(2) && !newBlocked.has(3);
      
      if (combination23Available) {
        assignments[reserva.id] = '2+3';
        occupiedTables.add(2);
        occupiedTables.add(3);
        asignada = true;
      }
    }
  }

  // Ya no se llama a redistribuirBloqueos ni rebalanceWalkInQuotas
  // Los bloqueos se mantienen como están, solo se modifican manualmente

  // Detectar cambios en cupos walk-in
  const quotaChanges = detectWalkInQuotaChanges(currentBlocked, newBlocked);

  return {
    assignments,
    blockedTables: newBlocked,
    quotaChanges,
  };
};

// Función para guardar asignaciones de mesas en las reservas
export const saveTableAssignments = async (assignments, onUpdateReservation, showNotification) => {
  try {
    const promises = Object.entries(assignments).map(([reservationId, tableId]) => {
      return onUpdateReservation(reservationId, { mesaAsignada: tableId }, true);
    });
    
    await Promise.all(promises);
    
    if (showNotification) {
      showNotification('success', 'Asignaciones de mesas guardadas correctamente');
    }
    
    return true;
  } catch (error) {
    console.error('Error al guardar asignaciones:', error);
    if (showNotification) {
      showNotification('error', 'Error al guardar las asignaciones de mesas');
    }
    throw error;
  }
};

// Función para guardar bloqueos de mesas
export const saveBlockedTables = async (blockedTables, fecha, turno, onSaveBlockedTables, showNotification) => {
  try {
    const blockedTablesArray = Array.from(blockedTables);
    await onSaveBlockedTables(fecha, turno, blockedTablesArray);
    
    if (showNotification) {
      showNotification('success', 'Bloqueos de mesas guardados correctamente');
    }
    
    return true;
  } catch (error) {
    console.error('Error al guardar bloqueos:', error);
    if (showNotification) {
      showNotification('error', 'Error al guardar los bloqueos de mesas');
    }
    throw error;
  }
};

// Función para cargar bloqueos guardados
export const loadBlockedTables = async (fecha, turno, onLoadBlockedTables) => {
  try {
    const savedBlocked = await onLoadBlockedTables(fecha, turno);
    return new Set(savedBlocked || []);
  } catch (error) {
    console.error('Error al cargar bloqueos:', error);
    // Retornar bloqueos por defecto si hay error - CORREGIDO
    const defaultBlocked = new Set();
    Object.values(DEFAULT_BLOCKED_TABLES).flat().forEach((id) => defaultBlocked.add(id));
    return defaultBlocked;
  }
};

// Función para asignar mesa automáticamente a una nueva reserva (usa la lógica con combinaciones)
export const assignTableToNewReservation = (newReservation, existingReservations, currentBlocked = new Set()) => {
  return assignTableWithCombinations(newReservation, existingReservations, currentBlocked);
};

// Función para validar conflictos de mesa
export const validateTableAssignment = (reservationId, tableId, fecha, turno, existingReservations) => {
  const conflictingReservation = existingReservations.find(
    r => r.id !== reservationId && 
        r.fecha === fecha && 
        r.turno === turno && 
        r.mesaAsignada === tableId
  );

  return {
    hasConflict: !!conflictingReservation,
    conflictingReservation: conflictingReservation || null
  };
};

// Función para reasignación manual de mesas desde el admin panel
export const reassignTableManually = async (reservationId, newTableId, reservations, onUpdateReservation, showNotification, forceAssignment = false) => {
  try {
    // Buscar la reserva a reasignar
    const reservation = reservations.find(r => r.id === reservationId);
    if (!reservation) {
      throw new Error('Reserva no encontrada');
    }

    // Validar conflictos si no es una asignación forzada
    if (!forceAssignment) {
      const conflict = validateTableAssignment(reservationId, newTableId, reservation.fecha, reservation.turno, reservations);
      
      if (conflict.hasConflict) {
        // Retornar información del conflicto para que el admin pueda decidir
        return {
          success: false,
          hasConflict: true,
          conflictingReservation: conflict.conflictingReservation,
          message: `La mesa ${newTableId} ya está asignada a ${conflict.conflictingReservation.cliente.nombre} (${conflict.conflictingReservation.personas} personas)`
        };
      }
    }

    // Actualizar la reserva con la nueva mesa
    await onUpdateReservation(reservationId, { mesaAsignada: newTableId }, true);

    if (showNotification) {
      showNotification('success', `Mesa ${newTableId} asignada correctamente${forceAssignment ? ' (forzado)' : ''}`);
    }

    return {
      success: true,
      hasConflict: false,
      message: `Mesa ${newTableId} asignada correctamente`
    };

  } catch (error) {
    console.error('Error al reasignar mesa:', error);
    if (showNotification) {
      showNotification('error', 'Error al asignar la mesa');
    }
    throw error;
  }
};

// Función para verificar si una combinación de mesas está disponible
export const isCombinationAvailable = (combination, occupiedTables, blockedTables) => {
  return combination.tables.every(tableId => 
    !occupiedTables.has(tableId) && !blockedTables.has(tableId)
  );
};

// Función para encontrar una combinación de mesas disponible para una capacidad específica
export const findAvailableCombination = (requiredCapacity, occupiedTables, blockedTables) => {
  if (requiredCapacity === 4) {
    // Buscar combinaciones de mesas de 2 que puedan formar una de 4
    for (const combination of TABLE_COMBINATIONS.joinableFor4) {
      if (isCombinationAvailable(combination, occupiedTables, blockedTables)) {
        return combination;
      }
    }
  } else if (requiredCapacity === 6) {
    // Buscar combinaciones de mesas de 2 que puedan formar una de 6
    for (const combination of TABLE_COMBINATIONS.joinableFor6) {
      if (isCombinationAvailable(combination, occupiedTables, blockedTables)) {
        return combination;
      }
    }
  }
  return null;
};

// Función mejorada para asignar mesa con capacidad de unión
export const assignTableWithCombinations = (newReservation, existingReservations, currentBlocked = new Set()) => {
  // Filtrar reservas del mismo turno y fecha
  const reservationsForTurno = existingReservations.filter(
    r => r.fecha === newReservation.fecha && r.turno === newReservation.turno
  );

  // Determinar capacidad objetivo
  let capacidadObjetivo = newReservation.personas === 5 ? 6 : newReservation.personas;
  
  // Obtener mesas ya ocupadas (incluyendo combinaciones existentes)
  const occupiedTables = new Set();
  reservationsForTurno.forEach(reservation => {
    if (reservation.mesaAsignada) {
      // Si es una combinación (formato "11+21"), agregar ambas mesas
      if (typeof reservation.mesaAsignada === 'string' && reservation.mesaAsignada.includes('+')) {
        const tableIds = reservation.mesaAsignada.split('+').map(id => parseInt(id));
        tableIds.forEach(id => occupiedTables.add(id));
      } else {
        occupiedTables.add(parseInt(reservation.mesaAsignada));
      }
    }
  });

  // 1. Intentar asignar mesa individual primero
  let posibleOrden = RESERVATION_ORDER[capacidadObjetivo];
  if (!posibleOrden) {
    for (const cap of [4, 6]) {
      if (cap >= newReservation.personas && RESERVATION_ORDER[cap]) {
        posibleOrden = RESERVATION_ORDER[cap];
        break;
      }
    }
  }

  if (posibleOrden) {
    // Intentar asignar mesa individual no bloqueada
    for (const tableId of posibleOrden) {
      if (!occupiedTables.has(tableId) && !currentBlocked.has(tableId)) {
        return tableId;
      }
    }

    // Si no hay mesa individual, intentar con bloqueadas
    for (const tableId of posibleOrden) {
      if (!occupiedTables.has(tableId) && currentBlocked.has(tableId)) {
        return tableId;
      }
    }
  }

  // 2. Si no se pudo asignar mesa individual y se necesita capacidad 4, intentar mesas bloqueadas de 4 personas
  if (capacidadObjetivo === 4) {
    // Buscar mesas de 4 personas que estén bloqueadas para liberar
    const mesasDe4Bloqueadas = RESERVATION_ORDER[4].filter(id => 
      currentBlocked.has(id) && !occupiedTables.has(id)
    );
    
    if (mesasDe4Bloqueadas.length > 0) {
      // Retornar la primera mesa de 4 bloqueada (se liberará automáticamente)
      return mesasDe4Bloqueadas[0];
    }
  }

  // 3. Si aún no se pudo asignar, intentar combinaciones
  if (capacidadObjetivo === 4) {
    const availableCombination = findAvailableCombination(4, occupiedTables, currentBlocked);
    if (availableCombination) {
      // Retornar la combinación como string "mesa1+mesa2"
      return availableCombination.tables.join('+');
    }
  } else if (capacidadObjetivo === 6) {
    // Para 5 o 6 personas, aplicar lógica de prioridad especial
    const mesa7Available = !occupiedTables.has(7) && !currentBlocked.has(7);
    const mesas23Available = !occupiedTables.has(2) && !occupiedTables.has(3) && 
                            !currentBlocked.has(2) && !currentBlocked.has(3);
    
    if (newReservation.personas === 6) {
      // Para 6 personas: priorizar Mesa 7, luego Mesa 2+3
      if (mesa7Available) {
        return 7;
      } else if (mesas23Available) {
        return '2+3';
      }
    } else if (newReservation.personas === 5) {
      // Para 5 personas: priorizar Mesa 7, luego Mesa 2+3
      if (mesa7Available) {
        return 7;
      } else if (mesas23Available) {
        return '2+3';
      }
    }
  }

  // No hay mesa disponible
  return null;
};

// Función para rebalancear cupos walk-in - SIMPLIFICADA
// Ya no realiza ajustes automáticos, solo respeta los bloqueos manuales
export const rebalanceWalkInQuotas = (currentBlocked, occupiedTables) => {
  // Simplemente devolver los bloqueos actuales sin modificaciones automáticas
  // Esto permite que los administradores manejen manualmente los cupos walk-in
  // según sus necesidades específicas
  return new Set(currentBlocked);
};

// Función para optimizar asignación de mesas grandes (5-6 personas)
export const optimizeLargeTableAssignment = (reservas, occupiedTables, blockedTables) => {
  // Filtrar reservas de 5 y 6 personas
  const reservas5 = reservas.filter(r => r.personas === 5);
  const reservas6 = reservas.filter(r => r.personas === 6);
  
  const assignments = {};
  const newOccupied = new Set(occupiedTables);
  
  // Lógica de prioridad:
  // 1. Si hay reservas de 6 personas: Mesa 7 para la primera, Mesa 2+3 para las siguientes
  // 2. Si hay reservas de 5 personas: Priorizar Mesa 7, luego Mesa 2+3
  
  // Verificar disponibilidad de mesas
  const mesa7Available = !newOccupied.has(7) && !blockedTables.has(7);
  const mesas23Available = !newOccupied.has(2) && !newOccupied.has(3) && 
                          !blockedTables.has(2) && !blockedTables.has(3);
  
  // Asignar reservas de 6 personas primero
  if (reservas6.length > 0) {
    if (mesa7Available) {
      // Primera reserva de 6 personas va a Mesa 7
      assignments[reservas6[0].id] = 7;
      newOccupied.add(7);
      
      // Siguientes reservas de 6 personas van a Mesa 2+3
      for (let i = 1; i < reservas6.length; i++) {
        if (mesas23Available && !newOccupied.has(2) && !newOccupied.has(3)) {
          assignments[reservas6[i].id] = '2+3';
          newOccupied.add(2);
          newOccupied.add(3);
          break; // Solo una combinación 2+3 disponible
        }
      }
    } else if (mesas23Available) {
      // Si Mesa 7 no está disponible, usar Mesa 2+3 para la primera reserva de 6
      assignments[reservas6[0].id] = '2+3';
      newOccupied.add(2);
      newOccupied.add(3);
    }
  }
  
  // Asignar reservas de 5 personas
  for (const reserva5 of reservas5) {
    if (!newOccupied.has(7) && !blockedTables.has(7)) {
      // Mesa 7 disponible para reserva de 5
      assignments[reserva5.id] = 7;
      newOccupied.add(7);
    } else if (!newOccupied.has(2) && !newOccupied.has(3) && 
               !blockedTables.has(2) && !blockedTables.has(3)) {
      // Mesa 2+3 disponible para reserva de 5
      assignments[reserva5.id] = '2+3';
      newOccupied.add(2);
      newOccupied.add(3);
      break; // Solo una combinación 2+3 disponible
    }
  }
  
  return {
    assignments,
    occupiedTables: newOccupied
  };
};

// Función para evaluar si es conveniente preservar la combinación Mesa 2+3
// Función para verificar si una mesa puede acomodar cierta cantidad de personas
export const canTableAccommodate = (mesaAsignada, newPersonas) => {
  if (!mesaAsignada || mesaAsignada === 'Sin asignar') {
    return false;
  }

  // Si es una combinación (ej: "2+3")
  if (typeof mesaAsignada === 'string' && mesaAsignada.includes('+')) {
    const tableIds = mesaAsignada.split('+').map(id => parseInt(id));
    const totalCapacity = tableIds.reduce((total, id) => {
      const mesa = TABLES_LAYOUT.find(t => t.id === id);
      return total + (mesa ? mesa.capacity : 0);
    }, 0);
    return totalCapacity >= newPersonas;
  }

  // Mesa individual
  const mesa = TABLES_LAYOUT.find(t => t.id === parseInt(mesaAsignada));
  return mesa ? mesa.capacity >= newPersonas : false;
};

// Función para verificar si necesita reasignación de mesa al cambiar cantidad de personas
export const checkTableReassignmentNeeded = (originalReservation, newPersonas, existingReservations, currentBlocked = new Set()) => {
  const currentMesa = originalReservation.mesaAsignada;
  
  // Si no tiene mesa asignada, intentar asignar una nueva
  if (!currentMesa || currentMesa === 'Sin asignar') {
    const tempReservation = { ...originalReservation, personas: newPersonas };
    const suggestedTable = assignTableToNewReservation(tempReservation, existingReservations, currentBlocked);
    
    return {
      needsReassignment: true,
      reason: 'no_table_assigned',
      currentTable: null,
      suggestedTable: suggestedTable,
      message: suggestedTable 
        ? `Se asignará automáticamente la mesa ${suggestedTable} para ${newPersonas} personas.`
        : `No hay mesa disponible para ${newPersonas} personas. Se guardará sin asignación de mesa.`
    };
  }

  // Verificar si la mesa actual puede acomodar la nueva cantidad
  const canAccommodate = canTableAccommodate(currentMesa, newPersonas);
  
  if (canAccommodate) {
    return {
      needsReassignment: false,
      reason: 'current_table_sufficient',
      currentTable: currentMesa,
      suggestedTable: currentMesa,
      message: `La mesa actual (${currentMesa}) puede acomodar ${newPersonas} personas.`
    };
  }

  // La mesa actual no es suficiente, buscar una mejor opción
  const tempReservation = { 
    ...originalReservation, 
    personas: newPersonas 
  };
  
  // Obtener reservas excluyendo la actual para evitar conflictos
  const otherReservations = existingReservations.filter(r => r.id !== originalReservation.id);
  const suggestedTable = assignTableToNewReservation(tempReservation, otherReservations, currentBlocked);

  return {
    needsReassignment: true,
    reason: 'insufficient_capacity',
    currentTable: currentMesa,
    suggestedTable: suggestedTable,
    currentCapacity: getCurrentTableCapacity(currentMesa),
    newCapacity: newPersonas,
    message: suggestedTable 
      ? `La mesa actual (${currentMesa}) es para ${getCurrentTableCapacity(currentMesa)} personas. Se reasignará automáticamente a la mesa ${suggestedTable} para ${newPersonas} personas.`
      : `La mesa actual (${currentMesa}) es para ${getCurrentTableCapacity(currentMesa)} personas, pero no hay mesa disponible para ${newPersonas} personas. Se mantendrá la mesa actual.`
  };
};

// Función auxiliar para obtener la capacidad de una mesa
export const getCurrentTableCapacity = (mesaAsignada) => {
  if (!mesaAsignada || mesaAsignada === 'Sin asignar') {
    return 0;
  }

  // Si es una combinación
  if (typeof mesaAsignada === 'string' && mesaAsignada.includes('+')) {
    const tableIds = mesaAsignada.split('+').map(id => parseInt(id));
    return tableIds.reduce((total, id) => {
      const mesa = TABLES_LAYOUT.find(t => t.id === id);
      return total + (mesa ? mesa.capacity : 0);
    }, 0);
  }

  // Mesa individual
  const mesa = TABLES_LAYOUT.find(t => t.id === parseInt(mesaAsignada));
  return mesa ? mesa.capacity : 0;
};

export const shouldPreserveCombination23 = (reservas, occupiedTables, blockedTables) => {
  // Verificar si hay reservas de 5 o 6 personas pendientes que AÚN NO ESTÁN ASIGNADAS
  const largeGroupReservations = reservas.filter(r => 
    r.personas >= 5 && (!r.mesaAsignada || r.mesaAsignada === 'Sin asignar')
  );
  
  // Si no hay reservas grandes pendientes, NO preservar - permitir usar Mesa 3
  if (largeGroupReservations.length === 0) {
    return false;
  }
  
  // Verificar disponibilidad de Mesa 7
  const mesa7Available = !occupiedTables.has(7) && !blockedTables.has(7);
  
  // Verificar disponibilidad de combinación 2+3
  const combination23Available = !occupiedTables.has(2) && !occupiedTables.has(3) && 
                                !blockedTables.has(2) && !blockedTables.has(3);
  
  // SOLO preservar si:
  // 1. Hay reservas grandes pendientes SIN asignar
  // 2. Mesa 7 está ocupada (no hay otra opción para grupos grandes)
  // 3. La combinación 2+3 está disponible
  if (!mesa7Available && combination23Available && largeGroupReservations.length > 0) {
    return true;
  }
  
  // Si Mesa 7 está disponible, NO preservar 2+3 - la primera reserva grande puede ir a Mesa 7
  // Solo preservar si hay MÁS DE UNA reserva grande pendiente
  if (mesa7Available && combination23Available && largeGroupReservations.length > 1) {
    return true;
  }
  
  // En todos los demás casos: NO preservar, permitir usar Mesa 3
  // Priorizar dar la reserva actual sobre guardar espacio "por si acaso"
  return false;
}; 