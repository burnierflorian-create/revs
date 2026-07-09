import { useTranslation } from 'react-i18next'
import LegalLayout from '../components/LegalLayout'

export default function LegalPrivacy() {
  const { t } = useTranslation()
  return (
    <LegalLayout
      title={t('legal.privacy.title')}
      updated="19 mai 2026"
    >
      <p className="rounded-xl bg-card p-3 text-xs text-fg/40">
        {t('legal.privacy.disclaimer')}
      </p>

      <section className="space-y-1">
        <h2>{t('legal.privacy.controller.heading')}</h2>
        <p>{t('legal.privacy.controller.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.data.heading')}</h2>
        <p>{t('legal.privacy.data.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.purposes.heading')}</h2>
        <p>{t('legal.privacy.purposes.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.retention.heading')}</h2>
        <p>{t('legal.privacy.retention.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.recipients.heading')}</h2>
        <p>{t('legal.privacy.recipients.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.transfers.heading')}</h2>
        <p>{t('legal.privacy.transfers.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.cookies.heading')}</h2>
        <p>{t('legal.privacy.cookies.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.privacy.rights.heading')}</h2>
        <p>{t('legal.privacy.rights.body')}</p>
      </section>
    </LegalLayout>
  )
}
