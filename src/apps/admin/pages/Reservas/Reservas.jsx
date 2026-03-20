import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronDown, ThumbsDown, MessageCircle, Check, Edit2, Trash2, CheckCircle, X, XCircle, AlertTriangle, Sun, Moon, Clock, Printer, ChevronLeft, ChevronRight, Calendar, Users, Phone, Lock, Unlock, MapPin, Plus, Zap, UserCheck, Save, RotateCcw } from 'lucide-react';

// Componentes modularizados
import { ConfirmationModal } from '../../../../shared/components/ui';
import ConflictModal from './components/modals/ConflictModal';
import CheckInModal from './components/modals/CheckInModal';
import ReassignmentModal from './components/modals/ReassignmentModal';

// Componentes de sección
import ReservationsList from './components/sections/ReservationsList';
import WaitingListSection from './components/sections/WaitingListSection';

import DatePicker, { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import "../../../../datepicker-custom.css";

import { formatPhoneForWhatsApp } from '../../../../utils/phoneUtils';
import { formatDateToString } from '../../../../utils';
import { DEFAULT_WALKIN_TABLES } from '../../../../utils/tablesLayout';
import {
  calculateAvailableSlots,
  isValidReservationDate,
  clearAllTableAssignments,
  DEFAULT_HORARIOS
} from '../../../../shared/services/reservationService';
import CheckInService from '../../../../shared/services/CheckInService';
import { toggleTableBlock } from '../../../../shared/services/tableManagementService';
import InteractiveMapController from '../../../../shared/components/InteractiveMap/InteractiveMapController';
import CreateReservationModal from '../../../../shared/components/modals/CreateReservationModal';
import EditReservationModal from '../../../../shared/components/modals/EditReservationModal';
import { useTableStates } from '../../../../shared/hooks/useTableStates';
import { loadVenueBlocks, saveVenueBlocks } from '../../../../shared/services/supabaseReservationRepository';

import styles from './Reservas.module.css';

// Registrar locale español para el DatePicker
registerLocale('es', es);

const Reservas = ({ 
  reservations = [], 
  waitingList = [], 
  onUpdateReservation, 
  onDeleteReservation,
  formatDate, 
  HORARIOS = DEFAULT_HORARIOS, 
  showNotification,
  onCreateReservation,
  onConfirmWaitingReservation,
  onRejectWaitingReservation,
  onContactWaitingClient,
  onAdminWorkDateChange
}) => {
  // ============== ESTADOS PRINCIPALES ==============
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTurno, setSelectedTurno] = useState('mediodia');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const [checkInMode, setCheckInMode] = useState(false); // Modo check-in activo
  const [selectedReservationForCheckIn, setSelectedReservationForCheckIn] = useState(null);
  
  // 🆕 ESTADOS PARA ASIGNACIÓN MANUAL DE MESAS
  const [assignmentMode, setAssignmentMode] = useState(false); // Modo asignación activo
  const [selectedReservationForAssignment, setSelectedReservationForAssignment] = useState(null); // Reserva seleccionada para asignar
  const [walkinOverrideConfirmation, setWalkinOverrideConfirmation] = useState(null); // Confirmación para sobreescribir mesas walk-in
  
  const [tableManagementMode, setTableManagementMode] = useState(false); // Modo gestión de mesas
  const [reservationPopup, setReservationPopup] = useState(null); // Popup de información
  const [confirmation, setConfirmation] = useState(null); // Estado para modales de confirmación

  // 🆕 ESTADOS PARA BLOQUEO DE MESAS POR FECHA Y TURNO
  const [blockedTables, setBlockedTables] = useState(new Set()); // Mesas bloqueadas para la fecha/turno actual
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false); // Indicador de cambios sin guardar
  
  // Memoizar dependencias para evitar recálculos innecesarios
  const formattedDate = useMemo(() => formatDateToString(selectedDate), [selectedDate]);
  
  const loadBlockedTables = useCallback(async () => {
    try {
      const fechaString = formatDateToString(selectedDate);
      const nums = await loadVenueBlocks(fechaString, selectedTurno);
      const arr = nums?.length ? nums : [];
      setBlockedTables(arr.length ? new Set(arr) : new Set(DEFAULT_WALKIN_TABLES));
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('❌ Error al cargar configuración de mesas:', error);
      setBlockedTables(new Set(DEFAULT_WALKIN_TABLES));
    }
  }, [selectedDate, selectedTurno]);

  useEffect(() => {
    loadBlockedTables();
  }, [loadBlockedTables]);

  useEffect(() => {
    if (onAdminWorkDateChange) {
      onAdminWorkDateChange(formatDateToString(selectedDate));
    }
  }, [selectedDate, onAdminWorkDateChange]);

  const emptyOrders = useMemo(() => [], []); // Array vacío memoizado

  const { tableStates, occupiedTables, tableAssignments, findOccupantByTable } = useTableStates(
    reservations,
    emptyOrders,
    blockedTables,
    formattedDate,
    selectedTurno
  );

  // Función para obtener reservas del turno seleccionado
  const reservasTurnoSeleccionado = useMemo(() => {
    const fechaSeleccionada = formatDateToString(selectedDate);
    return reservations.filter(reserva => 
      reserva.fecha === fechaSeleccionada && reserva.turno === selectedTurno
    );
  }, [reservations, selectedDate, selectedTurno]);

  // Función para filtrar lista de espera
  const filteredWaitingList = useMemo(() => {
    if (!waitingList) return [];
    const fechaSeleccionada = formatDateToString(selectedDate);
    return waitingList.filter(
      (waiting) =>
        waiting.fecha === fechaSeleccionada &&
        waiting.turno === selectedTurno &&
        waiting.status !== 'rejected'
    );
  }, [waitingList, selectedDate, selectedTurno]);

  // ============== FUNCIONES BÁSICAS ==============

  // Función para crear nueva reserva UNIFICADA
  const handleCreateReservation = useCallback(async (reservationData) => {
    try {
      // ✅ USAR SERVICIO UNIFICADO con todos los datos necesarios
      const { createReservation } = await import('../../../../shared/services/reservationService');
      
      const result = await createReservation(reservationData, {
        isAdmin: true,
        getAvailableSlots: null,
        existingReservations: reservations,
        loadBlockedTables: null, // No usar loadBlockedTables por ahora
        existingOrders: [], // Sin pedidos en sistema de reservas
        manualBlocks: blockedTables // Usar bloqueos manuales actuales
      });

      if (result.success) {
        showNotification?.(`Reserva creada exitosamente${result.mesaAsignada ? ` - Mesa ${result.mesaAsignada}` : ''}`, 'success');
        
        // El servicio unificado ya persistió en Supabase; no duplicar onCreateReservation
      }

      return result;
    } catch (error) {
      console.error('Error al crear reserva:', error);
      showNotification?.(error.message || 'Error al crear la reserva', 'error');
      throw error;
    }
  }, [reservations, blockedTables, onCreateReservation, showNotification]);

  // Función para abrir modal de crear reserva
  const handleOpenCreateReservationModal = useCallback(() => {
    setIsCreateModalOpen(true);
  }, []);

  const hasCheckedIn = CheckInService.hasCheckedIn;

  const handleCheckInComplete = useCallback(
    async (reserva, mesaId) => {
      await CheckInService.performCheckIn(reserva, mesaId, showNotification);
      setCheckInMode(false);
      setSelectedReservationForCheckIn(null);
    },
    [showNotification]
  );

  // ============== FUNCIONES DE GESTIÓN DE RESERVAS ==============
  
  // Función para abrir popup de información de reserva (siempre centrado)
  const handleShowReservationPopup = useCallback((reserva) => {
    setReservationPopup({ reserva });
  }, []);

  // Función para cerrar popup de información de reserva
  const handleCloseReservationPopup = useCallback(() => {
    setReservationPopup(null);
  }, []);
  
  // Función para editar una reserva (desde popup)
  const handleEditReservation = useCallback((reserva) => {
    setEditingReservation(reserva);
    setReservationPopup(null); // Cerrar popup
  }, []);

  // Función para eliminar/cancelar una reserva
  const handleDeleteReservation = useCallback((reserva) => {
    setConfirmation({
      title: 'Cancelar Reserva',
      message: `¿Estás seguro de que quieres cancelar la reserva de ${reserva.cliente?.nombre}?`,
      onConfirm: async () => {
        try {
          const reservaData = reserva.reserva || reserva;

          if (!reservaData || !reservaData.id) {
            throw new Error('ID de reserva no encontrado');
          }

          await onDeleteReservation(reservaData.id);
          showNotification('Reserva cancelada correctamente', 'success');
          setReservationPopup(null); // Cerrar popup
        } catch (error) {
          console.error('Error al cancelar reserva:', error);
          showNotification('Error al cancelar la reserva', 'error');
        }
      },
      onCancel: () => setConfirmation(null)
    });
  }, [onDeleteReservation, showNotification]);

  // Función para contactar cliente por WhatsApp
  const handleContactClient = useCallback((reserva) => {
    if (reserva.cliente?.telefono) {
      const phoneNumber = formatPhoneForWhatsApp(reserva.cliente.telefono);
      const message = `Hola ${reserva.cliente.nombre}, te contactamos desde Rosaura sobre tu reserva para ${reserva.personas} personas el ${formatDate(new Date(reserva.fecha))} a las ${reserva.horario}.`;
      const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, '_blank');
      setReservationPopup(null); // Cerrar popup
    } else {
      showNotification('No hay número de teléfono disponible', 'warning');
    }
  }, [formatDate, showNotification]);

  // ============== FUNCIONES PARA LISTA DE RESERVAS ==============

  // Función para hacer click en una reserva de la lista
  const handleReservationCardClick = useCallback((reserva, event) => {
    event?.stopPropagation();
    
    // Si está en modo check-in, cambiar la reserva seleccionada
    if (checkInMode) {
      setSelectedReservationForCheckIn(prevSelected => 
        prevSelected?.id === reserva.id ? null : reserva
      );
      return;
    }
    
    // En modo normal, mostrar popup de información
    handleShowReservationPopup(reserva);
  }, [checkInMode, handleShowReservationPopup]);

  // Función para manejar click en botón de mesa
  const handleTableButtonClick = useCallback((reserva, event) => {
    event?.stopPropagation();
    
    if (hasCheckedIn(reserva)) {
      showNotification('No se puede cambiar la mesa después del check-in', 'warning');
      return;
    }
    
    // Activar/desactivar modo asignación de mesa
    if (assignmentMode && selectedReservationForAssignment?.id === reserva.id) {
      // Si ya está en modo asignación para esta reserva, cancelar
      setAssignmentMode(false);
      setSelectedReservationForAssignment(null);
      showNotification('Modo asignación de mesa cancelado', 'info');
    } else {
      // Activar modo asignación para esta reserva
      setAssignmentMode(true);
      setSelectedReservationForAssignment(reserva);
      setCheckInMode(false); // Desactivar check-in si estaba activo
      setTableManagementMode(false); // Desactivar gestión de mesas si estaba activo
      showNotification(`Selecciona una mesa libre para ${reserva.cliente?.nombre}`, 'info');
    }
  }, [hasCheckedIn, showNotification, assignmentMode, selectedReservationForAssignment]);

  // ============== FUNCIONES PARA LISTA DE ESPERA ==============

  // Función para obtener badge de estado de lista de espera
  const getWaitingStatusBadge = useCallback((waiting) => {
    const statusClasses = {
      pending: styles['status-pending'],
      contacted: styles['status-contacted'], 
      confirmed: styles['status-confirmed'],
      rejected: styles['status-rejected']
    };
    
    const statusLabels = {
      pending: 'Pendiente',
      contacted: 'Contactado',
      confirmed: 'Confirmado', 
      rejected: 'Rechazado'
    };
    
    return (
      <span className={`${styles.statusBadge} ${statusClasses[waiting.status] || statusClasses.pending}`}>
        {statusLabels[waiting.status] || 'Pendiente'}
      </span>
    );
  }, []);

  // Función para contactar cliente en lista de espera
  const handleContactWaitingClient = useCallback(
    async (waiting) => {
      if (waiting.cliente?.telefono) {
        const phoneNumber = formatPhoneForWhatsApp(waiting.cliente.telefono);
        const message = `Hola ${waiting.cliente.nombre}, te contactamos desde Rosaura. Tenemos disponibilidad para tu solicitud de reserva para ${waiting.personas} personas el ${waiting.fecha}.`;
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
        try {
          if (onContactWaitingClient) await onContactWaitingClient(waiting.id);
        } catch (e) {
          console.error(e);
        }
        showNotification(`Contactando a ${waiting.cliente.nombre}`, 'info');
      } else {
        showNotification('No hay número de teléfono disponible', 'warning');
      }
    },
    [showNotification, onContactWaitingClient]
  );

  const handleQuickConfirmWaiting = useCallback(
    (waiting) => {
      setConfirmation({
        title: 'Confirmar desde Lista de Espera',
        message: `¿Convertir la solicitud de ${waiting.cliente?.nombre} en una reserva confirmada?`,
        onConfirm: async () => {
          try {
            const slots = await getAvailableSlots(waiting.fecha, waiting.turno);
            const ok = slots.filter((s) => s.cuposDisponibles > 0);
            if (ok.length === 0) {
              showNotification('No hay cupos disponibles para ese turno', 'warning');
              return;
            }
            const horario = ok[0].horario;
            await onConfirmWaitingReservation(
              waiting.id,
              { ...waiting, horario },
              horario,
              blockedTables
            );
            showNotification('Reserva confirmada desde lista de espera', 'success');
          } catch (error) {
            console.error('Error al confirmar desde lista de espera:', error);
            showNotification(error.message || 'Error al procesar la confirmación', 'error');
          }
        },
        onCancel: () => setConfirmation(null)
      });
    },
    [getAvailableSlots, reservations, blockedTables, onConfirmWaitingReservation, showNotification]
  );

  const handleRejectWaiting = useCallback(
    (waiting) => {
      setConfirmation({
        title: 'Rechazar Solicitud',
        message: `¿Estás seguro de que quieres rechazar la solicitud de ${waiting.cliente?.nombre}?`,
        onConfirm: async () => {
          try {
            await onRejectWaitingReservation(waiting.id, '');
            showNotification('Solicitud rechazada', 'success');
          } catch (error) {
            console.error('Error al rechazar solicitud:', error);
            showNotification('Error al rechazar la solicitud', 'error');
          }
        },
        onCancel: () => setConfirmation(null)
      });
    },
    [onRejectWaitingReservation, showNotification]
  );

  // ============== FUNCIONES DE GESTIÓN DE MESAS ==============

  // Auto-asignación UNIFICADA usando el nuevo servicio
  const handleAutoAssign = useCallback(async () => {
    try {
      const { assignTableAutomatically, calculateRealTableStates } = await import(
        '../../../../shared/services/tableManagementService'
      );
      
    const fechaSeleccionada = formatDateToString(selectedDate);
      const reservasSinMesa = reservations.filter(r => 
        r.fecha === fechaSeleccionada && 
        r.turno === selectedTurno && 
        (!r.mesaAsignada || r.mesaAsignada === 'Sin asignar') &&
        r.estadoCheckIn !== 'confirmado'
      );

      if (reservasSinMesa.length === 0) {
        showNotification?.('No hay reservas pendientes de asignación', 'info');
        return;
      }

      let asignadas = 0;
      let noAsignadas = [];

      for (const reserva of reservasSinMesa) {
        const statesForReserva = calculateRealTableStates(
          reservations,
          emptyOrders,
          blockedTables,
          fechaSeleccionada,
          selectedTurno,
          new Set(),
          reserva
        );
        const mesaAsignada = assignTableAutomatically(reserva, statesForReserva);
        
        if (mesaAsignada) {
          await onUpdateReservation(reserva.id, { mesaAsignada }, true);
          asignadas++;
        } else {
          noAsignadas.push(reserva.cliente?.nombre || 'Sin nombre');
        }
      }

      // Mostrar resultado
      if (asignadas > 0) {
        showNotification?.(`${asignadas} reservas asignadas automáticamente`, 'success');
      }
      
      if (noAsignadas.length > 0) {
        showNotification?.(`${noAsignadas.length} reservas no pudieron asignarse: ${noAsignadas.join(', ')}`, 'warning');
      }

    } catch (error) {
      console.error('Error en autoasignación:', error);
      showNotification?.('Error al autoasignar reservas', 'error');
    }
  }, [reservations, selectedDate, selectedTurno, onUpdateReservation, showNotification]);

  const handleClearAssignments = useCallback(async () => {
    const fechaSeleccionada = formatDateToString(selectedDate);
    
    // Confirmación antes de limpiar
    if (window.confirm('¿Estás seguro de que quieres limpiar todas las asignaciones de mesa del turno actual?')) {
      await clearAllTableAssignments(
        reservations,
        fechaSeleccionada,
        selectedTurno,
        onUpdateReservation,
        showNotification
      );
    }
  }, [reservations, selectedDate, selectedTurno, onUpdateReservation, showNotification]);

  // Función para manejar cambios de bloqueo desde el mapa
  const handleToggleTableBlock = useCallback((tableId) => {
    if (tableManagementMode) {
      // 🆕 MODO GESTIÓN DE MESAS: Alternar entre disponible y solo-walkin
      const currentState = tableStates.get(tableId);
      
      if (!currentState) {
        showNotification?.('Estado de mesa no encontrado', 'error');
        return;
      }
      
      // Solo permitir cambios en mesas libres (sin reserva ni ocupadas)
      if (currentState.state === 'reserved' || currentState.state === 'occupied') {
        showNotification?.('No se puede cambiar el estado de una mesa ocupada o reservada', 'warning');
        return;
      }

      setBlockedTables(prev => {
        const newBlocks = new Set(prev);
        if (newBlocks.has(tableId)) newBlocks.delete(tableId);
        else newBlocks.add(tableId);
        return newBlocks;
      });
      setHasUnsavedChanges(true);
    } else {
      // 🔄 MODO NORMAL: Funcionalidad original de bloqueo/desbloqueo
      const result = toggleTableBlock(tableId, blockedTables, tableStates);
      
      if (result.success) {
        setBlockedTables(result.blocks);
        showNotification?.(result.message, 'info');
      } else {
        showNotification?.(result.message, 'warning');
      }
    }
  }, [blockedTables, tableStates, showNotification, tableManagementMode]);

  const handleSaveTableChanges = useCallback(async () => {
    try {
      const fechaString = formatDateToString(selectedDate);
      await saveVenueBlocks(fechaString, selectedTurno, Array.from(blockedTables));
      setHasUnsavedChanges(false);
      const formattedDateForDisplay = new Date(selectedDate).toLocaleDateString('es-AR');
      showNotification?.(`✅ Configuración de mesas para ${formattedDateForDisplay} - ${selectedTurno} guardada`, 'success');
    } catch (error) {
      console.error('❌ Error al guardar cambios de mesas:', error);
      showNotification?.('❌ Error al guardar en la base de datos', 'error');
    }
  }, [blockedTables, selectedDate, selectedTurno, showNotification]);

  // Cancelar cambios y recargar configuración
  const handleCancelTableChanges = useCallback(() => {
    loadBlockedTables();
    setHasUnsavedChanges(false);
    showNotification?.('Cambios cancelados', 'info');
  }, [loadBlockedTables, showNotification]);

  // 🆕 Función para activar/desactivar modo gestión de mesas
  const handleToggleTableManagement = useCallback(() => {
    const newMode = !tableManagementMode;
    
    if (!newMode && hasUnsavedChanges) {
      // Al salir del modo gestión con cambios pendientes, preguntar qué hacer
      const shouldSave = window.confirm('Tienes cambios sin guardar. ¿Quieres guardarlos antes de salir?');
      if (shouldSave) {
        handleSaveTableChanges();
      } else {
        handleCancelTableChanges();
      }
    }
    
    setTableManagementMode(newMode);

    if (newMode) {
      const formattedDateForDisplay = new Date(selectedDate).toLocaleDateString('es-AR');
      showNotification?.(`🎯 Modo Gestión Activado para ${formattedDateForDisplay} - ${selectedTurno} - Click en mesas para cambiar estados`, 'info');
    } else {
      showNotification?.('👁️ Modo Vista Activado', 'info');
    }
  }, [tableManagementMode, hasUnsavedChanges, handleSaveTableChanges, handleCancelTableChanges, selectedDate, selectedTurno, showNotification]);

  // ============== FUNCIÓN DE ASIGNACIÓN MANUAL DE MESA ==============
  
  const handleAssignTable = useCallback(async (tableId) => {
    if (!selectedReservationForAssignment) return;
    
    const tableState = tableStates.get(tableId);
    if (!tableState) {
      showNotification('Estado de mesa no encontrado', 'error');
      return;
    }
    
    // Verificar si la mesa ya está ocupada o reservada
    if (tableState.state === 'occupied') {
      showNotification('Esta mesa está ocupada y no puede ser asignada', 'warning');
      return;
    }
    
    if (tableState.state === 'reserved') {
      showNotification('Esta mesa ya tiene una reserva asignada', 'warning');
      return;
    }
    
    // Si la mesa está completamente bloqueada
    if (tableState.state === 'blocked') {
      showNotification('Esta mesa está bloqueada y no puede ser asignada', 'warning');
      return;
    }
    
    // Función para realizar la asignación
    const performAssignment = async () => {
      try {
        await onUpdateReservation(selectedReservationForAssignment.id, { 
          mesaAsignada: tableId.toString() 
        }, true);
        
        showNotification(`Mesa ${tableId} asignada a ${selectedReservationForAssignment.cliente?.nombre}`, 'success');
        
        // Desactivar modo asignación
        setAssignmentMode(false);
        setSelectedReservationForAssignment(null);
      } catch (error) {
        console.error('Error al asignar mesa:', error);
        showNotification('Error al asignar la mesa', 'error');
      }
    };
    
    // Si la mesa está disponible completamente, asignar directamente
    if (tableState.state === 'available') {
      await performAssignment();
      return;
    }
    
    // Si la mesa es solo para walk-in, mostrar confirmación
    if (tableState.state === 'available-walkin') {
      setWalkinOverrideConfirmation({
        tableId,
        reserva: selectedReservationForAssignment,
        onConfirm: async () => {
          await performAssignment();
          setWalkinOverrideConfirmation(null);
        },
        onCancel: () => {
          setWalkinOverrideConfirmation(null);
        }
      });
    }
  }, [selectedReservationForAssignment, tableStates, onUpdateReservation, showNotification]);

  // Función para manejar click en mesa
  const handleTableClick = useCallback(async (tableId, tableInfo) => {
    if (checkInMode && selectedReservationForCheckIn) {
      try {
        await handleCheckInComplete(selectedReservationForCheckIn, tableId);
      } catch {
        /* notificación en servicio */
      }
      return;
    } else if (assignmentMode && selectedReservationForAssignment) {
      // Modo asignación de mesa
      handleAssignTable(tableId, tableInfo);
    } else {
      // Modo normal - verificar si la mesa tiene una reserva usando el estado unificado
      if (tableInfo && tableInfo.type === 'reservation') {
        // Mesa tiene reserva - mostrar popup de información
        // Reconstruir objeto de reserva desde tableInfo
        const reservaFromTable = {
          id: tableInfo.details?.reservationId,
          cliente: {
            nombre: tableInfo.details?.clientName,
            telefono: tableInfo.details?.phone,
            comentarios: tableInfo.details?.comments
          },
          personas: tableInfo.details?.people,
          horario: tableInfo.details?.time,
          fecha: tableInfo.details?.date || formattedDate,
          turno: tableInfo.details?.turno || selectedTurno,
          mesaAsignada: tableInfo.details?.mesaAsignada,
          mesaReal: tableInfo.details?.mesaReal,
          estadoCheckIn: tableInfo.details?.checkInStatus,
          horaLlegada: tableInfo.details?.horaLlegada
        };
        
        handleShowReservationPopup(reservaFromTable);
      }
    }
  }, [
    checkInMode,
    selectedReservationForCheckIn,
    assignmentMode,
    selectedReservationForAssignment,
    handleCheckInComplete,
    handleAssignTable,
    showNotification,
    tableStates,
    handleShowReservationPopup,
    formattedDate,
    selectedTurno
  ]);

  // ============== FUNCIONES AUXILIARES ==============

  // Función unificada para obtener slots disponibles
  const getAvailableSlots = useCallback(async (fecha, turno) => {
    return await calculateAvailableSlots(
      fecha, 
      turno, 
      null, // Sin restricción de personas específica
      null, // Sin exclusión de reserva
      reservations,
      null, // No usar mesas bloqueadas por ahora
      true // Admin mode
    );
  }, [reservations]);

  const isValidDate = useCallback((date) => {
    const dateString = typeof date === 'string' ? date : formatDateToString(date);
    return isValidReservationDate(dateString, 'mediodia', true); // Admin mode
  }, []);

  // Función para navegar entre fechas
  const goToPreviousDay = useCallback(() => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  }, [selectedDate]);

  const goToNextDay = useCallback(() => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  }, [selectedDate]);

  return (
    <div className={styles.todayContainer}>
      {/* Header */}
      <div className={styles.todayHeader}>
        <div className={styles.todayHeaderContent}>
          <div className={styles.todayTopRow}>
            {/* Navegación de fechas */}
            <div className={styles.todayDateControls}>
              <button
                onClick={goToPreviousDay}
                className={styles.navButton}
                title="Día anterior"
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className={styles.datePickerContainer}>
                <DatePicker
                  selected={selectedDate}
                  onChange={setSelectedDate}
                  dateFormat="dd/MM/yyyy"
                  locale="es"
                  className={styles.datePicker}
                  calendarStartDay={1}
                />
              </div>
              
              <button
                onClick={goToNextDay}
                className={styles.navButton}
                title="Día siguiente"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Selector de turno */}
            <div className={styles.todayTurnoSelector}>
              <button
                className={`${styles.turnoButton} ${selectedTurno === 'mediodia' ? styles.turnoButtonActive : ''}`}
                onClick={() => setSelectedTurno('mediodia')}
              >
                <Sun size={16} />
                Mediodía
              </button>
              <button
                className={`${styles.turnoButton} ${selectedTurno === 'noche' ? styles.turnoButtonActive : ''}`}
                onClick={() => setSelectedTurno('noche')}
              >
                <Moon size={16} />
                Noche
              </button>
            </div>

            {/* Indicador visual del modo asignación activo */}
            {assignmentMode && selectedReservationForAssignment && (
              <div className={styles.assignmentModeIndicator}>
                <div className={styles.assignmentModeIcon}>
                  <Users size={16} />
                </div>
                <span>
                  Asignando mesa a: <strong>{selectedReservationForAssignment.cliente?.nombre}</strong> ({selectedReservationForAssignment.personas} personas)
                </span>
                <button 
                  onClick={() => {
                    setAssignmentMode(false);
                    setSelectedReservationForAssignment(null);
                    showNotification('Modo asignación cancelado', 'info');
                  }}
                  className={styles.assignmentCancelButton}
                  title="Cancelar asignación de mesa"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Botón para nueva reserva */}
            <button
              onClick={handleOpenCreateReservationModal}
              className={styles.primaryButton}
              title="Crear nueva reserva"
            >
              <Plus size={16} />
              Nueva Reserva
            </button>

            {/* Botones de gestión de mesas */}
            <div className={styles.actionButtonsGroup}>
              <button
                onClick={handleAutoAssign}
                className={styles.secondaryButton}
                title="Autoasignar mesas a reservas pendientes"
              >
                <Zap size={16} />
                Autoasignar
              </button>
              
              <button
                onClick={handleToggleTableManagement}
                className={`${styles.secondaryButton} ${tableManagementMode ? styles.activeModeButton : ''}`}
                title={tableManagementMode ? "Salir del modo gestión de mesas" : "Activar modo gestión de mesas"}
              >
                <UserCheck size={16} />
                {tableManagementMode ? 'Salir Gestión' : 'Gestionar Mesas'}
              </button>
              
              <button
                onClick={handleClearAssignments}
                className={styles.secondaryButton}
                title="Limpiar todas las asignaciones de mesa"
              >
                <X size={16} />
                Limpiar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Indicador visual del modo gestión activo */}
      {tableManagementMode && (
        <div className={styles.contextualHelpBar}>
          <span className={styles.helpIcon}>🎯</span>
          <span className={styles.helpMessage}>
            <strong>Modo Gestión de Mesas Activo:</strong> Click en mesas libres para alternar entre "Disponible para reservas" y "Solo walk-in"
            {hasUnsavedChanges && (
              <span className={styles.unsavedIndicator}> • Cambios pendientes</span>
            )}
          </span>
          <div className={styles.helpActions}>
            {hasUnsavedChanges && (
              <>
                <button 
                  className={styles.helpSaveButton}
                  onClick={handleSaveTableChanges}
                  title="Guardar cambios en base de datos"
                >
                  <Save size={14} />
                  Guardar
                </button>
                <button 
                  className={styles.helpCancelChangesButton}
                  onClick={handleCancelTableChanges}
                  title="Cancelar cambios"
                >
                  <RotateCcw size={14} />
                  Cancelar
                </button>
              </>
            )}
            <button 
              className={styles.helpCancelButton}
              onClick={handleToggleTableManagement}
            >
              <X size={14} />
              Salir
            </button>
          </div>
        </div>
      )}

      {/* Contenido principal */}
      <div className={styles.todayContent}>
        {/* Mapa interactivo */}
        <div className={styles.todayMap}>
          <InteractiveMapController
            reservas={reservasTurnoSeleccionado}
            orders={[]} // Sin pedidos en sistema de reservas
            blockedTables={blockedTables}
            tableStates={tableStates} // ✅ NUEVO: Estados unificados
            tableAssignments={tableAssignments}
            occupiedTables={occupiedTables}
            mode={checkInMode ? 'checkin' : (assignmentMode ? 'assignment' : (tableManagementMode ? 'table-management' : 'view'))}
            onTableClick={handleTableClick}
            onToggleTableBlock={handleToggleTableBlock}
            findOccupantByTable={findOccupantByTable}
            selectedReservationId={editingReservation?.id}
            reservationPopup={reservationPopup}
            setReservationPopup={setReservationPopup}
            onEditReservation={handleEditReservation}
            onDeleteReservation={handleDeleteReservation}
            onContactClient={handleContactClient}
            showNotification={showNotification}
            tableManagementMode={tableManagementMode} // 🆕 Pasar estado del modo
            assignmentMode={assignmentMode} // 🆕 Pasar modo de asignación
            selectedReservationForAssignment={selectedReservationForAssignment} // 🆕 Reserva seleccionada para asignar
          />
        </div>

        {/* Panel lateral con reservas */}
        <div className={styles.todayPanel}>
          {/* Lista de reservas del turno seleccionado */}
          <div className={styles.todayReservationsList}>
            <ReservationsList
              reservasTurnoSeleccionado={reservasTurnoSeleccionado}
              selectedReservation={null}
              checkInMode={checkInMode}
              selectedReservationForCheckIn={selectedReservationForCheckIn}
              hasCheckedIn={hasCheckedIn}
              handleReservationCardClick={handleReservationCardClick}
              handleOpenCheckIn={(reserva) => {
                setSelectedReservationForCheckIn(reserva);
                setCheckInMode(true);
              }}
              handleTableButtonClick={handleTableButtonClick}
              getAssignmentButtonText={(reserva) => {
                if (assignmentMode && selectedReservationForAssignment?.id === reserva.id) {
                  return 'Cancelar asignación';
                }
                return reserva.mesaAsignada ? `Mesa ${reserva.mesaAsignada}` : 'Asignar Mesa';
              }}
              getAssignmentButtonClass={(reserva) => {
                if (assignmentMode && selectedReservationForAssignment?.id === reserva.id) {
                  return `${styles.tableButton} ${styles.tableButtonActive}`;
                }
                return reserva.mesaAsignada ? `${styles.tableButton} ${styles.tableButtonAssigned}` : `${styles.tableButton} ${styles.tableButtonUnassigned}`;
              }}
              getUnassignmentButtonClass={() => styles.tableButton}
            />
          </div>

          {/* Lista de espera */}
          <div className={styles.todayWaitingList}>
            <WaitingListSection
              filteredWaitingList={filteredWaitingList}
              getWaitingStatusBadge={getWaitingStatusBadge}
              handleContactWaitingClient={handleContactWaitingClient}
              handleQuickConfirmWaiting={handleQuickConfirmWaiting}
              handleRejectWaiting={handleRejectWaiting}
            />
          </div>
        </div>
      </div>

      {/* Modales */}
      
      {/* Popup profesional de información de reserva */}
      {reservationPopup && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={handleCloseReservationPopup}
        >
          <div 
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              minWidth: '400px',
              maxWidth: '500px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
              border: '1px solid #e1e5e9'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '16px',
              borderBottom: '1px solid #e1e5e9',
              marginBottom: '20px'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#2c3e50'
              }}>
                Reserva - {reservationPopup.reserva.cliente?.nombre}
              </h3>
              <button 
                onClick={handleCloseReservationPopup}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#7f8c8d',
                  padding: '4px'
                }}
              >
                ×
              </button>
            </div>
            
            {/* Detalles */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#7f8c8d' }}>Horario:</span>
                  <span style={{ fontWeight: '500' }}>{reservationPopup.reserva.horario}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#7f8c8d' }}>Personas:</span>
                  <span style={{ fontWeight: '500' }}>{reservationPopup.reserva.personas}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#7f8c8d' }}>Fecha:</span>
                  <span style={{ fontWeight: '500' }}>{formatDate(new Date(reservationPopup.reserva.fecha))}</span>
                </div>
                {reservationPopup.reserva.mesaAsignada && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#7f8c8d' }}>Mesa:</span>
                    <span style={{ fontWeight: '500' }}>{reservationPopup.reserva.mesaAsignada}</span>
                  </div>
                )}
                {reservationPopup.reserva.cliente?.telefono && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#7f8c8d' }}>Teléfono:</span>
                    <span style={{ fontWeight: '500' }}>{reservationPopup.reserva.cliente.telefono}</span>
                  </div>
                )}
                {reservationPopup.reserva.cliente?.comentarios && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ color: '#7f8c8d' }}>Comentarios:</span>
                    <span style={{ fontWeight: '500', textAlign: 'right', maxWidth: '200px' }}>
                      {reservationPopup.reserva.cliente.comentarios}
                    </span>
                  </div>
                )}
                {hasCheckedIn(reservationPopup.reserva) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#7f8c8d' }}>Estado:</span>
                    <span style={{ fontWeight: '500', color: '#27ae60' }}>Cliente llegó</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Acciones */}
            <div style={{ 
              display: 'flex', 
              gap: '8px',
              justifyContent: 'flex-end',
              paddingTop: '16px',
              borderTop: '1px solid #e1e5e9'
            }}>
              <button 
                onClick={() => handleEditReservation(reservationPopup.reserva)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Editar
              </button>
              
              {reservationPopup.reserva.cliente?.telefono && (
                <button 
                  onClick={() => handleContactClient(reservationPopup.reserva)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#27ae60',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  WhatsApp
                </button>
              )}
              
              <button 
                onClick={() => handleDeleteReservation(reservationPopup.reserva)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmation && (
        <div className={styles.confirmationOverlay}>
          <div className={styles.confirmationModal}>
            <div className={styles.confirmationHeader}>
              <div className={styles.confirmationIcon}>
                <AlertTriangle size={24} style={{ color: '#f59e0b' }} />
              </div>
              <div className={styles.confirmationContent}>
                <h3 className={styles.confirmationTitle}>{confirmation.title}</h3>
                <p className={styles.confirmationMessage}>{confirmation.message}</p>
              </div>
            </div>
            <div className={styles.confirmationActions}>
              <button 
                onClick={() => {
                  if (confirmation.onCancel) confirmation.onCancel();
                  setConfirmation(null);
                }}
                className={styles.confirmationButtonCancel}
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  if (confirmation.onConfirm) confirmation.onConfirm();
                  setConfirmation(null);
                }}
                className={styles.confirmationButton}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación para sobreescribir mesa walk-in */}
      {walkinOverrideConfirmation && (
        <div className={styles.confirmationOverlay}>
          <div className={styles.confirmationModal}>
            <div className={styles.confirmationHeader}>
              <div className={styles.confirmationIcon}>
                <AlertTriangle size={24} style={{ color: '#f59e0b' }} />
              </div>
              <div className={styles.confirmationContent}>
                <h3 className={styles.confirmationTitle}>Sobreescribir Estado de Mesa</h3>
                <p className={styles.confirmationMessage}>
                  La mesa {walkinOverrideConfirmation.tableId} está configurada solo para walk-ins. 
                  ¿Deseas asignarla a la reserva de {walkinOverrideConfirmation.reserva.cliente?.nombre} y cambiar su estado a "reservada"?
                </p>
              </div>
            </div>
            <div className={styles.confirmationActions}>
              <button 
                onClick={() => {
                  if (walkinOverrideConfirmation.onCancel) walkinOverrideConfirmation.onCancel();
                  setWalkinOverrideConfirmation(null);
                }}
                className={styles.confirmationButtonCancel}
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  if (walkinOverrideConfirmation.onConfirm) walkinOverrideConfirmation.onConfirm();
                  setWalkinOverrideConfirmation(null);
                }}
                className={styles.confirmationButton}
              >
                Sí, asignar mesa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para crear nueva reserva */}
      {isCreateModalOpen && (
        <CreateReservationModal
          onClose={() => setIsCreateModalOpen(false)}
          onSave={handleCreateReservation}
          getAvailableSlots={getAvailableSlots}
          isValidDate={isValidDate}
          HORARIOS={HORARIOS}
          showNotification={showNotification}
          isAdmin={true}
        />
      )}

      {/* Modal para editar reserva */}
      {editingReservation && (
        <EditReservationModal
          reservation={editingReservation}
          onClose={() => setEditingReservation(null)}
          onSave={async (updatedData) => {
            await onUpdateReservation(editingReservation.id, updatedData, true);
            setEditingReservation(null);
          }}
          getAvailableSlotsForEdit={getAvailableSlots}
          isValidDate={isValidDate}
          HORARIOS={HORARIOS}
          showNotification={showNotification}
          isAdmin={true}
        />
      )}
    </div>
  );
};

export default Reservas; 