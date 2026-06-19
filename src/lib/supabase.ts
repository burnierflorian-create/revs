import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Explicit auth options so the "remember me" behaviour is guaranteed:
// the session is persisted in localStorage, auto-refreshed (token rotated
// well before its 1h expiry), and OAuth/recovery tokens in the URL are
// detected on load. These match Supabase's defaults but are pinned here
// so they can never silently change.
// NB: we deliberately keep the DEFAULT storageKey so existing sessions
// stay valid (changing it would silently log everyone out).
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
