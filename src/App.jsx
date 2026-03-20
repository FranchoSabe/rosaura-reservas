import React, { useState, useEffect, useCallback } from 'react';
import { ClientView } from './apps/client/pages/ClientView/ClientView';
import { LoginView } from './apps/client/pages/Login/LoginView';
import AppRouter from './router/AppRouter';
import { NotificationContainer, ConfirmationModal } from './shared/components/ui';
import { 
  updateClientBlacklist, 
  updateClientNotes,
  subscribeToClients,
  auth 
} from './firebase';
import {
  subscribeToReservationsByDate,
  subscribeToWaitingReservationsByDate,
  updateReservation,
  deleteReservation,
  searchReservation,
  cancelReservationPublic,
  confirmWaitingReservation,
  deleteWaitingReservation,
  markWaitingAsNotified,
  contactWaitingClient,
  rejectWaitingReservation,
  saveTableBlocksForDateTurno,
  loadTableBlocksForDateTurno
} from './shared/data/reservationsDataLayer';
import {
  ensureSupabaseStaffSession,
  signOutSupabaseAuth,
  fetchTenantReservationConfigMap,
  fetchReservationScheduleForDateTurn,
  fetchPilotTenantClientSettings
} from './shared/services/supabaseReservationRepository';
import { CLIENT_CANCEL_MIN_HOURS_BEFORE_START } from './shared/constants/clientReservation';
import { slotsFromConfigRow } from './shared/services/reservationTimeWindows';
import { assignTableToNewReservation } from './shared/services/tableManagementService';
import { DEFAULT_WALKIN_TABLES } from './utils/tablesLayout';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { formatDateToString } from './utils';
import { validateOnlineReservation, getReservationLimitsInfo, generateWhatsAppMessage } from './utils/timeValidation';
import { isTurnoClosed } from './shared/constants/operatingDays';
import { calculateAvailableSlots, isValidReservationDate } from './shared/services/reservationService';
import { createReservation } from './shared/services/reservationService';

// --- CONFIGURACIÓN Y DATOS ---
const LOGO_URL = null; // Usamos texto con tipografía Daniel en lugar de imagen
const BACKGROUND_IMAGE_URL = '/fondo.jpg';
const FALLBACK_HORARIOS = {
    mediodia: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00'],
    noche: ['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30']
};

