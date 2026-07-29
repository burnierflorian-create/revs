// Normalised base-colour token for the card/garage uniqueness key.
// MUST stay byte-for-byte equivalent to the SQL `public.color_key()` used by
// the award_xp_spot trigger (supabase/0065-evolutive-cards.sql) — the client
// groups spots into cards with this, the trigger keys card_progress with it,
// and any divergence would split or merge cards inconsistently.
//
// Rule: the DOMINANT body colour is the FIRST colour word in the AI's free-text
// description ("noir avec covering jaune et blanc" → noir, "jaune Giallo Modena
// avec bandes noires" → jaune). Accents stripped, matched on whole words.

const MAP: [string, string[]][] = [
  ['noir', ['noir', 'noire', 'noirs', 'black', 'nero', 'nera']],
  ['blanc', ['blanc', 'blanche', 'white', 'bianco', 'bianca', 'weiss']],
  ['gris', ['gris', 'grise', 'grey', 'gray', 'grigio', 'argent', 'argente', 'silver', 'anthracite', 'graphite', 'gunmetal']],
  ['rouge', ['rouge', 'red', 'rosso', 'rossa', 'rot']],
  ['bleu', ['bleu', 'bleue', 'blue', 'blu', 'azzurro', 'azur']],
  ['vert', ['vert', 'verte', 'green', 'verde']],
  ['jaune', ['jaune', 'yellow', 'giallo', 'gelb']],
  ['orange', ['orange', 'arancio', 'arancione', 'papaya']],
  ['violet', ['violet', 'violette', 'purple', 'viola', 'mauve', 'lila']],
  ['marron', ['marron', 'brun', 'brune', 'brown', 'marrone']],
  ['beige', ['beige', 'sable', 'tan', 'creme', 'cream']],
  ['or', ['or', 'dore', 'doree', 'gold', 'golden', 'oro']],
  ['rose', ['rose', 'pink', 'rosa']],
  ['bronze', ['bronze', 'cuivre', 'copper']],
]

const WORD2BASE = new Map<string, string>()
for (const [base, syns] of MAP)
  for (const s of syns) if (!WORD2BASE.has(s)) WORD2BASE.set(s, base)

const stripAccents = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function colorKey(input: string | null | undefined): string {
  const words = stripAccents((input ?? '').toLowerCase())
    .split(/[^a-z]+/)
    .filter(Boolean)
  for (const w of words) {
    const b = WORD2BASE.get(w)
    if (b) return b
  }
  return 'autre'
}
