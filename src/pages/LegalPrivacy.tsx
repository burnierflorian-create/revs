import LegalLayout from '../components/LegalLayout'

export default function LegalPrivacy() {
  return (
    <LegalLayout
      title="Politique de confidentialité"
      updated="19 mai 2026"
    >
      <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
        Modèle RGPD à faire valider par un conseil juridique avant mise en
        production. L'e-mail du DPO/contact est à renseigner.
      </p>

      <section className="space-y-1">
        <h2>Responsable du traitement</h2>
        <p>
          REVS — Florian Burnier, Annecy, France. Contact / DPO :{' '}
          <strong>[email à renseigner]</strong>.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Données collectées</h2>
        <p>
          Adresse e-mail (compte) ; pseudo et ville (profil) ; photos des
          voitures spottées ; géolocalisation associée à chaque spot et
          événement ; données d'activité et de gamification (XP, badges,
          likes, commentaires, abonnements). Les préférences de consentement
          (analytics, marketing) sont stockées sur ton appareil.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Finalités et base légale</h2>
        <p>
          Fournir le service (carte, feed, classement, événements,
          notifications) — exécution du contrat. Mesure d'audience et
          communications marketing — uniquement sur la base de ton
          consentement, révocable à tout moment dans Paramètres →
          Confidentialité &amp; légal.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Durée de conservation</h2>
        <p>
          Données de compte conservées tant que le compte est actif et
          supprimées sur demande ou à la suppression du compte. Les spots
          expirent automatiquement après 1 h s'ils ne reçoivent pas
          d'interaction ; les actualités après 24 h.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Destinataires et sous-traitants</h2>
        <p>
          Supabase (base de données / stockage, Union européenne) ; Vercel
          Inc. (hébergement applicatif, États-Unis) ; Stripe (paiements des
          abonnements) ; Anthropic (analyse d'image pour la reconnaissance
          des voitures). Aucune donnée n'est revendue.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Transferts hors Union européenne</h2>
        <p>
          L'hébergement applicatif (Vercel Inc., USA) implique un transfert
          de données hors UE, encadré par les{' '}
          <strong>clauses contractuelles types</strong> de la Commission
          européenne (Standard Contractual Clauses).
        </p>
      </section>

      <section className="space-y-1">
        <h2>Cookies et stockage local</h2>
        <p>
          Cookies/stockage strictement techniques : session
          d'authentification Supabase, préférences de l'application. Les
          mesures d'audience et communications marketing ne sont activées
          qu'avec ton consentement explicite (Paramètres).
        </p>
      </section>

      <section className="space-y-1">
        <h2>Tes droits</h2>
        <p>
          Conformément au RGPD : droit d'accès, de rectification,
          d'effacement, de portabilité, de limitation et d'opposition. Tu
          peux supprimer ton compte et toutes tes données depuis Paramètres
          → Danger zone, et modifier tes consentements à tout moment. Pour
          exercer tes droits : <strong>[email à renseigner]</strong>. Tu
          peux aussi introduire une réclamation auprès de la CNIL
          (cnil.fr).
        </p>
      </section>
    </LegalLayout>
  )
}
