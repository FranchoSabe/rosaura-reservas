/** Debe coincidir con el tenant seed en migraciones SQL (pilot_tenant_id). */
export const DEFAULT_TENANT_ID =
  import.meta.env.VITE_DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

export const RESTAURANT_TIMEZONE =
  import.meta.env.VITE_RESTAURANT_TIMEZONE || 'America/Argentina/Buenos_Aires';
