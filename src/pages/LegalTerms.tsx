import { useTranslation } from 'react-i18next'
import LegalLayout from '../components/LegalLayout'

export default function LegalTerms() {
  const { t } = useTranslation()
  return (
    <LegalLayout
      title={t('legal.terms.title')}
      updated="19 mai 2026"
    >
      <section className="space-y-1">
        <h2>{t('legal.terms.section1.heading')}</h2>
        <p>{t('legal.terms.section1.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section2.heading')}</h2>
        <p>{t('legal.terms.section2.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section3.heading')}</h2>
        <p>{t('legal.terms.section3.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section4.heading')}</h2>
        <p>{t('legal.terms.section4.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section5.heading')}</h2>
        <p>{t('legal.terms.section5.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section6.heading')}</h2>
        <p>{t('legal.terms.section6.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section7.heading')}</h2>
        <p>{t('legal.terms.section7.body')}</p>
      </section>

      <section className="space-y-1">
        <h2>{t('legal.terms.section8.heading')}</h2>
        <p>{t('legal.terms.section8.body')}</p>
      </section>
    </LegalLayout>
  )
}
