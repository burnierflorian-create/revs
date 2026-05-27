import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Gamepad2, Zap } from 'lucide-react'

/** Index page for in-app games. For now only REVS RACE is wired
 *  (Phase 1 = solo vs AI). Future games slot in as additional cards
 *  in the same grid. */
export default function Games() {
  const navigate = useNavigate()
  return (
    <div
      className="min-h-screen bg-bg px-4 text-fg"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="flex items-center gap-2 display-xl text-fg">
          <Gamepad2 className="h-7 w-7 text-accent" />
          Jeux REVS
        </h1>
      </div>

      <p className="mb-5 text-sm text-fg2">
        Mini-jeux pour gagner de l'XP entre deux spots. Un seul disponible
        pour l'instant.
      </p>

      <div className="space-y-3">
        <button
          onClick={() => navigate('/race')}
          className="tappable relative w-full overflow-hidden rounded-3xl p-5 text-left"
          style={{
            background:
              'linear-gradient(135deg, #1c0a0d 0%, #2a0c11 50%, #14080a 100%)',
            border: '1px solid rgba(232, 32, 58, 0.30)',
            boxShadow: '0 14px 32px rgba(232, 32, 58, 0.18)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="font-display tracking-tighter text-fg"
                style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1 }}
              >
                REVS RACE
              </p>
              <p className="mt-1.5 text-[13px] text-fg/80">
                Drag race contre une IA. Choisis ta carte, vise le départ
                parfait, empoche l'enjeu.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className="rounded-full bg-accent/20 px-2.5 py-1 font-extrabold uppercase tracking-wider text-accent"
                  style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}
                >
                  Solo · IA
                </span>
                <span
                  className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 font-extrabold uppercase tracking-wider text-fg/70"
                  style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}
                >
                  <Zap className="h-3 w-3" /> jusqu'à +1000 XP
                </span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 flex-none text-fg2" />
          </div>
        </button>

        <div
          className="flex items-center gap-3 rounded-2xl bg-card/60 p-4 text-[12px] text-fg2"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <Gamepad2 className="h-4 w-4 flex-none" />
          <span>
            Multi-joueur, défi d'amis et matchmaking aléatoire arrivent
            dans la prochaine mise à jour.
          </span>
        </div>
      </div>
    </div>
  )
}
