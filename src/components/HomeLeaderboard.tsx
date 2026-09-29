// ═══════════════════════ CLASSEMENTS — bloc compact d'accueil ═══════════════════════
//
// Vue condensée des classements DÉJÀ existants (src/pages/Leaderboard.tsx).
// Aucun RPC n'est créé : les quatre onglets tapent les mêmes fonctions que la
// page complète.
//
//   Global → top_spotters()          — les meilleurs spotters, toutes zones
//   Pays   → countries_leaderboard() — agrégat PAR PAYS, pas par joueur
//   Ville  → city_leaderboard()      — les spotters de MA ville
//   Amis   → top_spotters() filtré par `followers` (les comptes que je suis)
//
// ── Deux choix à connaître avant de modifier ──
//
// 1. « Pays » n'affiche pas des joueurs. Le classement Pays de REVS compare des
//    PAYS entre eux ; le transformer en « joueurs de mon pays » demanderait un
//    nouveau RPC, hors périmètre. La ligne a donc une forme différente, et
//    c'est fidèle au système réel.
//
// 2. « Amis » n'existe pas côté base — il est composé ici, sans requête
//    supplémentaire côté classement : on lit `followers` (1 requête) et on
//    filtre le tableau global déjà chargé. Si je ne suis personne, l'onglet
//    affiche un état vide honnête, jamais une fausse liste.
//
// Chaque onglet charge à sa PREMIÈRE ouverture, puis reste en mémoire. Global
// se charge tout seul, à retardement : la section est sous la ligne de
// flottaison et ne doit pas concurrencer le premier rendu.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

export type BoardScope = 'global' | 'country' | 'city' | 'friends'

/** Une ligne de joueur — forme commune aux trois RPC de spotters. */
type PlayerRow = {
  user_id: string
  xp: number
  pseudo: string | null
  avatar: string | null
}

/** Une ligne de pays — agrégat renvoyé par countries_leaderboard(). */
type CountryRow = { country: string; spotters: number; xp: number }

type Entry = {
  key: string
  label: string
  xp: number
  avatar: string | null
  /** Vrai pour la ligne du joueur courant — elle doit rester identifiable. */
  isMe: boolean
  /** Faux pour les lignes de PAYS : un pays n'a pas de photo de profil, et une
   *  pastille d'initiales à sa place ne voudrait rien dire. */
  hasAvatar: boolean
}

const MEDAL = ['#D4AF37', '#C0C5CE', '#CD7F32']

function initials(label: string): string {
  return label.trim().slice(0, 2).toUpperCase() || '??'
}

// ─────────────────────────── Une place du podium ───────────────────────────

