import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bell, Check, MapPin, Search, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setLanguage, currentLang, type Lang } from '../i18n'

// ─────────────────────────────────────────────────────────────────────
// First-launch onboarding — a linear 8-step flow (no guided tour). The
// SINGLE source of truth for whether to show it is
// profiles.onboarding_completed in Supabase: false / null / missing row →
// show; true → skip. No localStorage gate, so a server-side reset replays
// it for everyone. The user's answers (language, dream car, interests,
// discovery source) are persisted to profiles at the end.
//
// Design: full-screen #0a0a0a, accent #E8203A, glassmorphism cards, pure
// Tailwind + a couple of CSS keyframes (onb-step-fwd / onb-step-back).
// ─────────────────────────────────────────────────────────────────────

const RED = '#E8203A'
const TOTAL = 8

// Step indices (kept named for readability).
const S_LANG = 0
const S_FLORIAN = 1
const S_DREAM = 2
const S_INTERESTS = 3
const S_SOURCE = 4
const S_NOTIF = 5
const S_GEO = 6
const S_RULES = 7

// Dream-car suggestions — proper nouns, identical in both languages.
const DREAM_CARS = [
  'Ferrari F40',
  'Ferrari 488 Pista',
  'Lamborghini Aventador',
  'Lamborghini Huracán',
  'Porsche 911 GT3 RS',
  'Porsche 911 Turbo S',
  'McLaren 720S',
  'McLaren P1',
  'Bugatti Chiron',
  'Nissan GT-R R34',
  'Toyota GR Supra',
  'Mercedes-AMG GT',
  'BMW M4 Competition',
  'Audi R8 V10',
  'Aston Martin Vantage',
  'Ford Mustang GT',
  'Chevrolet Corvette C8',
  'Tesla Model S Plaid',
  'Pagani Huayra',
  'Koenigsegg Jesko',
  'Mazda RX-7',
  'Honda NSX',
]

const INTERESTS = [
  'supercars',
  'hypercars',
  'jdm',
  'classics',
  'f1',
  'electric',
  'tuning',
  'suvs',
  'american',
  'german',
  'italian',
  'rally',
] as const

const SOURCES = [
  'instagram',
  'tiktok',
  'youtube',
  'friend',
  'appstore',
  'search',
  'event',
  'other',
] as const

