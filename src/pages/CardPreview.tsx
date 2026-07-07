import CollectorCardV2 from '../components/CollectorCardV2'
import type { Rarity } from '../lib/spots'

// TEMPORARY preview — the full rarity ladder, to validate the redesign.
// Public route (/card-preview); remove once signed off.

const P1 = 'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=800'
const P2 = 'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=800'
const P3 = 'https://images.unsplash.com/photo-1544829099-b9a0c07fad1a?w=800'

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

export default function CardPreview() {
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
              stats={c.stats}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
