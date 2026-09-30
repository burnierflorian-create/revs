import { useEffect, useRef, useState } from 'react'
import { Car, Crosshair, Crown, Eye, Flame, Images, ImagePlus, Loader2, Lock, Share2, Trophy } from 'lucide-react'
import type { Rarity } from '../lib/spots'
import { useTranslation } from 'react-i18next'
import { prefersReducedMotion } from '../lib/motion'
import { rarityFrame } from '../lib/rarityStyle'
import { timeAgo } from '../lib/spots'
import { fetchCardSpecs, type CardSpecs } from '../lib/cardSpecs'

// ── Card evolution (level-up) overlay, LAYERED on top of the rarity frame ──
// A card levels 1→5 as the same car is re-spotted. The mastery treatment
// intensifies the card WITHOUT changing its rarity: a Commune Nv5 stays
// Commune but becomes a gold/red "Légende" trophy. Keep thresholds/badges in
// sync with src/lib/cardLevels.ts.
export type CardEvolution = {
  level: number
  count: number // "spotté X fois" (the user's own captures)
  firstSpotAt?: string | null
  lastSpotAt?: string | null
  cumulativeXp?: number
}

type LevelFx = {
  badge: string
  Icon: typeof Crosshair
  chipBg: string
  chipFg: string
  ring: string // outer aura colour (level glow)
  shine: boolean
  aura: boolean
}
// L1 has no badge (base card). L2-L5 escalate. L5 forces the holo/aura trophy
// treatment even on a Commune.
const LEVEL_FX: Record<number, LevelFx> = {
  2: { badge: 'Chasseur', Icon: Crosshair, chipBg: 'linear-gradient(120deg,#7f8ea3,#c9d8ef)', chipFg: '#0c0c0f', ring: 'rgba(150,180,255,0.42)', shine: true, aura: false },
  3: { badge: 'Traqueur', Icon: Crosshair, chipBg: 'linear-gradient(120deg,#2f7fd0,#7fd0ff)', chipFg: '#04121f', ring: 'rgba(90,200,255,0.5)', shine: true, aura: false },
  4: { badge: 'Obsédé', Icon: Flame, chipBg: 'linear-gradient(120deg,#7d3ea8,#c98bf0)', chipFg: '#1a0a26', ring: 'rgba(190,120,240,0.55)', shine: true, aura: true },
  5: { badge: 'Légende', Icon: Crown, chipBg: 'linear-gradient(120deg,#E0B341,#FFD700 45%,#E8203A)', chipFg: '#1a1306', ring: 'rgba(255,190,60,0.7)', shine: true, aura: true },
}

// ─────────────────────────────────────────────────────────────────────
// Collector card v2 — FUT/EA-FC energy × Pokémon-TCG collectibility on the
// REVS dark + #E8203A identity. Rarity readable in a glance from the FRAME
// (escalating richness); Ultra Rare + Legendary get a gyroscope holo sheen.
// All animation is transform/opacity (GPU) for 120fps.
//
// TUNABLES: RARITY_FRAME (per-tier look) + CSS vars on the card root
// (--cv-float, --cv-holo, --cv-shine-dur, --cv-w).
// ─────────────────────────────────────────────────────────────────────

// Le cadre, les couleurs ET le libellé de chaque rareté vivent désormais dans
// src/lib/rarityStyle.ts — le même fichier que la pastille du fil. Ils y ont
// été réunis le 30/09/2026 : la carte annonçait « RARE » là où le fil disait
// « PERFORMANCE », avec des couleurs différentes par-dessus le marché.

const PARTICLE_COUNT = 12

