// ═══════════════ TUTORIEL DE DÉCOUVERTE ═══════════════
//
// POURQUOI IL N'EN EXISTAIT PAS
// L'audit du 30/09/2026 est sans ambiguïté : REVS n'avait AUCUN tutoriel
// d'accueil. `src/pages/Tutorial.tsx` et `src/lib/tutorial.ts` portent le REVS
// Master Tutorial — la documentation interne réservée au compte créateur, sans
// rapport avec un parcours utilisateur. Le seul état existant,
// `onboarding_completed`, marque la fin du QUESTIONNAIRE.
//
// Il n'y avait donc rien à réparer : tout était à construire.
//
// ── DÉCLENCHEMENT ──
// Questionnaire terminé (`onboarding_completed`) ET tutoriel jamais vu
// (`tutorial_completed`). Les deux états sont distincts parce que les deux
// situations le sont : les comptes existants ont fini le questionnaire il y a
// des semaines et n'ont jamais vu de tutoriel — ils doivent le voir.
//
// ── CE QU'IL PRÉSENTE ──
// Uniquement des fonctionnalités VÉRIFIÉES dans les routes de l'application :
// /new-spot, /ma-galerie, /map, /feed, /classement, /challenges, les routes
// F1, /actu, /events, /brands, /profile, /badges. Rien d'annoncé qui n'existe.
//
// ── CE QU'IL NE DEMANDE JAMAIS ──
// De photographier une voiture. Un nouvel inscrit peut être chez lui, dans le
// métro, loin de tout véhicule. Le tutoriel EXPLIQUE, il ne fait pas faire.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Camera,
  Flag,
  Layers,
  MapPin,
  Newspaper,
  Sparkles,
  Trophy,
  User,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { prefersReducedMotion } from '../lib/motion'

type Screen = {
  key: string
  Icon: typeof Camera | null
  /** Clés de puces à lire dans la traduction (b1…b4). */
  bullets: number
  /** Écrans d'ouverture et de clôture : titre géant, pas d'icône ronde. */
  hero?: boolean
  note?: boolean
}

const SCREENS: Screen[] = [
  { key: 's1', Icon: null, bullets: 0, hero: true },
  { key: 's2', Icon: Camera, bullets: 4, note: true },
  { key: 's3', Icon: Layers, bullets: 4 },
  { key: 's4', Icon: MapPin, bullets: 0, note: true },
  { key: 's5', Icon: Users, bullets: 3 },
  { key: 's6', Icon: Flag, bullets: 3 },
  { key: 's7', Icon: Newspaper, bullets: 2 },
  { key: 's8', Icon: Trophy, bullets: 3 },
  { key: 's9', Icon: User, bullets: 4 },
  { key: 's10', Icon: null, bullets: 0, hero: true },
]

