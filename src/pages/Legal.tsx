import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Legal() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="text-fg/60 transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-2xl font-bold">Mentions légales</h1>
      </div>

      <div className="space-y-5 pb-12 text-sm leading-relaxed text-fg/70">
        <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
          Modèle à compléter avec les informations réelles de l’éditeur
          (raison sociale, SIRET, directeur de publication) avant mise en
          production.
        </p>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Éditeur</h2>
          <p>
            REVS — [Raison sociale], [adresse]. Contact :
            [email de contact].
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Hébergement</h2>
          <p>
            Application hébergée par Vercel ; base de données et stockage
            par Supabase (Union européenne).
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">
            Propriété intellectuelle
          </h2>
          <p>
            Les contenus publiés par les utilisateurs restent leur
            propriété. La marque et le design de REVS sont protégés.
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Contact</h2>
          <p>
            Pour toute question relative aux données personnelles :
            [email DPO / contact].
          </p>
        </section>
      </div>
    </div>
  )
}
