import { APP_VERSION } from '../config/appConfig'

// Étiquette de version flottante, montée une seule fois dans MainLayout pour
// apparaître sur toutes les pages.
//
// ── Choix d'emplacement ──
// L'application n'a AUCUN en-tête global — pas de barre de titre, et
// components/Logo.tsx n'est importé nulle part. La seule chrome permanente est
// la pill de navigation flottante en bas. Le badge se place donc au même
// niveau vertical qu'elle, dans le coin bas-gauche : la pill fait 280 px
// centrés, donc ce coin est libre.
//
// Vérifié avant de choisir : le haut de l'écran est occupé par la barre de
// recherche de la Carte et les superpositions du Fil ; le logo et l'attribution
// Mapbox sont désactivés (attributionControl: false), donc le bas-gauche ne
// recouvre rien ; et les notifications transitoires (XpFloater, InstallBanner,
// UpdateNotification) vivent plus haut, entre bottom-20 et bottom-28.
//
// z-index 39, juste sous la pill (40), et pointer-events: none — le badge ne
// doit jamais intercepter un geste. Rien n'est masqué derrière : c'est
// purement informatif.
export default function BetaBadge() {
  return (
    <span
      aria-label={`Version ${APP_VERSION}`}
      className="pointer-events-none fixed left-3 z-[39] select-none rounded-full border border-fg/10 bg-card/70 px-2 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-fg/45 backdrop-blur-md"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
    >
      {APP_VERSION}
    </span>
  )
}
