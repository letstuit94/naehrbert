/**
 * Supabase Auth client (Google + email sign-in). This is the ONLY place
 * the frontend talks to Supabase directly -- everything else (all app
 * data) still goes through the FastAPI backend (lib/api.ts), which itself
 * verifies the session this client produces (backend/app/core/auth.py).
 *
 * The anon/public key is safe to ship client-side by design (unlike the
 * backend's service-role key) -- it identifies the Supabase project, not
 * a privileged credential.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set -- see frontend/.env.example',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
