import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bell, Check, MapPin, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { searchCars, CAR_MAKES } from '../lib/cars'
import { currentLang, type Lang } from '../i18n'
import {
  UNIVERSES,
  AMBITIONS,
  MAX_BRANDS,
  MAX_UNIVERSES,
  toggleCapped,
} from '../lib/passions'

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
// 10-step flow: language → founder hello → "why these questions" intro →
// the passion questionnaire (brands, dream car, universes, ambition) →
// discovery source → notification + location permissions. Last step =
// S_GEO, which finishes the flow via advance().
const TOTAL = 10

// Step indices (kept named for readability).
const S_LANG = 0
const S_FLORIAN = 1
const S_WHY = 2
const S_BRANDS = 3
const S_DREAM = 4
const S_UNIVERSES = 5
const S_AMBITION = 6
const S_SOURCE = 7
const S_NOTIF = 8
const S_GEO = 9

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
  const { t, i18n } = useTranslation()

  // null = still deciding (no flash); false = hidden; true = show.
  const [show, setShow] = useState<boolean | null>(null)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')

  // Answers.
  const [lang, setLang] = useState<Lang>(() => currentLang())
  const [dreamQuery, setDreamQuery] = useState('')
  const [dreamCar, setDreamCar] = useState('')
  const [brandQuery, setBrandQuery] = useState('')
  const [preferredBrands, setPreferredBrands] = useState<string[]>([])
  const [preferredUniverses, setPreferredUniverses] = useState<string[]>([])
  const [ambition, setAmbition] = useState<string | null>(null)
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
  // Advance to the next step, or finish the onboarding on the last one — so
  // whichever step is last (now S_GEO) closes the flow, no matter the count.
  function advance() {
    if (step >= TOTAL - 1) finish()
    else goNext()
  }

  function pickLang(l: Lang) {
    setLang(l)
    // 1) flip the live UI language (the root re-renders the whole tree),
    void i18n.changeLanguage(l)
    // 2) persist the choice to localStorage (i18next's conventional key),
    try {
      localStorage.setItem('i18nextLng', l)
    } catch {
      /* ignore */
    }
    // 3) mirror to profiles.language (best-effort) so it follows the user
    //    across devices even if they drop off before finishing.
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('profiles')
          .update({ language: l })
          .eq('user_id', user.id)
      }
    })()
  }

  function toggleBrand(id: string) {
    setPreferredBrands((prev) => toggleCapped(prev, id, MAX_BRANDS))
  }
  function toggleUniverse(id: string) {
    setPreferredUniverses((prev) => toggleCapped(prev, id, MAX_UNIVERSES))
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
    advance()
  }

  function requestGeo() {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          () => {
            // Remember the granted choice so no screen ever needs to re-ask.
            try {
              localStorage.setItem('revs_geo', '1')
            } catch {
              /* ignore */
            }
            setGeoOn(true)
            advance()
          },
          () => {
            try {
              localStorage.setItem('revs_geo', '0')
            } catch {
              /* ignore */
            }
            advance()
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 },
        )
        return
      }
    } catch {
      /* ignore */
    }
    advance()
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
            preferred_brands: preferredBrands,
            preferred_universes: preferredUniverses,
            ambition,
            discovery_source: source,
          })
          .eq('user_id', user.id)
      }
    })()
    setShow(false)
    navigate('/map')
  }

  if (!show) return null

  // Autocomplete over the full car database (src/lib/cars.ts) — so "Maserati"
  // surfaces MC20/Ghibli/Levante…, etc.
  const dreamSuggestions = searchCars(dreamQuery, 8)

  // Brand picker list — the full make catalogue, filtered live by the
  // search box. Empty query shows every make (scrollable).
  const brandQ = brandQuery.trim().toLowerCase()
  const brandList = brandQ
    ? CAR_MAKES.filter((m) => m.toLowerCase().includes(brandQ))
    : CAR_MAKES
  const brandsFull = preferredBrands.length >= MAX_BRANDS
  const universesFull = preferredUniverses.length >= MAX_UNIVERSES

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
        return primary(t('onboarding.ui.continue'), advance)
      case S_FLORIAN:
        return primary(t('onboarding.florian.cta'), advance)
      case S_WHY:
        return primary(t('onboarding.why.cta'), advance)
      case S_BRANDS:
        return primary(
          t('onboarding.ui.continue'),
          advance,
          preferredBrands.length === 0,
        )
      case S_DREAM:
        return (
          <>
            {primary(t('onboarding.ui.continue'), advance)}
            {!dreamCar && secondary(t('onboarding.dreamCar.skip'), advance)}
          </>
        )
      case S_UNIVERSES:
        return primary(
          t('onboarding.ui.continue'),
          advance,
          preferredUniverses.length === 0,
        )
      case S_AMBITION:
        return primary(t('onboarding.ui.continue'), advance, ambition === null)
      case S_SOURCE:
        return primary(t('onboarding.ui.continue'), advance, source === null)
      case S_NOTIF:
        return (
          <>
            {primary(
              notifOn
                ? t('onboarding.notifications.enabled')
                : t('onboarding.notifications.enable'),
              notifOn ? advance : requestNotif,
            )}
            {!notifOn && secondary(t('onboarding.notifications.skip'), advance)}
          </>
        )
      case S_GEO:
        return (
          <>
            {primary(
              geoOn
                ? t('onboarding.location.enabled')
                : t('onboarding.location.enable'),
              geoOn ? advance : requestGeo,
            )}
            {!geoOn && secondary(t('onboarding.location.skip'), advance)}
          </>
        )
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
              {/* Portrait réduit de 112 à 88 px sur CE seul écran : le mot du
                  créateur est le texte le plus long du parcours, et les 24 px
                  récupérés sont autant de lignes lues sans défiler. */}
              <div
                className="mb-5 h-[88px] w-[88px] shrink-0 overflow-hidden rounded-full"
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
              {/* Le mot du créateur fait désormais plusieurs paragraphes. Un
                  seul bloc de texte de cette longueur devient un mur illisible
                  sur 375 px : on découpe sur les sauts de ligne de la
                  traduction plutôt que de figer les paragraphes dans le code,
                  pour que FR et EN restent modifiables sans toucher au JSX. */}
              <div
                className="flex flex-col gap-2.5 rounded-3xl px-5 py-4 text-left text-[13.5px] leading-[1.55] text-white/80"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                {t('onboarding.florian.body')
                  .split('\n\n')
                  .map((para) => (
                    <p key={para.slice(0, 24)}>{para}</p>
                  ))}
                <p className="pt-1 font-semibold text-white">
                  {t('onboarding.florian.closing')}
                </p>
              </div>
              {/* pb : la zone de défilement partagée n'a pas de marge basse —
                  les autres étapes tiennent à l'écran, celle-ci non. Sans elle
                  la dernière ligne mourait collée sous le bouton. */}
              <p
                className="mt-4 pb-2 text-[13px] font-extrabold uppercase"
                style={{ color: RED, letterSpacing: '0.16em' }}
              >
                {t('onboarding.florian.signature')}
              </p>
            </div>
          </StepShell>
        )

      case S_WHY:
        return (
          <StepShell
            title={t('onboarding.why.title')}
            subtitle={t('onboarding.why.body')}
          />
        )

      case S_BRANDS:
        return (
          <StepShell
            title={t('onboarding.brands.title')}
            subtitle={t('onboarding.brands.subtitle')}
          >
            {/* Selected chips — removable, always visible even while the
                list below is filtered by search. */}
            {preferredBrands.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {preferredBrands.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBrand(b)}
                    className="tappable flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold active:scale-95"
                    style={{
                      background: 'rgba(232,32,58,0.16)',
                      border: `1px solid ${RED}`,
                      color: '#fff',
                    }}
                  >
                    {b}
                    <span className="text-white/70">×</span>
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={brandQuery}
                onChange={(e) => setBrandQuery(e.target.value)}
                placeholder={t('onboarding.brands.searchPlaceholder')}
                className="w-full rounded-2xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-accent/45"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1.5px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              />
            </div>
            <p className="mt-2 px-1 text-[11px] text-white/40">
              {preferredBrands.length}/{MAX_BRANDS} · {t('onboarding.brands.maxHint')}
            </p>
            <div className="mt-3 grid max-h-[42vh] grid-cols-2 gap-2.5 overflow-y-auto pr-1">
              {brandList.map((b) => {
                const sel = preferredBrands.includes(b)
                const capped = !sel && brandsFull
                return (
                  <OptionButton
                    key={b}
                    selected={sel}
                    onClick={() => toggleBrand(b)}
                    className={`flex items-center justify-between gap-2 ${
                      capped ? 'opacity-40' : ''
                    }`}
                  >
                    <span className="truncate">{b}</span>
                    {sel && (
                      <Check className="h-4 w-4 flex-none" style={{ color: RED }} />
                    )}
                  </OptionButton>
                )
              })}
              {brandList.length === 0 && (
                <p className="col-span-2 py-6 text-center text-[13px] text-white/40">
                  {t('onboarding.brands.empty')}
                </p>
              )}
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

      case S_UNIVERSES:
        return (
          <StepShell
            title={t('onboarding.universes.title')}
            subtitle={t('onboarding.universes.subtitle')}
          >
            <p className="mb-3 px-1 text-[11px] text-white/40">
              {preferredUniverses.length}/{MAX_UNIVERSES} ·{' '}
              {t('onboarding.universes.maxHint')}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {UNIVERSES.map((id) => {
                const sel = preferredUniverses.includes(id)
                const capped = !sel && universesFull
                return (
                  <OptionButton
                    key={id}
                    selected={sel}
                    onClick={() => toggleUniverse(id)}
                    className={`flex items-center justify-between gap-2 ${
                      capped ? 'opacity-40' : ''
                    }`}
                  >
                    <span className="truncate">
                      {t(`onboarding.universes.options.${id}`)}
                    </span>
                    {sel && (
                      <Check className="h-4 w-4 flex-none" style={{ color: RED }} />
                    )}
                  </OptionButton>
                )
              })}
            </div>
          </StepShell>
        )

      case S_AMBITION:
        return (
          <StepShell
            title={t('onboarding.ambition.title')}
            subtitle={t('onboarding.ambition.subtitle')}
          >
            <div className="flex flex-col gap-2.5">
              {AMBITIONS.map((id) => (
                <OptionButton
                  key={id}
                  selected={ambition === id}
                  onClick={() => setAmbition(id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span>{t(`onboarding.ambition.options.${id}`)}</span>
                  {ambition === id && (
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