function App() {
  const [authState, setAuthState] = useState(null);
  const [data, setData] = useState({ reservas: [], clientes: [], waitingList: [] });
  const [adminWorkDate, setAdminWorkDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [HORARIOS, setHORARIOS] = useState(FALLBACK_HORARIOS);
  const [currentScreen, setCurrentScreen] = useState('landing');
  const [reservaData, setReservaData] = useState({
    fecha: '',
    personas: 0,
    turno: '',
    horario: '',
    cliente: { nombre: '', telefono: '', comentarios: '', email: '' }
  });
  const [bookingPlanningSubmitted, setBookingPlanningSubmitted] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [showWaitingListModal, setShowWaitingListModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Estados para notificaciones y confirmaciones (migrados desde AdminView)
  const [notifications, setNotifications] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const [editingReservation, setEditingReservation] = useState(null);
  const [clientCancelMinHoursBeforeStart, setClientCancelMinHoursBeforeStart] = useState(
    CLIENT_CANCEL_MIN_HOURS_BEFORE_START
  );

  useEffect(() => {
    fetchTenantReservationConfigMap()
      .then((m) => {
        const md = m.mediodia ? slotsFromConfigRow(m.mediodia) : [];
        const nc = m.noche ? slotsFromConfigRow(m.noche) : [];
        setHORARIOS({
          mediodia: md.length ? md : FALLBACK_HORARIOS.mediodia,
          noche: nc.length ? nc : FALLBACK_HORARIOS.noche
        });
      })
      .catch(() => {});
    fetchPilotTenantClientSettings()
      .then((s) => {
        if (s?.clientCancelMinHoursBeforeStart != null) {
          setClientCancelMinHoursBeforeStart(s.clientCancelMinHoursBeforeStart);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribeReservations = subscribeToReservationsByDate((reservas) => {
      setData((prev) => ({ ...prev, reservas }));
    }, adminWorkDate);

    const unsubscribeWaitingList = subscribeToWaitingReservationsByDate((waitingList) => {
      setData((prev) => ({ ...prev, waitingList }));
    }, adminWorkDate);

    const unsubscribeClients = subscribeToClients((clientes) => {
      setData((prev) => ({ ...prev, clientes }));
    });

    return () => {
      unsubscribeReservations();
      unsubscribeWaitingList();
      unsubscribeClients();
    };
  }, [adminWorkDate]);

  // 🔔 SISTEMA DE NOTIFICACIONES MEJORADO
  // Categorías de notificaciones con diferentes comportamientos
  const NOTIFICATION_CATEGORIES = {
    CRITICAL: 'critical',    // Errores críticos - siempre mostrar
    IMPORTANT: 'important',  // Acciones importantes - mostrar
    ROUTINE: 'routine',      // Acciones rutinarias - mostrar menos
    DEBUG: 'debug'           // Información de debug - no mostrar en producción
  };

  // Configuración de notificaciones por tipo
  const getNotificationConfig = (message) => {
    // Notificaciones críticas (siempre mostrar)
    if (message.includes('Error') || message.includes('error')) {
      return { category: NOTIFICATION_CATEGORIES.CRITICAL, duration: 6000, priority: 'high' };
    }
    
    // Notificaciones importantes (mostrar)
    if (message.includes('cerrada') || message.includes('cobrar') || message.includes('descuento') || message.includes('cancelado')) {
      return { category: NOTIFICATION_CATEGORIES.IMPORTANT, duration: 4000, priority: 'medium' };
    }
    
    // Notificaciones rutinarias (mostrar menos tiempo)
    if (message.includes('enviado a cocina') || message.includes('entregado') || message.includes('Estado actualizado')) {
      return { category: NOTIFICATION_CATEGORIES.ROUTINE, duration: 2000, priority: 'low' };
    }
    
    // Notificaciones de debug (no mostrar en operación normal)
    if (message.includes('Recargados') || message.includes('inicializado') || message.includes('reiniciado')) {
      return { category: NOTIFICATION_CATEGORIES.DEBUG, duration: 1000, priority: 'low' };
    }
    
    return { category: NOTIFICATION_CATEGORIES.ROUTINE, duration: 3000, priority: 'medium' };
  };

  const showNotification = useCallback((message, type = 'info') => {
    const config = getNotificationConfig(message);
    
    // No mostrar notificaciones de debug en operación normal
    if (config.category === NOTIFICATION_CATEGORIES.DEBUG) {
      console.log(`[DEBUG] ${message}`);
      return;
    }
    
    // Limitar notificaciones rutinarias (máximo 3 simultáneas)
    if (config.category === NOTIFICATION_CATEGORIES.ROUTINE) {
      setNotifications(prev => {
        const routineCount = prev.filter(n => n.category === NOTIFICATION_CATEGORIES.ROUTINE).length;
        if (routineCount >= 2) {
          return prev; // No agregar más notificaciones rutinarias
        }
        return prev;
      });
    }
    
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const notification = { 
      id, 
      type, 
      message, 
      category: config.category,
      priority: config.priority
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove con duración variable según importancia
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, config.duration);
  }, []);

  const closeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Función para mostrar confirmaciones (migrada desde AdminView)
  const showConfirmationDialog = useCallback((config) => {
    return new Promise((resolve) => {
      setConfirmation({
        ...config,
        resolve
      });
    });
  }, []);

  const handleConfirmation = useCallback((result) => {
    if (confirmation?.resolve) {
      confirmation.resolve(result);
    }
    setConfirmation(null);
  }, [confirmation]);

  const getAvailableSlots = async (fecha, turno) => {
    const fechaObj = new Date(fecha + "T00:00:00");
    const dayOfWeek = fechaObj.getDay();
    
    // Usar nueva función unificada para verificar si está cerrado
    if (isTurnoClosed(dayOfWeek, turno)) {
      return []; // Día/turno cerrado según configuración
    }
    
    // Filtrar reservas por fecha y turno
    const reservasDelDia = data.reservas.filter(
      r => r.fecha === fecha && r.turno === turno
    );
    
    // Calcular ocupación por horario
    const ocupacionPorHorario = {};
    reservasDelDia.forEach(reserva => {
      const horario = reserva.horario;
      if (!ocupacionPorHorario[horario]) {
        ocupacionPorHorario[horario] = 0;
      }
      ocupacionPorHorario[horario] += reserva.personas || 1;
    });
    
    // Generar slots con cupos disponibles (formato requerido por CreateReservationModal)
    return HORARIOS[turno].map(horario => ({
      horario,
      cuposDisponibles: Math.max(0, 30 - (ocupacionPorHorario[horario] || 0)) // 30 personas máximo por horario
    }));
  };

  // FUNCIÓN SIMPLIFICADA: Usar lógica unificada
  const getAvailableSlotsDynamicSimplified = async (fecha, turno, personasOverride) => {
    return await calculateAvailableSlots(
      fecha,
      turno,
      personasOverride ?? reservaData?.personas ?? null,
      null,
      data.reservas,
      handleLoadBlockedTables,
      false,
      true
    );
  };

  const resetClientBookingFlow = () => {
    setBookingPlanningSubmitted(false);
    setAvailableSlots([]);
    setReservaData({
      fecha: '',
      personas: 0,
      turno: '',
      horario: '',
      cliente: { nombre: '', telefono: '', comentarios: '', email: '' }
    });
  };

  const getAvailableSlotsForEdit = async (fecha, turno, personas, excludeReservationId) => {
    return await calculateAvailableSlots(
      fecha,
      turno,
      personas,
      excludeReservationId,
      data.reservas,
      handleLoadBlockedTables,
      true // Admin mode para edición
    );
  };

  const isValidDate = (fecha, turno = null, adminOverride = false) => {
    return isValidReservationDate(fecha, turno || 'mediodia', adminOverride);
  };

  const handleLogin = async (username, password) => {
    try {
      let email;
      let role;

      // Determinar el rol basado en el nombre de usuario
      if (username === 'admin') {
        email = import.meta.env.VITE_ADMIN_EMAIL;
        role = 'admin';
      } else if (username === 'mozo') {
        email = import.meta.env.VITE_MOZO_EMAIL;
        role = 'mozo';
      } else {
        return "Usuario no válido";
      }

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      void userCredential.user;

      const supa = await ensureSupabaseStaffSession();
      if (!supa.ok && import.meta.env.DEV) {
        console.warn(
          '[Supabase] Sesión staff no iniciada:',
          supa.error,
          'Configurá VITE_SUPABASE_STAFF_EMAIL / VITE_SUPABASE_STAFF_PASSWORD'
        );
      }

      setAuthState({ user: username, role });
      return null; // Login exitoso
    } catch (error) {
      console.error("Error de login:", error);
      return "Usuario o contraseña incorrectos";
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      await signOutSupabaseAuth();
      setAuthState(null);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  const handleSetBlacklist = async (clienteId, newStatus) => {
    try {
      await updateClientBlacklist(clienteId, newStatus);
    } catch (error) {
      console.error("Error al actualizar lista negra:", error);
      alert("Error al actualizar el estado del cliente");
    }
  };

  const handleUpdateClientNotes = async (clienteId, notes) => {
    try {
      await updateClientNotes(clienteId, notes);
      return true;
    } catch (error) {
      console.error("Error al actualizar notas del cliente:", error);
      throw error;
    }
  };

  const handleDateAndTurnoSubmit = async () => {
    // Convertir fecha a string si es necesario
    const fechaString = formatDateToString(reservaData.fecha);
      
    if (!isValidDate(fechaString)) {
      alert('Por favor selecciona una fecha válida (desde hoy hasta 1 mes en el futuro).');
      return;
    }
    if (!reservaData.turno) {
      alert('Por favor, seleccioná un turno.');
      return;
    }
    
    // 🆕 VALIDACIÓN DE TURNO COMPLETA - Verificar si se puede reservar online
    const validation = validateOnlineReservation(fechaString, reservaData.turno);
    
    if (!validation.isValid) {
      if (validation.needsWhatsApp) {
        // Mostrar popup para ofrecer WhatsApp
        const shouldUseWhatsApp = window.confirm(
          `${validation.error}\n\n${validation.suggestion}\n\n¿Quieres contactarnos por WhatsApp para hacer la reserva?`
        );
        
        if (shouldUseWhatsApp) {
          const message = generateWhatsAppMessage(
            fechaString, 
            reservaData.turno, 
            reservaData.personas,
            reservaData.cliente?.nombre || ''
          );
          const encodedMessage = encodeURIComponent(message);
          window.open(`https://wa.me/5492213995351?text=${encodedMessage}`, '_blank');
        }
        return;
      } else {
        alert(validation.error);
        return;
      }
    }
    
    // Si llegamos aquí, el turno está disponible para reserva online
    // Usar el sistema dinámico de cupos que respeta los bloqueos
    const slots = await getAvailableSlotsDynamicSimplified(fechaString, reservaData.turno);
    
    // Si no hay slots disponibles, ir directamente a recopilar datos para lista de espera
    if (slots.length === 0) {
      setReservaData(prev => ({
        ...prev,
        fecha: fechaString,
        willGoToWaitingList: true
      }));
      setBookingPlanningSubmitted(true);
      setCurrentScreen('reserva-flow');
      return;
    }
    
    // Guardar información de límites para mostrar en UI
    const limitsInfo = getReservationLimitsInfo();
    setReservaData(prev => ({
      ...prev,
      fecha: fechaString,
      limitsInfo
    }));
    
    setAvailableSlots(slots);
    setBookingPlanningSubmitted(true);
    setCurrentScreen('reserva-flow');
  };

  const handleHorarioSelect = (selectedHorario) => {
    setReservaData(prev => ({ ...prev, horario: selectedHorario }));
  };

  const handleContactoSubmit = async () => {
    // Prevenir envíos duplicados
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    try {
      console.log('🔄 Creando reserva desde cliente con servicio unificado:', reservaData);
      
      const fechaString = formatDateToString(reservaData.fecha);
      const existingForDay = await fetchReservationScheduleForDateTurn(
        fechaString,
        reservaData.turno
      );

      const result = await createReservation({
        reservationData: reservaData,
        existingReservations: existingForDay,
        getAvailableSlots: getAvailableSlotsDynamicSimplified,
        loadBlockedTables: handleLoadBlockedTables,
        isAdmin: false
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      console.log('✅ Resultado de creación:', result);

      // Manejar resultado según el tipo
      if (result.type === 'waiting') {
        // Lista de espera
        setReservaData({
          ...reservaData,
          ...result.data
        });
        setShowWaitingListModal(true);
        setCurrentScreen('lista-espera');
      } else {
        // Reserva confirmada
        setReservaData({
          ...reservaData,
          ...result.data
        });
        setShowReservationModal(true);
        setCurrentScreen('confirmacion');
      }

    } catch (error) {
      console.error("❌ Error al crear reserva:", error);
      alert("Error al crear la reserva. Por favor, intenta nuevamente.");
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const formatDate = (dateInput) => {
    if (!dateInput) return '';
    
    let date;
    if (dateInput instanceof Date) {
      // Si ya es un objeto Date, usarlo directamente
      date = dateInput;
    } else {
      // Si es un string, convertirlo a Date
      date = new Date(dateInput + "T00:00:00");
    }
    
    return date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Función específica para crear reservas desde el panel de admin usando el servicio unificado
  const handleSaveReservation = async (reservationData) => {
    try {
      console.log('🔄 Creando reserva desde admin con servicio unificado:', reservationData);
      
      const f = formatDateToString(reservationData.fecha);
      const existingReservations = data.reservas.filter(
        (r) => r.fecha === f && r.turno === reservationData.turno
      );

      const result = await createReservation({
        reservationData,
        existingReservations,
        getAvailableSlots,
        loadBlockedTables: handleLoadBlockedTables,
        isAdmin: true
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      console.log('✅ Reserva admin creada exitosamente:', result.data);
      
      // ✅ NO actualizar estado manual - la suscripción en tiempo real lo hará automáticamente
      // Esto evita duplicados en la lista de reservas
      
      return result.data;
    } catch (error) {
      console.error('❌ Error al crear reserva desde admin:', error);
      throw error;
    }
  };

  const handleUpdateReservation = async (reservationId, updatedData, adminOverride = false) => {
    try {
      // Si es actualización de solo mesaAsignada (admin), buscar la reserva original y combinar datos
      let fullData = updatedData;
      const original = data.reservas.find(r => r.id === reservationId);
      if (!original) throw new Error('Reserva original no encontrada');
      
      if (adminOverride && Object.keys(updatedData).length === 1 && updatedData.mesaAsignada) {
        fullData = { ...original, mesaAsignada: updatedData.mesaAsignada };
      }

      const fechaString = formatDateToString(fullData.fecha);

      if (!isValidDate(fechaString, fullData.turno, adminOverride)) {
        throw new Error('Por favor selecciona una fecha válida (desde hoy hasta 1 mes en el futuro).');
      }

      // 🆕 VERIFICACIÓN DE CAMBIO DE TURNO AUTOMÁTICA
      const turnoChanged = original.turno !== fullData.turno;
      const fechaChanged = original.fecha !== fechaString;
      
      if ((turnoChanged || fechaChanged) && original.mesaAsignada && original.mesaAsignada !== 'Sin asignar') {
        console.log('🔄 Detectado cambio de turno/fecha, verificando disponibilidad de mesa:', original.mesaAsignada);
        
        try {
          // Importar dinámicamente el servicio de gestión de mesas
          const { calculateRealTableStates, assignTableAutomatically } = await import('./shared/services/tableManagementService');
          
          // Cargar bloqueos para el nuevo turno/fecha
          const blockedTablesForNewSlot = await handleLoadBlockedTables(fechaString, fullData.turno);
          const blockedTables = new Set(blockedTablesForNewSlot || []);
          
          // Filtrar reservas del nuevo turno/fecha (excluyendo la que estamos editando)
          const reservasNuevoTurno = data.reservas.filter(r => 
            r.fecha === fechaString && 
            r.turno === fullData.turno &&
            r.id !== reservationId
          );
          
          // Calcular estados de mesas para el nuevo turno
          const tableStates = calculateRealTableStates(
            reservasNuevoTurno,
            [], // Sin pedidos
            blockedTables,
            fechaString,
            fullData.turno
          );
          
          // Verificar si la mesa actual está disponible
          const currentTableState = tableStates.get(parseInt(original.mesaAsignada));
          const isCurrentTableAvailable = currentTableState?.canReceiveReservations;
          
          if (isCurrentTableAvailable) {
            console.log('✅ Mesa actual disponible en nuevo turno, manteniéndola:', original.mesaAsignada);
            // Mantener la mesa actual
            fullData.mesaAsignada = original.mesaAsignada;
          } else {
            console.log('❌ Mesa actual no disponible, reasignando automáticamente...');
            // Reasignar automáticamente
            const nuevaMesa = assignTableAutomatically(fullData, tableStates);
            
            if (nuevaMesa) {
              fullData.mesaAsignada = nuevaMesa;
              console.log('✅ Mesa reasignada automáticamente:', nuevaMesa);
            } else {
              console.log('⚠️ No hay mesas disponibles para reasignación automática');
              fullData.mesaAsignada = 'Sin asignar';
            }
          }
        } catch (error) {
          console.error('❌ Error en verificación de cambio de turno:', error);
          // En caso de error, mantener la mesa original o marcar sin asignar
          fullData.mesaAsignada = 'Sin asignar';
        }
      }

      const slots = await getAvailableSlotsForEdit(
        fechaString,
        fullData.turno,
        fullData.personas,
        reservationId
      );

      const horarioOk =
        adminOverride ||
        (Array.isArray(slots) &&
          slots.some((s) => s.horario === fullData.horario || s === fullData.horario));
      if (!horarioOk) {
        throw new Error('El horario seleccionado no está disponible. Por favor, elige otro horario.');
      }

      // Limpiar objeto cliente para eliminar campos undefined (Firebase no los acepta)
      const cleanCliente = {};
      Object.keys(fullData.cliente).forEach(key => {
        const value = fullData.cliente[key];
        if (value !== undefined && value !== null && value !== '') {
          cleanCliente[key] = value;
        }
      });
      
      const reservationUpdate = {
        ...fullData,
        fecha: fechaString,
        cliente: {
          ...cleanCliente,
          ultimaReserva: fechaString
        },
      };
      
      delete reservationUpdate.id;

      await updateReservation(reservationId, reservationUpdate);
      return true;
    } catch (error) {
      console.error("Error al actualizar reserva:", error);
      throw error;
    }
  };

  const handleSearchReservation = async (searchData) => {
    try {
      return await searchReservation(searchData);
    } catch (error) {
      console.error("Error al buscar reserva:", error);
      alert("Error al buscar la reserva. Por favor, intenta nuevamente.");
      return null;
    }
  };

  const handleDeleteReservation = async (documentId) => {
    try {
      await deleteReservation(documentId);
      return true;
    } catch (error) {
      console.error("Error al eliminar reserva:", error);
      throw error;
    }
  };

  const handleCancelReservationPublic = async (code, phoneDigits) => {
    try {
      await cancelReservationPublic(code, phoneDigits);
      showNotification('Reserva cancelada.', 'info');
      return true;
    } catch (error) {
      console.error('Cancelación pública:', error);
      const msg = error?.message || '';
      if (msg.includes('cancel_too_late') || msg.includes('too_late')) {
        const h = clientCancelMinHoursBeforeStart;
        alert(
          h <= 0
            ? 'No se puede cancelar online en este momento según el horario de tu reserva. Contactanos por WhatsApp.'
            : `No se puede cancelar online: hace falta al menos ${h} h de antelación. Contactanos por WhatsApp.`
        );
      } else if (msg.includes('invalid_phone_length')) {
        alert('El teléfono debe tener al menos 8 dígitos para verificar la cancelación.');
      } else if (msg.includes('phone_mismatch')) {
        alert('El teléfono no coincide con la reserva.');
      } else if (msg.includes('reservation_not_found') || msg.includes('not_found')) {
        alert('No encontramos esa reserva o ya fue cancelada.');
      } else {
        alert('No se pudo cancelar. Intentá de nuevo o contactanos por WhatsApp.');
      }
      return false;
    }
  };

  const handleBeginReservationModification = async (reservation) => {
    const reservationDate = new Date(`${reservation.fecha}T00:00:00`);
    const fechaString = reservation.fecha;
    const turno = reservation.turno;
    const slots = await getAvailableSlotsDynamicSimplified(
      fechaString,
      turno,
      reservation.personas
    );
    setReservaData({
      ...reservation,
      fecha: reservationDate,
      isModifying: true,
      cliente: {
        nombre: reservation.cliente?.nombre || '',
        telefono: reservation.cliente?.telefono || '',
        comentarios: reservation.cliente?.comentarios || '',
        email: reservation.cliente?.email || ''
      },
      willGoToWaitingList: slots.length === 0,
      limitsInfo: getReservationLimitsInfo()
    });
    setAvailableSlots(slots);
    setBookingPlanningSubmitted(true);
    setCurrentScreen('reserva-flow');
  };

  // === FUNCIONES PARA LISTA DE ESPERA ===
  
  const handleConfirmWaitingReservation = async (waitingReservationId, waitingData, selectedHorario, currentBlocked = null) => {
    try {
      // Verificar que aún hay cupo disponible antes de confirmar
      const slotsDisponibles = await getAvailableSlots(waitingData.fecha, waitingData.turno);
      const hayCupo = slotsDisponibles.some((s) => s.cuposDisponibles > 0);
      if (!hayCupo) {
        throw new Error('Ya no hay cupos disponibles para este turno.');
      }

      // Crear datos temporales para asignación de mesa
      const tempReservationData = {
        ...waitingData,
        horario: selectedHorario
      };

      let blockedTables = currentBlocked;
      if (!blockedTables) {
        blockedTables = new Set(DEFAULT_WALKIN_TABLES);
      }
      const blockedSet =
        blockedTables instanceof Set ? blockedTables : new Set(blockedTables || []);

      const reservasDelTurno = data.reservas.filter(
        (r) => r.fecha === waitingData.fecha && r.turno === waitingData.turno
      );

      let mesaAsignada = waitingData.mesaAsignada;
      if (!mesaAsignada || mesaAsignada === 'Sin asignar') {
        mesaAsignada = await assignTableToNewReservation(
          tempReservationData,
          reservasDelTurno,
          blockedSet
        );
      }

      // Limpiar objeto cliente de la waiting list
      const cleanClienteWaiting = {};
      if (waitingData.cliente) {
        Object.keys(waitingData.cliente).forEach(key => {
          const value = waitingData.cliente[key];
          if (value !== undefined && value !== null && value !== '') {
            cleanClienteWaiting[key] = value;
          }
        });
      }

      // Confirmar la reserva desde lista de espera con mesa asignada
      const { id, reservationId } = await confirmWaitingReservation(waitingReservationId, {
        ...waitingData,
        cliente: cleanClienteWaiting,
        horario: selectedHorario, // Usar el horario seleccionado por el admin
        mesaAsignada: mesaAsignada // Agregar mesa asignada
      });

      console.log('Reserva confirmada desde lista de espera con mesa:', mesaAsignada);

      return { id, reservationId };
    } catch (error) {
      console.error("Error al confirmar reserva desde lista de espera:", error);
      throw error;
    }
  };

  const handleDeleteWaitingReservation = async (waitingReservationId) => {
    try {
      await deleteWaitingReservation(waitingReservationId);
      return true;
    } catch (error) {
      console.error("Error al eliminar reserva de lista de espera:", error);
      throw error;
    }
  };

  const handleMarkAsNotified = async (waitingReservationId) => {
    try {
      await markWaitingAsNotified(waitingReservationId);
      return true;
    } catch (error) {
      console.error("Error al marcar como notificada:", error);
      throw error;
    }
  };

  const handleContactWaitingClient = async (waitingReservationId, waitingData = null) => {
    try {
      await contactWaitingClient(waitingReservationId, waitingData);
      return true;
    } catch (error) {
      console.error("Error al contactar cliente:", error);
      throw error;
    }
  };

  const handleRejectWaitingReservation = async (waitingReservationId, reason = '') => {
    try {
      await rejectWaitingReservation(waitingReservationId, reason);
      return true;
    } catch (error) {
      console.error("Error al rechazar reserva:", error);
      throw error;
    }
  };

  // === FUNCIONES PARA BLOQUEOS DE MESAS ===
  
  const handleSaveBlockedTables = async (fecha, turno, blockedTablesArray) => {
    await saveTableBlocksForDateTurno(fecha, turno, blockedTablesArray);
    return true;
  };

  const handleLoadBlockedTables = async (fecha, turno) => {
    try {
      const cfg = await loadTableBlocksForDateTurno(fecha, turno);
      const arr = cfg?.blockedTables ? Array.from(cfg.blockedTables) : [];
      return arr.length ? arr : null;
    } catch (error) {
      console.error('Error al cargar bloqueos de mesas:', error);
      return null;
    }
  };





  // Usar el nuevo sistema de routing modular
  return (
    <>
      <AppRouter
      // Props para auth state
      authState={authState}
      adminWorkDate={adminWorkDate}
      onAdminWorkDateChange={setAdminWorkDate}
      
      // Props para admin
      data={data}
      auth={authState}
      onLogout={handleLogout}
      onSetBlacklist={handleSetBlacklist}
      onUpdateClientNotes={handleUpdateClientNotes}
      onUpdateReservation={handleUpdateReservation}
      onDeleteReservation={handleDeleteReservation}
      handleSaveReservation={handleSaveReservation}
      onConfirmWaitingReservation={handleConfirmWaitingReservation}
      onDeleteWaitingReservation={handleDeleteWaitingReservation}
      onMarkAsNotified={handleMarkAsNotified}
      onContactWaitingClient={handleContactWaitingClient}
      onRejectWaitingReservation={handleRejectWaitingReservation}
      onSaveBlockedTables={handleSaveBlockedTables}
      onLoadBlockedTables={handleLoadBlockedTables}
      getAvailableSlotsForEdit={getAvailableSlotsForEdit}
      getAvailableSlots={getAvailableSlots}
      isValidDate={isValidDate}
      formatDate={formatDate}
      HORARIOS={HORARIOS}
      showNotification={showNotification}
      showConfirmationDialog={showConfirmationDialog}
      editingReservation={editingReservation}
      setEditingReservation={setEditingReservation}
      
      // Props para client
      LOGO_URL={LOGO_URL}
      BACKGROUND_IMAGE_URL={BACKGROUND_IMAGE_URL}
      currentScreen={currentScreen}
      setCurrentScreen={setCurrentScreen}
      reservaData={reservaData}
      setReservaData={setReservaData}
      availableSlots={availableSlots}
      showConfirmation={showConfirmation}
      setShowConfirmation={setShowConfirmation}
      handleDateAndTurnoSubmit={handleDateAndTurnoSubmit}
      handleHorarioSelect={handleHorarioSelect}
      handleContactoSubmit={handleContactoSubmit}
      handleSearchReservation={handleSearchReservation}
      handleUpdateReservation={handleUpdateReservation}
      handleDeleteReservation={handleDeleteReservation}
      showReservationModal={showReservationModal}
      setShowReservationModal={setShowReservationModal}
      showWaitingListModal={showWaitingListModal}
      setShowWaitingListModal={setShowWaitingListModal}
      waitingList={data.waitingList || []}
      allReservations={data.reservas || []}
      handleLogin={handleLogin}
      bookingPlanningSubmitted={bookingPlanningSubmitted}
      setBookingPlanningSubmitted={setBookingPlanningSubmitted}
      resetClientBookingFlow={resetClientBookingFlow}
      handleCancelReservationPublic={handleCancelReservationPublic}
      handleBeginReservationModification={handleBeginReservationModification}
      clientCancelMinHoursBeforeStart={clientCancelMinHoursBeforeStart}
      />
      
      {/* Componentes de UI globales */}
      <NotificationContainer 
        notifications={notifications} 
        onClose={closeNotification} 
      />
      <ConfirmationModal 
        confirmation={confirmation}
        onConfirm={() => handleConfirmation(true)}
        onCancel={() => handleConfirmation(false)}
      />
    </>
  );
}

export default App;