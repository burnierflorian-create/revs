import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Radar as RadarIcon, MapPin, Crown } from 'lucide-react'
import {
  fetchMyRadarPrefs,
  getCurrentPosition,
  saveRadarPrefs,
  type RadarPrefs,
} from '../lib/radar'
import { supabase } from '../lib/supabase'
import { Skeleton } from '../components/Skeleton'

const RADIUS_OPTIONS: { value: 5 | 10 | 20; label: string }[] = [
  { value: 5, label: '5 km' },
  { value: 10, label: '10 km' },
  { value: 20, label: '20 km' },
]

const DEFAULT_PREFS: RadarPrefs = {
  enabled: false,
  radius_km: 10,
  lat: null,
  lng: null,
  updated_at: '',
}

export default function Radar() {
  const navigate = useNavigate()
  const [tier, setTier] = useState<'premium' | 'vip' | null | 'loading'>('loading')
  const [prefs, setPrefs] = useState<RadarPrefs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (active) setTier(null)
        return
      }
      const { data: t } = await supabase.rpc('user_tier', { p_user: user.id })
      if (!active) return
      setTier((t as 'premium' | 'vip' | null) ?? null)
      const p = await fetchMyRadarPrefs()
      if (active) setPrefs(p ?? DEFAULT_PREFS)
    })()
    return () => {
      active = false
    }
  }, [])

  async function toggle(next: boolean) {
    if (!prefs || busy) return
    setError(null)
    setBusy(true)
    try {
      // First-time activation: capture the user's location so we can
      // compute distance to incoming spots.
      let lat = prefs.lat
      let lng = prefs.lng
      if (next && (lat === null || lng === null)) {
        try {
          const pos = await getCurrentPosition()
          lat = pos.lat
          lng = pos.lng
        } catch {
          setError('Active la géolocalisation pour utiliser le Mode Radar.')
          setBusy(false)
          return
        }
      }
      const saved = await saveRadarPrefs({ enabled: next, lat, lng })
      if (saved) setPrefs(saved)
    } finally {
      setBusy(false)
    }
  }

  async function setRadius(r: 5 | 10 | 20) {
    if (!prefs || busy) return
    setBusy(true)
    const saved = await saveRadarPrefs({ radius_km: r })
    if (saved) setPrefs(saved)
    setBusy(false)
  }

  async function refreshLocation() {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const pos = await getCurrentPosition()
      const saved = await saveRadarPrefs({ lat: pos.lat, lng: pos.lng })
      if (saved) setPrefs(saved)
    } catch {
      setError('Impossible de récupérer ta position. Vérifie les permissions du navigateur.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="flex items-center gap-2 display-xl text-fg">
          <RadarIcon className="h-7 w-7 text-accent" />
          Mode Radar
        </h1>
      </div>

      <p className="mb-6 text-sm text-fg2">
        Reçois une notification dès qu'une voiture est spottée dans ton rayon.
      </p>

      {tier === 'loading' || prefs === null ? (
        <Skeleton className="h-56 rounded-3xl" />
      ) : tier === null || tier === undefined ? (
        <div
          className="rounded-3xl p-6 text-center"
          style={{
            background:
              'linear-gradient(155deg, rgba(232,32,58,0.18) 0%, rgba(232,32,58,0.04) 50%, rgb(var(--color-card) / 0.95) 90%)',
            border: '1px solid rgba(232,32,58,0.4)',
            boxShadow: '0 12px 36px rgba(232,32,58,0.16)',
          }}
        >
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: 'rgba(232,32,58,0.15)',
              border: '1px solid rgba(232,32,58,0.45)',
            }}
          >
            <Crown className="h-7 w-7 text-accent" />
          </div>
          <p className="mt-4 font-display text-xl font-extrabold tracking-tighter text-fg">
            Réservé aux membres Premium
          </p>
          <p className="mt-2 text-sm text-fg2">
            Active un abonnement Premium ou VIP pour débloquer le Mode Radar.
          </p>
          <button
            onClick={() => navigate('/premium')}
            className="tappable mt-5 rounded-full bg-accent px-5 py-3 text-sm font-extrabold tracking-wider text-fg"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            DÉCOUVRIR PREMIUM ⚡
          </button>
        </div>
      ) : (
        <>
          {/* Toggle card — radar pulsing rings derrière quand actif */}
          <div
            className="relative overflow-hidden rounded-3xl bg-card p-5"
            style={{
              border: prefs.enabled
                ? '1px solid rgba(232,32,58,0.45)'
                : '1px solid var(--color-border)',
              boxShadow: prefs.enabled
                ? '0 0 32px rgba(232,32,58,0.2)'
                : undefined,
            }}
          >
            {prefs.enabled && (
              <div
                aria-hidden
                className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2"
              >
                <div className="relative h-44 w-44">
                  {[0, 0.8, 1.6].map((delay) => (
                    <span
                      key={delay}
                      className="radar-ping absolute inset-0 rounded-full border border-accent/55"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                  <span className="absolute inset-0 m-auto h-3 w-3 rounded-full bg-accent shadow-glow" />
                </div>
              </div>
            )}
            <div className="relative flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-lg font-extrabold tracking-tighter text-fg">
                  Mode Radar
                </p>
                <p
                  className={`label-up mt-1 text-[10px] ${
                    prefs.enabled ? 'text-accent' : 'text-fg2'
                  }`}
                >
                  {prefs.enabled ? 'ACTIF — TU SERAS NOTIFIÉ' : 'DÉSACTIVÉ'}
                </p>
              </div>
              <button
                onClick={() => toggle(!prefs.enabled)}
                disabled={busy}
                className={`relative h-7 w-12 flex-none rounded-full transition-colors disabled:opacity-50 ${
                  prefs.enabled ? 'bg-accent' : 'bg-fg/15'
                }`}
                aria-pressed={prefs.enabled}
                style={
                  prefs.enabled
                    ? { boxShadow: '0 0 12px rgba(232,32,58,0.45)' }
                    : undefined
                }
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-transform ${
                    prefs.enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {error && (
              <p className="relative mt-3 text-xs text-accent">{error}</p>
            )}
          </div>

          {/* Radius selector */}
          {prefs.enabled && (
            <>
              <div
                className="mt-4 rounded-3xl bg-card p-5"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <p className="label-up text-[10px] text-fg2">
                  Rayon de détection
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {RADIUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setRadius(opt.value)}
                      disabled={busy}
                      className={`tappable rounded-2xl py-3 text-sm font-extrabold tracking-wider transition-colors disabled:opacity-50 ${
                        prefs.radius_km === opt.value
                          ? 'bg-accent text-fg'
                          : 'bg-fg/[0.04] text-fg2 hover:bg-fg/[0.08]'
                      }`}
                      style={
                        prefs.radius_km === opt.value
                          ? { boxShadow: '0 6px 18px rgba(232,32,58,0.35)' }
                          : { border: '1px solid var(--color-border)' }
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div
                className="mt-4 rounded-3xl bg-card p-5"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center gap-2 text-fg2">
                  <MapPin className="h-4 w-4 text-accent" />
                  <span className="label-up text-[10px]">
                    Position de référence
                  </span>
                </div>
                <p className="mt-2 font-display text-base font-extrabold tracking-tighter text-fg">
                  {prefs.lat !== null && prefs.lng !== null
                    ? `${prefs.lat.toFixed(4)}, ${prefs.lng.toFixed(4)}`
                    : '—'}
                </p>
                <button
                  onClick={refreshLocation}
                  disabled={busy}
                  className="tappable mt-4 w-full rounded-full bg-fg/[0.06] py-3 text-sm font-bold tracking-wide text-fg/80 hover:bg-fg/[0.10] disabled:opacity-50"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {busy ? '…' : 'Actualiser ma position'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
