import { useTranslation } from 'react-i18next'
import LegalLayout from '../components/LegalLayout'

export default function LegalMentions() {
  const { t } = useTranslation()
  return (
    <LegalLayout title={t('legal.mentions.title')} updated="19 mai 2026">
      <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
        {t('legal.mentions.disclaimer')}
      </p>

      <section className="space-y-1">
        <h2>{t('legal.mentions.publisher.heading')}</h2>
        <p>
          <strong>REVS</strong> — {t('legal.mentions.publisher.editedBy')}{' '}
          <strong>Florian Burnier</strong>,{' '}
          {t('legal.mentions.publisher.status')}
          <br />
          Annecy, France.
          <br />
          {t('legal.mentions.publisher.contact')}{' '}
          <strong>[email à renseigner]</strong>
        </p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.mentions.director.heading')}</h2>
        <p>Florian Burnier.</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.mentions.hosting.heading')}</h2>
        <p>
          {t('legal.mentions.hosting.app')}{' '}
          <strong>Vercel Inc.</strong>, 340 S Lemon Ave #4133, Walnut, CA
          91789, {t('legal.mentions.hosting.usa')} —{' '}
          <span className="break-all">vercel.com</span>.
          <br />
          {t('legal.mentions.hosting.db')}
        </p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.mentions.ip.heading')}</h2>
        <p>{t('legal.mentions.ip.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.mentions.report.heading')}</h2>
        <p>{t('legal.mentions.report.body')}</p>
      </section>
    </LegalLayout>
  )
}
