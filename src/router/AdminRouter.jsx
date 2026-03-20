import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PrivateRoute from './PrivateRoute';
import AdminLayout from '../apps/admin/layout/AdminLayout';
import Dashboard from '../apps/admin/pages/Dashboard/Dashboard';

// Nuevas páginas del Sistema de Gestión Integral
import Reservas from '../apps/admin/pages/Reservas/Reservas';
import Pedidos from '../apps/admin/pages/Pedidos/Pedidos';

/**
 * Router para la aplicación de administración
 * 
 * SISTEMA DE GESTIÓN INTEGRAL:
 * ✅ /admin/dashboard -> Dashboard.jsx (Vista principal con resumen)
 * ✅ /admin/reservas -> Reservas.jsx (Gestión de reservas)
 * ✅ /admin/pedidos -> Pedidos.jsx (Gestión de pedidos)
 * 
 * RUTAS LEGACY (compatibilidad):
 * ✅ /admin/panorama -> Redirige a /admin/reservas (Panorama integrado en Reservas)
 */
const AdminRouter = (props) => {
  return (
    <PrivateRoute auth={props.auth}>
      <AdminLayout 
        auth={props.auth} 
        onLogout={props.onLogout}
        // Props para CreateReservationModal global
        onCreateReservation={props.onSaveReservation}
        getAvailableSlots={props.getAvailableSlots}
        isValidDate={props.isValidDate}
        HORARIOS={props.HORARIOS}
        showNotification={props.showNotification}
      >
        <Routes>
          {/* Ruta dashboard - nueva página modular */}
          <Route 
            path="/dashboard" 
            element={
              <Dashboard 
                // Props de datos
                reservations={props.data?.reservas || []}
                waitingList={props.data?.waitingList || []}
                
                // Props de acciones sobre reservas
                onSetBlacklist={props.onSetBlacklist}
                onUpdateReservation={props.onUpdateReservation}
                onDeleteReservation={props.onDeleteReservation}
                
                // Props de acciones sobre lista de espera
                onConfirmWaitingReservation={props.onConfirmWaitingReservation}
                onDeleteWaitingReservation={props.onDeleteWaitingReservation}
                onMarkAsNotified={props.onMarkAsNotified}
                onContactWaitingClient={props.onContactWaitingClient}
                onRejectWaitingReservation={props.onRejectWaitingReservation}
                
                // Props de utilidades
                getAvailableSlotsForEdit={props.getAvailableSlotsForEdit}
                getAvailableSlots={props.getAvailableSlots}
                isValidDate={props.isValidDate}
                HORARIOS={props.HORARIOS}
                formatDate={props.formatDate}
                
                // Props de estado de edición
                editingReservation={props.editingReservation}
                setEditingReservation={props.setEditingReservation}
                
                // Props de mesas bloqueadas
                onSaveBlockedTables={props.onSaveBlockedTables}
                onLoadBlockedTables={props.onLoadBlockedTables}
                
                // Props de notificaciones globales - AÑADIDO
                showNotification={props.showNotification}
                showConfirmation={props.showConfirmation}
              />
            } 
          />
          
          {/* Ruta panorama - redirige a reservas (integrado) */}
          <Route 
            path="/panorama" 
            element={<Navigate to="/admin/reservas" replace />}
          />
          
          {/* Ruta reservas - nueva página modular */}
          <Route 
            path="/reservas" 
            element={
              <Reservas 
                // Props de datos
                reservations={props.data?.reservas || []}
                waitingList={props.data?.waitingList || []}
                
                // Props de acciones sobre reservas
                onSetBlacklist={props.onSetBlacklist}
                onUpdateReservation={props.onUpdateReservation}
                onDeleteReservation={props.onDeleteReservation}
                onCreateReservation={props.onSaveReservation}
                onAdminWorkDateChange={props.onAdminWorkDateChange}
                
                // Props de acciones sobre lista de espera
                onConfirmWaitingReservation={props.onConfirmWaitingReservation}
                onDeleteWaitingReservation={props.onDeleteWaitingReservation}
                onMarkAsNotified={props.onMarkAsNotified}
                onContactWaitingClient={props.onContactWaitingClient}
                onRejectWaitingReservation={props.onRejectWaitingReservation}
                
                // Props de utilidades
                getAvailableSlotsForEdit={props.getAvailableSlotsForEdit}
                getAvailableSlots={props.getAvailableSlots}
                isValidDate={props.isValidDate}
                HORARIOS={props.HORARIOS}
                formatDate={props.formatDate}
                
                // Props de estado de edición
                editingReservation={props.editingReservation}
                setEditingReservation={props.setEditingReservation}
                
                // Props de mesas bloqueadas
                onSaveBlockedTables={props.onSaveBlockedTables}
                onLoadBlockedTables={props.onLoadBlockedTables}
                
                // Props de notificaciones globales
                showNotification={props.showNotification}
                showConfirmation={props.showConfirmation}
              />
            } 
          />
          
          
          {/* Ruta pedidos - nueva página modular */}
          <Route 
            path="/pedidos" 
            element={
              <Pedidos 
                // Props de notificaciones globales
                showNotification={props.showNotification}
                showConfirmation={props.showConfirmation}
              />
            } 
          />
          
          
          {/* Ruta principal redirige a dashboard */}
          <Route 
            path="/" 
            element={<Navigate to="/admin/dashboard" replace />} 
          />
          

          
          {/* Catch-all redirige a dashboard */}
          <Route 
            path="*" 
            element={<Navigate to="/admin/dashboard" replace />} 
          />
        </Routes>
      </AdminLayout>
    </PrivateRoute>
  );
};

export default AdminRouter; 