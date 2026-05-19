import LegalLayout from '../components/LegalLayout'

export default function LegalTerms() {
  return (
    <LegalLayout
      title="Conditions générales d'utilisation"
      updated="19 mai 2026"
    >
      <section className="space-y-1">
        <h2>1. Objet</h2>
        <p>
          REVS est une application communautaire de spotting automobile
          permettant de photographier, géolocaliser et partager des voitures
          repérées, de suivre l'actualité auto/F1 et de participer à des
          événements. L'utilisation de l'application implique l'acceptation
          pleine et entière des présentes conditions.
        </p>
      </section>

      <section className="space-y-1">
        <h2>2. Conditions d'accès</h2>
        <p>
          L'application est réservée aux personnes âgées d'au moins{' '}
          <strong>13 ans</strong>. Tu es responsable de la confidentialité
          de tes identifiants et de toute activité depuis ton compte.
        </p>
      </section>

      <section className="space-y-1">
        <h2>3. Règles de la communauté</h2>
        <p>
          Sont interdits : tout contenu illicite, diffamatoire, haineux ou
          portant atteinte à la vie privée d'autrui (personnes
          identifiables, plaques, propriété privée) ; le spam et la
          sollicitation ; les fausses photos (photos d'écran, miniatures,
          rendus 3D, images non prises sur le vif). Spotte dans le respect
          du code de la route et de ta sécurité — ne photographie jamais en
          conduisant. Tout manquement peut entraîner la suppression de
          contenus ou du compte.
        </p>
      </section>

      <section className="space-y-1">
        <h2>4. Contenus utilisateurs</h2>
        <p>
          Tu restes propriétaire de tes photos et conserves la
          responsabilité des contenus publiés. Tu concèdes à REVS une
          licence non exclusive d'hébergement et d'affichage de ces contenus
          au sein de l'application.
        </p>
      </section>

      <section className="space-y-1">
        <h2>5. Abonnements et remboursements</h2>
        <p>
          Abonnements mensuels payants via Stripe : Starter 3 €, Premium
          8 €, VIP 25 € par mois. Le renouvellement est automatique chaque
          mois ; tu peux résilier à tout moment, la résiliation prenant
          effet à la fin de la période en cours. Conformément au droit de la
          consommation, tu disposes d'un droit de rétractation de 14 jours ;
          en demandant l'accès immédiat aux fonctionnalités payantes, tu
          acceptes l'exécution immédiate du service et la perte du droit de
          rétractation une fois le service pleinement fourni. Aucun
          remboursement au prorata n'est dû pour une période entamée.
        </p>
      </section>

      <section className="space-y-1">
        <h2>6. Responsabilité</h2>
        <p>
          REVS est fournie « en l'état », sans garantie de disponibilité
          continue. REVS ne saurait être tenue responsable des contenus
          publiés par les utilisateurs, ni d'un usage dangereux ou illégal
          de l'application. La responsabilité de l'éditeur est limitée dans
          les limites autorisées par la loi.
        </p>
      </section>

      <section className="space-y-1">
        <h2>7. Droit applicable et juridiction</h2>
        <p>
          Les présentes conditions sont régies par le{' '}
          <strong>droit français</strong>. À défaut de résolution amiable,
          tout litige relève de la compétence des tribunaux d'
          <strong>Annecy</strong>.
        </p>
      </section>

      <section className="space-y-1">
        <h2>8. Évolution des conditions</h2>
        <p>
          REVS peut modifier les présentes conditions. La version en vigueur
          est celle publiée dans l'application ; l'usage continu vaut
          acceptation des modifications.
        </p>
      </section>
    </LegalLayout>
  )
}
