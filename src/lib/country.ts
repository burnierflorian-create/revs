// Detect the user's country as a French display name, for the "Mon Pays"
// leaderboard scope. Cheap + offline (browser locale region); defaults to
// France — the app's home market. Persisted onto the profile so the
// country_leaderboard can group users.

const REGION_TO_COUNTRY: Record<string, string> = {
  FR: 'France',
  BE: 'Belgique',
  CH: 'Suisse',
  CA: 'Canada',
  LU: 'Luxembourg',
  MC: 'Monaco',
  DE: 'Allemagne',
  IT: 'Italie',
  ES: 'Espagne',
  GB: 'Royaume-Uni',
  IE: 'Irlande',
  US: 'États-Unis',
  PT: 'Portugal',
  NL: 'Pays-Bas',
  MA: 'Maroc',
  TN: 'Tunisie',
  DZ: 'Algérie',
  SN: 'Sénégal',
  CI: "Côte d'Ivoire",
}

const FLAG_BY_COUNTRY: Record<string, string> = {
  France: '🇫🇷',
  Belgique: '🇧🇪',
  Suisse: '🇨🇭',
  Canada: '🇨🇦',
  Luxembourg: '🇱🇺',
  Monaco: '🇲🇨',
  Allemagne: '🇩🇪',
  Italie: '🇮🇹',
  Espagne: '🇪🇸',
  'Royaume-Uni': '🇬🇧',
  Irlande: '🇮🇪',
  'États-Unis': '🇺🇸',
  Portugal: '🇵🇹',
  'Pays-Bas': '🇳🇱',
  Maroc: '🇲🇦',
  Tunisie: '🇹🇳',
  Algérie: '🇩🇿',
  Sénégal: '🇸🇳',
  "Côte d'Ivoire": '🇨🇮',
}

export function detectCountry(): string {
  try {
    const langs = [navigator.language, ...(navigator.languages ?? [])]
    for (const l of langs) {
      const region = l?.split('-')[1]?.toUpperCase()
      if (region && REGION_TO_COUNTRY[region]) return REGION_TO_COUNTRY[region]
    }
  } catch {
    /* navigator unavailable */
  }
  return 'France'
}

export function countryFlag(country: string | null | undefined): string {
  return (country && FLAG_BY_COUNTRY[country]) || '🌍'
}
