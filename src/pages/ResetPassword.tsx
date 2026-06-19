import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { translateError } from '../lib/errors'
import { useAuth } from '../hooks/useAuth'
import { PasswordField } from './Auth'

// Landing page for the password-reset email link. supabase-js captures the
// recovery token from the URL (detectSessionInUrl) and elevates the user to
// a temporary recovery session; here they just set a new password (no old
// one required), then we drop into the app.
export default function ResetPassword() {
  const navigate = useNavigate()
  const { setPasswordRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Mot de passe trop court (min. 8 caractères).')
      return
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // Clear the recovery flag so the app guard lets us through, strip the
      // token hash, then land in the app.
      setPasswordRecovery(false)
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/')
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(translateError(err))
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-fg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          background:
            'radial-gradient(ellipse 90% 100% at 50% 0%, rgba(232,32,58,0.38) 0%, rgba(232,32,58,0.08) 35%, transparent 65%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen w-full max-w-sm flex-col px-7 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="mb-8 text-center">
          <h1
            className="font-display font-extrabold leading-none"
            style={{ fontSize: '56px', letterSpacing: '-2px' }}
          >
            <span className="text-accent">R</span>
            <span className="text-fg">EVS</span>
          </h1>
          <p className="mt-3 text-sm text-fg2">
            Choisis ton nouveau mot de passe.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField
            label="Nouveau mot de passe"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={setPassword}
            hint="Minimum 8 caractères."
          />
          <PasswordField
            label="Confirme le nouveau mot de passe"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={setConfirm}
          />

          {error && (
            <p className="rounded-2xl bg-accent/15 px-3 py-2 text-sm text-accent">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tappable mt-2 w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg transition-opacity disabled:opacity-50"
            style={{ boxShadow: '0 10px 28px rgba(232,32,58,0.45)' }}
          >
            {loading ? '…' : 'ENREGISTRER LE NOUVEAU MOT DE PASSE'}
          </button>
        </form>
      </div>
    </div>
  )
}
