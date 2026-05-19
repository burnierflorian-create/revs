import LegalLayout from '../components/LegalLayout'

export default function LegalMentions() {
  return (
    <LegalLayout title="Mentions légales" updated="19 mai 2026">
      <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
        L'adresse e-mail de contact est à renseigner par l'éditeur avant la
        mise en production publique.
      </p>

      <section className="space-y-1">
        <h2>Éditeur du site</h2>
        <p>
          <strong>REVS</strong> — éditée par <strong>Florian Burnier</strong>,
          entrepreneur individuel.
          <br />
          Annecy, France.
          <br />
          Contact : <strong>[email à renseigner]</strong>
        </p>
      </section>

      <section className="space-y-1">
        <h2>Directeur de la publication</h2>
        <p>Florian Burnier.</p>
      </section>

      <section className="space-y-1">
        <h2>Hébergement</h2>
        <p>
          Application hébergée par <strong>Vercel Inc.</strong>, 340 S Lemon
          Ave #4133, Walnut, CA 91789, États-Unis —{' '}
          <span className="break-all">vercel.com</span>.
          <br />
          Base de données et stockage des fichiers : Supabase, hébergement en
          Union européenne.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Propriété intellectuelle</h2>
        <p>
          La marque, le design et le code de REVS sont protégés. Les photos
          et contenus publiés restent la propriété de leurs auteurs, qui
          concèdent à REVS une licence d'affichage dans l'application.
        </p>
      </section>

      <section className="space-y-1">
        <h2>Signalement</h2>
        <p>
          Tout contenu illicite peut être signalé à l'adresse de contact
          ci-dessus pour retrait dans les meilleurs délais.
        </p>
      </section>
    </LegalLayout>
  )
}
