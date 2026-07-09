import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { EVENT_TYPES, type EventType } from '../lib/events'
import { translateError } from '../lib/errors'

export default function NewEvent() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [title, setTitle] = useState('')
  const [type, setType] = useState<EventType>('Cars & Coffee')
  const [datetime, setDatetime] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [isLive, setIsLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (active) setAllowed(false)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      const role = (data?.role as string | undefined) ?? 'user'
      setAllowed(role === 'organizer' || role === 'admin')
    })()
    return () => {
      active = false
    }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Non authentifié')

      // Best-effort: attach the organizer's position so the event can
      // surface in "Près de moi". Never blocks creation if denied.
      const coords = await new Promise<{ lat: number; lng: number } | null>(
        (resolve) => {
          if (!navigator.geolocation) return resolve(null)
          navigator.geolocation.getCurrentPosition(
            (p) =>
              resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
          )
        },
      )

      const { error: insErr } = await supabase.from('events').insert({
        organizer_id: user.id,
        title: title.trim(),
        type,
        starts_at: new Date(datetime).toISOString(),
        location: location.trim(),
        description: description.trim() || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        is_live: isLive,
      })
      if (insErr) {
        const o = insErr as {
          message?: string
          code?: string
          details?: string
          hint?: string
        }
        console.error('[event] insert failed:', o)
        throw new Error(
          `Publication : ${[o.message, o.details, o.hint]
            .filter(Boolean)
            .join(' — ')}${o.code ? ` [${o.code}]` : ''}`,
        )
      }

      navigate('/events')
    } catch (err) {
      console.error('[event] aborted:', err)
      setError(translateError(err))
      setBusy(false)
    }
  }

  if (allowed === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg px-8 text-center text-fg">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: 'rgba(232,32,58,0.12)',
            border: '1px solid rgba(232,32,58,0.40)',
            boxShadow: '0 0 24px rgba(232,32,58,0.25)',
          }}
        >
          <Lock className="h-6 w-6 text-accent" />
        </div>
        <p className="font-display text-xl font-extrabold tracking-tighter text-fg">
          {t('miscpages.newEvent.gatedTitle')}
        </p>
        <p className="-mt-3 max-w-sm text-sm leading-relaxed text-fg2">
          {t('miscpages.newEvent.gatedBody')}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/events')}
            className="tappable rounded-full bg-card px-6 py-3 text-sm font-bold tracking-wide text-fg2"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {t('miscpages.newEvent.back')}
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="tappable rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            {t('miscpages.newEvent.becomeOrganizer')}
          </button>
        </div>
      </div>
    )
  }

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-fg2">
        {t('miscpages.newEvent.loading')}
      </div>
    )
  }

  const inputCls =
    'w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent'
  const inputStyle = { border: '1px solid var(--color-border)' }

  return (
    <div className="min-h-screen bg-bg px-6 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate('/events')}
          aria-label={t('miscpages.newEvent.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">{t('miscpages.newEvent.title')}</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 pb-10">
        <Labelled label={t('miscpages.newEvent.fieldTitle')}>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </Labelled>

        <Labelled label={t('miscpages.newEvent.fieldType')}>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            className={`${inputCls} appearance-none`}
            style={inputStyle}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t} className="bg-bg">
                {t}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled label={t('miscpages.newEvent.fieldDatetime')}>
          <input
            required
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </Labelled>

        <Labelled label={t('miscpages.newEvent.fieldLocation')}>
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </Labelled>

        <Labelled label={t('miscpages.newEvent.fieldDescription')}>
          <textarea
            value={description}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputCls} resize-none`}
            style={inputStyle}
          />
        </Labelled>

        <div
          className="flex items-center justify-between rounded-3xl bg-card p-4"
          style={{
            border: isLive
              ? '1px solid rgba(232,32,58,0.40)'
              : '1px solid var(--color-border)',
            boxShadow: isLive ? '0 0 24px rgba(232,32,58,0.16)' : undefined,
          }}
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-base font-extrabold tracking-tighter text-fg">
              <span className="relative flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full ${
                    isLive ? 'animate-ping bg-accent opacity-75' : 'bg-fg2/30'
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    isLive ? 'bg-accent' : 'bg-fg2/40'
                  }`}
                />
              </span>
              {t('miscpages.newEvent.liveMode')}
            </p>
            <p className="mt-1 text-xs text-fg2">
              {t('miscpages.newEvent.liveModeHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsLive((v) => !v)}
            className={`relative h-7 w-12 flex-none rounded-full transition-colors ${
              isLive ? 'bg-accent' : 'bg-fg/15'
            }`}
            aria-pressed={isLive}
            style={
              isLive
                ? { boxShadow: '0 0 12px rgba(232,32,58,0.45)' }
                : undefined
            }
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-transform ${
                isLive ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {error && <p className="text-sm text-accent">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="tappable w-full rounded-full bg-accent py-4 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          {busy ? '…' : t('miscpages.newEvent.submit')}
        </button>
      </form>
    </div>
  )
}

function Labelled({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <label className="label-up text-[10px] text-fg2">{label}</label>
      {children}
    </div>
  )
}