function PodiumCell({ entry, rank }: { entry: Entry; rank: number }) {
  const color = MEDAL[rank] ?? 'rgb(var(--color-fg-2))'
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2"
      style={{
        background: entry.isMe
          ? 'rgb(var(--color-accent) / 0.12)'
          : 'var(--color-glass-mid)',
        border: `1px solid ${
          entry.isMe ? 'rgb(var(--color-accent) / 0.45)' : 'var(--color-border)'
        }`,
      }}
    >
      {/* Pastille de rang, puis avatar légèrement superposé comme sur la
          maquette. Les lignes de pays n'ont que la pastille. */}
      <span className="relative flex flex-none items-center">
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full font-display text-[10px] font-black text-black"
          style={{ background: color }}
        >
          {rank + 1}
        </span>
        {entry.hasAvatar && (
          <span
            className="-ml-1 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full"
            style={{
              // Fond OPAQUE : la pastille de rang passe dessous, et un fond
              // translucide laissait les deux se mélanger.
              background: 'rgb(var(--color-card))',
              border: '1px solid var(--color-border)',
            }}
          >
            {entry.avatar ? (
              <img
                src={entry.avatar}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[9px] font-bold text-fg/55">
                {initials(entry.label)}
              </span>
            )}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-bold leading-tight text-fg">
          {entry.label}
        </span>
        <span className="block truncate text-[10px] font-semibold tabular-nums text-fg/45">
          {new Intl.NumberFormat('fr-FR').format(Math.floor(entry.xp))} XP
        </span>
      </span>
    </div>
  )
}

// ─────────────────────────────── La section ───────────────────────────────

export default function HomeLeaderboard() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<BoardScope>('global')
  const [meId, setMeId] = useState<string | null>(null)
  const [myCity, setMyCity] = useState<string | null>(null)

  // `null` = pas encore chargé, `[]` = chargé et vide. La distinction porte
  // l'affichage : squelette dans un cas, état vide dans l'autre.
  const [players, setPlayers] = useState<PlayerRow[] | null>(null)
  const [countries, setCountries] = useState<CountryRow[] | null>(null)
  const [cityRows, setCityRows] = useState<PlayerRow[] | null>(null)
  const [followed, setFollowed] = useState<Set<string> | null>(null)

  // ── Chargement différé du classement global ──
  // requestIdleCallback : la section est hors écran au premier rendu, elle
  // attend que le fil principal soit libre.
  useEffect(() => {
    let active = true
    const run = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      setMeId(user?.id ?? null)

      const [boardRes, profRes] = await Promise.all([
        // 200 lignes : assez pour composer « Amis » sans seconde requête de
        // classement, et c'est la même RPC que la page complète (qui en
        // demande 500).
        supabase.rpc('top_spotters', { limit_count: 200 }),
        user
          ? supabase
              .from('profiles')
              .select('ville')
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (!active) return
      setPlayers(Array.isArray(boardRes.data) ? (boardRes.data as PlayerRow[]) : [])
      const ville = (profRes.data as { ville?: string | null } | null)?.ville
      setMyCity(ville?.trim() || null)
    }

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number
    }
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => void run(), { timeout: 2500 })
    } else {
      setTimeout(() => void run(), 400)
    }
    return () => {
      active = false
    }
  }, [])

  // ── Chargements à la demande, une fois par onglet ──
  useEffect(() => {
    if (scope !== 'country' || countries !== null) return
    let active = true
    supabase.rpc('countries_leaderboard').then(({ data }) => {
      if (active) setCountries(Array.isArray(data) ? (data as CountryRow[]) : [])
    })
    return () => {
      active = false
    }
  }, [scope, countries])

  useEffect(() => {
    // Pas de ville renseignée → aucune requête, et surtout aucune écriture
    // d'état ici : le cas « sans ville » se déduit à l'affichage.
    if (scope !== 'city' || cityRows !== null || !myCity) return
    let active = true
    supabase
      .rpc('city_leaderboard', { p_city: myCity, p_limit: 3 })
      .then(({ data }) => {
        if (active) setCityRows(Array.isArray(data) ? (data as PlayerRow[]) : [])
      })
    return () => {
      active = false
    }
  }, [scope, myCity, cityRows])

  useEffect(() => {
    if (scope !== 'friends' || followed !== null || !meId) return
    let active = true
    supabase
      .from('followers')
      .select('following_id')
      .eq('follower_id', meId)
      .then(({ data }) => {
        if (!active) return
        const ids = (data ?? []).map(
          (r) => (r as { following_id: string }).following_id,
        )
        setFollowed(new Set(ids))
      })
    return () => {
      active = false
    }
  }, [scope, followed, meId])

  // ── Composition des trois places affichées ──
  const toEntries = useCallback(
    (rows: PlayerRow[]): Entry[] =>
      rows.slice(0, 3).map((r) => ({
        key: r.user_id,
        label: r.pseudo?.trim() || t('home.board.anonymous'),
        xp: r.xp,
        avatar: r.avatar,
        isMe: r.user_id === meId,
        hasAvatar: true,
      })),
    [meId, t],
  )

  let entries: Entry[] | null = null
  let empty: string | null = null

  if (scope === 'global') {
    entries = players ? toEntries(players) : null
    if (entries && entries.length === 0) empty = t('home.board.emptyGlobal')
  } else if (scope === 'country') {
    entries = countries
      ? countries.slice(0, 3).map((c) => ({
          key: c.country,
          label: c.country,
          xp: c.xp,
          avatar: null,
          isMe: false,
          hasAvatar: false,
        }))
      : null
    if (entries && entries.length === 0) empty = t('home.board.emptyCountry')
  } else if (scope === 'city') {
    // `players !== null` signale que le chargement initial (identité + ville)
    // est terminé : sans ce garde, « ville non renseignée » et « pas encore
    // chargé » seraient indiscernables et l'écran afficherait brièvement un
    // état vide à tort.
    if (players !== null && !myCity) {
      entries = []
      empty = t('home.board.noCity')
    } else {
      entries = cityRows ? toEntries(cityRows) : null
      if (entries && entries.length === 0) empty = t('home.board.emptyCity')
    }
  } else {
    // Amis : le tableau global filtré par les comptes suivis, moi inclus —
    // se comparer à ses amis sans se voir soi-même n'aurait aucun sens.
    if (players && followed) {
      const keep = players.filter(
        (r) => followed.has(r.user_id) || r.user_id === meId,
      )
      entries = toEntries(keep)
      if (entries.length === 0) empty = t('home.board.emptyFriends')
    }
  }

  // Rang du joueur dans le classement courant, quand il n'est pas sur le
  // podium. Uniquement pour les onglets « joueurs ».
  const myRank = (() => {
    if (!meId) return null
    const src =
      scope === 'global' || scope === 'friends'
        ? players
        : scope === 'city'
          ? cityRows
          : null
    if (!src) return null
    const list =
      scope === 'friends' && followed
        ? src.filter((r) => followed.has(r.user_id) || r.user_id === meId)
        : src
    const i = list.findIndex((r) => r.user_id === meId)
    return i >= 3 ? { rank: i + 1, xp: list[i].xp } : null
  })()

  const TABS: { key: BoardScope; label: string }[] = [
    { key: 'global', label: t('home.board.global') },
    { key: 'country', label: t('home.board.country') },
    { key: 'city', label: t('home.board.city') },
    { key: 'friends', label: t('home.board.friends') },
  ]

  return (
    <>
      {/* Onglets — un seul rail, la pastille active en rouge REVS. */}
      <div
        className="flex gap-1 rounded-full p-1"
        style={{
          background: 'var(--color-glass-mid)',
          border: '1px solid var(--color-border)',
        }}
        role="tablist"
        aria-label={t('home.board.title')}
      >
        {TABS.map((tb) => {
          const active = scope === tb.key
          return (
            <button
              key={tb.key}
              role="tab"
              aria-selected={active}
              onClick={() => setScope(tb.key)}
              className="tappable min-w-0 flex-1 truncate rounded-full py-[7px] text-[11.5px] font-bold transition-colors"
              style={
                active
                  ? {
                      background: 'rgb(var(--color-accent))',
                      color: '#fff',
                      boxShadow: '0 2px 12px rgb(var(--color-accent) / 0.35)',
                    }
                  : { color: 'rgb(var(--color-fg-2))' }
              }
            >
              {tb.label}
            </button>
          )
        })}
      </div>

      <div className="mt-2.5">
        {entries === null ? (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[46px] flex-1 animate-pulse rounded-2xl bg-fg/[0.06]"
              />
            ))}
          </div>
        ) : empty ? (
          <p
            className="rounded-2xl px-4 py-4 text-center text-[12.5px] text-fg/45"
            style={{
              background: 'var(--color-glass-mid)',
              border: '1px solid var(--color-border)',
            }}
          >
            {empty}
          </p>
        ) : (
          /* Grille à 3 colonnes plutôt qu'une rangée souple : avec un seul
             inscrit, une rangée souple étirait la cellule sur toute la
             largeur. Les emplacements manquants restent vides — on ne comble
             jamais un podium incomplet avec une fausse ligne. */
          <div className="grid grid-cols-3 gap-2">
            {entries.map((e, i) => (
              <PodiumCell key={e.key} entry={e} rank={i} />
            ))}
          </div>
        )}

        {myRank && (
          <p className="mt-2 text-center text-[11px] font-semibold text-fg/45">
            {t('home.board.yourRank', {
              rank: myRank.rank,
              xp: new Intl.NumberFormat('fr-FR').format(Math.floor(myRank.xp)),
            })}
          </p>
        )}
      </div>
    </>
  )
}
