import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { translateError } from '../lib/errors'
import { stashPendingReferral } from '../lib/referrals'
import { useAuth } from '../hooks/useAuth'
import { storeVault } from '../lib/passwordVault'
import { detectCountry, reverseGeocode, COUNTRY_NAMES } from '../lib/country'

type PseudoStatus = 'idle' | 'invalid' | 'checking' | 'ok' | 'taken'
const PSEUDO_RE = /^[a-zA-Z0-9_]{3,20}$/

type Mode = 'login' | 'signup' | 'forgot' | 'recover'

// 6-char alphanumeric uppercase. The server's claim_referral RPC is
// the authoritative validator; this is purely a UX hint while the
// user types so they know their format is correct before submit.
const REFERRAL_FORMAT = /^[A-Z0-9]{6}$/

// Hard-coded production origin used to force email reset links to
// land on prod even when the request is issued from localhost during
// dev. The check is conservative — anything that isn't 127.0.0.1 /
// localhost / a Vercel preview slug uses window.location.origin as-is
// so internal preview deploys still work.
const PROD_ORIGIN = 'https://revs-ten.vercel.app'
function resetRedirectOrigin(): string {
  if (typeof window === 'undefined') return PROD_ORIGIN
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) {
    return PROD_ORIGIN
  }
  return window.location.origin
}

