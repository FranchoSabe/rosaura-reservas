import React from 'react';
import { Clock, Users, CheckCircle, UserCheck, Phone } from 'lucide-react';
import { formatPhoneForWhatsApp } from '../../../../../../utils/phoneUtils';
import styles from '../../Reservas.module.css';

function formatCheckInTime(horaLlegada) {
  if (!horaLlegada) return '';
  if (horaLlegada instanceof Date && !Number.isNaN(horaLlegada.getTime())) {
    return horaLlegada.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof horaLlegada === 'string' || typeof horaLlegada === 'number') {
    const d = new Date(horaLlegada);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  if (horaLlegada?.seconds != null) {
    return new Date(horaLlegada.seconds * 1000).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  return '';
}

/**
 * Lista de reservas con toda la lógica de visualización y interacción
 */
const ReservationsList = ({
  reservasTurnoSeleccionado,
  selectedReservation,
  checkInMode,
  selectedReservationForCheckIn,
  hasCheckedIn,
  handleReservationCardClick,
  handleOpenCheckIn,
  handleTableButtonClick,
  getAssignmentButtonText,
  getAssignmentButtonClass,
  getUnassignmentButtonClass
}) => {
  return (
    <div className={styles.reservationsList}>
      {reservasTurnoSeleccionado.length > 0 ? (
        reservasTurnoSeleccionado.map((reserva) => (
          <div
            key={reserva.id}
            className={`${styles.reservationCard} ${
              selectedReservation?.id === reserva.id ? styles.reservationCardSelected : ''
            } ${
              hasCheckedIn(reserva) ? styles.reservationCardCheckedIn : ''
            }`}
            onClick={(event) => handleReservationCardClick(reserva, event)}
          >
            {/* Información principal: Nombre + hora + personas en línea compacta */}
            <div className={styles.reservationMainInfo}>
              <div className={styles.reservationNameSection}>
                <div className={`${styles.reservationName} ${
                  hasCheckedIn(reserva) ? styles.reservationNameCheckedIn : ''
                }`}>
                  {reserva.cliente?.nombre}
                </div>
              </div>
              
              <div className={styles.reservationInfoLine}>
                <div className={styles.reservationTime}>
                  <Clock size={14} />
                  <span>{reserva.horario}</span>
                </div>
                <div className={styles.reservationPeople}>
                  <Users size={14} />
                  <span>{reserva.personas}p</span>
                </div>
              </div>
            </div>

            {/* Segundo renglón: Teléfono (botón), Mesa asignada (botón), Check-in (botón) */}
            <div className={styles.reservationActions}>
              {/* Botón de teléfono */}
              {reserva.cliente?.telefono && (
                <a
                  href={`https://wa.me/${formatPhoneForWhatsApp(reserva.cliente.telefono)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.phoneButton}
                  title={`WhatsApp: ${reserva.cliente.telefono}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone size={14} />
                  <span>{reserva.cliente.telefono}</span>
                </a>
              )}

              {/* Botón de mesa asignada */}
              <button
                onClick={(event) => handleTableButtonClick(reserva, event)}
                className={`${styles.tableButton} ${getAssignmentButtonClass(reserva)}`}
                title={reserva.mesaAsignada && reserva.mesaAsignada !== 'Sin asignar' 
                  ? `Cambiar asignación de mesa ${reserva.mesaAsignada}` 
                  : 'Asignar mesa'
                }
                disabled={hasCheckedIn(reserva)}
              >
                {getAssignmentButtonText(reserva)}
              </button>

              {/* Botón de check-in */}
              {hasCheckedIn(reserva) ? (
                <div className={styles.checkedInIndicator}>
                  <CheckCircle size={14} />
                  <span>Llegó a las {formatCheckInTime(reserva.horaLlegada)}</span>
                </div>
              ) : (
                <button
                  onClick={(event) => handleOpenCheckIn(reserva, event)}
                  className={`${styles.checkInButton} ${
                    checkInMode && selectedReservationForCheckIn?.id === reserva.id 
                      ? styles.checkInButtonActive 
                      : ''
                  }`}
                  title={
                    checkInMode && selectedReservationForCheckIn?.id === reserva.id
                      ? 'Cancelar check-in'
                      : `Hacer check-in de ${reserva.cliente?.nombre}`
                  }
                >
                  <UserCheck size={14} />
                  <span>
                    {checkInMode && selectedReservationForCheckIn?.id === reserva.id 
                      ? 'Cancelar' 
                      : 'Check-in'
                    }
                  </span>
                </button>
              )}
            </div>

            {/* Comentarios si existen */}
            {reserva.cliente?.comentarios && (
              <div className={styles.reservationComments}>{reserva.cliente.comentarios}</div>
            )}
          </div>
        ))
      ) : (
        <div className={styles.emptyState}>
          <p>No hay reservas para este turno</p>
        </div>
      )}
    </div>
  );
};

export default ReservationsList; 