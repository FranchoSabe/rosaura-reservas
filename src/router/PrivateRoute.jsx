import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { ensureSupabaseStaffSession } from '../shared/services/supabaseReservationRepository';

/**
 * Componente para proteger rutas que requieren autenticación
 * Redirige a login si no hay usuario autenticado
 */
const PrivateRoute = ({ children, auth }) => {
  useEffect(() => {
    if (auth?.user) {
      ensureSupabaseStaffSession().then((r) => {
        if (!r.ok && import.meta.env.DEV) {
          console.warn('[Supabase staff]', r.error);
        }
      });
    }
  }, [auth?.user]);

  if (!auth || !auth.user) {
    return <Navigate to="/client/login" replace />;
  }

  return children;
};

export default PrivateRoute; 