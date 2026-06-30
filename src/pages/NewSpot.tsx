import { useEffect, useMemo, useRef, useState } from 'react'
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
import { takePendingPhoto } from '../lib/pendingPhoto'
import { useTheme } from '../lib/theme'
import { emitNewSpot } from '../lib/feedSync'
import { getCurrentPositionSafe } from '../lib/geo'
import { hapticError, hapticHeartbeat, hapticSuccess } from '../lib/haptic'
import { maybePromptPush, myPseudo, notifyPush } from '../lib/push'
import { brandSlugFor, getBrand } from '../lib/brands'
import { Skeleton } from '../components/Skeleton'
import CollectorCard from '../components/CollectorCard'
import type { Spot } from '../lib/spots'

type Step = 1 | 2 | 3 | 4

// Spec 2026-06-02 — anti-cheat tightened from 10 min to 5 min so
// the photo + GPS pair stays plausibly "fresh from the street".
const MAX_PHOTO_AGE_MS = 5 * 60 * 1000
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
    `${i18n.t('newspot.supaError', {
      label,
      detail: detail || i18n.t('newspot.errorUnknown'),
    })}${code ? ` [${code}]` : ''}`,
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
    setPreviewUrl(URL.createObjectURL(file))
    setImage(null)
    setAiBase64(null)
    // EXIF must be read from the original file: resizing re-encodes via
    // canvas and strips all metadata.
    setPhotoMeta(await readPhotoMeta(file))
    try {
      const resized = await resizeImageToJpeg(file)
      setImage(resized)
      // AI-only downscale (1200px / q0.7). Larger than the display path on
      // purpose: more pixels = sharper badges/logos for the vision model.
      // Best-effort: if it fails we fall back to image.base64 in analyze(),
      // so capture is never blocked.
      try {
        const ai = await resizeImageToJpeg(file, 1200, 0.7)
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
  }

  async function analyze() {
    if (!image) return
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
        // rejectAndRestart() owns the error buzz — call it once.
        cancelHeartbeat()
        rejectAndRestart(data.reason || t('newspot.rejectNotRealCar'))
        return
      }
      applyResult(data)
      cancelHeartbeat()
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
          setPubError(t('newspot.limitReached'))
          setPubStatus('')
          return
        }
      }

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
          rarity: result.rarity ?? 'standard',
          production: result.production ?? null,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          event_id: liveEventId,
        })
        .select('*')
        .single()
      if (insErr) throw supaError(t('newspot.publishLabel'), insErr)
      const insertedSpot = (inserted as Spot | null) ?? null
      const newSpotId = insertedSpot?.id ?? null
      // Instant feed re-render — hand the full row to the (kept-alive)
      // Feed so the user's photo is already at the top of the Fil the
      // moment they switch tabs, no manual refresh.
      if (insertedSpot) emitNewSpot(insertedSpot)

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
                <button
                  onClick={analyze}
                  disabled={!image}
                  className="tappable flex-[2] rounded-full bg-accent py-3 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
                  style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
                >
                  {t('newspot.analyze')}
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

      {/* ÉTAPE 3 — CONFIRMATION */}
      {step === 3 && (
        <div className="space-y-6 pb-8">
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
              <p
                className="text-center font-medium uppercase text-fg2"
                style={{ fontSize: '10px', letterSpacing: '0.18em' }}
              >
                {t('newspot.confidenceLine', { confidence: result.confidence })}
              </p>
              {/* Low-confidence warning — a far / obscured shot makes the
                  model guess unreliable. Surfaced under the card so the
                  user double-checks the brand/model before publishing. */}
              {result.confidence < 50 && <LowConfidenceBadge />}
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
            <Field label={t('newspot.fieldBrand')} value={brand} onChange={setBrand} />
            <Field label={t('newspot.fieldModel')} value={model} onChange={setModel} />
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

          <button
            onClick={() => setStep(4)}
            disabled={!brand.trim() || !model.trim()}
            className="tappable w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            {t('newspot.continue')}
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
