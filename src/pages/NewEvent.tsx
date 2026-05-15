import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
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