export default function CollectorCardV2({
  photo,
  brand,
  model,
  year,
  rarity,
  locked = false,
  serial,
  serialTotal,
  specs,
  firstOnRevs = false,
  evolution,
  reveal = false,
  showShare = false,
  onShare,
  onViewSpots,
  onChangePhoto,
  width = '100%',
}: {
  photo: string | null
  brand: string
  model: string
  year: number | null
  /** Accepté pour compatibilité d'API : la catégorie ne figure plus sur le
   *  recto (elle doublonnait avec la rareté). Les appelants continuent de la
   *  passer sans effet — elle reste exploitée par la fiche détaillée. */
  category?: string
  rarity: Rarity
  /** Carte repérée dans le catalogue mais pas encore spottée par l'utilisateur.
   *  La rareté reste lisible — c'est elle qui donne envie — mais le véhicule
   *  est masqué. Aucune donnée inventée : si on ne connaît pas la voiture, on
   *  ne l'invente pas, on montre une silhouette. */
  locked?: boolean
  serial: number
  serialTotal: number
  specs?: CardSpecs | null
  firstOnRevs?: boolean
  evolution?: CardEvolution
  reveal?: boolean
  showShare?: boolean
  onShare?: () => void
  /** Card back → open the full history + photo picker (collection only). */
  onViewSpots?: () => void
  onChangePhoto?: () => void
  width?: number | string
}) {
  const { t } = useTranslation()
  const look = rarityFrame(rarity)

  // ── Mouvement réduit ──
  // Le retournement et le tilt sont posés en styles INLINE : le garde
  // `@media (prefers-reduced-motion)` de design-system.css, qui ne cible que
  // des classes, ne pouvait rien contre eux. La carte continuait donc de
  // pivoter en 3D pour quelqu'un qui a explicitement demandé à son système
  // d'arrêter les animations. On lit la préférence ici, et on la SUIT : elle
  // peut changer sans rechargement.
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduceMotion(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  const lvl = evolution?.level ?? 1
  const count = evolution?.count ?? 1
  const fx = LEVEL_FX[lvl] ?? null // null at L1 (base card)
  const rootRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const [flipped, setFlipped] = useState(false)
  const [visible, setVisible] = useState(false)

  // Scroll-in appearance (per-card → natural stagger down a grid).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Real specs — provided, else lazy-fetched on first flip (server-cached
  // per model, so it's paid once site-wide).
  const [fetched, setFetched] = useState<CardSpecs | null>(specs ?? null)
  const [loading, setLoading] = useState(false)
  const triedRef = useRef(!!specs)
  useEffect(() => {
    if (!flipped || triedRef.current) return
    triedRef.current = true
    setLoading(true)
    fetchCardSpecs(brand, model, year).then((r) => {
      setFetched(r)
      setLoading(false)
    })
  }, [flipped, brand, model, year])

  const eff = specs ?? fetched

  // Micro-tilt parallax (ALL tiers) + holo sheen tracking (rare tiers).
  // nx/ny are normalized -0.5..0.5. GPU: tilt = transform on the tilt
  // wrapper, holo = --hx/--hy CSS vars. Works with pointer everywhere and
  // the real gyroscope on phones.
  const MAX_TILT = 9 // deg
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Aucun suivi du pointeur ni du gyroscope en mouvement réduit : la carte
    // reste parfaitement plane.
    if (reduceMotion) return
    const apply = (nx: number, ny: number) => {
      if (look.sheen) {
        root.style.setProperty('--hx', nx.toFixed(3))
        root.style.setProperty('--hy', ny.toFixed(3))
      }
      const t = tiltRef.current
      if (t) {
        t.style.transition = 'transform 0.12s ease-out'
        t.style.transform = `rotateY(${(nx * 2 * MAX_TILT).toFixed(2)}deg) rotateX(${(-ny * 2 * MAX_TILT).toFixed(2)}deg)`
      }
    }
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect()
      apply((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5)
    }
    const onLeave = () => {
      const t = tiltRef.current
      if (t) {
        t.style.transition = 'transform 0.55s cubic-bezier(0.34,1.4,0.5,1)'
        t.style.transform = 'rotateY(0deg) rotateX(0deg)'
      }
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      if (!look.sheen) return
      const g = Math.max(-45, Math.min(45, e.gamma ?? 0)) / 45
      const b = Math.max(-45, Math.min(45, (e.beta ?? 0) - 45)) / 45
      apply(g * 0.5, b * 0.5)
    }
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('deviceorientation', onOrient)
    }
  }, [look.sheen, reduceMotion])

  const rootWidth = typeof width === 'number' ? `${width}px` : width

  // Level intensifies the treatment on top of rarity: shine ≥ L2, gold bloom
  // + reveal particles at the top levels — even for a low-rarity card.
  const effShine = look.sheen || lvl >= 2
  const goldBloom = look.aura || lvl >= 5
  const particles = reveal && (look.sheen || look.aura || lvl >= 4)
  const firstDate = evolution?.firstSpotAt
    ? new Date(evolution.firstSpotAt).toLocaleDateString('fr-FR')
    : null
  const lastAgo = evolution?.lastSpotAt ? timeAgo(evolution.lastSpotAt) : null
  const cumXp = evolution?.cumulativeXp ?? 0

  // ── Les lignes du dos ──
  // Construites en amont du rendu pour qu'une section entière disparaisse
  // quand elle n'a rien à dire. `Boolean(v) && v !== '0'` écarte aussi bien la
  // valeur absente que le zéro que renvoie parfois le catalogue : « 0 ch »
  // n'est pas une information, c'est une donnée manquante déguisée.
  const keep = (v: string | null | undefined) =>
    typeof v === 'string' && v.trim() !== '' && v.trim() !== '0'

  const specRows = eff
    ? (
        [
          { k: t('card.power'), v: keep(eff.horsepower) ? `${eff.horsepower} ch` : '' },
          { k: t('card.accel'), v: keep(eff.zero_to_100) ? eff.zero_to_100 : '' },
          { k: t('card.topSpeed'), v: keep(eff.top_speed) ? `${eff.top_speed} km/h` : '' },
          { k: t('card.torque'), v: keep(eff.torque) ? `${eff.torque} Nm` : '' },
        ] as { k: string; v: string }[]
      )
        .filter((r) => r.v !== '')
        // Trois lignes au maximum. Sur une carte de 235 px de haut, la
        // quatrième se faisait couper en deux dès que le nom du modèle passait
        // sur deux lignes — « Couple 1600 Nm » tranché au milieu. Le dos est un
        // objet de collection, pas une fiche technique : puissance, 0-100 et
        // vitesse de pointe sont ce qu'un spotteur regarde.
        .slice(0, 3)
    : []

  // Deux lignes au maximum, même raison que pour les specs.
  const COLLECTION_MAX = 2
  const collectionRows: { k: string; v: string; accent?: boolean }[] = []
  if (evolution) {
    if (count > 1)
      collectionRows.push({
        k: t('card.spotted'),
        v: t('card.spottedTimes', { count }),
      })
    if (firstDate) collectionRows.push({ k: t('card.discovered'), v: firstDate })
    if (lastAgo) collectionRows.push({ k: t('card.lastSeen'), v: lastAgo })
    if (cumXp > 0)
      collectionRows.push({
        k: t('card.cumulativeXp'),
        v: `${cumXp} XP`,
        accent: true,
      })
  }

  collectionRows.length = Math.min(collectionRows.length, COLLECTION_MAX)

  return (
    <div style={{ width: rootWidth }}>
      <div
        ref={rootRef}
        className="cv2-root"
        style={
          {
            '--cv-float': '5px',
            '--cv-holo': '0.9',
            '--cv-shine-dur': '5.5s',
            '--frame': look.frame,
            '--edge': look.edge,
            '--glow': look.glow,
            width: '100%',
            perspective: '1100px',
            position: 'relative',
            opacity: reveal || visible ? undefined : 0,
            animation: reveal
              ? 'cardv2-reveal 0.9s cubic-bezier(0.22,1,0.36,1) both'
              : visible
                ? 'cardv2-appear 0.5s cubic-bezier(0.22,1,0.36,1) both'
                : undefined,
          } as React.CSSProperties
        }
      >
        {/* Reveal particle burst (rare tiers). */}
        {particles && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              pointerEvents: 'none',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
              const a = (i / PARTICLE_COUNT) * Math.PI * 2
              const R = 96
              return (
                <span
                  key={i}
                  style={
                    {
                      position: 'absolute',
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      background: look.aura ? '#FFD700' : '#E8203A',
                      boxShadow: `0 0 8px ${look.aura ? '#FFD700' : '#E8203A'}`,
                      '--px': Math.cos(a) * R,
                      '--py': Math.sin(a) * R,
                      animation: `cardv2-particle 0.85s ease-out ${0.15 + i * 0.012}s both`,
                    } as React.CSSProperties
                  }
                />
              )
            })}
          </div>
        )}

        <div
          className="cv2-float"
          style={{
            position: 'relative',
            animation: 'cardv2-float 6s ease-in-out infinite',
            willChange: 'transform',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Le halo n'existe que face visible. Retourné, il continuait de
              peindre un coin doré au travers du dos — bataille de profondeur
              perdue d'avance dans un contexte `preserve-3d`. Et sur le fond,
              il n'avait rien à y faire : l'aura signale une pièce rare quand on
              la REGARDE, pas quand on lit sa fiche. */}
          {goldBloom && !flipped && (
            /* Le halo est enveloppé pour une raison précise : `cardv2-aura`
               anime `transform`, donc toute profondeur posée sur l'élément
               lui-même est écrasée à la première image. Sans ce parent, le halo
               restait à z=0 dans le contexte `preserve-3d` et, carte retournée,
               passait DEVANT le dos — une traînée dorée en diagonale au travers
               des spécifications. Le parent porte la profondeur, l'enfant garde
               son animation. */
            <div
              aria-hidden
              style={{
                // `inset: 0` et non `-10%` : le halo débordait de 10 % de
                // chaque côté. Une carte Légendaire en colonne de droite
                // élargissait donc la page et provoquait un défilement
                // horizontal sur toute la collection. Le halo EXTÉRIEUR est
                // déjà assuré par `look.glow` (box-shadow), qui n'agrandit
                // jamais la zone défilable ; celui-ci ne fait plus que
                // réchauffer l'intérieur du cadre.
                position: 'absolute',
                inset: 0,
                transform: 'translateZ(-4px)',
                zIndex: 0,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '28px',
                  background:
                    'radial-gradient(closest-side, rgba(255,190,60,0.5), rgba(232,32,58,0.18) 60%, transparent 72%)',
                  filter: 'blur(14px)',
                  animation: 'cardv2-aura 3.4s ease-in-out infinite',
                }}
              />
            </div>
          )}

          <div
            ref={tiltRef}
            style={{
              position: 'relative',
              zIndex: 1,
              transformStyle: 'preserve-3d',
              willChange: 'transform',
            }}
          >
          {/* Rarity glow — a static ring BEHIND the card so it never flickers
              during the flip and never lands on the photo. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 20,
              boxShadow: fx
                ? `var(--glow), 0 0 0 2px ${fx.ring}, 0 0 34px 6px ${fx.ring}`
                : 'var(--glow)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <button
            // Une carte verrouillée ne se retourne pas : son dos n'aurait rien
            // à montrer, et un flip sur du vide se lit comme une panne.
            onClick={() => !locked && setFlipped((f) => !f)}
            aria-label={`${brand} ${model}`}
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'block',
              width: '100%',
              aspectRatio: '3 / 4.2',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              transformStyle: 'preserve-3d',
              WebkitTransformStyle: 'preserve-3d',
              willChange: 'transform',
              // Mouvement réduit : la carte BASCULE quand même — elle change
              // simplement de face instantanément. Supprimer l'animation ne
              // doit jamais supprimer la fonction.
              transition: reduceMotion
                ? 'none'
                : 'transform 0.55s cubic-bezier(0.34,1.35,0.45,1)',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* ── FRONT ── */}
            <div style={faceStyle(look.sheen)}>
              <div style={innerStyle()}>
                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    draggable={false}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center 42%',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      background: '#141418',
                      color: 'rgba(255,255,255,0.25)',
                    }}
                  >
                    <Car className="h-12 w-12" />
                  </div>
                )}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(to top, rgba(5,5,7,0.98) 0%, rgba(5,5,7,0.9) 22%, rgba(6,6,8,0.5) 42%, transparent 62%), linear-gradient(to bottom, rgba(6,6,8,0.5) 0%, transparent 22%)',
                  }}
                />

                {/* No holo film on the surface — the rainbow lives ONLY in the
                    card border (faceStyle). The photo stays a clean photo. */}
                {effShine && !locked && <div aria-hidden style={shineStyle()} />}

                {/* ── CARTE VERROUILLÉE ──
                    La photo est désaturée et assombrie jusqu'à la silhouette :
                    on devine une voiture, on ne l'identifie pas. La rareté,
                    elle, reste parfaitement lisible en haut — c'est le seul
                    élément qui doit donner envie d'aller la chercher. */}
                {locked && (
                  <>
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backdropFilter: 'grayscale(1) brightness(0.32) blur(2px)',
                        WebkitBackdropFilter:
                          'grayscale(1) brightness(0.32) blur(2px)',
                        background: 'rgba(6,6,9,0.55)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 7,
                        padding: '0 14px',
                        textAlign: 'center',
                      }}
                    >
                      <Lock
                        style={{
                          width: 20,
                          height: 20,
                          color: 'rgba(255,255,255,0.72)',
                        }}
                      />
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 800,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'rgba(255,255,255,0.55)',
                        }}
                      >
                        {t('card.locked')}
                      </span>
                    </div>
                  </>
                )}

                {/* Top row: rarity + serial */}
                <div style={topRowStyle()}>
                  {/* « ULTRA RARE » et « PERFORMANCE » passaient sur deux
                      lignes : la pastille doublait de hauteur et poussait le
                      numéro hors de la carte. Une seule ligne, taille qui suit
                      la largeur réelle, et troncature en dernier recours. */}
                  <span
                    style={{
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      padding: '4px 8px',
                      borderRadius: 9,
                      // « PERFORMANCE » (11 signes) sortait en « PERFOR… ».
                      // Un libellé de rareté tronqué ne se lit plus : il fallait
                      // descendre le plancher et resserrer la chasse.
                      fontSize: 'clamp(6.8px, 1.95vw, 10px)',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      color: look.chipFg,
                      background: look.chipBg,
                      border: `1px solid ${look.chipBorder}`,
                      backdropFilter: 'blur(6px)',
                      WebkitBackdropFilter: 'blur(6px)',
                    }}
                  >
                    {look.label}
                  </span>
                  {/* Le recto ne porte que le NUMÉRO, pas le tirage.
                      « #051/2000 » mangeait la moitié de la rangée et écrasait
                      la pastille de rareté en « PERFORM… ». Le tirage complet
                      reste au dos, où il a la place et où il se lit vraiment. */}
                  <span style={serialStyle()}>
                    #{String(serial).padStart(3, '0')}
                  </span>
                </div>

                {firstOnRevs && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 40,
                      left: 10,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 8,
                      fontSize: 9,
                      fontWeight: 900,
                      letterSpacing: '0.06em',
                      color: '#0a0a0a',
                      background: 'linear-gradient(120deg,#FFD700,#E8203A)',
                    }}
                  >
                    <Trophy className="h-3 w-3" /> 1ᵉʳ SUR REVS
                  </span>
                )}

                {/* Bottom block */}
                <div style={{ position: 'absolute', inset: 'auto 12px 12px 12px', color: '#fff' }}>
                  {/* Rien de tout cela sur une carte verrouillée : elle n'a
                      jamais été spottée, afficher « Spotté ×3 » y serait faux. */}
                  {!locked && (fx || count > 1) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                      {fx && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '2px 7px',
                            borderRadius: 7,
                            fontSize: 9,
                            fontWeight: 900,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: fx.chipFg,
                            background: fx.chipBg,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                          }}
                        >
                          <fx.Icon style={{ width: 10, height: 10 }} /> {fx.badge}
                        </span>
                      )}
                      {count > 1 && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 9,
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            color: 'rgba(255,255,255,0.74)',
                            textShadow: '0 1px 3px rgba(0,0,0,0.75)',
                          }}
                        >
                          <Eye style={{ width: 11, height: 11 }} />{' '}
                          {t('card.spotted')} {t('card.spottedTimes', { count })}
                        </span>
                      )}
                    </div>
                  )}
                  {/* « MERCEDES-AMG · 2023 » se repliait sur deux lignes et
                      décalait le modèle vers le bas : dans une grille, deux
                      cartes voisines n'avaient plus la même ligne de base. */}
                  {/* Marque, année et modèle disparaissent quand la carte est
                      verrouillée : une silhouette légendée « Lamborghini Huracán
                      EVO » n'a plus rien de mystérieux, et c'est le mystère qui
                      donne envie d'aller la chercher. La rareté, elle, reste
                      affichée en haut — c'est le seul appât utile. */}
                  <div
                    style={{
                      visibility: locked ? 'hidden' : 'visible',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontSize: 'clamp(9px, 2.3vw, 11px)',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      color: 'rgba(255,255,255,0.78)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.7)',
                    }}
                  >
                    {brand.toUpperCase()}
                    {year ? ` · ${year}` : ''}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display, inherit)',
                      // « 718 Cayman GTS » et « Chiron Super Sport » étaient
                      // tronqués à 20 px fixes dans une carte de 168 px.
                      visibility: locked ? 'hidden' : 'visible',
                      fontSize: 'clamp(14px, 4.4vw, 20px)',
                      fontWeight: 800,
                      lineHeight: 1.05,
                      letterSpacing: '-0.02em',
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textShadow: '0 2px 6px rgba(0,0,0,0.75)',
                    }}
                  >
                    {model}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-display, inherit)',
                        fontWeight: 900,
                        fontSize: 13,
                        letterSpacing: '-0.03em',
                      }}
                    >
                      <span style={{ color: '#E8203A' }}>R</span>
                      <span style={{ color: '#fff' }}>EVS</span>
                    </span>
                    {/* La catégorie a quitté le recto (30/09/2026). Elle
                        affichait « PERFORMANCE » en bas d'une carte dont la
                        rareté était « EXCLUSIF » : deux échelles côte à côte,
                        dont l'une emprunte les mots de l'autre. Le recto porte
                        désormais l'essentiel — photo, marque, modèle, rareté,
                        numéro — et rien de plus. La catégorie reste sur la
                        fiche détaillée, à sa place. */}
                  </div>
                </div>
              </div>
            </div>

            {/* ── DOS ──
                Refait le 30/09/2026. L'ancien dos affichait le nom, un filet
                rouge, puis « Description bientôt disponible » — un texte
                d'attente occupant tout l'espace. Pendant ce temps la puissance,
                le 0-100, la vitesse de pointe et le couple étaient DÉJÀ chargés
                et n'étaient nulle part.

                Règle de remplissage : une ligne n'apparaît que si sa donnée
                existe. Jamais de tiret, jamais de « 0 », jamais de « bientôt ».
                Un dos court est honnête ; un dos rempli de vide ne l'est pas. */}
            {/* `isolation: isolate` + fond opaque : sans cela, le halo doré du
                Légendaire (rendu DERRIÈRE la carte) transparaissait en diagonale
                au travers du dos, comme une trace de brûlure. */}
            <div
              style={{
                ...faceStyle(look.sheen),
                transform: 'rotateY(180deg) translateZ(0.5px)',
                isolation: 'isolate',
              }}
            >
              <div
                style={{ ...innerStyle(), background: '#0C0C0F', opacity: 1 }}
              >
                <div
                  style={{
                    padding: '14px 14px 12px',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    minHeight: 0,
                  }}
                >
                  {/* En-tête officiel : le dos doit dire « carte REVS » avant
                      de dire quoi que ce soit sur la voiture. */}
                  <div style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-display, inherit)',
                        fontWeight: 900,
                        fontSize: 15,
                        letterSpacing: '-0.03em',
                      }}
                    >
                      <span style={{ color: '#E8203A' }}>R</span>
                      <span style={{ color: '#fff' }}>EVS</span>
                    </span>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 6.5,
                        fontWeight: 800,
                        letterSpacing: '0.22em',
                        color: 'rgba(255,255,255,0.34)',
                      }}
                    >
                      {t('card.tagline')}
                    </div>
                  </div>
                  <div
                    aria-hidden
                    style={{
                      width: 46,
                      height: 1.5,
                      margin: '8px auto 9px',
                      borderRadius: 2,
                      background:
                        'linear-gradient(90deg, transparent, #E8203A, transparent)',
                    }}
                  />

                  {/* Le véhicule */}
                  <div
                    style={{
                      textAlign: 'center',
                      fontFamily: 'var(--font-display, inherit)',
                      fontSize: 'clamp(10px, 3vw, 13.5px)',
                      fontWeight: 800,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.15,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {brand} {model}
                  </div>
                  {year && (
                    <div
                      style={{
                        textAlign: 'center',
                        marginTop: 1,
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'rgba(255,255,255,0.45)',
                      }}
                    >
                      {year}
                    </div>
                  )}

                  {/* Corps : specs puis collection, chacune omise si vide. */}
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden',
                      marginTop: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 9,
                    }}
                  >
                    {loading && !specRows.length ? (
                      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          style={{ color: 'rgba(255,255,255,0.4)' }}
                        />
                      </div>
                    ) : null}

                    {specRows.length > 0 && (
                      <section>
                        <SectionLabel>{t('card.specsHeading')}</SectionLabel>
                        {specRows.map((r) => (
                          <SpecRow key={r.k} label={r.k} value={r.v} />
                        ))}
                      </section>
                    )}

                    {collectionRows.length > 0 && (
                      <section>
                        <SectionLabel>{t('card.collectionHeading')}</SectionLabel>
                        {collectionRows.map((r) => (
                          <SpecRow key={r.k} label={r.k} value={r.v} accent={r.accent} />
                        ))}
                      </section>
                    )}
                  </div>


                  {/* Back actions (collection only): history + hero-photo picker.
                      Divs (not buttons) + stopPropagation so they don't nest
                      inside the flip button nor trigger a flip. */}
                  {(onViewSpots || onChangePhoto) && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      {onViewSpots && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            onViewSpots()
                          }}
                          style={backBtnStyle()}
                        >
                          <Images style={{ width: 13, height: 13 }} />
                          {count > 1 ? `${count} spots` : t('card.mySpots')}
                        </div>
                      )}
                      {onChangePhoto && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            onChangePhoto()
                          }}
                          style={backBtnStyle()}
                        >
                          <ImagePlus style={{ width: 13, height: 13 }} />
                          {t('card.photo')}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Pied : architecture moteur si connue, puis le numéro
                      d'édition — la signature de l'objet. */}
                  {eff?.architecture && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 7.5,
                        letterSpacing: '0.04em',
                        textAlign: 'center',
                        color: 'rgba(255,255,255,0.32)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {eff.architecture}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 7,
                      borderTop: '1px solid rgba(255,255,255,0.07)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 8,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                    }}
                  >
                    <span style={{ color: look.chipFg === '#1A1306' ? '#E0B341' : look.chipFg }}>
                      {look.label}
                    </span>
                    <span
                      style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      #{String(serial).padStart(3, '0')}/{serialTotal}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </button>
          </div>
        </div>
      </div>

      {showShare && onShare && (
        <button
          onClick={onShare}
          className="tappable"
          style={{
            marginTop: 12,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            borderRadius: 9999,
            padding: '10px 0',
            fontSize: 13,
            fontWeight: 800,
            color: '#fff',
            background: '#E8203A',
            border: 'none',
            boxShadow: '0 8px 22px rgba(232,32,58,0.4)',
          }}
        >
          <Share2 className="h-4 w-4" /> Partager
        </button>
      )}
    </div>
  )
}

