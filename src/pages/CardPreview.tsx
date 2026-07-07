import CollectorCardV2 from '../components/CollectorCardV2'

// TEMPORARY preview — Légendaire vs Commune side by side to validate the
// card redesign direction before rolling it out to all rarities. Public
// route (/card-preview); remove once the direction is signed off.

const LEGENDARY = {
  photo:
    'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=900',
  brand: 'Bugatti',
  model: 'Chiron Super Sport',
  year: 2023,
  category: 'hypercar',
  rarity: 'hypercar' as const,
  serial: 12,
  serialTotal: 500,
  stats: { power: '1600', accel: '2.4s', vmax: '440', torque: '1600' },
}

const COMMON = {
  photo:
    'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=900',
  brand: 'Volkswagen',
  model: 'Golf GTI',
  year: 2021,
  category: 'other',
  rarity: 'standard' as const,
  serial: 247,
  serialTotal: 999,
  stats: { power: '245', accel: '6.2s', vmax: '250', torque: '370' },
}

export default function CardPreview() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0a0a0a',
        color: '#fff',
        padding: '28px 16px 48px',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display, inherit)',
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: '-0.02em',
          }}
        >
          Cartes collector — direction
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          Légendaire vs Commune. Incline le téléphone (ou glisse le doigt sur la
          Légendaire) pour l'holo. Touche une carte pour le flip. Photos =
          placeholders.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 22,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: 30,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <CollectorCardV2 {...LEGENDARY} width={280} />
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#FFD700',
              }}
            >
              LÉGENDAIRE
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <CollectorCardV2 {...COMMON} width={280} />
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              COMMUNE
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