export default function Auth() {
  const { passwordRecovery, setPasswordRecovery } = useAuth()
  const [searchParams] = useSearchParams()
  // Auto-switch into recover mode when either the URL hash carries the
  // Supabase recovery token (`#type=recovery`) or the back-channel
  // PASSWORD_RECOVERY event has fired into useAuth. ?reset=1 in the
  // query is an extra hint for email clients that strip the hash.
  const initialMode: Mode =
    passwordRecovery || searchParams.get('reset') === '1'
      ? 'recover'
      : 'login'
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Signup-only profile fields.
  const [pseudo, setPseudo] = useState('')
  const [pseudoStatus, setPseudoStatus] = useState<PseudoStatus>('idle')
  const [ville, setVille] = useState('')
  const [country, setCountry] = useState<string>(() => detectCountry())
  const [geoTried, setGeoTried] = useState(false)
  const pseudoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // OAuth (Apple / Google) — redirects to the provider then back to the
  // app origin, where detectSessionInUrl completes the PKCE exchange.
  async function oauth(provider: 'apple' | 'google') {
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
      // On success the browser is already navigating away.
    } catch (err) {
      setError(translateError(err))
      setLoading(false)
    }
  }

  // Live pseudo uniqueness (format gate → 500 ms debounce → RPC).
  useEffect(() => {
    if (mode !== 'signup') return
    if (pseudoTimer.current) clearTimeout(pseudoTimer.current)
    const v = pseudo.trim()
    if (v.length === 0) {
      setPseudoStatus('idle')
      return
    }
    if (!PSEUDO_RE.test(v)) {
      setPseudoStatus('invalid')
      return
    }
    setPseudoStatus('checking')
    pseudoTimer.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('pseudo_available', {
        p_pseudo: v,
      })
      if (error) {
        setPseudoStatus('idle')
        return
      }
      setPseudoStatus(data === true ? 'ok' : 'taken')
    }, 500)
    return () => {
      if (pseudoTimer.current) clearTimeout(pseudoTimer.current)
    }
  }, [pseudo, mode])

  // On entering signup, try to auto-fill ville/pays from GPS (once).
  useEffect(() => {
    if (mode !== 'signup' || geoTried || !navigator.geolocation) return
    setGeoTried(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        reverseGeocode(pos.coords.latitude, pos.coords.longitude).then((r) => {
          if (!r) return
          setVille((cur) => cur || r.city)
          setCountry(r.country)
        })
      },
      () => {
        /* refused → leave the fields for manual entry */
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }, [mode, geoTried])

  // Sync mode to the recovery flag — fires when Supabase event lands
  // AFTER the component already mounted (e.g. user opened the email
  // link in a tab that already had /auth open).
  useEffect(() => {
    if (passwordRecovery && mode !== 'recover') setMode('recover')
  }, [passwordRecovery, mode])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        const cleanPseudo = pseudo.trim()
        if (!PSEUDO_RE.test(cleanPseudo))
          throw new Error(
            'Pseudo invalide (3-20 caractères : lettres, chiffres, _).',
          )
        if (pseudoStatus === 'taken')
          throw new Error('Ce pseudo est déjà pris.')
        const cleanedCode = referralCode.trim().toUpperCase().slice(0, 6)
        // Profile fields (pseudo/ville/pays) + referral are stashed in
        // user_metadata so they survive the email-confirm round-trip;
        // MainLayout hydrates them into `profiles` on first login.
        const meta: Record<string, string> = {
          pseudo: cleanPseudo,
          ville: ville.trim(),
          country: country.trim(),
        }
        if (cleanedCode.length === 6) meta.referral_code = cleanedCode
        const { data: signupData, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: meta },
        })
        if (error) throw error
        if (cleanedCode.length === 6) stashPendingReferral(cleanedCode)
        // Auto-populate the local password vault so the Settings →
        // Sécurité → "Voir mon mot de passe" row reveals correctly
        // on this browser. No checkbox — the feature is always-on,
        // matching what most native PWAs do via the OS keychain.
        // clearVault() runs on every signout / account-delete path so
        // a different user on the same browser never inherits this.
        if (signupData?.user?.id) {
          await storeVault(signupData.user.id, password)
        }
        setInfo('Compte créé. Vérifie ta boîte mail pour confirmer.')
      } else if (mode === 'forgot') {
        // Supabase sends a password-reset email pointing to redirectTo
        // with a `#access_token=…&type=recovery` hash. We route to
        // /auth?reset=1 so the redirected page enters recover mode
        // even if the email client strips the hash. The redirect
        // origin is forced to the prod URL when the request fires
        // from localhost so dev testing produces working email links.
        const redirectTo = `${resetRedirectOrigin()}/reset-password`
        const { error } = await supabase.auth.resetPasswordForEmail(
          email,
          { redirectTo },
        )
        if (error) throw error
        setInfo(
          "Un email t'a été envoyé avec un lien pour créer un nouveau mot de passe.",
        )
      } else if (mode === 'recover') {
        // User landed back from the email link. supabase-js already
        // captured the access token from the URL hash and elevated
        // them to a recovery session; updateUser changes the password
        // for that authenticated user.
        if (password.length < 6) throw new Error('Mot de passe trop court (min. 6 caractères).')
        if (password !== confirmPassword) throw new Error('Les deux mots de passe ne correspondent pas.')
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        // Clear the recovery flag and route the user back to login —
        // they'll log in fresh with the new password. Clear the hash
        // so a reload doesn't re-enter recover mode.
        setPasswordRecovery(false)
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', '/auth')
        }
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setInfo('Mot de passe mis à jour. Connecte-toi avec le nouveau.')
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        // Always-on local password vault — same behaviour as native
        // PWAs that use the OS keychain. clearVault() runs on every
        // signout / account-delete path so the next user on the same
        // browser never inherits the prior password.
        if (data?.user?.id) {
          await storeVault(data.user.id, password)
        }
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

        {/* Social login — Apple first (iOS requirement), then Google,
            then an "ou" divider. Hidden during password-reset flows. */}
        {mode !== 'forgot' && mode !== 'recover' && (
          <div className="mb-6 space-y-2.5">
            <button
              type="button"
              onClick={() => oauth('apple')}
              disabled={loading}
              className="tappable flex w-full items-center justify-center gap-2.5 rounded-full py-3.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: '#000', color: '#fff', border: '1px solid rgba(255,255,255,0.55)' }}
            >
              <svg width="15" height="18" viewBox="0 0 384 512" fill="#fff" aria-hidden>
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C60.5 141.6 0 184.4 0 271.6c0 25.7 4.7 52.3 14.1 79.7 12.6 36.2 57.9 124.9 105.3 123.5 24.8-.6 42.3-17.6 74.5-17.6 31.2 0 47.4 17.6 76.4 17.6 47.8-.7 88.8-81.4 100.7-117.7-64-30.2-60.6-88.5-60.6-90.4zm-39.6-238C309.3 -5.9 297.9 0 297.9 0s4.9 35.4-18.8 60.7c-25.4 27.1-58.6 22.5-58.6 22.5s-5.3-31.5 20.6-58.5z" />
              </svg>
              Continuer avec Apple
            </button>
            <button
              type="button"
              onClick={() => oauth('google')}
              disabled={loading}
              className="tappable flex w-full items-center justify-center gap-2.5 rounded-full py-3.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: '#fff', color: '#1f1f1f' }}
            >
              <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.7 5.2-4.9 7.3l7.6 5.9c4.5-4.2 7.1-10.3 7.1-16.8z"/>
                <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.7-4.7l-7.8-6.1C.9 16.2 0 19.9 0 24s.9 7.8 2.6 11.2l7.8-6.5z"/>
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2 1.4-4.8 2.4-8.3 2.4-6.4 0-11.8-3.8-13.7-9.3l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/>
              </svg>
              Continuer avec Google
            </button>
            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-fg/10" />
              <span className="text-[11px] font-medium text-fg2/70">ou</span>
              <span className="h-px flex-1 bg-fg/10" />
            </div>
          </div>
        )}

        {/* Segmented control — Connexion / Inscription. Hidden when
            mode is forgot or recover so the password-reset flows stay
            focused. */}
        {mode !== 'forgot' && mode !== 'recover' && <div
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

        {mode === 'recover' && (
          <p className="px-1 text-center text-sm text-fg2">
            Choisis ton nouveau mot de passe. Une fois validé, tu seras
            renvoyé sur l'écran de connexion.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {mode !== 'recover' && (
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={setEmail}
              placeholder="toi@exemple.com"
            />
          )}

          {mode === 'recover' && (
            <>
              <PasswordField
                label="Nouveau mot de passe"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={setPassword}
              />
              <PasswordField
                label="Confirme le nouveau mot de passe"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
            </>
          )}

          {mode !== 'forgot' && (
            <div className="space-y-1.5">
              <PasswordField
                label="Mot de passe"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                required
                minLength={mode === 'signup' ? 8 : 6}
                value={password}
                onChange={setPassword}
                hint={mode === 'signup' ? 'Minimum 8 caractères.' : undefined}
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
            <>
              {/* Pseudo — real-time uniqueness check */}
              <div className="space-y-1">
                <Field
                  label="Pseudo"
                  type="text"
                  autoComplete="username"
                  required
                  maxLength={20}
                  value={pseudo}
                  onChange={(v) => setPseudo(v.replace(/\s/g, ''))}
                  placeholder="ton_pseudo"
                  adornment={
                    pseudoStatus === 'checking' ? (
                      <span className="text-[12px] text-fg2/60">…</span>
                    ) : pseudoStatus === 'ok' ? (
                      <span className="text-[14px] font-bold text-emerald-400">✓</span>
                    ) : pseudoStatus === 'taken' ||
                      pseudoStatus === 'invalid' ? (
                      <span className="text-[14px] font-bold text-accent">✗</span>
                    ) : null
                  }
                />
                {pseudoStatus === 'invalid' && (
                  <p className="px-1 text-[11px] text-accent">
                    3-20 caractères : lettres, chiffres ou _ uniquement.
                  </p>
                )}
                {pseudoStatus === 'taken' && (
                  <p className="px-1 text-[11px] text-accent">
                    Ce pseudo est déjà pris.
                  </p>
                )}
              </div>

              {/* Ville — auto-détectée si géoloc accordée */}
              <Field
                label="Ville"
                type="text"
                autoComplete="address-level2"
                value={ville}
                onChange={setVille}
                placeholder="Ex: Annecy"
              />

              {/* Pays — auto-détecté, modifiable */}
              <label className="block space-y-1.5">
                <span className="label-up block px-1 text-[10px] text-fg2">
                  Pays
                </span>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full appearance-none rounded-2xl bg-card px-4 py-3.5 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/45"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {!COUNTRY_NAMES.includes(country) && country && (
                    <option value={country}>{country}</option>
                  )}
                  {COUNTRY_NAMES.map((c) => (
                    <option key={c} value={c} className="bg-bg">
                      {c}
                    </option>
                  ))}
                </select>
              </label>

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
            </>
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
            disabled={
              loading ||
              (mode === 'signup' &&
                (pseudo.trim().length === 0 ||
                  pseudoStatus === 'invalid' ||
                  pseudoStatus === 'taken' ||
                  pseudoStatus === 'checking'))
            }
            className="tappable mt-2 w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg transition-opacity disabled:opacity-50"
            style={{ boxShadow: '0 10px 28px rgba(232,32,58,0.45)' }}
          >
            {loading
              ? '…'
              : mode === 'login'
                ? 'SE CONNECTER'
                : mode === 'signup'
                  ? "S'INSCRIRE"
                  : mode === 'recover'
                    ? 'METTRE À JOUR LE MOT DE PASSE'
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
  adornment,
  ...inputProps
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  valueClassName?: string
  adornment?: React.ReactNode
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'className'
>) {
  return (
    <label className="block space-y-1.5">
      <span className="label-up block px-1 text-[10px] text-fg2">{label}</span>
      <div className="relative">
        <input
          {...inputProps}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-2xl bg-card px-4 py-3.5 text-sm text-fg placeholder-fg2/60 outline-none transition-shadow focus:ring-2 focus:ring-accent/45 ${
            adornment ? 'pr-11' : ''
          } ${valueClassName}`}
          style={{ border: '1px solid var(--color-border)' }}
        />
        {adornment && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {adornment}
          </span>
        )}
      </div>
      {hint && <span className="block px-1 text-[11px] text-fg2/80">{hint}</span>}
    </label>
  )
}

// Password field with a built-in show/hide eye. Used for EVERY password
// input across the app (login, signup, recover, reset) so the toggle is
// always available.
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  placeholder = '••••••••',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  minLength?: number
  required?: boolean
  placeholder?: string
  hint?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <Field
      label={label}
      type={show ? 'text' : 'password'}
      autoComplete={autoComplete}
      minLength={minLength}
      required={required}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      hint={hint}
      adornment={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          className="tappable flex h-6 w-6 items-center justify-center text-fg2 hover:text-fg"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  )
}
