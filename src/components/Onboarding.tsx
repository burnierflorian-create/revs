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
              className="flex h-full shrink-0 flex-col items-center justify-center gap-6 px-10 text-center"
            >
              <Icon className="h-20 w-20 text-accent" strokeWidth={1.5} />
              <h1 className="text-3xl font-bold leading-tight">{title}</h1>
              <p className="max-w-xs text-base text-fg/60">{subtitle}</p>
            </section>
          ))}

          <section
            style={{ width: `${100 / TOTAL}%` }}
            className="flex h-full shrink-0 flex-col justify-center gap-6 px-8"
          >
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-bold">Crée ton profil</h1>
              <p className="text-sm text-fg/60">
                Ton pseudo et ta ville pour le classement des spotters
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-widest text-fg/40">
                  Pseudo
                </label>
                <input
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  maxLength={24}
                  placeholder="ex: speedhunter_75"
                  className="w-full rounded-lg bg-card px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-widest text-fg/40">
                  Ville
                </label>
                <input
                  value={ville}
                  onChange={(e) => setVille(e.target.value)}
                  maxLength={48}
                  placeholder="ex: Annecy"
                  className="w-full rounded-lg bg-card px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
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
                i === slide ? 'w-6 bg-accent' : 'w-2 bg-fg/20'
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={onForm && (!canFinish || saving)}
          className="w-full rounded-full bg-accent py-4 font-medium disabled:opacity-50"
        >
          {onForm ? (saving ? '…' : 'Commencer') : 'Continuer'}
        </button>
      </footer>
    </div>
  )
}
