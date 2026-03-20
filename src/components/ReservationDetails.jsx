import React from 'react';
import { X, Edit2, MessageCircle, Trash2 } from 'lucide-react';
import styles from './ReservationDetails.module.css';

const ReservationDetails = ({ reservation, onClose, formatDate, onEdit, onCancel, onContact }) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Detalles de la Reserva</h2>
        <button
          onClick={onClose}
          className={styles.closeButton}
        >
          <X size={24} />
        </button>
      </div>

      <div className={styles.detailsContainer}>
        <div className={styles.detailItem}>
          <p className={styles.detailLabel}>Código de Reserva</p>
          <p className={styles.detailValue}>{reservation.reservationId}</p>
        </div>
        <div className={styles.detailItem}>
          <p className={styles.detailLabel}>Fecha</p>
          <p className={styles.detailValue}>{formatDate(reservation.fecha)}</p>
        </div>
        <div className={styles.detailItem}>
          <p className={styles.detailLabel}>Horario</p>
          <p className={styles.detailValue}>{reservation.horario}</p>
        </div>
        <div className={styles.detailItem}>
          <p className={styles.detailLabel}>Personas</p>
          <p className={styles.detailValue}>{reservation.personas}</p>
        </div>
        <div className={styles.detailItem}>
          <p className={styles.detailLabel}>Nombre</p>
          <p className={styles.detailValue}>
            {reservation.cliente?.nombre?.trim()
              ? reservation.cliente.nombre
              : reservation._publicPhoneSummary
                ? '— (no mostrado en búsqueda por teléfono)'
                : '—'}
          </p>
        </div>
        {reservation.cliente?.comentarios && (
          <div className={styles.detailItem}>
            <p className={styles.detailLabel}>Comentarios</p>
            <p className={styles.detailValue}>{reservation.cliente.comentarios}</p>
          </div>
        )}
      </div>

      <div className={styles.actionsContainer}>
        {onEdit && (
          <button
            onClick={onEdit}
            className={styles.actionButton}
          >
            <Edit2 className={styles.editIcon} size={20} />
            Modificar Reserva
          </button>
        )}

        {onCancel && (
          <button
            onClick={onCancel}
            className={styles.actionButton}
          >
            <Trash2 className={styles.deleteIcon} size={20} />
            Cancelar Reserva
          </button>
        )}

        {onContact && (
          <button
            onClick={onContact}
            className={styles.actionButton}
          >
            <MessageCircle className={styles.contactIcon} size={20} />
            Envianos un WhatsApp
          </button>
        )}
      </div>
    </div>
  );
};

export default ReservationDetails; 