// ── Shared inline-style helpers (keep the JSX readable) ──
// The card frame. For holo tiers the BORDER itself is the rainbow (a gradient
// painted in the 4px padding ring, sitting BEHIND the opaque inner content).
// It can never touch the photo/text — there is no overlay, no mask, no blend.
//
// NB: no CSS animation here on purpose. An animated compositing layer on a
// backface-visibility:hidden element breaks backface culling on iOS Safari
// (both faces render, back text shows mirrored). The border stays static so
// the 3D flip is rock-solid. Each face also carries an explicit rotateY so
// Safari reliably engages backface-visibility.
/**
 * Le liseré de la carte.
 *
 * `sheen` ne change plus la COULEUR du cadre, seulement sa matière : le
 * dégradé de la rareté est agrandi et déplacé au tilt, ce qui donne un reflet
 * de métal poli. Avant, il basculait sur un arc-en-ciel néon identique pour
 * toutes les hautes raretés — on ne distinguait plus Ultra Rare de Légendaire,
 * et l'objet évoquait la borne d'arcade plutôt que la pièce de collection.
 */
function faceStyle(sheen?: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    // `translateZ` : les deux faces vivaient exactement dans le même plan
    // (z = 0). Chromium départageait alors les pixels au petit bonheur, d'où
    // ce coin du recto qui transparaissait à travers le dos. Chacune avance
    // d'un demi-pixel dans son propre repère : elles ne se disputent plus rien.
    transform: 'rotateY(0deg) translateZ(0.5px)',
    borderRadius: 20,
    padding: sheen ? 3.5 : 3,
    background: 'var(--frame)',
    backgroundSize: sheen ? '200% 200%' : undefined,
    // --hx/--hy sont alimentés par le tilt (pointeur ou gyroscope) : le reflet
    // suit la main au lieu de tourner tout seul en boucle.
    backgroundPosition: sheen
      ? 'calc(50% + var(--hx, 0) * 60%) calc(50% + var(--hy, 0) * 60%)'
      : undefined,
  }
}
function innerStyle(): React.CSSProperties {
  return {
    position: 'relative',
    height: '100%',
    borderRadius: 17,
    overflow: 'hidden',
    background: '#0e0e11',
    boxShadow: 'inset 0 0 0 1px var(--edge)',
  }
}
function shineStyle(): React.CSSProperties {
  return {
    position: 'absolute',
    top: '-30%',
    bottom: '-30%',
    left: 0,
    width: '32%',
    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
    animation: 'cardv2-shine var(--cv-shine-dur) ease-in-out infinite',
    pointerEvents: 'none',
  }
}
// Rangée haute : rareté à gauche, numéro de série à droite.
// `alignItems: center` et non `flex-start` — les deux pastilles font la même
// hauteur, les aligner en haut ne servait qu'à décaler visuellement celle qui
// passait sur deux lignes.
function topRowStyle(): React.CSSProperties {
  return {
    position: 'absolute',
    inset: '10px 10px auto 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  }
}
function backBtnStyle(): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '8px 0',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 800,
    color: 'rgba(255,255,255,0.9)',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    cursor: 'pointer',
    userSelect: 'none',
  }
}
// `flexShrink: 0` : « #012/100 » se faisait couper en « #012/10 » dès que le
// libellé de rareté était long. Un numéro d'édition tronqué ne se remarque pas
// — il se lit comme un autre numéro, ce qui est pire qu'un affichage manquant.
function serialStyle(): React.CSSProperties {
  return {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    padding: '4px 7px',
    borderRadius: 9,
    fontSize: 9.5,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
    color: '#fff',
    background: 'rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.14)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  }
}


// ── Petits composants du dos ──
// Extraits pour que le JSX du dos reste lisible : deux sections, des lignes
// libellé/valeur, rien d'autre.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 7,
        fontWeight: 900,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.3)',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  )
}

function SpecRow({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 9.5,
        lineHeight: 1.6,
      }}
    >
      <span style={{ color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span
        style={{
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          color: accent ? '#E8203A' : 'rgba(255,255,255,0.9)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  )
}
