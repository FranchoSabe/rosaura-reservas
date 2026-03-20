/**
 * Fallback si no hay columna `tenants.client_cancel_min_hours_before_start` o falla la lectura.
 * Valor por defecto en BD/migración: 2. UI usa fetchPilotTenantClientSettings().
 */
export const CLIENT_CANCEL_MIN_HOURS_BEFORE_START = 2;

/** Mensaje de deuda: rate-limit en RPC (requiere Edge/WAF). */
export const PUBLIC_RPC_RATE_LIMIT_NOTE =
  'Rate-limit de RPC públicas: documentar en Edge Function o WAF en producción.';
