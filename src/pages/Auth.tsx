import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'signup'

export default function Auth() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setInfo('Compte créé. Vérifie ta boîte mail pour confirmer.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-8 bg-bg text-fg">
      <div className="max-w-sm mx-auto w-full space-y-12">
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight">revs</h1>
          <p className="text-sm text-fg/50">
            {mode === 'login'
              ? 'Connecte-toi pour continuer.'
              : 'Crée ton compte.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-widest text-fg/40">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border-b border-white/10 py-3 text-fg placeholder-fg/20 outline-none focus:border-accent transition-colors"
              placeholder="toi@exemple.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-widest text-fg/40">
              Mot de passe
            </label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border-b border-white/10 py-3 text-fg placeholder-fg/20 outline-none focus:border-accent transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-accent">{error}</p>}
          {info && <p className="text-sm text-fg/70">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-fg py-4 rounded-full font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? '…' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setError(null)
            setInfo(null)
          }}
          className="w-full text-center text-sm text-fg/50 hover:text-fg transition-colors"
        >
          {mode === 'login'
            ? "Pas de compte ? S'inscrire"
            : 'Déjà un compte ? Se connecter'}
        </button>
      </div>
    </div>
  )
}
