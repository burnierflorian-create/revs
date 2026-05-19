import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="text-fg/60 transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
      </div>
      <p className="pb-4 text-xs text-fg/30">Dernière mise à jour : {updated}</p>
      <div className="space-y-6 pb-16 text-sm leading-relaxed text-fg/70 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-fg [&_strong]:text-fg/90">
        {children}
      </div>
    </div>
  )
}
