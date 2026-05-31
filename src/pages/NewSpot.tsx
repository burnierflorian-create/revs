import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  blurRegions,
  CATEGORIES,
  distanceMeters,
  readPhotoMeta,
  resizeImageToJpeg,
  type BBox,
  type IdentifyResult,
  type PhotoMeta,
  type SpotCategory,
} from '../lib/spots'
import { takePendingPhoto } from '../lib/pendingPhoto'
import { getCurrentPositionSafe } from '../lib/geo'
import { maybePromptPush, myPseudo, notifyPush } from '../lib/push'
import { brandSlugFor, getBrand } from '../lib/brands'
import { Skeleton } from '../components/Skeleton'

type Step = 1 | 2 | 3 | 4

const MAX_PHOTO_AGE_MS = 10 * 60 * 1000
const MAX_GPS_DRIFT_M = 300

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
    `${label} : ${detail || 'erreur inconnue'}${code ? ` [${code}]` : ''}`,
  )
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
  rarity: 'commun',
  production: null,
}

// getPosition delegates to the shared lib so every GPS-consuming
// screen gets the same defensive pattern (named callbacks, typeof
// guards, try/catch, per-code messages). Local re-export kept so
// existing callers below don't need to be touched.
const getPosition = getCurrentPositionSafe

export default function NewSpot() {
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>(1)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [image, setImage] = useState<{ blob: Blob; base64: string } | null>(
    null,
  )

  const [result, setResult] = useState<IdentifyResult>(EMPTY_RESULT)
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('')
  const [category, setCategory] = useState<SpotCategory>('other')
  const [description, setDescription] = useState('')

  const [photoMeta, setPhotoMeta] = useState<PhotoMeta | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const [pubError, setPubError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const [pubStatus, setPubStatus] = useState('')
  // Gate: a pseudo is required before spotting (no "Anonyme" spots).
  const [profileOk, setProfileOk] = useState<boolean | null>(null)
  const [gpPseudo, setGpPseudo] = useState('')
  const [gpVille, setGpVille] = useState('')
  const [gpSaving, setGpSaving] = useState(false)
  const [gpErr, setGpErr] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function rejectAndRestart(message: string) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setImage(null)
    setPhotoMeta(null)
    setResult(EMPTY_RESULT)
    setPubError(null)
    setPubStatus('')
    setRejection(message)
    setStep(1)
  }

  async function loadFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setRejection(null)
    setPubError(null)
    setPreviewUrl(URL.createObjectURL(file))
    setImage(null)
    // EXIF must be read from the original file: resizing re-encodes via
    // canvas and strips all metadata.
    setPhotoMeta(await readPhotoMeta(file))
    try {
      const resized = await resizeImageToJpeg(file)
      setImage(resized)
    } catch {
      setPubError('Impossible de lire cette image.')
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
      setGpErr('Choisis un pseudo (2 caractères minimum).')
      return
    }
    setGpSaving(true)
    setGpErr(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setGpSaving(false)
      setGpErr('Non authentifié.')
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
      setGpErr("Échec de l'enregistrement. Réessaie.")
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
  }

  async function analyze() {
    if (!image) return
    setStep(2)
    const ctrl = new AbortController()
    // 25 s upper bound: identify-car's prompt ladder + detect-plate's
    // own retry can each chew ~10-15 s. Below that the abort can take
    // out the still-running sibling call.
    const timer = setTimeout(() => ctrl.abort(), 25000)
    const body = JSON.stringify({
      imageBase64: image.base64,
      mimeType: 'image/jpeg',
    })
    const fetchJson = (path: string) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      }).then((r) => r.json())
    try {
      // Identify the car AND detect license plates in parallel — both
      // are vision calls of similar latency, no reason to serialise.
      // Plate detection failing is non-fatal: we just skip the blur.
      const [carJson, plateJson] = await Promise.all([
        fetchJson('/api/identify-car') as Promise<IdentifyResult>,
        (fetchJson('/api/detect-plate') as Promise<{ plates: BBox[] }>).catch(
          () => ({ plates: [] as BBox[] }),
        ),
      ])
      clearTimeout(timer)

      // Apply the plate blur to the in-memory blob BEFORE moving to the
      // edit step. By the time the user reaches publish(), image.blob
      // already carries the anonymised version — no race, no extra wait.
      const plates = plateJson.plates ?? []
      if (plates.length > 0) {
        try {
          const blurred = await blurRegions(image.blob, plates)
          setImage(blurred)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(URL.createObjectURL(blurred.blob))
        } catch (e) {
          // Canvas error → fall through with the original image. Better
          // a missed plate than blocking the whole publish flow.
          console.error('[plate blur] failed:', e)
        }
      }

      const data = { ...EMPTY_RESULT, ...carJson }
      if (data.valid === false) {
        rejectAndRestart(
          data.reason ||
            "Cette photo ne semble pas être une vraie voiture en conditions réelles.",
        )
        return
      }
      applyResult(data)
      setStep(3)
    } catch {
      // Infra/timeout failure: fail open to manual entry, don't block.
      clearTimeout(timer)
      applyResult(EMPTY_RESULT)
      setStep(3)
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
    setPubStatus('')
    publish()
  }

  async function publish() {
    if (!image) return
    setPubError(null)
    setLimitReached(false)
    try {
      setPubStatus('Localisation…')
      const pos = await getPosition()

      // Anti-fraude : photo prise sur le moment et au bon endroit.
      const takenAt = photoMeta?.takenAt ?? null
      if (takenAt && Date.now() - takenAt.getTime() > MAX_PHOTO_AGE_MS) {
        rejectAndRestart('Photo trop ancienne - prends la photo sur le moment')
        return
      }
      const photoLat = photoMeta?.lat ?? null
      const photoLng = photoMeta?.lng ?? null
      if (photoLat != null && photoLng != null) {
        const drift = distanceMeters(
          photoLat,
          photoLng,
          pos.coords.latitude,
          pos.coords.longitude,
        )
        if (drift > MAX_GPS_DRIFT_M) {
          rejectAndRestart('Localisation incohérente')
          return
        }
      }

      setPubStatus('Authentification…')
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Non authentifié')

      // Limite quotidienne : 5 spots/jour pour les comptes gratuits.
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle()
      const subscribed =
        sub?.status === 'active' || sub?.status === 'trialing'
      if (!subscribed) {
        const today = new Date().toISOString().slice(0, 10)
        const { data: cnt } = await supabase
          .from('spot_count_daily')
          .select('count')
          .eq('user_id', user.id)
          .eq('date', today)
          .maybeSingle()
        if ((cnt?.count ?? 0) >= 5) {
          setLimitReached(true)
          setPubError(
            "Tu as atteint ta limite de 5 spots aujourd'hui. Passe Premium pour des spots illimités.",
          )
          setPubStatus('')
          return
        }
      }

      setPubStatus('Envoi de la photo…')
      const path = `${user.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('spots')
        .upload(path, image.blob, { contentType: 'image/jpeg' })
      if (upErr) throw supaError('Envoi de la photo', upErr)

      const { data: pub } = supabase.storage.from('spots').getPublicUrl(path)

      setPubStatus('Publication…')
      const yearNum = parseInt(year, 10)

      // If a live event is within 5km, opt-in to tag this spot to it.
      // Best-effort lookup; failures fall through silently.
      let liveEventId: string | null = null
      try {
        const { data: live } = await supabase
          .rpc('nearby_live_event', {
            p_lat: pos.coords.latitude,
            p_lng: pos.coords.longitude,
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
          brand: brand.trim(),
          model: model.trim(),
          year: Number.isFinite(yearNum) ? yearNum : null,
          color: color.trim(),
          category,
          description: description.trim() || null,
          photo_url: pub.publicUrl,
          confidence: result.confidence,
          estimated_price: result.estimated_price ?? null,
          rarity: result.rarity ?? 'commun',
          production: result.production ?? null,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          event_id: liveEventId,
        })
        .select('id')
        .single()
      if (insErr) throw supaError('Publication', insErr)
      const newSpotId = (inserted as { id: string } | null)?.id ?? null

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
          title: '🚗 Nouveau spot',
          body: `${who} vient de spotter une ${brandTrim} ${modelTrim} près de toi`,
          url: '/map',
          type: 'nearby',
          nearby: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            radiusKm: 10,
            excludeUserId: user.id,
          },
        })
        const slug = brandSlugFor(brandTrim)
        const brandEntry = slug ? getBrand(slug) : undefined
        if (slug && brandEntry) {
          void notifyPush({
            title: `🔔 Nouvelle ${brandEntry.name} spottée`,
            body: `${who} vient de spotter une ${brandEntry.name} ${modelTrim} près de toi`,
            url: `/brand/${slug}`,
            // Gate on the existing "nearby" pref — brand follows are
            // proximity-based notifications by design.
            type: 'nearby',
            brand_nearby: {
              brand: slug,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
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
          // CarImages PNG resolution runs async on the server. The
          // garage falls back to a silhouette until the URL lands.
          const { triggerGarageImage } = await import('../lib/garage')
          void triggerGarageImage(newSpotId)
        }
      })()

      // Fire the "+N XP" floater so the user sees their reward land.
      // Same formula as the SQL trigger : basePrice × rarityMultiplier.
      const { floatXp } = await import('../components/XpFloater')
      const { xpForSpot } = await import('../lib/spots')
      floatXp(
        xpForSpot(
          result.estimated_price,
          (result.rarity ?? 'commun') as 'commun' | 'rare' | 'ultra_rare' | 'unique',
        ),
      )
      navigate('/map', { state: { toast: 'Spot publié ! 🔥' } })
    } catch (err) {
      console.error('[spot] publish aborted:', err)
      const msg =
        (err as { code?: number })?.code === 1
          ? 'Position GPS refusée. Active la localisation pour publier.'
          : err instanceof Error
            ? err.message
            : 'Échec de la publication'
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
        Chargement…
      </div>
    )
  }

  if (profileOk === false) {
    return (
      <div className="min-h-screen bg-bg px-6 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
        <div className="flex items-center gap-4 py-4">
          <button
            onClick={() => navigate('/')}
            aria-label="Retour"
            className="tappable text-fg2 hover:text-fg"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
        </div>
        <div className="mx-auto mt-6 max-w-sm space-y-5">
          <div>
            <h1 className="display-xl text-fg">
              Crée ton pseudo avant de spotter
            </h1>
            <p className="mt-2 text-sm text-fg2">
              Ton pseudo apparaît sur tes spots dans le feed. Pas de spots
              anonymes sur REVS.
            </p>
          </div>
          <div className="space-y-2">
            <label className="label-up text-[10px] text-fg2">Pseudo</label>
            <input
              value={gpPseudo}
              maxLength={24}
              onChange={(e) => setGpPseudo(e.target.value)}
              placeholder="ex : speedhunter_74"
              className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none placeholder:text-fg2/40 focus:border-accent"
              style={{ border: '1px solid var(--color-border)' }}
            />
          </div>
          <div className="space-y-2">
            <label className="label-up text-[10px] text-fg2">Ville</label>
            <input
              value={gpVille}
              maxLength={48}
              onChange={(e) => setGpVille(e.target.value)}
              placeholder="ex : Annecy"
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
            {gpSaving ? '…' : 'SAUVEGARDER ET SPOTTER'}
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
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors ${
                n <= step ? 'bg-accent' : 'bg-white/10'
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
          <h1 className="display-xl text-fg">Nouveau spot</h1>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="hidden"
          />

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
                alt="Aperçu"
                className="w-full max-h-[55vh] object-cover rounded-3xl"
                style={{ border: '1px solid var(--color-border)' }}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="tappable flex-1 rounded-full py-3 text-sm font-bold tracking-wide text-fg2 hover:text-fg"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  Reprendre
                </button>
                <button
                  onClick={analyze}
                  disabled={!image}
                  className="tappable flex-[2] rounded-full bg-accent py-3 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
                  style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
                >
                  ANALYSER
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
                PRENDRE UNE PHOTO
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
                  Analyse REVS IA en cours
                </h3>
                <p
                  className="mt-1.5 leading-snug text-white/55"
                  style={{ fontSize: '12px' }}
                >
                  Identification des courbes, de la rareté et des
                  caractéristiques techniques…
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ÉTAPE 3 — CONFIRMATION */}
      {step === 3 && (
        <div className="space-y-6 pb-8">
          {result.brand === 'Voiture' && result.model === 'Modèle indéterminé' ? (
            <div
              className="rounded-3xl bg-card px-4 py-3 text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              Identification difficile — complète ou corrige les champs ci-dessous.
            </div>
          ) : (
            // 3D corner-flip reveal: the perspective parent gives
            // the inner card a real depth feel as it scales from
            // 30% / rotateY 180° to 100% / 0° via the
            // card-pop-3d keyframe. The white flash overlay below
            // is a sibling that fires once on mount via its own
            // keyframe.
            <>
              <div className="perspective-1000">
                <div
                  className="card-pop-3d rounded-3xl px-4 py-3 text-sm font-extrabold tracking-tight text-fg"
                  style={{
                    background: 'rgba(232,32,58,0.10)',
                    border: '1px solid rgba(232,32,58,0.40)',
                    boxShadow: '0 0 16px rgba(232,32,58,0.18)',
                  }}
                >
                  ✨ {result.brand} {result.model} — {result.confidence}%
                </div>
              </div>
              {/* Brief full-screen white flash, anchored to the
                  same conditional render as the success card so it
                  only fires on a real identification. Pointer-events
                  none + auto-fade keeps it from blocking taps. */}
              <span aria-hidden className="card-reveal-flash" />
            </>
          )}

          {result.alternatives.length > 0 && (
            <div className="space-y-2">
              <p className="label-up text-[10px] text-fg2">Alternatives</p>
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
            <Field label="Marque" value={brand} onChange={setBrand} />
            <Field label="Modèle" value={model} onChange={setModel} />
            <Field
              label="Année"
              value={year}
              onChange={setYear}
              inputMode="numeric"
            />
            <Field label="Couleur" value={color} onChange={setColor} />

            <div className="space-y-2">
              <label className="label-up text-[10px] text-fg2">Catégorie</label>
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
              <label className="label-up text-[10px] text-fg2">
                Description (optionnel)
              </label>
              <textarea
                value={description}
                maxLength={140}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
                style={{ border: '1px solid var(--color-border)' }}
              />
              <p className="text-right text-[11px] text-fg2/70">
                {description.length}/140
              </p>
            </div>
          </div>

          <button
            onClick={() => setStep(4)}
            disabled={!brand.trim() || !model.trim()}
            className="tappable w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            CONTINUER
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
            Votre position GPS sera enregistrée.
          </p>
          {limitReached ? (
            <div className="w-full max-w-xs space-y-3">
              <p className="text-sm text-fg/85">{pubError}</p>
              <button
                onClick={() => navigate('/premium')}
                className="tappable w-full rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
                style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
              >
                VOIR LES ABONNEMENTS
              </button>
              <button
                onClick={() => navigate('/')}
                className="tappable w-full rounded-full bg-card px-6 py-3 text-sm font-bold tracking-wide text-fg2"
                style={{ border: '1px solid var(--color-border)' }}
              >
                Plus tard
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
                RÉESSAYER
              </button>
            </div>
          ) : (
            <div className="w-56 space-y-3 text-sm text-fg2">
              <p className="label-up text-[11px]">
                {pubStatus || 'Publication…'}
              </p>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          )}
        </div>
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
