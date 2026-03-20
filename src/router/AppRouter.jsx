import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminRouter from './AdminRouter';
import ClientRouter from './ClientRouter';
import ComponentShowcase from '../pages/ComponentShowcase';

/**
 * Router principal de la aplicación
 * Separa las rutas entre admin (/admin/*) y cliente (/client/*)
 * Parte de la migración hacia arquitectura modular
 */
const AppRouter = (props) => {
  // Separar props para admin y client
  const adminProps = {
    data: props.data,
    auth: props.auth,
    onLogout: props.onLogout,
    onSetBlacklist: props.onSetBlacklist,
    onUpdateClientNotes: props.onUpdateClientNotes,
    onUpdateReservation: props.onUpdateReservation,
    onDeleteReservation: props.onDeleteReservation,
    onConfirmWaitingReservation: props.onConfirmWaitingReservation,
    onDeleteWaitingReservation: props.onDeleteWaitingReservation,
    onMarkAsNotified: props.onMarkAsNotified,
    onContactWaitingClient: props.onContactWaitingClient,
    onRejectWaitingReservation: props.onRejectWaitingReservation,
    onSaveBlockedTables: props.onSaveBlockedTables,
    onLoadBlockedTables: props.onLoadBlockedTables,
    getAvailableSlotsForEdit: props.getAvailableSlotsForEdit,
    getAvailableSlots: props.getAvailableSlots,
    isValidDate: props.isValidDate,
    formatDate: props.formatDate,
    HORARIOS: props.HORARIOS,
    
    // Props de UI faltantes
    showNotification: props.showNotification,
    showConfirmation: props.showConfirmationDialog,
    
    onSaveReservation: props.handleSaveReservation,
    adminWorkDate: props.adminWorkDate,
    onAdminWorkDateChange: props.onAdminWorkDateChange,
    
    // Props de estado faltantes
    editingReservation: props.editingReservation,
    setEditingReservation: props.setEditingReservation
  };

  const clientProps = {
    currentScreen: props.currentScreen,
    setCurrentScreen: props.setCurrentScreen,
    reservaData: props.reservaData,
    setReservaData: props.setReservaData,
    availableSlots: props.availableSlots,
    showConfirmation: props.showConfirmation,
    setShowConfirmation: props.setShowConfirmation,
    handleDateAndTurnoSubmit: props.handleDateAndTurnoSubmit,
    handleHorarioSelect: props.handleHorarioSelect,
    handleContactoSubmit: props.handleContactoSubmit,
    formatDate: props.formatDate,
    handleSearchReservation: props.handleSearchReservation,
    handleUpdateReservation: props.handleUpdateReservation,
    handleDeleteReservation: props.handleDeleteReservation,
    showReservationModal: props.showReservationModal,
    setShowReservationModal: props.setShowReservationModal,
    showWaitingListModal: props.showWaitingListModal,
    setShowWaitingListModal: props.setShowWaitingListModal,
    waitingList: props.waitingList,
    allReservations: props.allReservations,
    handleLogin: props.handleLogin,
    BACKGROUND_IMAGE_URL: props.BACKGROUND_IMAGE_URL,
    LOGO_URL: props.LOGO_URL,
    bookingPlanningSubmitted: props.bookingPlanningSubmitted,
    setBookingPlanningSubmitted: props.setBookingPlanningSubmitted,
    resetClientBookingFlow: props.resetClientBookingFlow,
    handleCancelReservationPublic: props.handleCancelReservationPublic,
    handleBeginReservationModification: props.handleBeginReservationModification,
    clientCancelMinHoursBeforeStart: props.clientCancelMinHoursBeforeStart
  };

  return (
    <Routes>
      {/* Rutas de administración */}
      <Route path="/admin/*" element={<AdminRouter {...adminProps} />} />
      
      {/* Rutas de cliente */}
      <Route path="/client/*" element={<ClientRouter {...clientProps} />} />
      
      {/* 🎨 Showcase de componentes UI */}
      <Route path="/showcase" element={<ComponentShowcase />} />
      
      {/* Ruta por defecto redirige a cliente */}
      <Route path="/" element={<Navigate to="/client" replace />} />
      
      {/* Catch-all: cualquier ruta no encontrada va a cliente */}
      <Route path="*" element={<Navigate to="/client" replace />} />
    </Routes>
  );
};

export default AppRouter; 