// Reusable glassmorphism option button. `selected` flips it to the red
// accent treatment.
function OptionButton({
  selected,
  onClick,
  children,
  className = '',
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tappable relative rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition-all active:scale-[0.98] ${className}`}
      style={{
        background: selected ? 'rgba(232,32,58,0.14)' : 'rgba(255,255,255,0.04)',
        border: `1.5px solid ${selected ? RED : 'rgba(255,255,255,0.1)'}`,
        color: selected ? '#fff' : 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: selected ? '0 0 22px rgba(232,32,58,0.3)' : undefined,
      }}
    >
      {children}
    </button>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  // null = still deciding (no flash); false = hidden; true = show.
  const [show, setShow] = useState<boolean | null>(null)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')

  // Answers.
  const [lang, setLang] = useState<Lang>(() => currentLang())
  const [dreamQuery, setDreamQuery] = useState('')
  const [dreamCar, setDreamCar] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [notifOn, setNotifOn] = useState(false)
  const [geoOn, setGeoOn] = useState(false)

  // Florian photo — /florian.jpg if present, else a gradient "F" avatar.
  const [photoOk, setPhotoOk] = useState(true)

  // Single source of truth = the DB flag. Show whenever it isn't
  // explicitly true (false / null / missing row → first launch).
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      if (!user) {
        setShow(false)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      const done =
        (data as { onboarding_completed?: boolean } | null)
          ?.onboarding_completed === true
      setShow(!done)
    })()
    return () => {
      active = false
    }
  }, [])

  function goNext() {
    setDir('fwd')
    setStep((s) => Math.min(s + 1, TOTAL - 1))
  }
  function goBack() {
    setDir('back')
    setStep((s) => Math.max(s - 1, 0))
  }

  function pickLang(l: Lang) {
    setLang(l)
    setLanguage(l) // apply immediately so the rest of the flow is in `l`
  }

  function toggleInterest(id: string) {
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function requestNotif() {
    try {
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        const perm = await Notification.requestPermission()
        setNotifOn(perm === 'granted')
      } else if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        setNotifOn(true)
      }
    } catch {
      /* ignore — unsupported */
    }
    goNext()
  }

  function requestGeo() {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          () => {
            setGeoOn(true)
            goNext()
          },
          () => goNext(),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 },
        )
        return
      }
    } catch {
      /* ignore */
    }
    goNext()
  }

  // Persist every answer + flip the completed flag, then close to the map.
  function finish() {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('profiles')
          .update({
            onboarding_completed: true,
            language: lang,
            dream_car: dreamCar.trim() || null,
            interests,
            discovery_source: source,
          })
          .eq('user_id', user.id)
      }
    })()
    setShow(false)
    navigate('/map')
  }

  if (!show) return null

  const dreamSuggestions = (() => {
    const q = dreamQuery.trim().toLowerCase()
    if (!q) return DREAM_CARS.slice(0, 6)
    return DREAM_CARS.filter((c) => c.toLowerCase().includes(q)).slice(0, 6)
  })()

  // ── Footer (primary CTA + optional secondary skip), per step ──
  function renderFooter() {
    const primary = (label: string, onClick: () => void, disabled = false) => (
      <button
        onClick={onClick}
        disabled={disabled}
        className="tappable w-full rounded-full py-4 text-base font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
        style={{ background: RED, boxShadow: '0 0 20px rgba(232,32,58,0.5)' }}
      >
        {label}
      </button>
    )
    const secondary = (label: string, onClick: () => void) => (
      <button
        onClick={onClick}
        className="tappable w-full py-3 text-center text-sm font-semibold text-white/45 transition-colors hover:text-white/80"
      >
        {label}
      </button>
    )

    switch (step) {
      case S_LANG:
        return primary(t('onboarding.ui.continue'), goNext)
      case S_FLORIAN:
        return primary(t('onboarding.florian.cta'), goNext)
      case S_DREAM:
        return (
          <>
            {primary(t('onboarding.ui.continue'), goNext)}
            {!dreamCar && secondary(t('onboarding.dreamCar.skip'), goNext)}
          </>
        )
      case S_INTERESTS:
        return primary(t('onboarding.ui.continue'), goNext, interests.length === 0)
      case S_SOURCE:
        return primary(t('onboarding.ui.continue'), goNext, source === null)
      case S_NOTIF:
        return (
          <>
            {primary(
              notifOn
                ? t('onboarding.notifications.enabled')
                : t('onboarding.notifications.enable'),
              notifOn ? goNext : requestNotif,
            )}
            {!notifOn && secondary(t('onboarding.notifications.skip'), goNext)}
          </>
        )
      case S_GEO:
        return (
          <>
            {primary(
              geoOn
                ? t('onboarding.location.enabled')
                : t('onboarding.location.enable'),
              geoOn ? goNext : requestGeo,
            )}
            {!geoOn && secondary(t('onboarding.location.skip'), goNext)}
          </>
        )
      case S_RULES:
        return primary(t('onboarding.rules.accept'), finish)
      default:
        return null
    }
  }

  // ── Step body ──
  function renderStep() {
    switch (step) {
      case S_LANG:
        return (
          <StepShell
            title={t('onboarding.lang.title')}
            subtitle={t('onboarding.lang.subtitle')}
          >
            <div className="flex flex-col gap-3">
              {(
                [
                  { code: 'fr' as Lang, flag: '🇫🇷', label: t('onboarding.lang.fr') },
                  { code: 'en' as Lang, flag: '🇬🇧', label: t('onboarding.lang.en') },
                ]
              ).map((o) => (
                <OptionButton
                  key={o.code}
                  selected={lang === o.code}
                  onClick={() => pickLang(o.code)}
                  className="flex items-center gap-4 !py-4"
                >
                  <span className="text-3xl leading-none">{o.flag}</span>
                  <span className="flex-1 text-[16px]">{o.label}</span>
                  {lang === o.code && (
                    <Check className="h-5 w-5" style={{ color: RED }} />
                  )}
                </OptionButton>
              ))}
            </div>
          </StepShell>
        )

      case S_FLORIAN:
        return (
          <StepShell title={t('onboarding.florian.title')}>
            <div className="flex flex-col items-center text-center">
              <div
                className="mb-6 h-28 w-28 overflow-hidden rounded-full"
                style={{
                  border: '2px solid rgba(232,32,58,0.6)',
                  boxShadow: '0 0 34px rgba(232,32,58,0.35)',
                }}
              >
                {photoOk ? (
                  <img
                    src="/florian.jpg"
                    alt="Florian"
                    onError={() => setPhotoOk(false)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center font-display text-4xl font-extrabold text-white"
                    style={{
                      background:
                        'linear-gradient(135deg, #E8203A 0%, #7a0f1c 100%)',
                    }}
                  >
                    F
                  </div>
                )}
              </div>
              <p
                className="rounded-3xl px-5 py-4 text-[14.5px] leading-relaxed text-white/80"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                {t('onboarding.florian.body')}
              </p>
              <p className="mt-4 text-[13px] font-semibold" style={{ color: RED }}>
                {t('onboarding.florian.signature')}
              </p>
            </div>
          </StepShell>
        )

      case S_DREAM:
        return (
          <StepShell
            title={t('onboarding.dreamCar.title')}
            subtitle={t('onboarding.dreamCar.subtitle')}
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={dreamQuery}
                onChange={(e) => {
                  setDreamQuery(e.target.value)
                  setDreamCar(e.target.value)
                }}
                placeholder={t('onboarding.dreamCar.placeholder')}
                className="w-full rounded-2xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-accent/45"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1.5px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              />
            </div>
            {dreamSuggestions.length > 0 && (
              <div className="mt-4">
                <p className="label-up mb-2 px-1 text-[10px] text-white/40">
                  {t('onboarding.dreamCar.suggestionsTitle')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {dreamSuggestions.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setDreamCar(c)
                        setDreamQuery(c)
                      }}
                      className="tappable rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all active:scale-95"
                      style={{
                        background:
                          dreamCar === c
                            ? 'rgba(232,32,58,0.16)'
                            : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${
                          dreamCar === c ? RED : 'rgba(255,255,255,0.12)'
                        }`,
                        color: dreamCar === c ? '#fff' : 'rgba(255,255,255,0.8)',
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </StepShell>
        )

      case S_INTERESTS:
        return (
          <StepShell
            title={t('onboarding.interests.title')}
            subtitle={t('onboarding.interests.subtitle')}
          >
            <div className="grid grid-cols-2 gap-2.5">
              {INTERESTS.map((id) => (
                <OptionButton
                  key={id}
                  selected={interests.includes(id)}
                  onClick={() => toggleInterest(id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {t(`onboarding.interests.options.${id}`)}
                  </span>
                  {interests.includes(id) && (
                    <Check className="h-4 w-4 flex-none" style={{ color: RED }} />
                  )}
                </OptionButton>
              ))}
            </div>
          </StepShell>
        )

      case S_SOURCE:
        return (
          <StepShell
            title={t('onboarding.source.title')}
            subtitle={t('onboarding.source.subtitle')}
          >
            <div className="flex flex-col gap-2.5">
              {SOURCES.map((id) => (
                <OptionButton
                  key={id}
                  selected={source === id}
                  onClick={() => setSource(id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span>{t(`onboarding.source.options.${id}`)}</span>
                  {source === id && (
                    <Check className="h-4 w-4 flex-none" style={{ color: RED }} />
                  )}
                </OptionButton>
              ))}
            </div>
          </StepShell>
        )

      case S_NOTIF:
        return (
          <StepShell
            icon={<Bell className="h-8 w-8" style={{ color: RED }} />}
            title={t('onboarding.notifications.title')}
            subtitle={t('onboarding.notifications.subtitle')}
            centered
          />
        )

      case S_GEO:
        return (
          <StepShell
            icon={<MapPin className="h-8 w-8" style={{ color: RED }} />}
            title={t('onboarding.location.title')}
            subtitle={t('onboarding.location.subtitle')}
            centered
          />
        )

      case S_RULES:
        return (
          <StepShell
            icon={<Shield className="h-8 w-8" style={{ color: RED }} />}
            title={t('onboarding.rules.title')}
            subtitle={t('onboarding.rules.subtitle')}
          >
            <div className="flex flex-col gap-3">
              {(['respect', 'privacy', 'safety', 'authentic'] as const).map(
                (k) => (
                  <div
                    key={k}
                    className="flex items-start gap-3 rounded-2xl px-4 py-3"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full"
                      style={{ background: 'rgba(232,32,58,0.16)' }}
                    >
                      <Check className="h-3.5 w-3.5" style={{ color: RED }} />
                    </span>
                    <span className="text-[13.5px] leading-snug text-white/80">
                      {t(`onboarding.rules.items.${k}`)}
                    </span>
                  </div>
                ),
              )}
            </div>
          </StepShell>
        )

      default:
        return null
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: 'var(--font-display, Inter, system-ui, sans-serif)',
      }}
    >
      {/* Backdrop red glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[45vh]"
        style={{
          background:
            'radial-gradient(ellipse 90% 100% at 50% 0%, rgba(232,32,58,0.28) 0%, rgba(232,32,58,0.05) 38%, transparent 66%)',
        }}
      />

      {/* Header — back button + progress bar + step counter */}
      <div
        className="relative z-10 flex items-center gap-3 px-5"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={goBack}
          aria-label={t('onboarding.ui.back')}
          className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full transition-opacity"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            opacity: step === 0 ? 0 : 1,
            pointerEvents: step === 0 ? 'none' : 'auto',
          }}
        >
          <ArrowLeft className="h-4 w-4 text-white" />
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full"
            style={{
              width: `${((step + 1) / TOTAL) * 100}%`,
              background: RED,
              boxShadow: '0 0 10px rgba(232,32,58,0.6)',
              transition: 'width 0.4s cubic-bezier(0.22,1,0.36,1)',
            }}
          />
        </div>
        <span className="flex-none text-[12px] font-bold tabular-nums text-white/45">
          {step + 1}/{TOTAL}
        </span>
      </div>

      {/* Body — animated per step */}
      <div className="relative z-10 flex-1 overflow-y-auto px-7 pt-8">
        <div
          key={step}
          style={{
            animation: `${
              dir === 'back' ? 'onb-step-back' : 'onb-step-fwd'
            } 0.35s cubic-bezier(0.22,1,0.36,1)`,
          }}
        >
          {renderStep()}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 px-7 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        {renderFooter()}
      </div>
    </div>
  )
}

// Shared step layout — optional centered icon, title, subtitle, body.
function StepShell({
  icon,
  title,
  subtitle,
  children,
  centered,
}: {
  icon?: React.ReactNode
  title: string
  subtitle?: string
  children?: React.ReactNode
  centered?: boolean
}) {
  return (
    <div className={centered ? 'flex flex-col items-center text-center' : ''}>
      {icon && (
        <div
          className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{
            background: 'rgba(232,32,58,0.12)',
            border: '1px solid rgba(232,32,58,0.3)',
          }}
        >
          {icon}
        </div>
      )}
      <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight">
        {title}
      </h1>
      {subtitle && (
        <p
          className={`mt-2.5 text-[14.5px] leading-relaxed text-white/55 ${
            centered ? 'max-w-[20rem]' : ''
          }`}
        >
          {subtitle}
        </p>
      )}
      {children && <div className="mt-7">{children}</div>}
    </div>
  )
}
