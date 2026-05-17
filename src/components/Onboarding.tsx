import { useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Sparkles, Users } from 'lucide-react'

const STORAGE_KEY = 'revs_onboarded'

// localStorage can throw (private mode, blocked storage, sandboxed
// context). This runs during render, so it must never crash the app.
function isOnboarded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Storage unavailable: skip onboarding rather than block the app.
    return true
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* no-op: nothing we can do, just don't crash */
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

export default function Onboarding() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(() => !isOnboarded())
  const [slide, setSlide] = useState(0)

  if (!visible) return null

  const isLast = slide === SLIDES.length - 1

  function next() {
    if (isLast) {
      markOnboarded()
      setVisible(false)
      navigate('/map')
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
            width: '300%',
            transform: `translateX(-${slide * (100 / SLIDES.length)}%)`,
          }}
        >
          {SLIDES.map(({ icon: Icon, title, subtitle }) => (
            <section
              key={title}
              className="flex h-full w-1/3 shrink-0 flex-col items-center justify-center gap-6 px-10 text-center"
            >
              <Icon className="h-20 w-20 text-accent" strokeWidth={1.5} />
              <h1 className="text-3xl font-bold leading-tight">{title}</h1>
              <p className="max-w-xs text-base text-fg/60">{subtitle}</p>
            </section>
          ))}
        </div>
      </div>

      <footer className="space-y-7 px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex justify-center gap-2">
          {SLIDES.map((s, i) => (
            <span
              key={s.title}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === slide ? 'w-6 bg-accent' : 'w-2 bg-fg/20'
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-full rounded-full bg-accent py-4 font-medium"
        >
          {isLast ? 'Commencer' : 'Continuer'}
        </button>
      </footer>
    </div>
  )
}
