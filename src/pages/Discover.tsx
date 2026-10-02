import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import News from './News'
import Meets from '../components/Meets'
import F1Calendar from '../components/F1Calendar'
import Brands from './Brands'
import F1Roster from './F1Roster'
import SearchOverlay from '../components/SearchOverlay'
import { RevsWordmark } from '../components/Logo'
import { PillTabs } from '../components/discover/kit'
import { hapticSelection } from '../lib/haptic'
// Spot Wars temporarily pulled from the MVP launch — the component,
// the 0032-spot-wars.sql migration and the spot_wars_leaderboard RPC
// stay on the DB so the feature can be re-enabled by re-adding the
// `wars` tab below + the `<SpotWars />` render branch.


type Universe = 'f1' | 'cars'

export default function Discover({ initial }: { initial?: 'events' }) {
  const { t } = useTranslation()
  // AUTOMOBILE est l'univers principal ; F1 & Motorsport vit à côté.
  //
  // Renommé le 01/10/2026 : « CarSpotting » désignait la même chose que
  // l'action de spotter, alors que cette section ne sert pas à photographier
  // mais à DÉCOUVRIR — actualités, événements, marques. Les deux rôles
  // portaient le même nom, ce qui en faisait un pour l'utilisateur.
  // La clé interne reste 'cars' : la renommer orphelinerait les URL.
  const [universe, setUniverse] = useState<Universe>('cars')
  const [f1Sub, setF1Sub] = useState<'actu' | 'calendar' | 'roster'>('actu')
  const [carsSub, setCarsSub] = useState<
    'actu' | 'events' | 'brands'
  >(initial === 'events' ? 'events' : 'actu')

  // Discover is kept alive across /discover ↔ /events ↔ /actu — sync to
  // the route prop so navigating to /events from another tab correctly
  // switches the inner state instead of showing whatever was last open.
  useEffect(() => {
    if (initial === 'events') {
      setUniverse('cars')
      setCarsSub('events')
    }
  }, [initial])

  const [searchOpen, setSearchOpen] = useState(false)

  const isF1 = universe === 'f1'
  const sub = isF1 ? f1Sub : carsSub

  // Rigid 50/50 two-tab header — each title is centred in its grid half,
  // with a fixed-width active underline centred under it (symmetric).
  //
  // Le trait actif est ROUGE et non blanc (planche du 02/10) : en blanc il
  // avait exactement la couleur du libellé actif, donc il doublait une
  // information déjà portée par la graisse au lieu d'en ajouter une.
  const universeBtn = (u: Universe, label: string) => {
    const active = universe === u
    return (
      <button
        onClick={() => {
          hapticSelection()
          setUniverse(u)
        }}
        className="relative w-full pb-3 text-center text-[16px] transition-colors duration-300"
      >
        <span className={active ? 'font-semibold text-fg' : 'font-normal text-fg2'}>
          {label}
        </span>
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px mx-auto h-[3px] w-16 rounded-full transition-opacity duration-300"
          style={{
            opacity: active ? 1 : 0,
            background: 'var(--revs-red)',
            boxShadow: '0 0 12px rgb(var(--color-accent) / 0.55)',
          }}
        />
      </button>
    )
  }

  const subTabs: { key: string; label: string }[] = isF1
    ? [
        { key: 'actu', label: t('discoverpage.subtabs.actu') },
        { key: 'calendar', label: t('discoverpage.subtabs.calendar') },
        { key: 'roster', label: t('discoverpage.subtabs.roster') },
      ]
    : [
        { key: 'actu', label: t('discoverpage.subtabs.actu') },
        { key: 'events', label: t('discoverpage.subtabs.events') },
        { key: 'brands', label: t('discoverpage.subtabs.brands') },
      ]

  function setSub(k: string) {
    hapticSelection()
    if (isF1) setF1Sub(k as 'actu' | 'calendar' | 'roster')
    else setCarsSub(k as 'actu' | 'events' | 'brands')
  }

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))]">
      {/* Barre d'identité — mot REVS à gauche, recherche à droite.
          La planche la place au-dessus des onglets d'univers. Elle réveille
          au passage SearchOverlay, qui existait depuis longtemps dans le
          dossier des composants sans être monté nulle part : la recherche
          globale était écrite mais inatteignable. */}
      <div className="flex items-center justify-between px-4 pb-1">
        <RevsWordmark height={17} title="REVS" />
        <button
          onClick={() => {
            hapticSelection()
            setSearchOpen(true)
          }}
          aria-label={t('common.search')}
          className="tappable -mr-2 p-2 text-fg"
        >
          <Search className="h-[21px] w-[21px]" strokeWidth={2} />
        </button>
      </div>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Niveau 1 — grille 50/50 rigide : Automobile à gauche, F1 à droite. */}
      <div
        className="grid w-full grid-cols-2 pt-2"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
        {universeBtn('cars', t('discoverpage.universeCars'))}
        {universeBtn('f1', 'F1')}
      </div>

      {/* Niveau 2 — contrôle segmenté en pastilles.
          Il était en traits soulignés, comme le niveau 1 : les deux rangées
          se ressemblaient donc, et rien ne disait laquelle commandait
          laquelle. Deux formes distinctes pour deux niveaux distincts. */}
      <div className="px-4 pt-3">
        <PillTabs tabs={subTabs} value={sub} onChange={setSub} />
      </div>

      <div key={`${universe}-${sub}`} className="discover-fade pt-3">
        {isF1 ? (
          f1Sub === 'actu' ? (
            <News categories={['F1']} />
          ) : f1Sub === 'calendar' ? (
            <div className="px-4">
              <F1Calendar />
            </div>
          ) : (
            <F1Roster embedded />
          )
        ) : carsSub === 'actu' ? (
          <News
            categories={['Hypercar', 'Supercar', 'Électrique', 'JDM', 'Classique', 'SUV']}
          />
        ) : carsSub === 'events' ? (
          <Meets />
        ) : (
          <Brands embedded />
        )}
      </div>
    </div>
  )
}
