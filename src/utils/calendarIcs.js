/**
 * Genera un .ics mínimo (UTC) para “Añadir al calendario”.
 */

function formatIcsUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * @param {{ title: string, description?: string, location?: string, start: Date, end: Date, uid: string }} p
 */
export function buildReservationIcsBlob(p) {
  const stamp = formatIcsUtc(new Date());
  const start = formatIcsUtc(p.start);
  const end = formatIcsUtc(p.end);
  if (!start || !end || !stamp) return null;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rosaura//Reserva//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(p.uid)}@rosaura`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(p.title)}`
  ];
  if (p.description) lines.push(`DESCRIPTION:${escapeIcsText(p.description)}`);
  if (p.location) lines.push(`LOCATION:${escapeIcsText(p.location)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
}

export function triggerIcsDownload(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'reserva.ics';
  a.click();
  URL.revokeObjectURL(url);
}