export default function TutorialTour() {
  const { t } = useTranslation()
  const [show, show_] = useState(false)
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const paneRef = useRef<HTMLDivElement>(null)

  // Décision d'affichage : questionnaire fini, tutoriel jamais vu.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('onboarding_completed, tutorial_completed')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!alive || !data) return
      const d = data as {
        onboarding_completed?: boolean
        tutorial_completed?: boolean
      }
      if (d.onboarding_completed === true && d.tutorial_completed !== true) {
        show_(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /**
   * Marque le tutoriel comme vu, puis ferme.
   *
   * L'écriture est tentée mais ne conditionne PAS la fermeture : si le réseau
   * lâche au dernier écran, on ne retient pas l'utilisateur dans un tutoriel
   * qu'il vient de terminer. Il le reverrait au prochain lancement, ce qui est
   * un moindre mal que de le bloquer maintenant.
   */
  const close = useCallback(() => {
    show_(false)
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('profiles')
        .update({ tutorial_completed: true })
        .eq('user_id', user.id)
    })()
  }, [])

  // Animation d'entrée de chaque écran, jouée une fois, sans remonter l'arbre.
  useEffect(() => {
    const el = paneRef.current
    if (!show || !el || prefersReducedMotion()) return
    el.animate(
      [
        { opacity: 0, transform: `translateX(${dir * 26}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 280, easing: 'cubic-bezier(0.22,1,0.36,1)' },
    )
  }, [i, show, dir])

  if (!show) return null

  const s = SCREENS[i]
  const last = i === SCREENS.length - 1
  const go = (d: 1 | -1) => {
    setDir(d)
    setI((n) => Math.max(0, Math.min(SCREENS.length - 1, n + d)))
  }

  // Portail + z-index au-dessus de tout : la barre de navigation est à z-40,
  // les feuilles modales à z-[60]. Le tutoriel couvre l'application entière —
  // c'est la première chose que voit un nouvel inscrit.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: '#0B0B0B' }}
      role="dialog"
      aria-modal="true"
    >
      {/* Halo rouge diffus — la seule décoration, et elle situe la marque. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[42vh]"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 0%, rgba(232,32,58,0.20), transparent 70%)',
        }}
      />

      {/* ── En-tête : retour · progression · passer ── */}
      <div
        className="relative z-10 flex items-center gap-3 px-5"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={() => go(-1)}
          disabled={i === 0}
          aria-label={t('tour.back')}
          className="tappable -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-white/55 disabled:opacity-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="flex flex-1 items-center gap-1.5">
          {SCREENS.map((sc, n) => (
            <span
              key={sc.key}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{
                background:
                  n <= i ? 'rgb(232,32,58)' : 'rgba(255,255,255,0.14)',
              }}
            />
          ))}
        </div>

        <button
          onClick={close}
          className="tappable -mr-1 whitespace-nowrap px-2 py-2 text-[12.5px] font-semibold text-white/45"
        >
          {t('tour.skip')}
        </button>
      </div>

      {/* ── Écran ── */}
      <div
        ref={paneRef}
        key={s.key}
        className="relative z-10 flex flex-1 flex-col justify-center overflow-y-auto px-7 py-6"
      >
        {s.Icon && (
          <div
            className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              background: 'rgba(232,32,58,0.13)',
              border: '1px solid rgba(232,32,58,0.32)',
            }}
          >
            <s.Icon className="h-7 w-7" style={{ color: '#E8203A' }} />
          </div>
        )}

        <h1
          className="font-display font-black tracking-tight text-white"
          style={{
            fontSize: s.hero ? 'clamp(30px, 8.5vw, 40px)' : 'clamp(23px, 6.4vw, 30px)',
            lineHeight: 1.08,
            textWrap: 'balance',
          }}
        >
          {t(`tour.${s.key}.title`)}
        </h1>

        <p className="mt-4 text-[14.5px] leading-relaxed text-white/70">
          {t(`tour.${s.key}.body`)}
        </p>

        {s.bullets > 0 && (
          <ul className="mt-6 space-y-3">
            {Array.from({ length: s.bullets }, (_, n) => (
              <li key={n} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: '#E8203A' }}
                />
                <span className="text-[13.5px] leading-snug text-white/82">
                  {t(`tour.${s.key}.b${n + 1}`)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {s.note && (
          <p
            className="mt-6 rounded-2xl px-4 py-3 text-[12.5px] leading-snug text-white/60"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
            }}
          >
            {t(`tour.${s.key}.note`)}
          </p>
        )}

        {s.hero && (
          <div
            className="mt-7 text-[10px] font-extrabold text-white/30"
            style={{ letterSpacing: '0.22em' }}
          >
            {t(`tour.${s.key}.tag`)}
          </div>
        )}
      </div>

      {/* ── Pied : avancer ── */}
      <div
        className="relative z-10 px-7"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={() => (last ? close() : go(1))}
          className="tappable w-full rounded-full py-4 text-sm font-extrabold tracking-wider text-white"
          style={{
            background: 'rgb(232,32,58)',
            boxShadow: '0 10px 30px rgba(232,32,58,0.42)',
          }}
        >
          {last ? (
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t('tour.start')}
            </span>
          ) : (
            t('tour.next')
          )}
        </button>
        <p className="mt-3 text-center text-[11px] font-semibold text-white/30">
          {t('tour.step', { current: i + 1, total: SCREENS.length })}
        </p>
      </div>
    </div>,
    document.body,
  )
}
