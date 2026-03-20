import { performReservationCheckIn } from './supabaseReservationRepository';

export const hasCheckedIn = (reservation) => reservation?.estadoCheckIn === 'confirmado';

export const performCheckIn = async (reservation, mesaRealNumber, showNotification) => {
  try {
    if (mesaRealNumber == null || mesaRealNumber === '') {
      throw new Error('Seleccioná la mesa en el plano.');
    }
    const mesa =
      typeof mesaRealNumber === 'number' ? mesaRealNumber : parseInt(String(mesaRealNumber), 10);
    if (Number.isNaN(mesa)) {
      throw new Error('Mesa inválida');
    }
    await performReservationCheckIn(reservation.id, mesa);
    if (showNotification) {
      showNotification('Check-in realizado correctamente', 'success');
    }
    return true;
  } catch (error) {
    console.error('Error en check-in:', error);
    if (showNotification) {
      showNotification(error.message || 'Error al realizar check-in', 'error');
    }
    throw error;
  }
};

export default { hasCheckedIn, performCheckIn };
