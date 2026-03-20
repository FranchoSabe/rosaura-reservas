import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client;

/**
 * Cliente singleton. Con sesión staff (Supabase Auth) las políticas RLS usan rol authenticated;
 * sin sesión, rol anon.
 */
export function getSupabaseClient() {
  if (!url || !anonKey) {
    if (import.meta.env.DEV) {
      console.warn(
        '[Supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Dominio reservas no funcionará.'
      );
    }
    return null;
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  }
  return client;
}
