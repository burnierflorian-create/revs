import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { translateError } from '../lib/errors'
import { stashPendingReferral } from '../lib/referrals'

type Mode = 'login' | 'signup' | 'forgot'

// 6-char alphanumeric uppercase. The server's claim_referral RPC is
// the authoritative validator; this is purely a UX hint while the
// user types so they know their format is correct before submit.
const REFERRAL_FORMAT = /^[A-Z0-9]{6}$/

export default function Auth() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
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
        const cleanedCode = referralCode.trim().toUpperCase().slice(0, 6)
        // Persist the referral code in two places so the claim survives
        // any email-confirm flow:
        //  - localStorage on this browser (instant claim if user clicks
        //    the confirmation link on the same device).
        //  - user_metadata server-side (survives device switches).
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options:
            cleanedCode.length === 6
              ? { data: { referral_code: cleanedCode } }
              : undefined,
        })
        if (error) throw error
        if (cleanedCode.length === 6) stashPendingReferral(cleanedCode)
        setInfo('Compte créé. Vérifie ta boîte mail pour confirmer.')
      } else if (mode === 'forgot') {
        // Supabase sends a password-reset email pointing to the redirect
        // URL with a #access_token=… hash; the user follows it back into
        // the app and sets a new password. We send them back to /auth so
        // the existing reset flow handles it.
        const redirectTo =
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth?reset=1`
            : undefined
        const { error } = await supabase.auth.resetPasswordForEmail(
          email,
          redirectTo ? { redirectTo } : undefined,
        )
        if (error) throw error
        setInfo(
          'Lien de réinitialisation envoyé sur votre adresse e-mail !',
        )
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
      }
    } catch (err) {
      setError(translateError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-fg">
      {/* Backdrop radial glow rouge en haut — la page respire en
          rappelant l'accent de la marque sans envahir. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          background:
            'radial-gradient(ellipse 90% 100% at 50% 0%, rgba(232,32,58,0.38) 0%, rgba(232,32,58,0.08) 35%, transparent 65%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(232,32,58,0.6) 50%, transparent 100%)',
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-sm flex-col px-7 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        {/* Logo + tagline */}
        <div className="mb-10 text-center">
          <h1
            className="font-display font-extrabold leading-none"
            style={{ fontSize: '64px', letterSpacing: '-2px' }}
          >
            <span className="text-accent">R</span>
            <span className="text-fg">EVS</span>
          </h1>
          <p className="mt-3 text-sm text-fg2">
            Spotte les voitures iconiques.
          </p>
        </div>

        {/* Segmented control — Connexion / Inscription. Hidden when
            mode === 'forgot' so the password-reset flow stays focused. */}
        {mode !== 'forgot' && <div
          className="mx-auto flex rounded-full bg-card p-1"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setError(null)
              setInfo(null)
            }}
            className={`tappable rounded-full px-6 py-2 text-sm font-bold tracking-wide transition-colors ${
              mode === 'login' ? 'bg-fg text-bg' : 'text-fg2'
            }`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError(null)
              setInfo(null)
            }}
            className={`tappable rounded-full px-6 py-2 text-sm font-bold tracking-wide transition-colors ${
              mode === 'signup' ? 'bg-fg text-bg' : 'text-fg2'
            }`}
          >
            Inscription
          </button>
        </div>}

        {mode === 'forgot' && (
          <p className="px-1 text-center text-sm text-fg2">
            Saisis ton adresse e-mail. Nous t'enverrons un lien pour
            réinitialiser ton mot de passe.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
            placeholder="toi@exemple.com"
          />

          {mode !== 'forgot' && (
            <div className="space-y-1.5">
              <Field
                label="Mot de passe"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                required
                minLength={6}
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
              />
              {mode === 'login' && (
                <div className="flex justify-end px-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot')
                      setError(null)
                      setInfo(null)
                    }}
                    className="tappable text-xs font-semibold text-fg2 transition-colors hover:text-accent"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'signup' && (
            <div className="space-y-1.5">
              <Field
                label="Code de parrainage"
                type="text"
                autoComplete="off"
                maxLength={6}
                value={referralCode}
                onChange={(v) =>
                  setReferralCode(v.toUpperCase().replace(/\s/g, ''))
                }
                placeholder="ABC123"
                hint={
                  referralCode.length === 0
                    ? 'Optionnel — +50 XP pour toi et ton parrain.'
                    : undefined
                }
                valueClassName="tracking-[0.3em] font-bold"
              />
              {referralCode.length > 0 &&
                referralCode.length < 6 && (
                  <p className="px-1 text-[11px] text-fg2/70">
                    {referralCode.length}/6 caractères
                  </p>
                )}
              {referralCode.length === 6 &&
                REFERRAL_FORMAT.test(referralCode) && (
                  <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-400"
                    style={{ border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    ✓ Code parrain valide — +50 XP pour vous deux !
                  </p>
                )}
              {referralCode.length === 6 &&
                !REFERRAL_FORMAT.test(referralCode) && (
                  <p className="rounded-xl bg-accent/10 px-3 py-2 text-[11px] font-semibold text-accent"
                    style={{ border: '1px solid rgba(232, 32, 58, 0.25)' }}>
                    Format invalide — 6 chiffres ou lettres
                    majuscules.
                  </p>
                )}
            </div>
          )}

          {error && (
            <p className="rounded-2xl bg-accent/15 px-3 py-2 text-sm text-accent">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-2xl bg-card px-3 py-2 text-sm text-fg/85">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tappable mt-2 w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg transition-opacity disabled:opacity-50"
            style={{ boxShadow: '0 10px 28px rgba(232,32,58,0.45)' }}
          >
            {loading
              ? '…'
              : mode === 'login'
                ? 'SE CONNECTER'
                : mode === 'signup'
                  ? "S'INSCRIRE"
                  : 'ENVOYER LE LIEN'}
          </button>

          {mode === 'forgot' && (
            <button
              type="button"
              onClick={() => {
                setMode('login')
                setError(null)
                setInfo(null)
              }}
              className="tappable -mt-1 w-full py-2 text-center text-xs font-semibold text-fg2 transition-colors hover:text-fg"
            >
              ← Retour à la connexion
            </button>
          )}
        </form>

        <p className="mt-auto pt-8 text-center text-[11px] text-fg2/70">
          {mode === 'login'
            ? 'En continuant, tu acceptes les conditions et la politique de confidentialité.'
            : 'En créant un compte, tu acceptes les conditions et la politique de confidentialité.'}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────── Field primitive ───────────────────────

function Field({
  label,
  hint,
  value,
  onChange,
  valueClassName = '',
  ...inputProps
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  valueClassName?: string
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'className'
>) {
  return (
    <label className="block space-y-1.5">
      <span className="label-up block px-1 text-[10px] text-fg2">{label}</span>
      <input
        {...inputProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-2xl bg-card px-4 py-3.5 text-sm text-fg placeholder-fg2/60 outline-none transition-shadow focus:ring-2 focus:ring-accent/45 ${valueClassName}`}
        style={{ border: '1px solid var(--color-border)' }}
      />
      {hint && <span className="block px-1 text-[11px] text-fg2/80">{hint}</span>}
    </label>
  )
}
