import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

/** Detects whether the current URL is mid-password-recovery. Supabase's
 *  implicit auth flow lands the user back at the redirectTo URL with a
 *  hash fragment `#access_token=…&type=recovery`. While this is true,
 *  the app gate must NOT shortcut a non-null session straight to the
 *  main tabs — it should route through /auth so the recover form can
 *  capture the new password. */
function hashIsRecovery(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hash || ''
  return h.includes('type=recovery')
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Sticky once the URL hash signals recovery OR Supabase fires the
  // PASSWORD_RECOVERY event. Cleared when the user successfully updates
  // their password (Auth.tsx calls back via useAuthReset()).
  const [passwordRecovery, setPasswordRecovery] = useState<boolean>(
    () => hashIsRecovery(),
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  return { session, loading, passwordRecovery, setPasswordRecovery }
}
