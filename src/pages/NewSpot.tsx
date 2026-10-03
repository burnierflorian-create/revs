import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { ArrowLeft, Camera, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  blurRegions,
  CATEGORIES,
  distanceMeters,
  readPhotoMeta,
  resizeImageToJpeg,
  xpForSpot,
  type BBox,
  type IdentifyResult,
  type PhotoMeta,
  type Rarity,
  type SpotCategory,
} from '../lib/spots'
import { fetchAiQuota, type AiQuota } from '../lib/aiQuota'
import PlateMarker from '../components/PlateMarker'
import { takePendingPhoto } from '../lib/pendingPhoto'
import { useTheme } from '../lib/theme'
import { emitNewSpot } from '../lib/feedSync'
import { getCurrentPositionSafe, roundCoord } from '../lib/geo'
import { hapticError, hapticHeartbeat, hapticSuccess } from '../lib/haptic'
import { maybePromptPush, myPseudo, notifyPush } from '../lib/push'
import { brandSlugFor, getBrand } from '../lib/brands'
import { searchCars, searchMakes, modelsForMake, findMake } from '../lib/cars'
import { Skeleton } from '../components/Skeleton'
import CollectorCard from '../components/CollectorCard'
import type { Spot } from '../lib/spots'
import { checkAutomotive, gateMessageKey } from '../lib/imageGate'

type Step = 1 | 2 | 3 | 4

// Spec 2026-06-02 — anti-cheat tightened from 10 min to 5 min so
// the photo + GPS pair stays plausibly "fresh from the street".
const MAX_PHOTO_AGE_MS = 5 * 60 * 1000
const MAX_GPS_DRIFT_M = 300

// Écart minimum entre deux scans, en miroir de COOLDOWN_MS dans
// server/ai-gate.js. Le serveur reste l'AUTORITÉ — il applique le même délai
// de façon atomique en SQL, donc inviolable. Ce garde client ne fait
// qu'éviter le travail inutile : sans lui, un double appui déclenchait un
// upload d'image complet et un aller-retour réseau pour finir en 429.
const SCAN_COOLDOWN_MS = 3000

// Supabase errors (Postgrest/Storage) are plain objects, NOT Error
// instances — so a bare `instanceof Error` check hides the real cause.
// Log the full shape and return an Error carrying a useful message.
function supaError(label: string, e: unknown): Error {
  const o = (e ?? {}) as {
    message?: string
    details?: string
    hint?: string
    code?: string | number
    statusCode?: string | number
    name?: string
  }
  const code = o.code ?? o.statusCode
  console.error(`[spot] ${label} failed:`, {
    message: o.message,
    code,
    details: o.details,
    hint: o.hint,
    name: o.name,
  })
  const detail = [o.message, o.details, o.hint].filter(Boolean).join(' — ')
  return new Error(
    `${i18n.t('newspot.supaError', {
      label,
      detail: detail || i18n.t('newspot.errorUnknown'),
    })}${code ? ` [${code}]` : ''}`,
  )
}

/** Le trigger enforce_spot_daily_quota (migration 0068) refuse l'insertion
 *  au-delà du plafond du palier. Il lève une exception SQL avec le code
 *  `check_violation` (23514) et le hint `spot_daily_quota_exceeded`.
 *
 *  Sans ce test, supaError() produisait un message technique — « Publication a
 *  échoué : Limite de 5 spots par jour atteinte… [23514] » — avec le code SQL
 *  apparent. On reconnaît le hint, qui est stable et ne dépend pas de la langue
 *  du message, pour afficher le texte du serveur seul.
 *
 *  Depuis le 30/09/2026 ce plafond n'est plus un quota commercial mais un
 *  garde anti-abus très haut (200/jour, migration 0086) : un usage humain ne
 *  l'atteint jamais. Le message reste géré proprement au cas où un flot
 *  automatisé le déclenche.
 *
 *  On teste le HINT SEUL, jamais le code 23514 : `spots_rarity_check` porte le
 *  même code, et une rareté invalide aurait alors affiché un message de quota
 *  doublé d'une relance Premium. Le hint, lui, n'est posé que par ce trigger. */
function quotaMessage(e: unknown): string | null {
  const o = (e ?? {}) as { hint?: string; message?: string }
  if (o.hint !== 'spot_daily_quota_exceeded') return null
  return o.message?.trim() || i18n.t('newspot.limitReached')
}

const EMPTY_RESULT: IdentifyResult = {
  brand: '',
  model: '',
  year: null,
  color: '',
  category: 'other',
  confidence: 0,
  alternatives: [],
  valid: true,
  reason: '',
  estimated_price: null,
  description: '',
  rarity: 'standard',
  production: null,
}

// getPosition delegates to the shared lib so every GPS-consuming
// screen gets the same defensive pattern (named callbacks, typeof
// guards, try/catch, per-code messages). Local re-export kept so
// existing callers below don't need to be touched.
const getPosition = getCurrentPositionSafe

export default function NewSpot() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>(1)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // Résultat de la protection automatique des plaques.
  //   'ok'      la détection a tourné (qu'elle ait trouvé une plaque ou non)
  //   'failed'  elle n'a PAS tourné — appel en échec, ou floutage impossible
  // 'failed' bloque la publication, sans aucune possibilité de passer outre.
  // `pending` tant que la détection n'a pas rendu son verdict. L'état initial
