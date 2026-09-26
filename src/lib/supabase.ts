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
    // supabase-js serialises every auth call (getSession, token refresh,
    // signInWithPassword…) behind the Web Locks API (navigator.locks).
    // On iOS Safari / standalone PWA the lock manager gets SUSPENDED when
    // the page loses focus — which is exactly what happens the instant the
    // keyboard or password-autofill sheet appears during login. The lock
    // request then never resolves, so signInWithPassword() hangs forever
    // and the button stays stuck on "…" with no error. Replacing the lock
    // with a pass-through runs auth calls directly. Safe here: REVS is a
    // single-instance mobile PWA, so the cross-tab refresh contention the
    // lock guards against effectively never occurs. Reverting to the
    // default lock would reintroduce the iOS login hang.
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
})
