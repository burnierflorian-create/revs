import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { EVENT_TYPES, type EventType } from '../lib/events'

export default function NewEvent() {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [type, setType] = useState<EventType>('Cars & Coffee')
  const [datetime, setDatetime] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
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

      const { error: insErr } = await supabase.from('events').insert({
        organizer_id: user.id,
        title: title.trim(),
        type,
        starts_at: new Date(datetime).toISOString(),
        location: location.trim(),
        description: description.trim() || null,
      })
      if (insErr) throw insErr

      navigate('/events')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la publication')
      setBusy(false)
    }
  }

  if (allowed === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg px-8 text-center text-fg">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15">
          <Lock className="h-6 w-6 text-accent" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-fg/70">
          La création d'événements est réservée aux organisateurs officiels.
          Fais une demande via les paramètres.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/events')}
            className="rounded-full bg-card px-6 py-3 text-sm font-medium text-fg"
          >
            Retour
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-fg"
          >
            Devenir organisateur
          </button>
        </div>
      </div>
    )
  }

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-fg/40">
        Chargement…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg px-6 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate('/events')}
          aria-label="Retour"
          className="text-fg/60 transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-2xl font-semibold">Nouvel événement</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 pb-10">
        <Labelled label="Titre">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
          />
        </Labelled>

        <Labelled label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            className="w-full appearance-none rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t} className="bg-bg">
                {t}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled label="Date et heure">
          <input
            required
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className="w-full rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
          />
        </Labelled>

        <Labelled label="Lieu">
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
          />
        </Labelled>

        <Labelled label="Description (optionnel)">
          <textarea
            value={description}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
          />
        </Labelled>

        {error && <p className="text-sm text-accent">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-accent py-4 font-medium disabled:opacity-50"
        >
          {busy ? '…' : "Publier l'événement"}
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
      <label className="text-[11px] uppercase tracking-widest text-fg/40">
        {label}
      </label>
      {children}
    </div>
  )
}