// était 'ok', ce qui voulait dire « protégée » avant même d'avoir regardé.
const [plateGuard, setPlateGuard] = useState<'pending' | 'ok' | 'failed'>('ok')
  /** Vrai pendant la détection : la publication est retenue le temps du contrôle. */
  const [plateChecking, setPlateChecking] = useState(false)
  /**
   * ── MASQUAGE MANUEL : L'ISSUE QUAND LA DÉTECTION NE SAIT PAS (01/10/2026) ──
   *
   * `PlateMarker` existait déjà mais n'était plus ouvert nulle part. Il le
   * redevient, parce que la mesure impose cette issue : vérifié contre la
   * production sur quatre photos, le détecteur Claude ne confirme AUCUNE de
   * ses boîtes sur les trois qui portent une plaque. Depuis que les boîtes
   * sont vérifiées au lieu d'être crues, ces photos sont donc refusées — ce
   * qui est la bonne direction d'échec, mais laisserait l'utilisateur sans
   * aucun moyen de publier.
   *
   * L'œil de la personne qui a pris la photo est, lui, fiable : elle sait où
   * est la plaque. On lui demande de la désigner, et on floute ce qu'elle
   * désigne. Aucun coût, aucune dépendance, et la garantie la plus forte dont
   * on dispose aujourd'hui.
   */
  const [markerOpen, setMarkerOpen] = useState(false)
  const [image, setImage] = useState<{ blob: Blob; base64: string } | null>(
    null,
  )
  // A separate, smaller (1200px / q0.7) JPEG sent ONLY to the Claude vision
  // calls (identify-car + detect-plate). The full-res `image` blob is kept
  // for storage/display + plate blur; the AI never sees the heavy original,
  // which cuts vision token cost ~60% without hurting display quality.
  const [aiBase64, setAiBase64] = useState<string | null>(null)

  const [result, setResult] = useState<IdentifyResult>(EMPTY_RESULT)
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('')
  const [category, setCategory] = useState<SpotCategory>('other')
  const [description, setDescription] = useState('')

  const [photoMeta, setPhotoMeta] = useState<PhotoMeta | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  /** Jeton du contrôle automobile. La base l'exige à l'insertion d'un spot
   *  (migration 0122) : le chemin manuel comme le chemin IA y passent, sinon
   *  choisir « saisie manuelle » suffirait à contourner la règle. */
  const [validationId, setValidationId] = useState<string | null>(null)
  const [gateChecking, setGateChecking] = useState(false)
  const [pubError, setPubError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const [pubStatus, setPubStatus] = useState('')
  // "Saved to gallery" confirmation flash (2s).
  const [savedToGallery, setSavedToGallery] = useState(false)
  // Gate: a pseudo is required before spotting (no "Anonyme" spots).
  const [profileOk, setProfileOk] = useState<boolean | null>(null)
  const [gpPseudo, setGpPseudo] = useState('')
  const [gpVille, setGpVille] = useState('')
  const [gpSaving, setGpSaving] = useState(false)
  const [gpErr, setGpErr] = useState<string | null>(null)
  // Horodatage du dernier scan lancé — alimente le garde de cooldown.
  const lastScanRef = useRef(0)

  // Quota d'ANALYSE IA du jour. `null` = inconnu (hors ligne, RPC en échec) :
  // on masque alors le compteur au lieu d'afficher un chiffre inventé.
  // Purement informatif — server/ai-gate.js décide, pas cet état.
  const [aiQuota, setAiQuota] = useState<AiQuota | null>(null)
  // Explication affichée en tête de l'étape 3 quand on y arrive SANS analyse :
  // quota épuisé, ou saisie manuelle demandée. `null` = on vient de l'IA.
  const [manualNotice, setManualNotice] = useState<string | null>(null)
  const aiExhausted = aiQuota !== null && aiQuota.remaining <= 0
  const refreshAiQuota = useCallback(() => {
    void fetchAiQuota().then(setAiQuota)
  }, [])
  useEffect(() => {
    refreshAiQuota()
  }, [refreshAiQuota])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  /** Synthetic Spot used by the step-3 collector-card preview. The
   *  CollectorCard component expects a full Spot record from
   *  supabase.spots, but at this step the row doesn't exist yet
   *  (it's inserted by publish()). We rebuild the relevant fields
   *  from the in-memory form so the user sees a live preview that
   *  updates as they edit. Lat/lng default to 0/0 — the front
   *  face doesn't surface them; only the back-face GPS chip does. */
  const previewSpot = useMemo<Spot>(() => {
    const yearN = Number.parseInt(year, 10)
    return {
      id: 'preview-' + Date.now(),
      user_id: '',
      brand: brand || result.brand || t('newspot.previewDefaultBrand'),
      model: model || result.model || t('newspot.previewDefaultModel'),
      year: Number.isFinite(yearN) ? yearN : null,
      color: color || result.color || '',
      category: (category || result.category) as SpotCategory,
      description: description || null,
      photo_url: previewUrl,
      confidence: result.confidence ?? null,
      estimated_price: result.estimated_price ?? null,
      car_info: null,
      lat: 0,
      lng: 0,
      expires_at: '',
      created_at: new Date().toISOString(),
      rarity: result.rarity ?? 'standard',
    }
  }, [
    brand,
    model,
    year,
    color,
    category,
    description,
    previewUrl,
    result.brand,
    result.model,
    result.color,
    result.category,
    result.confidence,
    result.estimated_price,
    result.rarity,
  ])

  function rejectAndRestart(message: string) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setImage(null)
    setPhotoMeta(null)
    setResult(EMPTY_RESULT)
    setPubError(null)
    setPubStatus('')
    setRejection(message)
    // Error buzz on every reject path (screen detected by AI, photo
    // too old, GPS incoherent, GPS off). hapticError no-ops on iOS.
    hapticError()
    setStep(1)
  }

  async function loadFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setRejection(null)
    setPubError(null)
    setValidationId(null)
    setPreviewUrl(URL.createObjectURL(file))
    setImage(null)
    setAiBase64(null)
    // EXIF must be read from the original file: resizing re-encodes via
    // canvas and strips all metadata.
    setPhotoMeta(await readPhotoMeta(file))
    try {
      const resized = await resizeImageToJpeg(file)
      // ── CONTRÔLE AUTOMOBILE ──
      // Il tourne avant tout le reste, sur les DEUX chemins : l'analyse IA
      // rejette déjà les non-voitures, mais le chemin manuel — de rang égal
      // depuis le 30/09 — ne rejetait rien du tout. Et `identify-car` refuse
      // les motos, que REVS accepte désormais.
      setGateChecking(true)
      const gate = await checkAutomotive(resized.blob)
      setGateChecking(false)
      if (!gate.ok) {
        setImage(null)
        setPreviewUrl(null)
        URL.revokeObjectURL(URL.createObjectURL(file))
        setRejection(t(gateMessageKey(gate)))
        hapticError()
        return
      }
      setValidationId(gate.validationId)
      setImage(resized)
      // Nouvelle photo → la protection repart de zéro.
      //
      // ── 01/10/2026 : PLUS D'ÉCRAN DE MARQUAGE MANUEL ──
      // On ouvrait ici `PlateMarker` : l'utilisateur devait désigner les
      // plaques lui-même avant toute autre chose. Deux raisons de l'enlever.
      // La première est qu'une protection qui dépend d'un geste humain n'est
      // pas une protection : elle est aussi fiable que l'attention de la
      // personne la plus pressée. La seconde est qu'elle n'était même pas
      // nécessaire — la détection automatique tourne de toute façon sur les
      // deux chemins. Le composant reste dans le dépôt, mais il n'est plus
      // sur le chemin obligatoire.
      setPlateGuard('pending')
      // ── 768 → 1024 px (01/10/2026) ──
      // Le coût d'une image suit sa SURFACE (≈ w×h/750 jetons), donc 1024 px
      // coûte 1,8× plus que 768. Ce n'est pas un réglage gratuit, et il est
      // assumé pour une raison précise : à 768 px, les indices qui séparent
      // deux modèles voisins ne sont plus lisibles. La poignée affleurante
      // qui distingue une Classe E W214 d'une Classe C W206 fait une vingtaine
      // de pixels à cette taille ; les protections d'arches noires d'une
      // Model Y se confondent avec l'ombre du passage de roue.
      //
      // Ces deux erreurs-là sont précisément celles trouvées dans le parc. On
      // paie ~0,002 $ de plus par spot pour cesser de les commettre, sur une
      // chaîne qui en coûte déjà bien davantage.
      //
      // Au-delà, repli sur image.base64 dans analyze() : la capture n'est
      // jamais bloquée par un échec de redimensionnement.
      try {
        const ai = await resizeImageToJpeg(file, 1024, 0.85)
        setAiBase64(ai.base64)
      } catch {
        /* keep aiBase64 null → analyze() uses the full-res base64 */
      }
    } catch {
      setPubError(t('newspot.imageReadFailed'))
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await loadFile(file)
  }

  // Photo captured straight from the FAB camera: load it and skip the
  // "Prendre une photo" screen.
  useEffect(() => {
    const f = takePendingPhoto()
    if (f) loadFile(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (active) setProfileOk(false)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('pseudo, ville')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      if (data?.pseudo) setGpPseudo(data.pseudo)
      if (data?.ville) setGpVille(data.ville)
      setProfileOk(!!(data?.pseudo && String(data.pseudo).trim()))
    })()
    return () => {
      active = false
    }
  }, [])

  async function saveProfileGate() {
    const p = gpPseudo.trim()
    if (p.length < 2) {
      setGpErr(t('newspot.gatePseudoTooShort'))
      return
    }
    setGpSaving(true)
    setGpErr(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setGpSaving(false)
      setGpErr(t('newspot.notAuthenticated'))
      return
    }
    const { error } = await supabase
      .from('profiles')
      .upsert(
        { user_id: user.id, pseudo: p, ville: gpVille.trim() },
        { onConflict: 'user_id' },
      )
    setGpSaving(false)
    if (error) {
      setGpErr(t('newspot.profileSaveFailed'))
      return
    }
    setProfileOk(true)
  }

  function applyResult(r: IdentifyResult) {
    setResult(r)
    setBrand(r.brand)
    setModel(r.model)
    setYear(r.year != null ? String(r.year) : '')
    setColor(r.color)
    setCategory(r.category === 'classic' ? 'other' : r.category)
    // Brouillon de description proposé par l'IA. On ne l'impose pas : si
    // l'utilisateur a déjà écrit quelque chose, on ne l'écrase pas.
    if (r.description) setDescription((d) => d || r.description || '')
  }

  async function analyze() {
    if (!image) return
    const since = Date.now() - lastScanRef.current
    if (since < SCAN_COOLDOWN_MS) {
      setRejection(
        t('newspot.cooldown', {
          seconds: Math.ceil((SCAN_COOLDOWN_MS - since) / 1000),
        }),
      )
      hapticError()
      return
    }
    lastScanRef.current = Date.now()
    setRejection(null)
    setStep(2)
    // Haptic heartbeat — feels like a low-pulse sensor scan during the
    // laser animation. cancelHeartbeat is called in every exit path
    // below so the loop never leaks past step 2.
    const cancelHeartbeat = hapticHeartbeat()
    const ctrl = new AbortController()
    // 25 s upper bound: identify-car's prompt ladder + detect-plate's
    // own retry can each chew ~10-15 s. Below that the abort can take
    // out the still-running sibling call.
    const timer = setTimeout(() => ctrl.abort(), 25000)
    const body = JSON.stringify({
      // Send the lightweight 1200px AI image; fall back to the full-res
      // base64 only if the downscale failed.
      imageBase64: aiBase64 ?? image.base64,
      mimeType: 'image/jpeg',
    })
    // Bearer token lets identify-car attribute the call to this user for
    // quota / rate-limit accounting. Missing token = server fails open.
    const { data: sess } = await supabase.auth.getSession()
    const authToken = sess?.session?.access_token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (authToken) headers.Authorization = `Bearer ${authToken}`
    const doFetch = (path: string) =>
      fetch(path, { method: 'POST', headers, body, signal: ctrl.signal })
    // ── POURQUOI UN LECTEUR DÉDIÉ POUR LES PLAQUES (01/10/2026) ──
    //
    // Le lecteur générique précédent faisait `r.json()` sans regarder `r.ok`.
    // Le serveur, lui, échoue volontairement
    // en 502 `{error:'detection_failed'}` quand aucune détection n'a abouti.
    // Ce corps était parsé sans erreur, `plates` valait `undefined`, et le test
    // `plates === null` plus bas est FAUX pour `undefined` : le garde passait à
    // « ok » et l'original partait en ligne. Le fail-closed côté serveur était
    // donc neutralisé côté client depuis sa mise en place.
    //
    // Règle appliquée ici : seule une réponse 2xx portant un VRAI tableau vaut
    // résultat. Tout le reste — statut d'erreur, corps inattendu, `plates`
    // absent ou non-tableau — devient `null`, c'est-à-dire « on ne sait pas »,
    // ce que l'appelant traite en retenant la publication.
    const fetchPlates = (path: string): Promise<{ plates: BBox[] | null }> =>
      doFetch(path)
        .then(async (r) => {
          if (!r.ok) return { plates: null }
          const j = (await r.json().catch(() => null)) as {
            plates?: unknown
          } | null
          if (!j || !Array.isArray(j.plates)) return { plates: null }
          return { plates: j.plates as BBox[] }
        })
        .catch(() => ({ plates: null }))
    try {
      // Identify the car AND detect license plates in parallel — both
      // are vision calls of similar latency, no reason to serialise.
      // Plate detection failing is non-fatal: we just skip the blur.
      const [carRes, plateJson] = await Promise.all([
        doFetch('/api/identify-car'),
        fetchPlates('/api/detect-plate'),
      ])
      clearTimeout(timer)

      // Refus du portail IA (server/ai-gate.js) : 401 session absente ou
      // expirée, 429 cooldown ou quota du jour, 503 portail indisponible.
      // Dans les trois cas on affiche le message du serveur et on revient à
      // l'étape capture — sans ce garde, un 401 tombait dans le chemin
      // nominal et ouvrait l'étape 3 avec un formulaire vide.
      if (
        carRes.status === 401 ||
        carRes.status === 429 ||
        carRes.status === 503
      ) {
        const q = await carRes.json().catch(() => ({}))
        cancelHeartbeat()

        // ── QUOTA IA ÉPUISÉ : on CONTINUE, on ne renvoie pas à la case
        // départ (30/09/2026) ──
        //
        // Avant, ce cas repartait à l'étape photo : l'utilisateur avait sa
        // voiture sous les yeux, sa photo dans la main, et REVS lui répondait
        // « reviens demain ». Or publier ne coûte rien — seule l'analyse
        // coûte. Le quota doit fermer l'IA, pas l'application.
        //
        // On rejoint donc exactement le chemin déjà emprunté quand l'IA tombe
        // en panne : formulaire vierge, saisie à la main, publication. Aucun
        // système parallèle, aucun écran de plus.
        if (q?.error === 'quota_exceeded') {
          setAiQuota((prev) =>
            prev ? { ...prev, used: prev.limit, remaining: 0 } : prev,
          )
          // Le quota d'IDENTIFICATION est épuisé — mais la détection de
          // plaque n'en dépend pas (server/ai-gate.js lui donne sa propre
          // limite). On la lance donc pour de vrai au lieu de marquer la photo
          // « non vérifiée » et de s'en remettre à l'utilisateur : identifier
          // une voiture est un service, flouter une plaque est une obligation.
          applyResult(EMPTY_RESULT)
          setManualNotice(
            q?.message ||
              t('newspot.aiQuotaExhausted', { limit: aiQuota?.limit ?? 5 }),
          )
          setStep(3)
          void runPlateGuard()
          return
        }

        rejectAndRestart(
          q?.message ||
            (carRes.status === 401
              ? 'Session expirée — reconnecte-toi pour scanner.'
              : 'Tu as atteint ta limite du jour, réessaie demain'),
        )
        return
      }
      const carJson = (await carRes.json()) as IdentifyResult

      // Le floutage est appliqué au blob en mémoire AVANT l'étape d'édition :
      // quand l'utilisateur atteint publish(), image.blob porte déjà la
      // version anonymisée — pas de course, pas d'attente supplémentaire.
      //
      // `plates === null` signifie que la détection n'a PAS tourné (appel en
      // échec). C'est différent d'un tableau vide, qui signifie « aucune plaque
      // trouvée ». La version précédente confondait les deux et publiait
      // silencieusement : une panne de l'API suffisait à mettre en ligne une
      // plaque parfaitement lisible.
      // Depuis que l'état initial est `pending`, le succès doit être AFFIRMÉ.
      // Tant que cette ligne n'existait pas, une photo non vérifiée restait
      // marquée « ok » par défaut — c'est exactement l'hypothèse qu'on veut
      // rendre impossible.
      const plates = plateJson.plates
      if (plates === null) setPlateGuard('failed')
      else setPlateGuard('ok')
      if (plates && plates.length > 0) {
        try {
          const blurred = await blurRegions(image.blob, plates)
          setImage(blurred)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(URL.createObjectURL(blurred.blob))
        } catch (e) {
          // Erreur canvas : l'image reste non floutée. On ne laisse plus
          // passer en silence — l'utilisateur devra confirmer explicitement
          // qu'aucune plaque n'est lisible avant de publier.
          console.error('[plate blur] failed:', e)
          // Le floutage a échoué APRÈS une détection réussie : l'image en
          // mémoire est donc toujours l'originale, plaque comprise.
          setPlateGuard('failed')
        }
      }

      const data = { ...EMPTY_RESULT, ...carJson }
      if (data.valid === false) {
        // rejectAndRestart() owns the error buzz — call it once.
        cancelHeartbeat()
        rejectAndRestart(data.reason || t('newspot.rejectNotRealCar'))
        return
      }
      applyResult(data)
      cancelHeartbeat()
      // Un crédit vient d'être consommé côté serveur : on relit le compteur
      // plutôt que de le décrémenter à l'aveugle, pour que l'écran affiche
      // exactement ce que la base connaît.
      refreshAiQuota()
      // Success buzz lands at the exact moment the 3D card reveals.
      hapticSuccess()
      setStep(3)
    } catch {
      // Infra/timeout failure: fail open to manual entry, don't block.
      clearTimeout(timer)
      cancelHeartbeat()
      applyResult(EMPTY_RESULT)
      setStep(3)
    }
  }

  /**
   * Ouvre le formulaire SANS lancer d'analyse.
   *
   * Emprunte le chemin déjà utilisé quand l'IA échoue — résultat vide, étape 3 —
   * plutôt que d'ajouter un écran. Deux usages :
   *   · quota épuisé (le bouton principal devient « Saisir à la main ») ;
   *   · choix délibéré alors qu'il reste des analyses.
   *
   * Aucun appel réseau n'est émis, donc aucun crédit consommé. C'est ce qui
   * garantit qu'atteindre le plafond ne déclenche plus de tentative inutile.
   */
  /**
   * Saisie manuelle — SANS identification IA, mais AVEC floutage des plaques.
   *
   * ── CE QUI A CHANGÉ LE 30/09/2026 ──
   * Ce chemin posait `plateGuard('failed')` et s'en remettait à une case à
   * cocher : « je certifie qu'aucune plaque n'est lisible ». Le mode manuel
   * devenait donc une sortie de secours du système de confidentialité, et
   * c'est précisément par là que passaient les utilisateurs à court de quota.
   *
   * Désormais la détection de plaque tourne TOUJOURS. Elle ne dépend plus du
   * quota d'identification (voir server/ai-gate.js) : identifier une voiture
   * est un service, flouter une plaque est une obligation.
   *
   * La case à cocher ne subsiste que pour le vrai échec technique — détection
   * indisponible, floutage impossible — jamais comme raccourci par défaut.
   */
  async function startManual() {
    if (!image) return
    applyResult(EMPTY_RESULT)
    setRejection(null)
    setPubError(null)
    setManualNotice(
      aiExhausted
        ? t('newspot.aiQuotaExhausted', { limit: aiQuota?.limit ?? 5 })
        : t('newspot.manualEntryHint'),
    )
    setStep(3)
    await runPlateGuard()
  }

  /**
   * Détecte puis floute les plaques sur le blob en mémoire.
   *
   * Utilisé par les DEUX chemins : l'analyse IA le fait déjà dans son appel
   * groupé, la saisie manuelle l'appelle ici. Le blob est remplacé sur place,
   * donc `publish()` téléverse toujours la version anonymisée — l'original ne
   * quitte jamais l'appareil.
   */
  async function runPlateGuard() {
    if (!image) return
    setPlateChecking(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) {
        setPlateGuard('failed')
        return
      }
      const res = await fetch('/api/detect-plate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageBase64: aiBase64 ?? image.base64,
          mimeType: 'image/jpeg',
        }),
      })
      if (!res.ok) {
        setPlateGuard('failed')
        return
      }
      const { plates } = (await res.json()) as { plates: BBox[] | null }
      if (plates === null) {
        setPlateGuard('failed')
        return
      }
      if (plates.length > 0) {
        const blurred = await blurRegions(image.blob, plates)
        setImage(blurred)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(URL.createObjectURL(blurred.blob))
      }
      setPlateGuard('ok')
    } catch (e) {
      console.error('[plate guard] échec :', e)
      setPlateGuard('failed')
    } finally {
      setPlateChecking(false)
    }
  }

  function pickAlternative(alt: { brand: string; model: string; year: number | null }) {
    setBrand(alt.brand)
    setModel(alt.model)
    setYear(alt.year != null ? String(alt.year) : '')
  }

  /** Explicit retry handler bound to the RÉESSAYER button. Resets
   *  every error/status slot first, then re-invokes publish() so the
   *  retry path is identical to the first attempt — no half-flushed
   *  state, no risk of a stale pubStatus string sticking around. */
  function retryPublish(): void {
    setPubError(null)
    setLimitReached(false)
    setManualNotice(null)
    setPubStatus('')
    publish()
  }

  /** Save the (already plate-blurred) photo to the device gallery —
   *  independent of publishing. Prefers the Web Share sheet with a file
   *  (iOS lets the user "Save Image"); falls back to a download link
   *  (Android / desktop). Cancelling the share sheet is a silent no-op. */
  async function saveToGallery(): Promise<void> {
    if (!image) return
    const file = new File([image.blob], `revs-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    })
    try {
      const nav = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean
      }
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file] })
      } else {
        const url = URL.createObjectURL(image.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      hapticSuccess()
      setSavedToGallery(true)
      window.setTimeout(() => setSavedToGallery(false), 2000)
    } catch {
      /* user dismissed the share sheet — no feedback, no error */
    }
  }

  async function publish() {
    if (!image) return
    setPubError(null)
    setLimitReached(false)
    setManualNotice(null)
    try {
      setPubStatus(t('newspot.statusLocating'))
      const pos = await getPosition()

      // Anti-fraude : photo prise sur le moment et au bon endroit.
      const takenAt = photoMeta?.takenAt ?? null
      if (takenAt && Date.now() - takenAt.getTime() > MAX_PHOTO_AGE_MS) {
        rejectAndRestart(t('newspot.rejectPhotoTooOld'))
        return
      }
      const photoLat = photoMeta?.lat ?? null
      const photoLng = photoMeta?.lng ?? null
      if (photoLat != null && photoLng != null) {
        // Contrôle anti-fraude : on compare l'EXIF de la photo à la position
        // réelle, en PRÉCISION PLEINE. Arrondir ici ajouterait jusqu'à ~78 m
        // de dérive artificielle sur un seuil de 300 m, donc des rejets
        // injustifiés. L'arrondi ne concerne que ce qui est stocké ou
        // transmis, jamais ce qui est comparé localement.
        const drift = distanceMeters(
          photoLat,
          photoLng,
          pos.coords.latitude,
          pos.coords.longitude,
        )
        if (drift > MAX_GPS_DRIFT_M) {
          rejectAndRestart(t('newspot.rejectGpsIncoherent'))
          return
        }
      }

      setPubStatus(t('newspot.statusAuthenticating'))
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error(t('newspot.notAuthenticatedThrow'))

      // ── SUPPRIMÉ le 30/09/2026 : le comptage « 5 spots/jour » vivait ici ──
      //
      // Cet écran interrogeait `subscriptions`, comptait les spots du jour et
      // refusait la publication au-delà de 5. C'était la première des trois
      // couches qui rationnaient une action GRATUITE — publier ne déclenche
      // aucun appel IA. La publication n'a plus de quota commercial ; seul le
      // trigger `enforce_spot_daily_quota` subsiste en base, comme garde
      // anti-abus très haut, et `quotaMessage()` sait encore le reconnaître si
      // un flot automatisé venait à le déclencher.
      //
      // Ce qui reste plafonné, et uniquement cela : les ANALYSES IA.

      setPubStatus(t('newspot.statusUploading'))
      const path = `${user.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('spots')
        .upload(path, image.blob, { contentType: 'image/jpeg' })
      if (upErr) throw supaError(t('newspot.uploadLabel'), upErr)

      const { data: pub } = supabase.storage.from('spots').getPublicUrl(path)

      setPubStatus(t('newspot.statusPublishing'))
      const yearNum = parseInt(year, 10)

      // If a live event is within 5km, opt-in to tag this spot to it.
      // Best-effort lookup; failures fall through silently.
      let liveEventId: string | null = null
      try {
        const { data: live } = await supabase
          .rpc('nearby_live_event', {
            p_lat: roundCoord(pos.coords.latitude),
            p_lng: roundCoord(pos.coords.longitude),
            p_radius_km: 5,
          })
          .maybeSingle()
        liveEventId = ((live as { id?: string } | null)?.id) ?? null
      } catch {
        liveEventId = null
      }

      const { data: inserted, error: insErr } = await supabase
        .from('spots')
        .insert({
          user_id: user.id,
          validation_id: validationId,
          brand: brand.trim(),
          model: model.trim(),
          year: Number.isFinite(yearNum) ? yearNum : null,
          color: color.trim(),
          category,
          description: description.trim() || null,
          photo_url: pub.publicUrl,
          confidence: result.confidence,
          estimated_price: result.estimated_price ?? null,
          rarity: result.rarity ?? 'standard',
          production: result.production ?? null,
          lat: roundCoord(pos.coords.latitude),
          lng: roundCoord(pos.coords.longitude),
          event_id: liveEventId,
          // ── QUI FAIT AUTORITÉ SUR L'IDENTITÉ ──
          // Si l'utilisateur a modifié la marque ou le modèle proposés, c'est
          // SA saisie la vérité du spot, et aucune ré-identification
          // automatique ne doit plus l'écraser — l'audit du parc a montré que
          // l'IA se trompe sur un spot sur dix, et il serait absurde qu'un
          // futur passage « corrige » une donnée humaine exacte.
          // Le drapeau marque aussi les spots saisis à la main quand l'IA
          // n'avait rien proposé.
          ident_locked:
            brand.trim() !== (result.brand ?? '').trim() ||
            model.trim() !== (result.model ?? '').trim(),
          // Sceau de la contre-vérification d'identify-car. Sans cette ligne
          // il ne survivait pas à la publication, et le Garage refusait de
          // générer même sur une identité que la chaîne avait confirmée.
          ai_verified: result.verified === true,
        })
        .select('*')
        .single()
      if (insErr) {
        // ── Rollback du fichier ──
        // Le fichier est déposé AVANT l'insertion : sans ce nettoyage, tout
        // échec laisse une image que plus rien ne référence. L'audit du 29/09
        // en a trouvé trois, datées de mai et juin 2026.
        //
        // La suppression ne vise QUE le chemin créé par cette tentative
        // (`path`, construit juste au-dessus). Elle est volontairement
        // silencieuse en cas d'échec : le message utile est l'erreur
        // d'insertion d'origine, pas celle du nettoyage — on ne veut pas la
        // masquer derrière un second message.
        await supabase.storage
          .from('spots')
          .remove([path])
          .catch(() => {
            /* le fichier restera orphelin ; l'erreur d'insertion prime */
          })

        // Plafond de publication atteint côté base : message propre plutôt que
        // l'erreur SQL brute, et même traitement visuel que le garde client
        // (bandeau + lien Premium via limitReached).
        const quota = quotaMessage(insErr)
        if (quota) {
          setLimitReached(true)
          setPubError(quota)
          setPubStatus('')
          return
        }
        throw supaError(t('newspot.publishLabel'), insErr)
      }
      const insertedSpot = (inserted as Spot | null) ?? null
      const newSpotId = insertedSpot?.id ?? null
      // Instant feed re-render — hand the full row to the (kept-alive)
      // Feed so the user's photo is already at the top of the Fil the
      // moment they switch tabs, no manual refresh.
      if (insertedSpot) emitNewSpot(insertedSpot)

      // ── RENDU GARAGE : LANCÉ, JAMAIS ATTENDU ──
      //
      // La publication est DÉJÀ terminée à ce point. Cet appel part et on ne
      // s'en occupe plus : pas de `await`, pas d'état de chargement, pas de
      // message d'erreur. S'il échoue, si le réseau coupe, si l'utilisateur
      // ferme l'application dans la seconde — le spot reste publié et le
      // Garage affiche simplement sa photo, ce qu'il fait déjà aujourd'hui
      // pour les 25 spots sans rendu.
      //
      // Le serveur refuse de lui-même si l'identité n'est pas validée, si un
      // rendu compatible existe déjà, ou si quelqu'un génère la même voiture
      // au même moment. Le client n'a aucune de ces décisions à prendre.
      if (newSpotId) {
        void (async () => {
          try {
            const { data: s } = await supabase.auth.getSession()
            const tk = s?.session?.access_token
            if (!tk) return
            await fetch('/api/garage-render', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${tk}`,
              },
              body: JSON.stringify({ spotId: newSpotId }),
            })
          } catch {
            /* le Garage retombe sur photo_url — rien à signaler */
          }
        })()
      }

      // After the first successful spot: ask for push permission, then
      // fire two parallel notifications:
      //  (1) nearby subscribers (≤10km, generic "new spot near you")
      //  (2) brand followers within ≤50km (only if the spot brand maps
      //      to one of the catalogued brands in src/lib/brands.ts)
      void (async () => {
        await maybePromptPush()
        const who = await myPseudo()
        const brandTrim = brand.trim()
        const modelTrim = model.trim()
        void notifyPush({
          title: t('newspot.pushNearbyTitle'),
          body: t('newspot.pushNearbyBody', {
            who,
            brand: brandTrim,
            model: modelTrim,
          }),
          url: '/map',
          type: 'nearby',
          nearby: {
            lat: roundCoord(pos.coords.latitude),
            lng: roundCoord(pos.coords.longitude),
            radiusKm: 10,
            excludeUserId: user.id,
          },
        })
        const slug = brandSlugFor(brandTrim)
        const brandEntry = slug ? getBrand(slug) : undefined
        if (slug && brandEntry) {
          void notifyPush({
            title: t('newspot.pushBrandTitle', { brand: brandEntry.name }),
            body: t('newspot.pushBrandBody', {
              who,
              brand: brandEntry.name,
              model: modelTrim,
            }),
            url: `/brand/${slug}`,
            // Gate on the existing "nearby" pref — brand follows are
            // proximity-based notifications by design.
            type: 'nearby',
            brand_nearby: {
              brand: slug,
              lat: roundCoord(pos.coords.latitude),
              lng: roundCoord(pos.coords.longitude),
              radiusKm: 50,
              excludeUserId: user.id,
            },
          })
        }
        // Premium Radar fanout — bespoke push per target with personalised
        // distance line. Best-effort; never blocks the publish flow.
        if (newSpotId) {
          const { triggerRadarFanout } = await import('../lib/radar')
          void triggerRadarFanout(newSpotId)
          // ── SUPPRIMÉ le 30/09/2026 : la résolution d'image de garage ──
          //
          // `triggerGarageImage()` demandait au serveur d'aller chercher sur
          // INTERNET une photo presse/constructeur du modèle (CarImages, puis
          // Claude web_search), et de la stocker dans `garage_image_url`. Le
          // Garage affichait ensuite cette image à la place de la voiture
          // réellement photographiée. En base : 30 lignes sur 32 pointant vers
          // wikimedia.org.
          //
          // Trois raisons de couper, et pas seulement l'esthétique :
          //   · ce n'est pas la voiture de l'utilisateur ;
          //   · ces images n'ont jamais traversé le floutage de plaques REVS ;
          //   · leur licence n'est pas maîtrisée et elles sont chargées à
          //     chaud depuis un domaine tiers.
          //
          // Le Garage part désormais de SA photo : détourée hors ligne quand
          // le rendu existe (migration 0087), telle quelle sinon.
        }
      })()

      // Cosmetic "+N XP" floater — strictly best-effort. The spot is
      // already saved at this point, so a failure here (e.g. a chunk that
      // fails to resolve, or xpForSpot somehow undefined in a minified
      // bundle — the original "oe is not a function" crash) must NEVER
      // abort the publish or block navigation. Rarity falls back to
      // 'standard' and the floater is simply skipped on any error.
      try {
        const { floatXp } = await import('../components/XpFloater')
        if (typeof xpForSpot === 'function' && typeof floatXp === 'function') {
          floatXp(
            xpForSpot(
              result.estimated_price ?? null,
              (result.rarity ?? 'standard') as Rarity,
            ),
            result.rarity ?? 'standard',
          )
        }
      } catch (floaterErr) {
        console.warn('[spot] xp floater skipped:', floaterErr)
      }

      // Post-spot celebration (confetti burst + collector fly-away) and a
      // level-up check — both best-effort, never block navigation.
      try {
        const [{ celebrateSpot }, { checkLevelUp }] = await Promise.all([
          import('../components/SpotCelebration'),
          import('../components/LevelUpOverlay'),
        ])
        celebrateSpot({ photoUrl: pub.publicUrl })
        void checkLevelUp()
      } catch (fxErr) {
        console.warn('[spot] celebration skipped:', fxErr)
      }
      navigate('/map', { state: { toast: t('newspot.toastPublished') } })
    } catch (err) {
      console.error('[spot] publish aborted:', err)
      const msg =
        (err as { code?: number })?.code === 1
          ? t('newspot.gpsDenied')
          : err instanceof Error
            ? err.message
            : t('newspot.publishFailed')
      setPubError(msg)
      setPubStatus('')
    }
  }

  useEffect(() => {
    if (step === 4) publish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  function back() {
    setPubError(null)
    setRejection(null)
    if (step === 1) navigate('/')
    else if (step === 3) setStep(1)
    else setStep((s) => (s - 1) as Step)
  }

  if (profileOk === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-fg2">
        {t('newspot.loading')}
      </div>
    )
  }

  if (profileOk === false) {
    return (
      <div className="min-h-screen bg-bg px-6 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
        <div className="flex items-center gap-4 py-4">
          <button
            onClick={() => navigate('/')}
            aria-label={t('newspot.back')}
            className="tappable text-fg2 hover:text-fg"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
        </div>
        <div className="mx-auto mt-6 max-w-sm space-y-5">
          <div>
            <h1 className="display-xl text-fg">
              {t('newspot.gateTitle')}
            </h1>
            <p className="mt-2 text-sm text-fg2">
              {t('newspot.gateSubtitle')}
            </p>
          </div>
          <div className="space-y-2">
            <label className="label-up text-[10px] text-fg2">{t('newspot.labelPseudo')}</label>
            <input
              value={gpPseudo}
              maxLength={24}
              onChange={(e) => setGpPseudo(e.target.value)}
              placeholder={t('newspot.placeholderPseudo')}
              className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none placeholder:text-fg2/40 focus:border-accent"
              style={{ border: '1px solid var(--color-border)' }}
            />
          </div>
          <div className="space-y-2">
            <label className="label-up text-[10px] text-fg2">{t('newspot.labelVille')}</label>
            <input
              value={gpVille}
              maxLength={48}
              onChange={(e) => setGpVille(e.target.value)}
              placeholder={t('newspot.placeholderVille')}
              className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none placeholder:text-fg2/40 focus:border-accent"
              style={{ border: '1px solid var(--color-border)' }}
            />
          </div>
          {gpErr && <p className="text-sm text-accent">{gpErr}</p>}
          <button
            onClick={saveProfileGate}
            disabled={gpSaving}
            className="tappable w-full rounded-full bg-accent py-3.5 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            {gpSaving ? t('newspot.gateSaving') : t('newspot.gateSave')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-fg px-6 pt-[max(1rem,env(safe-area-inset-top))]">
      {/* Header : retour + progression */}
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={back}
          aria-label={t('newspot.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors ${
                n <= step ? 'bg-accent' : 'bg-fg/10'
              }`}
              style={
                n <= step
                  ? { boxShadow: '0 0 8px rgba(232,32,58,0.55)' }
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {/* ÉTAPE 1 — PHOTO */}
      {step === 1 && (
        <div className="space-y-6 pb-8">
          <h1 className="display-xl text-fg">{t('newspot.newSpotTitle')}</h1>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="hidden"
          />

          {/* Le contrôle automobile tourne pendant que l'aperçu s'affiche :
              on le dit plutôt que de laisser un bouton inerte sans raison. */}
          {gateChecking && (
            <p className="text-center text-sm text-fg2">{t('gate.checking')}</p>
          )}

          {rejection && (
            <div
              className="rounded-3xl px-4 py-3 text-sm text-accent"
              style={{
                background: 'rgba(232,32,58,0.10)',
                border: '1px solid rgba(232,32,58,0.40)',
              }}
            >
              {rejection}
            </div>
          )}

          {previewUrl ? (
            <div className="space-y-5">
              <img
                src={previewUrl}
                alt={t('newspot.previewAlt')}
                // Hero of the publish flow — keep eager + high
                // priority so the preview lands the moment the
                // analyse step finishes.
                fetchPriority="high"
                decoding="async"
                className="w-full max-h-[55vh] object-cover rounded-3xl"
                style={{ border: '1px solid var(--color-border)' }}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="tappable flex-1 rounded-full py-3 text-sm font-bold tracking-wide text-fg2 hover:text-fg"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {t('newspot.retake')}
                </button>
              </div>

              {/* ── « COMMENT VEUX-TU IDENTIFIER CE VÉHICULE ? » ──
                  Deux chemins de rang ÉGAL (30/09/2026). L'analyse IA n'est
                  plus une porte obligatoire : c'est un service, offert à côté
                  de la saisie manuelle. Le bouton manuel reste présent même
                  quand il reste des crédits — et devient le chemin mis en
                  avant quand il n'y en a plus.

                  Dans les deux cas, la détection de plaque tourne : elle ne
                  dépend plus du quota (voir server/ai-gate.js). */}
              <p className="mt-5 text-center text-[13px] font-bold text-fg">
                {t('newspot.chooseTitle')}
              </p>

              {aiExhausted && (
                <p className="mt-1.5 text-center text-[12px] leading-snug text-fg2">
                  {t('newspot.chooseExhausted', { limit: aiQuota?.limit ?? 5 })}
                </p>
              )}

              <div className="mt-3 space-y-2.5">
                <button
                  onClick={analyze}
                  disabled={!image || aiExhausted}
                  className="tappable w-full rounded-2xl px-4 py-3.5 text-left disabled:opacity-40"
                  style={{
                    background: aiExhausted
                      ? 'var(--color-glass-mid)'
                      : 'rgb(var(--color-accent))',
                    border: aiExhausted ? '1px solid var(--color-border)' : 'none',
                    boxShadow: aiExhausted
                      ? undefined
                      : '0 8px 24px rgba(232,32,58,0.45)',
                  }}
                >
                  <span
                    className="block text-[14px] font-extrabold tracking-wide"
                    style={{ color: aiExhausted ? 'rgb(var(--color-fg-2))' : '#fff' }}
                  >
                    {t('newspot.chooseAi')}
                  </span>
                  <span
                    className="mt-0.5 block text-[11.5px] font-medium"
                    style={{
                      color: aiExhausted
                        ? 'rgb(var(--color-fg-2))'
                        : 'rgba(255,255,255,0.78)',
                    }}
                  >
                    {aiQuota
                      ? t('newspot.chooseAiSub', { count: aiQuota.remaining })
                      : t('newspot.chooseAiSubDefault', { limit: 5 })}
                  </span>
                </button>

                <button
                  onClick={startManual}
                  disabled={!image}
                  className="tappable w-full rounded-2xl px-4 py-3.5 text-left disabled:opacity-40"
                  style={{
                    background: aiExhausted
                      ? 'rgb(var(--color-accent))'
                      : 'var(--color-glass-mid)',
                    border: aiExhausted ? 'none' : '1px solid var(--color-border)',
                    boxShadow: aiExhausted
                      ? '0 8px 24px rgba(232,32,58,0.45)'
                      : undefined,
                  }}
                >
                  <span
                    className="block text-[14px] font-extrabold tracking-wide"
                    style={{ color: aiExhausted ? '#fff' : 'rgb(var(--color-fg))' }}
                  >
                    {t('newspot.chooseManual')}
                  </span>
                  <span
                    className="mt-0.5 block text-[11.5px] font-medium"
                    style={{
                      color: aiExhausted
                        ? 'rgba(255,255,255,0.78)'
                        : 'rgb(var(--color-fg-2))',
                    }}
                  >
                    {t('newspot.chooseManualSub')}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                onClick={() => cameraRef.current?.click()}
                className="tappable flex w-full items-center justify-center gap-3 rounded-3xl bg-accent py-6 text-base font-extrabold tracking-wider text-fg"
                style={{ boxShadow: '0 12px 36px rgba(232,32,58,0.45)' }}
              >
                <Camera className="h-6 w-6" />
                {t('newspot.takePhoto')}
              </button>
              {pubError && (
                <p className="text-sm text-accent">{pubError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ÉTAPE 2 — ANALYSE IA. Premium "scan" UI: the just-captured
          photo fills the canvas at 60% opacity, a red laser line
          sweeps it vertically, and a glass-blur card centered on
          top displays a spinning red rim + the analysis copy.
          Falls back to a discreet placeholder when previewUrl is
          missing (shouldn't happen — the flow enforces a photo
          before step 2 — but the guard keeps the layout safe). */}
      {step === 2 && (
        <div className="relative -mx-4 overflow-hidden rounded-3xl bg-black"
          style={{ minHeight: '380px' }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              aria-hidden
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: 0.60 }}
            />
          ) : null}
          {/* Slight dark gradient + edge vignette for legibility */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.70) 100%)',
            }}
          />
          {/* Animated red laser sweep */}
          <span aria-hidden className="scan-laser-line" />

          {/* Centred premium glass card */}
          <div className="relative z-10 flex min-h-[380px] items-center justify-center px-6 py-10">
            <div
              className="flex max-w-[280px] flex-col items-center gap-4 rounded-3xl px-6 py-6 text-center"
              style={{
                background: 'rgba(10, 10, 12, 0.72)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                backdropFilter: 'saturate(170%) blur(22px)',
                WebkitBackdropFilter: 'saturate(170%) blur(22px)',
                boxShadow: '0 22px 48px rgba(0, 0, 0, 0.55)',
              }}
            >
              {/* Spinning ring — Tailwind animate-spin on a partial
                  border gives the classic loading-ring look. */}
              <div className="relative flex h-12 w-12 items-center justify-center">
                <span
                  className="absolute inset-0 rounded-full border-2 animate-spin"
                  style={{
                    borderColor:
                      '#E8203A #E8203A transparent transparent',
                  }}
                />
                <span style={{ fontSize: '14px' }} aria-hidden>
                  👁️‍🗨️
                </span>
              </div>
              <div>
                <h3
                  className="font-display font-extrabold tracking-tight text-white"
                  style={{ fontSize: '16px', letterSpacing: '-0.01em' }}
                >
                  {t('newspot.analyzingTitle')}
                </h3>
                <p
                  className="mt-1.5 leading-snug text-fg/55"
                  style={{ fontSize: '12px' }}
                >
                  {t('newspot.analyzingSubtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ÉTAPE 3 — CONFIRMATION (et saisie manuelle : c'est le même écran,
          simplement pré-rempli ou vide selon qu'une analyse a eu lieu) */}
      {step === 3 && (
        <div className="space-y-6 pb-8">
          {/* Pourquoi le formulaire est vide. Sans cette phrase, arriver sur
              des champs vierges ressemble à un bug plutôt qu'à une porte
              ouverte. */}
          {manualNotice && (
            <div
              className="rounded-2xl px-4 py-3 text-[12.5px] leading-snug text-fg2"
              style={{
                background: 'var(--color-glass-mid)',
                border: '1px solid var(--color-border)',
              }}
            >
              {manualNotice}
            </div>
          )}
          {result.brand === 'Voiture' && result.model === 'Modèle indéterminé' ? (
            <div
              className="rounded-3xl bg-card px-4 py-3 text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {t('newspot.identifyDifficult')}
            </div>
          ) : (
            // Hero reveal — full 2:3 CollectorCard preview built
            // from the in-memory form fields + the captured photo.
            // The 3D pop animation (perspective parent + card-pop-3d
            // child) mimics a trading card being flipped into view;
            // the white flash overlay sibling marks the moment the
            // card lands.
            <div className="space-y-3">
              <div className="perspective-1000 flex justify-center">
                <div
                  className="card-pop-3d"
                  style={{ width: '70%', maxWidth: '260px' }}
                >
                  <CollectorCard
                    spot={previewSpot}
                    cardNumber={1}
                    isFirstOnRevs={false}
                    spotsCount={1}
                  />
                </div>
              </div>
              {/* Indice de confiance — uniquement quand une analyse a
                  RÉELLEMENT eu lieu. En saisie manuelle, `result` est
                  EMPTY_RESULT : afficher « IA · 0 % de confiance » et un
                  avertissement de reconnaissance reviendrait à reprocher à
                  l'IA un travail qu'on ne lui a jamais demandé. */}
              {!manualNotice && (
                <>
                  {/* ── PLUS DE POURCENTAGE (01/10/2026) ──
                      On affichait « IA · 94 % de confiance ». Ce chiffre est
                      la certitude que le modèle s'attribue à lui-même, pas une
                      probabilité mesurée : il n'a jamais été calibré contre
                      des résultats réels. Mesuré sur les 33 spots du parc,
                      trois fiches étaient fausses, dont une annoncée à 88 —
                      « Model 3 » sur une Model Y. Un pourcentage sur deux
                      décimales donne l'impression d'une précision qui n'existe
                      pas, et détourne de la seule chose utile : relire.
                      Le score reste calculé et stocké pour la logique
                      interne ; il n'est simplement plus montré. */}
                  <p
                    className="px-3 text-center leading-snug text-fg2"
                    style={{ fontSize: '11px' }}
                  >
                    {t('newspot.aiDisclaimer')}
                  </p>
                  {/* Photo lointaine ou véhicule masqué : le doute, lui, reste
                      affiché — c'est une information actionnable (reprendre la
                      photo), pas un chiffre décoratif. */}
                  {result.confidence < 50 && <LowConfidenceBadge />}
                </>
              )}
              <span aria-hidden className="card-reveal-flash" />
            </div>
          )}

          {result.alternatives.length > 0 && (
            <div className="space-y-2">
              <p className="label-up text-[10px] text-fg2">{t('newspot.alternatives')}</p>
              <div className="flex flex-wrap gap-2">
                {result.alternatives.slice(0, 2).map((alt, i) => (
                  <button
                    key={i}
                    onClick={() => pickAlternative(alt)}
                    className="tappable rounded-full bg-card px-4 py-2 text-xs font-bold tracking-wide text-fg2 hover:text-fg"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    {alt.brand} {alt.model}
                    {alt.year ? ` (${alt.year})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <BrandField
              label={t('newspot.fieldBrand')}
              brand={brand}
              onBrand={setBrand}
            />
            <ModelField
              label={t('newspot.fieldModel')}
              brand={brand}
              model={model}
              onModel={setModel}
              onBrand={setBrand}
            />
            <Field
              label={t('newspot.fieldYear')}
              value={year}
              onChange={setYear}
              inputMode="numeric"
            />
            <Field label={t('newspot.fieldColor')} value={color} onChange={setColor} />

            <div className="space-y-2">
              <label className="label-up text-[10px] text-fg2">{t('newspot.fieldCategory')}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SpotCategory)}
                className="w-full appearance-none rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-bg">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label
                className="block"
                style={{ fontSize: '12px', color: '#888' }}
              >
                {t('newspot.descriptionLabel')}
              </label>
              <div className="relative">
                <textarea
                  value={description}
                  maxLength={280}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder={t('newspot.descriptionPlaceholder')}
                  className="w-full resize-none outline-none placeholder:text-[#666]"
                  style={{
                    background: '#1a1a1a',
                    borderRadius: '12px',
                    border: '1px solid #333',
                    // Extra bottom padding leaves room for the overlaid
                    // counter so the last line never slides under it.
                    padding: '12px 12px 26px',
                    color: '#fff',
                    fontSize: '14px',
                  }}
                />
                <p
                  className="absolute bottom-2 right-3 tabular-nums"
                  style={{ fontSize: '11px', color: '#888' }}
                >
                  {description.length}/280
                </p>
              </div>
            </div>
          </div>

          {/* Save to gallery — independent of publishing. The photo here
              already has the plate blur applied. */}
          <button
            onClick={saveToGallery}
            className="tappable flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold tracking-wide transition-colors"
            style={
              savedToGallery
                ? { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.5)', color: '#34D399' }
                : { background: '#141414', border: '1px solid var(--color-border)', color: 'rgb(var(--color-fg))' }
            }
          >
            {savedToGallery ? t('newspot.savedToGallery') : t('newspot.saveToGallery')}
          </button>

          {/* ── PROTECTION DES PLAQUES — PLUS AUCUNE SORTIE DE SECOURS ──
              Il y avait ici une case à cocher : « je certifie qu'aucune plaque
              n'est lisible ». Elle permettait de publier l'original quand la
              détection avait échoué.

              C'était une faille, pas un compromis. Une case cochée par
              quelqu'un qui veut publier ne dit rien de la photo ; elle déplace
              seulement la responsabilité sur l'utilisateur, ce qui ne protège
              aucune plaque. Le système doit être fail-safe : si on ne sait pas,
              on ne publie pas.

              Le bouton reprend la détection. Si elle échoue encore, reprendre
              la photo reste possible — publier sans vérification, non. */}
          {plateGuard === 'failed' && (
            <div
              className="rounded-2xl p-3.5"
              style={{
                background: 'rgb(var(--color-accent) / 0.08)',
                border: '1px solid rgb(var(--color-accent) / 0.35)',
              }}
              role="alert"
            >
              <p className="text-[12.5px] font-bold text-accent">
                {t('newspot.plateGuardBlockedTitle')}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-fg2">
                {t('newspot.plateGuardBlockedBody')}
              </p>
              <button
                onClick={() => void runPlateGuard()}
                disabled={plateChecking}
                className="tappable mt-3 w-full rounded-full py-2.5 text-[12px] font-extrabold tracking-wider text-accent disabled:opacity-50"
                style={{ border: '1px solid rgb(var(--color-accent) / 0.45)' }}
              >
                {plateChecking
                  ? t('newspot.plateChecking')
                  : t('newspot.plateGuardRetry')}
              </button>
              {/* Relancer la détection ne sert à rien si le détecteur ne sait
                  pas lire CETTE photo — il échouera pareil. L'issue n'est donc
                  pas une case à cocher, qui ne dit rien de la photo, mais le
                  geste qui protège réellement : désigner la plaque. */}
              <button
                onClick={() => setMarkerOpen(true)}
                disabled={plateChecking || !previewUrl}
                className="tappable mt-2 w-full rounded-full bg-accent py-2.5 text-[12px] font-extrabold tracking-wider text-fg disabled:opacity-50"
              >
                {t('plate.title')}
              </button>
            </div>
          )}

          <button
            onClick={() => setStep(4)}
            // `plateChecking` : la publication est retenue tant que le contrôle
            // de plaque tourne. Sans ce garde, un utilisateur rapide pouvait
            // publier AVANT que le floutage ne soit appliqué au blob — et
            // téléverser l'original.
            // Fail-safe : on ne continue QUE si le contrôle de plaque a
            // réellement abouti. 'pending' comme 'failed' bloquent — le doute
            // ne doit jamais se résoudre en faveur de la publication.
            disabled={
              !brand.trim() ||
              !model.trim() ||
              plateChecking ||
              plateGuard !== 'ok'
            }
            className="tappable w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            {plateChecking ? t('newspot.plateChecking') : t('newspot.continue')}
          </button>
        </div>
      )}

      {/* ÉTAPE 4 — PUBLICATION */}
      {step === 4 && (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: 'rgba(232,32,58,0.12)',
              border: '1px solid rgba(232,32,58,0.40)',
              boxShadow: '0 0 24px rgba(232,32,58,0.30)',
            }}
          >
            <MapPin className="h-7 w-7 text-accent" />
          </div>
          <p className="text-sm text-fg2">
            {t('newspot.gpsWillBeSaved')}
          </p>
          {limitReached ? (
            <div className="w-full max-w-xs space-y-3">
              <p className="text-sm text-fg/85">{pubError}</p>
              <button
                onClick={() => navigate('/premium')}
                className="tappable w-full rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
                style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
              >
                {t('newspot.viewSubscriptions')}
              </button>
              <button
                onClick={() => navigate('/')}
                className="tappable w-full rounded-full bg-card px-6 py-3 text-sm font-bold tracking-wide text-fg2"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {t('newspot.later')}
              </button>
            </div>
          ) : pubError ? (
            <div className="space-y-4">
              <p className="text-sm text-accent">{pubError}</p>
              <button
                onClick={retryPublish}
                className="tappable rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
                style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
              >
                {t('newspot.retry')}
              </button>
            </div>
          ) : (
            <div className="w-56 space-y-3 text-sm text-fg2">
              <p className="label-up text-[11px]">
                {pubStatus || t('newspot.statusPublishing')}
              </p>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          )}
        </div>
      )}

      {/* ── MARQUAGE MANUEL, EN SURCOUCHE ──
          Monté en dernier et en plein écran : désigner une plaque demande de
          voir la photo en grand, pas une vignette dans un formulaire. */}
      {markerOpen && previewUrl && image && (
        <PlateMarker
          photoUrl={previewUrl}
          onConfirm={(boxes) => {
            void (async () => {
              setMarkerOpen(false)
              setPlateChecking(true)
              try {
                const blurred = await blurRegions(image.blob, boxes)
                setImage(blurred)
                if (previewUrl) URL.revokeObjectURL(previewUrl)
                setPreviewUrl(URL.createObjectURL(blurred.blob))
                setPlateGuard('ok')
              } catch (e) {
                // Le floutage a échoué : l'image en mémoire est toujours
                // l'originale, plaque comprise. On NE débloque pas.
                console.error('[plate marker] floutage en échec :', e)
                setPlateGuard('failed')
              } finally {
                setPlateChecking(false)
              }
            })()
          }}
          onNone={() => {
            // Déclaration explicite après avoir vu la photo en plein écran et
            // qu'on lui ait demandé de pointer les plaques. C'est autre chose
            // qu'une case cochée au bas d'un formulaire : le geste demandé
            // était de MARQUER, et répondre « il n'y en a pas » suppose
            // d'avoir regardé. Sans cette issue, une photo réellement sans
            // plaque deviendrait impubliable dès que le détecteur bute.
            setMarkerOpen(false)
            setPlateGuard('ok')
          }}
        />
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: 'numeric'
}) {
  return (
    <div className="space-y-2">
      <label className="label-up text-[10px] text-fg2">{label}</label>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
        style={{ border: '1px solid var(--color-border)' }}
      />
    </div>
  )
}

/** Brand field with live autocomplete over the 61-make catalogue. Empty +
 *  focused → popular makes; typing filters. Tap → fills the brand. */
function BrandField({
  label,
  brand,
  onBrand,
}: {
  label: string
  brand: string
  onBrand: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(() => searchMakes(brand, 6), [brand])
  const showList =
    open &&
    suggestions.length > 0 &&
    !(suggestions.length === 1 && suggestions[0] === brand)

  return (
    <div className="relative space-y-2">
      <label className="label-up text-[10px] text-fg2">{label}</label>
      <input
        value={brand}
        autoComplete="off"
        onChange={(e) => {
          onBrand(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
        style={{ border: '1px solid var(--color-border)' }}
      />
      {showList && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-2xl bg-card py-1 shadow-xl"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {suggestions.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onBrand(m)
                setOpen(false)
              }}
              className="tappable block w-full px-4 py-2.5 text-left text-sm font-semibold text-fg transition-colors hover:bg-fg/5"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Model field with live autocomplete over the car catalogue (src/lib/cars.ts).
 *  If a brand is set, it suggests that make's models (tap → fills the model).
 *  If not, it searches the whole DB as "Make Model" (tap → fills brand + model).
 *  Typing "Maserati" in Brand then opening Model lists MC20, Ghibli, Levante… */
function ModelField({
  label,
  brand,
  model,
  onModel,
  onBrand,
}: {
  label: string
  brand: string
  model: string
  onModel: (v: string) => void
  onBrand: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasMake = !!findMake(brand)
  const suggestions = useMemo(() => {
    if (hasMake) {
      return modelsForMake(brand, model, 6).map((m) => ({
        label: m,
        make: '',
        model: m,
      }))
    }
    return searchCars(model, 6).map((s) => {
      const i = s.indexOf(' ')
      return {
        label: s,
        make: i > 0 ? s.slice(0, i) : s,
        model: i > 0 ? s.slice(i + 1) : '',
      }
    })
  }, [brand, model, hasMake])

  // Don't show the list when the value already equals the only suggestion.
  const showList =
    open &&
    suggestions.length > 0 &&
    !(suggestions.length === 1 && suggestions[0].model === model)

  return (
    <div className="relative space-y-2">
      <label className="label-up text-[10px] text-fg2">{label}</label>
      <input
        value={model}
        autoComplete="off"
        onChange={(e) => {
          onModel(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
        style={{ border: '1px solid var(--color-border)' }}
      />
      {showList && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-2xl bg-card py-1 shadow-xl"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (s.make) onBrand(s.make)
                onModel(s.model || s.label)
                setOpen(false)
              }}
              className="tappable block w-full px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-fg/5"
            >
              {s.make ? (
                <>
                  <span className="text-fg2">{s.make} </span>
                  <span className="font-semibold">{s.model}</span>
                </>
              ) : (
                <span className="font-semibold">{s.model}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Shown under the AI preview card when the model's confidence is low
 *  (< 50%) — a far or obscured shot. Amber alert, theme-aware: muted
 *  glow on dark, deeper contrasted amber on the alabaster light surface. */
function LowConfidenceBadge() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'
  return (
    <div className="flex justify-center">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold"
        style={{
          fontSize: '11px',
          letterSpacing: '0.01em',
          background: light ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.12)',
          color: light ? '#B45309' : '#FBBF24',
          border: light
            ? '1px solid rgba(180,83,9,0.40)'
            : '1px solid rgba(245,158,11,0.30)',
        }}
      >
        {t('newspot.lowConfidenceBadge')}
      </span>
    </div>
  )
}
