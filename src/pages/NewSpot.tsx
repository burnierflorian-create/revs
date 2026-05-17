import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  CATEGORIES,
  distanceMeters,
  readPhotoMeta,
  resizeImageToJpeg,
  type IdentifyResult,
  type PhotoMeta,
  type SpotCategory,
} from '../lib/spots'
import { takePendingPhoto } from '../lib/pendingPhoto'
import { Skeleton } from '../components/Skeleton'

type Step = 1 | 2 | 3 | 4

const MAX_PHOTO_AGE_MS = 10 * 60 * 1000
const MAX_GPS_DRIFT_M = 300

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
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
    })
  })
}

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
  const [pubStatus, setPubStatus] = useState('')

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

  function applyResult(r: IdentifyResult) {
    setResult(r)
    setBrand(r.brand)
    setModel(r.model)
    setYear(r.year != null ? String(r.year) : '')
    setColor(r.color)
    setCategory(r.category)
  }

  async function analyze() {
    if (!image) return
    setStep(2)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch('/api/identify-car', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: image.base64,
          mimeType: 'image/jpeg',
        }),
        signal: ctrl.signal,
      })
      const data = { ...EMPTY_RESULT, ...((await res.json()) as IdentifyResult) }
      clearTimeout(timer)
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

  async function publish() {
    if (!image) return
    setPubError(null)
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

      setPubStatus('Envoi de la photo…')
      const path = `${user.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('spots')
        .upload(path, image.blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('spots').getPublicUrl(path)

      setPubStatus('Publication…')
      const yearNum = parseInt(year, 10)
      const { error: insErr } = await supabase.from('spots').insert({
        user_id: user.id,
        brand: brand.trim(),
        model: model.trim(),
        year: Number.isFinite(yearNum) ? yearNum : null,
        color: color.trim(),
        category,
        description: description.trim() || null,
        photo_url: pub.publicUrl,
        confidence: result.confidence,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      })
      if (insErr) throw insErr

      navigate('/map', { state: { toast: 'Spot publié ! 🔥' } })
    } catch (err) {
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

  return (
    <div className="min-h-screen animate-slide-up bg-bg text-fg px-6 pt-[max(1rem,env(safe-area-inset-top))]">
      {/* Header : retour + progression */}
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={back}
          aria-label="Retour"
          className="text-fg/60 hover:text-fg transition-colors"
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
            />
          ))}
        </div>
      </div>

      {/* ÉTAPE 1 — PHOTO */}
      {step === 1 && (
        <div className="space-y-6 pb-8">
          <h1 className="text-2xl font-semibold">Nouveau spot</h1>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="hidden"
          />

          {rejection && (
            <div className="rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
              {rejection}
            </div>
          )}

          {previewUrl ? (
            <div className="space-y-5">
              <img
                src={previewUrl}
                alt="Aperçu"
                className="w-full max-h-[55vh] object-cover rounded-2xl"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="flex-1 rounded-full border border-white/15 py-3 text-sm text-fg/70 hover:text-fg transition-colors"
                >
                  Reprendre
                </button>
                <button
                  onClick={analyze}
                  disabled={!image}
                  className="flex-[2] rounded-full bg-accent py-3 text-sm font-medium disabled:opacity-50"
                >
                  Analyser
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                onClick={() => cameraRef.current?.click()}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-accent py-6 font-medium"
              >
                <Camera className="h-6 w-6" />
                Prendre une photo
              </button>
              {pubError && (
                <p className="text-sm text-accent">{pubError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ÉTAPE 2 — ANALYSE IA */}
      {step === 2 && (
        <div className="space-y-6 pb-8">
          <p className="text-sm text-fg/60">Identification de la voiture…</p>
          <Skeleton className="h-12 w-full rounded-2xl" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            ))}
          </div>
          <Skeleton className="h-14 w-full rounded-full" />
        </div>
      )}

      {/* ÉTAPE 3 — CONFIRMATION */}
      {step === 3 && (
        <div className="space-y-6 pb-8">
          {result.confidence > 0 && result.brand ? (
            <div className="rounded-2xl bg-accent/10 border border-accent/30 px-4 py-3 text-sm">
              ✨ {result.brand} {result.model} — {result.confidence}%
            </div>
          ) : (
            <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-fg/60">
              Voiture non identifiée — remplis les champs à la main.
            </div>
          )}

          {result.alternatives.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-fg/40">
                Alternatives
              </p>
              <div className="flex flex-wrap gap-2">
                {result.alternatives.slice(0, 2).map((alt, i) => (
                  <button
                    key={i}
                    onClick={() => pickAlternative(alt)}
                    className="rounded-full border border-white/15 px-4 py-2 text-xs text-fg/80 hover:text-fg transition-colors"
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
              <label className="text-[11px] uppercase tracking-widest text-fg/40">
                Catégorie
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SpotCategory)}
                className="w-full appearance-none rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-bg">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-widest text-fg/40">
                Description (optionnel)
              </label>
              <textarea
                value={description}
                maxLength={140}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="text-right text-[11px] text-fg/30">
                {description.length}/140
              </p>
            </div>
          </div>

          <button
            onClick={() => setStep(4)}
            disabled={!brand.trim() || !model.trim()}
            className="w-full rounded-full bg-accent py-4 font-medium disabled:opacity-50"
          >
            Continuer
          </button>
        </div>
      )}

      {/* ÉTAPE 4 — PUBLICATION */}
      {step === 4 && (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
          <MapPin className="h-10 w-10 text-accent" />
          <p className="text-sm text-fg/70">
            📍 Votre position GPS sera enregistrée.
          </p>
          {pubError ? (
            <div className="space-y-4">
              <p className="text-sm text-accent">{pubError}</p>
              <button
                onClick={() => publish()}
                className="rounded-full bg-accent px-6 py-3 text-sm font-medium"
              >
                Réessayer
              </button>
            </div>
          ) : (
            <div className="w-56 space-y-3 text-sm text-fg/60">
              <p>{pubStatus || 'Publication…'}</p>
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
      <label className="text-[11px] uppercase tracking-widest text-fg/40">
        {label}
      </label>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}
