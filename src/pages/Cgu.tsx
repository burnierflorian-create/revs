import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Cgu() {
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
        <h1 className="text-2xl font-bold">Conditions d'utilisation</h1>
      </div>

      <div className="space-y-5 pb-12 text-sm leading-relaxed text-fg/70">
        <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
          Modèle à faire valider par un conseil juridique avant mise en
          production — ce texte est un point de départ, pas un avis légal.
        </p>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Objet</h2>
          <p>
            REVS est une application de spotting automobile. En l'utilisant,
            tu acceptes les présentes conditions.
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">
            Contenus publiés
          </h2>
          <p>
            Tu es responsable des photos et informations que tu publies. Ne
            publie pas de contenu illégal, diffamatoire ou portant atteinte
            à la vie privée d'autrui (plaques, personnes identifiables sans
            consentement).
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Comportement</h2>
          <p>
            Spotte en sécurité et dans le respect du code de la route. REVS
            ne saurait être tenu responsable d'un usage dangereux de
            l'application.
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">
            Compte et résiliation
          </h2>
          <p>
            Tu peux supprimer ton compte et toutes tes données à tout moment
            depuis Paramètres → Danger zone. Nous pouvons suspendre un compte
            en cas d'abus.
          </p>
        </section>
      </div>
    </div>
  )
}
