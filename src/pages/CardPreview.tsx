import { useState } from 'react'
import CollectorCardV2 from '../components/CollectorCardV2'
import CardSpotsSheet from '../components/CardSpotsSheet'
import type { Rarity, Spot } from '../lib/spots'

// TEMPORARY preview — the full rarity ladder, to validate the redesign.
// Public route (/card-preview); remove once signed off.

const P1 = 'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=800'
const P2 = 'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=800'
const P3 = 'https://images.unsplash.com/photo-1544829099-b9a0c07fad1a?w=800'

// Fake spots to preview the Phase-3 history + photo-picker sheet.
const DEMO_SPOTS = [
  { id: 'demo-1', brand: 'Lamborghini', model: 'Huracán EVO', photo_url: P1, created_at: '2026-07-27T18:12:00Z', lat: 45.7578, lng: 4.832 },
  { id: 'demo-2', brand: 'Lamborghini', model: 'Huracán EVO', photo_url: P2, created_at: '2026-06-14T11:03:00Z', lat: 45.764, lng: 4.8357 },
  { id: 'demo-3', brand: 'Lamborghini', model: 'Huracán EVO', photo_url: P3, created_at: '2026-05-12T09:40:00Z', lat: 45.75, lng: 4.85 },
] as unknown as Spot[]

const CARDS: {
  rarity: Rarity
  photo: string
  brand: string
  model: string
  year: number
  category: string
  serial: number
  total: number
  stats: { power: string; accel: string; vmax: string; torque: string }
}[] = [
  { rarity: 'standard', photo: P2, brand: 'Volkswagen', model: 'Golf GTI', year: 2021, category: 'other', serial: 247, total: 9999, stats: { power: '245', accel: '6.2s', vmax: '250', torque: '370' } },
  { rarity: 'premium', photo: P3, brand: 'BMW', model: 'M240i', year: 2022, category: 'other', serial: 88, total: 5000, stats: { power: '374', accel: '4.3s', vmax: '250', torque: '500' } },
  { rarity: 'performance', photo: P1, brand: 'Porsche', model: '718 Cayman GTS', year: 2023, category: 'performance', serial: 51, total: 2000, stats: { power: '400', accel: '4.0s', vmax: '293', torque: '430' } },
  { rarity: 'exclusif', photo: P2, brand: 'Mercedes-AMG', model: 'GT 63 S', year: 2023, category: 'performance', serial: 34, total: 500, stats: { power: '639', accel: '3.2s', vmax: '315', torque: '900' } },
  { rarity: 'supercar', photo: P3, brand: 'Lamborghini', model: 'Huracán EVO', year: 2022, category: 'supercar', serial: 19, total: 250, stats: { power: '640', accel: '2.9s', vmax: '325', torque: '600' } },
  { rarity: 'hypercar', photo: P1, brand: 'Bugatti', model: 'Chiron Super Sport', year: 2023, category: 'hypercar', serial: 12, total: 100, stats: { power: '1600', accel: '2.4s', vmax: '440', torque: '1600' } },
]

// Evolution ladder: same car at levels 1→5. counts = thresholds 1/3/5/10/20.
const LADDER_COUNTS = [1, 3, 5, 10, 20]
const LADDER_LABELS = ['Base', 'Chasseur', 'Traqueur', 'Obsédé', 'Légende']

function EvoRow({
  rarity,
  photo,
  brand,
  model,
  year,
  category,
  total,
}: {
  rarity: Rarity
  photo: string
  brand: string
  model: string
  year: number
  category: string
  total: number
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 22,
      }}
    >
      {LADDER_COUNTS.map((count, i) => (
        <div key={i}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '0.04em' }}>
            Nv{i + 1} · {LADDER_LABELS[i]}
          </div>
          <CollectorCardV2
            photo={photo}
            brand={brand}
            model={model}
            year={year}
            category={category}
            rarity={rarity}
            serial={i + 1}
            serialTotal={total}
            evolution={{
              level: i + 1,
              count,
              firstSpotAt: '2026-05-12T10:00:00Z',
              lastSpotAt: '2026-07-27T18:00:00Z',
              cumulativeXp: count * 40 + i * 30,
            }}
          />
        </div>
      ))}
    </div>
  )
}

export default function CardPreview() {
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoMain, setDemoMain] = useState<string | null>(P1)
  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a0a', color: '#fff', padding: '28px 16px 60px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>
          Cartes collector — échelle de rareté
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          Du Commun au Légendaire. Incline le téléphone (ou glisse le doigt) sur
          Ultra Rare / Légendaire pour l'holo. Touche une carte pour le flip.
        </p>
        <div
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 22,
          }}
        >
          {CARDS.map((c) => (
            <CollectorCardV2
              key={c.rarity}
              photo={c.photo}
              brand={c.brand}
              model={c.model}
              year={c.year}
              category={c.category}
              rarity={c.rarity}
              serial={c.serial}
              serialTotal={c.total}
            />
          ))}
        </div>

        <h1 style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', marginTop: 48 }}>
          Paliers d'évolution — une Commune qui devient un trophée
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          Même voiture, du Nv1 au Nv5 (1 · 3 · 5 · 10 · 20 spots). La rareté ne
          change pas — c'est le cadre, le badge et le compteur qui montent.
          Touche une carte pour voir le dos (découverte / dernière capture / XP).
        </p>
        <div style={{ marginTop: 24 }}>
          <EvoRow rarity="standard" photo={P2} brand="Volkswagen" model="Golf GTI" year={2021} category="other" total={9999} />
        </div>
        <div style={{ marginTop: 32 }}>
          <EvoRow rarity="supercar" photo={P3} brand="Lamborghini" model="Huracán EVO" year={2022} category="supercar" total={250} />
        </div>

        <h1 style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', marginTop: 48 }}>
          Historique + photo principale (Phase 3)
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          L'écran ouvert par « Mes spots » / « Photo » au dos d'une carte :
          mini-map des lieux, tous les spots (date/heure), étoile = photo de la carte.
        </p>
        <button
          onClick={() => setDemoOpen(true)}
          className="tappable"
          style={{ marginTop: 14, borderRadius: 9999, padding: '10px 18px', fontSize: 13, fontWeight: 800, color: '#fff', background: '#E8203A', border: 'none' }}
        >
          Ouvrir la démo
        </button>
      </div>

      <CardSpotsSheet
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        brand="Lamborghini"
        model="Huracán EVO"
        level={4}
        count={DEMO_SPOTS.length}
        spots={DEMO_SPOTS}
        mainPhotoUrl={demoMain}
        onSetMain={(s) => setDemoMain(s.photo_url)}
      />
    </div>
  )
}
