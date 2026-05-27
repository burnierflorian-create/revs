import { useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Sparkles, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'revs_onboarded'

// localStorage can throw (private mode, blocked storage, sandboxed
// context). This runs during render, so it must never crash the app.
function isOnboarded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* no-op */
  }
}

// Fire the permission prompts in order — geolocation first (needed to
// spot), then notifications. Must run synchronously from the click
// (no await before) so iOS Safari / iOS PWA surface the geo prompt.
// Refusal is fine: the app keeps working, changeable later in Settings.
function kickoffPermissions() {
  try {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 },
      )
    }
  } catch {
    /* ignore */
  }
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission()
        .then((p) => {
          try {
            localStorage.setItem(
              'revs_notifications',
              p === 'granted' ? '1' : '0',
            )
          } catch {
            /* ignore */
          }
        })
        .catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

type IconProps = { className?: string; strokeWidth?: number }

type Slide = {
  icon: ComponentType<IconProps>
  title: string
  subtitle: string
}

const SLIDES: Slide[] = [
  {
    icon: Camera,
    title: 'Spotte les supercars autour de toi',
    subtitle: 'Chaque voiture exceptionnelle mérite d’être sur la carte',
  },
  {
    icon: Sparkles,
    title: "L'IA reconnaît la voiture automatiquement",
    subtitle: 'Marque, modèle, année, couleur — en quelques secondes',
  },
  {
    icon: Users,
    title: 'Rejoins la communauté REVS',
    subtitle: 'Des passionnés de supercars, F1 et culture auto',
  },
]

// 3 info slides + a final profile form.
const TOTAL = SLIDES.length + 1
const FORM_INDEX = SLIDES.length

export default function Onboarding() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(() => !isOnboarded())
  const [slide, setSlide] = useState(0)
  const [pseudo, setPseudo] = useState('')
  const [ville, setVille] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!visible) return null

  const onForm = slide === FORM_INDEX
  const canFinish = pseudo.trim().length > 0 && ville.trim().length > 0

  async function finish() {
    // Request permissions within the user gesture, before any await.
    kickoffPermissions()
    setError(null)
    setSaving(true)
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser()
      if (authErr || !auth.user) {
        console.error('onboarding: not authenticated', authErr)
        setError('Tu n’es pas connecté. Reconnecte-toi puis réessaie.')
        setSaving(false)
        return
      }

      const { error: upErr } = await supabase.from('profiles').upsert(
        {
          user_id: auth.user.id,
          pseudo: pseudo.trim(),
          ville: ville.trim(),
        },
        { onConflict: 'user_id' },
      )

      if (upErr) {
        // Supabase returns a PostgrestError object (NOT an Error
        // instance), so the message was being swallowed before.
        console.error('profile upsert failed:', {
          code: upErr.code,
          message: upErr.message,
          details: upErr.details,
          hint: upErr.hint,
        })
        setError(
          `Profil non enregistré (${upErr.code ?? 'erreur'}): ${upErr.message}`,
        )
        setSaving(false)
        return
      }

      markOnboarded()
      setVisible(false)
      navigate('/map')
    } catch (e) {
      console.error('onboarding finish crashed:', e)
      setError(
        e instanceof Error ? e.message : 'Impossible d’enregistrer le profil',
      )
      setSaving(false)
    }
  }

  function next() {
    if (onForm) {
      finish()
      return
    }
    setSlide((s) => s + 1)
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-bg text-fg">
      <div className="flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{
            width: `${TOTAL * 100}%`,
            transform: `translateX(-${slide * (100 / TOTAL)}%)`,
          }}
        >
          {SLIDES.map(({ icon: Icon, title, subtitle }) => (
            <section
              key={title}
              style={{ width: `${100 / TOTAL}%` }}
              className="flex h-full shrink-0 flex-col items-center justify-center gap-7 px-10 text-center"
            >
              <div
                className="flex h-24 w-24 items-center justify-center rounded-full"
                style={{
                  background:
                    'linear-gradient(155deg, rgba(232,32,58,0.22) 0%, rgba(232,32,58,0.06) 70%, rgba(20,20,20,0.95) 100%)',
                  border: '1px solid rgba(232,32,58,0.40)',
                  boxShadow: '0 12px 36px rgba(232,32,58,0.30)',
                }}
              >
                <Icon className="h-11 w-11 text-accent" strokeWidth={1.6} />
              </div>
              <h1 className="font-display text-[34px] font-extrabold leading-[1.05] tracking-tighter text-fg">
                {title}
              </h1>
              <p className="max-w-xs text-base leading-relaxed text-fg2">
                {subtitle}
              </p>
            </section>
          ))}

          <section
            style={{ width: `${100 / TOTAL}%` }}
            className="flex h-full shrink-0 flex-col justify-center gap-7 px-8"
          >
            <div className="space-y-2 text-center">
              <h1 className="display-xl text-fg">Crée ton profil</h1>
              <p className="text-sm text-fg2">
                Ton pseudo et ta ville pour le classement des spotters
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="label-up text-[10px] text-fg2">Pseudo</label>
                <input
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  maxLength={24}
                  placeholder="ex: speedhunter_75"
                  className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none placeholder:text-fg2/40 focus:border-accent"
                  style={{ border: '1px solid var(--color-border)' }}
                />
              </div>
              <div className="space-y-2">
                <label className="label-up text-[10px] text-fg2">Ville</label>
                <input
                  value={ville}
                  onChange={(e) => setVille(e.target.value)}
                  maxLength={48}
                  placeholder="ex: Annecy"
                  className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none placeholder:text-fg2/40 focus:border-accent"
                  style={{ border: '1px solid var(--color-border)' }}
                />
              </div>
              {error && <p className="text-sm text-accent">{error}</p>}
            </div>
          </section>
        </div>
      </div>

      <footer className="space-y-7 px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex justify-center gap-2">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === slide ? 'w-7 bg-accent' : 'w-2 bg-fg2/30'
              }`}
              style={
                i === slide
                  ? { boxShadow: '0 0 10px rgba(232,32,58,0.55)' }
                  : undefined
              }
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={onForm && (!canFinish || saving)}
          className="tappable w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
          style={{ boxShadow: '0 12px 36px rgba(232,32,58,0.45)' }}
        >
          {onForm ? (saving ? '…' : 'COMMENCER') : 'CONTINUER'}
        </button>
      </footer>
    </div>
  )
}
