import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Privacy() {
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
        <h1 className="text-2xl font-bold">Politique de confidentialité</h1>
      </div>

      <div className="space-y-5 pb-12 text-sm leading-relaxed text-fg/70">
        <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
          Modèle à faire valider par un conseil juridique avant mise en
          production — ce texte est un point de départ, pas un avis légal.
        </p>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">
            Données collectées
          </h2>
          <p>
            REVS collecte : ton email (compte), ton pseudo et ta ville
            (profil), les photos et la position GPS des spots que tu
            publies, et tes interactions (likes, événements). Les
            préférences de consentement sont stockées sur ton appareil.
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Finalités</h2>
          <p>
            Fournir le service (carte, feed, classement), te permettre de
            publier et retrouver des spots, et — si tu y consens —
            mesurer l’audience et t’envoyer des communications.
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Hébergement</h2>
          <p>
            Les données sont hébergées en Europe (Supabase). Aucune donnée
            n’est revendue.
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold text-fg">Tes droits</h2>
          <p>
            Conformément au RGPD : accès, rectification, suppression et
            portabilité. Tu peux supprimer ton compte et toutes tes
            données depuis Paramètres → Danger zone, et modifier tes
            consentements à tout moment dans Paramètres → Autorisations.
          </p>
        </section>
      </div>
    </div>
  )
}
