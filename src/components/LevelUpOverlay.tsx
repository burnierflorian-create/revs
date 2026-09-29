import { useEffect, useState } from 'react'
import { prefersReducedMotion, vibrate } from '../lib/motion'
import { fetchProgress, xpLevel } from '../lib/xp'
import { supabase } from '../lib/supabase'
import type { Rarity, Spot } from '../lib/spots'
import { rarityRank } from './CollectorCard'
import { openShareCard } from './ShareCardSheet'

const CHANNEL = 'revs:level-up'

/** After a level-up, surface the user's best card for a story share. */
async function offerBestCardShare(): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('spots')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    const list = (data ?? []) as Spot[]
    const withPhoto = list.filter((s) => s.photo_url)
    if (withPhoto.length === 0) return
    const best = [...withPhoto].sort(
      (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity),
    )[0]
    openShareCard({
      id: best.id,
      photoUrl: best.photo_url,
      brand: best.brand,
      model: best.model,
      year: best.year,
      rarity: (best.rarity ?? 'standard') as Rarity,
      autoMessage: 'Ta carte est prête à être partagée ! 🔥',
    })
  } catch {
    /* best-effort — never block */
  }
}
// ── CLÉ CHANGÉE À LA REFONTE DU 29/09/2026 ──
// L'ancienne clé stockait un NOM de palier (« Maître Spotter »). La nouvelle
// stocke un NUMÉRO de niveau. Changer de clé fait qu'au premier chargement
// après la refonte, chacun repart d'une base neuve et RIEN ne se déclenche —
// c'est exactement ce que demande la règle « ne pas jouer une animation par
// niveau franchi lors de la migration ». Un joueur qui passe de l'ancien
// palier 5/10 au nouveau niveau 9/100 ne verra aucune célébration rétroactive.
const LAST_LEVEL_KEY = 'revs_last_level_n'
const COLORS = ['#E8203A', '#C8A96E', '#ffffff']

type LevelUpDetail = { from: string; to: string }

/** Fire the full-screen level-up sequence directly (old → new tier). */
export function triggerLevelUp(from: string, to: string) {
  window.dispatchEvent(
    new CustomEvent<LevelUpDetail>(CHANNEL, { detail: { from, to } }),
  )
}

/**
 * Compare le niveau courant au dernier vu (localStorage) et déclenche
 * l'overlay en cas d'avancement.
 *
 * La progression est demandée au SERVEUR (`my_progress`), qui connaît aussi le
 * prestige : un client ne peut donc pas se célébrer un niveau qu'il n'a pas.
 * `knownXp` reste accepté comme repli hors ligne, mais il ignore le prestige.
 *
 * Plusieurs niveaux franchis d'un coup → UNE seule animation, de l'ancien au
 * nouveau. Le premier appel ne fait qu'amorcer la référence, sans rien jouer.
 */
export async function checkLevelUp(knownXp?: number): Promise<void> {
  let level: number
  let title: string
  const prog = await fetchProgress()
  if (prog) {
    level = prog.level
    title = prog.title
  } else if (knownXp != null) {
    const v = xpLevel(knownXp)
    level = v.level
    title = v.name
  } else {
    return
  }

  let previous: number | null = null
  try {
    const raw = localStorage.getItem(LAST_LEVEL_KEY)
    previous = raw == null ? null : Number(raw)
  } catch {
    /* stockage indisponible */
  }
  try {
    localStorage.setItem(LAST_LEVEL_KEY, String(level))
  } catch {
    /* ignore */
  }

  if (previous == null || !Number.isFinite(previous) || previous >= level) return
  triggerLevelUp(`Niveau ${previous}`, `Niveau ${level} · ${title}`)
}

type Particle = {
  dx: number
  dy: number
  rot: number
  color: string
  circle: boolean
}

function makeParticles(): Particle[] {
  return Array.from({ length: 30 }, () => {
    const angle = Math.random() * Math.PI * 2
    const dist = 120 + Math.random() * 160
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      rot: (Math.random() - 0.5) * 900,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      circle: Math.random() > 0.5,
    }
  })
}

function Particles({ particles }: { particles: Particle[] }) {
  return (
    <>
      {particles.map((p, i) => (
        <span
          key={i}
          className="fx-levelup-particle"
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              '--col': p.color,
              '--rad': p.circle ? '50%' : '1px',
            } as React.CSSProperties
          }
        />
      ))}
    </>
  )
}

/** Global mount (MainLayout). Plays the 2.5s level-up sequence; tap to
 *  dismiss early. Skipped under reduced motion. */
export default function LevelUpOverlay() {
  const [data, setData] = useState<
    (LevelUpDetail & { particles: Particle[] }) | null
  >(null)

  useEffect(() => {
    const handler = (e: Event) => {
      if (prefersReducedMotion()) return
      vibrate([200, 100, 200, 100, 300])
      const detail = (e as CustomEvent<LevelUpDetail>).detail
      // Particles built in the handler (not render) to keep render pure.
      setData({ ...detail, particles: makeParticles() })
      window.setTimeout(() => setData(null), 2500)
      // Once the level-up overlay clears, offer to share the best card.
      window.setTimeout(() => void offerBestCardShare(), 2700)
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  if (!data) return null
  return (
    <div className="fx-levelup" onClick={() => setData(null)} role="presentation">
      <div className="fx-levelup-old">{data.from}</div>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <Particles particles={data.particles} />
        <div className="fx-levelup-new">{data.to}</div>
      </div>
      <div className="fx-levelup-label">Niveau supérieur !</div>
    </div>
  )
}
