import { useState } from 'react'
import News from './News'
import Events from './Events'

type Sub = 'actu' | 'events'

export default function Discover({ initial = 'actu' }: { initial?: Sub }) {
  const [sub, setSub] = useState<Sub>(initial)

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="px-4 pt-2">
        <div className="mx-auto flex max-w-md gap-1 rounded-full bg-card p-1">
          {(['actu', 'events'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSub(k)}
              className={`flex-1 rounded-full py-2.5 text-sm font-semibold transition-colors ${
                sub === k
                  ? 'bg-accent text-fg'
                  : 'text-fg/50 hover:text-fg'
              }`}
            >
              {k === 'actu' ? 'Actu' : 'Événements'}
            </button>
          ))}
        </div>
      </div>

      <div key={sub} className="discover-fade pt-3">
        {sub === 'actu' ? <News /> : <Events />}
      </div>
    </div>
  )
}
