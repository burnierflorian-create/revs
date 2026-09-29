// En-tête de section du profil : titre, décompte, et « Voir tout » — ce
// dernier UNIQUEMENT quand une destination réelle est passée. La spec est
// explicite : pas de lien vers une page qui n'existe pas.

import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

export default function SectionHead({
  title,
  count,
  onMore,
}: {
  title: string
  /** Sous-titre chiffré, déjà formaté par l'appelant. */
  count?: string
  onMore?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-extrabold tracking-tight text-fg">
          {title}
        </h2>
        {count && (
          <p className="mt-0.5 text-[12px] font-medium text-fg/45">{count}</p>
        )}
      </div>
      {onMore && (
        <button
          onClick={onMore}
          className="tappable inline-flex flex-none items-center gap-0.5 pb-0.5 text-[12.5px] font-semibold text-fg/50"
        >
          {t('home.seeAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
