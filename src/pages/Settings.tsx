import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AtSign,
  BadgeCheck,
  Bell,
  BellRing,
  BookOpen,
  CalendarDays,
  Camera,
  Car,
  Check,
  ChevronRight,
  Cookie,
  Crown,
  Eye,
  Flame,
  Globe,
  Heart,
  HelpCircle,
  Info,
  KeyRound,
  LogOut,
  MapPin,
  Megaphone,
  MessageCircle,
  Palette,
  Radar as RadarIcon,
  Radio,
  RotateCcw,
  Scale,
  Search,
  Shield,
  Smartphone,
  SmilePlus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { APP_VERSION, CONTACT_EMAIL } from '../lib/constants'
import { pickPrimaryVehicle } from '../lib/primaryVehicle'
import { canonicalHandle, displayHandle } from '../lib/social'
import type { Spot } from '../lib/spots'
import { fetchUnreadCount, onUnreadChanged } from '../lib/notifications'
import type { OrganizerStatus } from '../lib/organizer'
import { hasTutorialAccess } from '../lib/tutorial'
import { useTheme } from '../lib/theme'
import { hapticSuccess } from '../lib/haptic'
import AvatarCropModal from '../components/AvatarCropModal'
import { uploadAvatar } from '../lib/avatar'
import { enablePush, pushSupported } from '../lib/push'
import { translateError } from '../lib/errors'
import { CAR_MAKES } from '../lib/cars'
import {
  UNIVERSES,
  AMBITIONS,
  MAX_BRANDS,
  MAX_UNIVERSES,
  toggleCapped,
} from '../lib/passions'
import {
  fetchMyRadarPrefs,
  getCurrentPosition,
  saveRadarPrefs,
  type RadarPrefs,
} from '../lib/radar'
import { useTranslation } from 'react-i18next'
import { setLanguage, type Lang } from '../i18n'

// ─────────────────────── Reusable primitives ───────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="label-up px-1 text-[10px] text-fg2">{title}</h2>
      <div
        className="overflow-hidden rounded-3xl bg-card"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {children}
      </div>
    </section>
  )
}

function Row({
  icon,
  label,
  sub,
  onClick,
  right,
  danger,
  warn,
  noChevron,
  wrap,
}: {
  icon?: ReactNode
  label: string
  sub?: string
  onClick?: () => void
  right?: ReactNode
  danger?: boolean
  warn?: boolean
  noChevron?: boolean
  /** When true, the label rolls onto multiple lines via
   *  whitespace-normal instead of being truncated with an ellipsis.
   *  Useful for labels that don't fit the single-row width — opt-in
   *  so existing rows keep the iOS-style single-line truncation. */
  wrap?: boolean
}) {
  const interactive = !!onClick
  const tone = danger ? 'text-accent' : warn ? 'text-[#F59E0B]' : 'text-fg'
  // 2026-06-02 critical fix — when the row has no onClick (toggle-only
  // rows like Notifications, Localisation, Marketing), DON'T wrap it
  // in a <button disabled>. Safari + Chrome both swallow pointer
  // events on children of disabled buttons, which froze every Toggle
  // in the Settings preferences section. Render <div> in that case so
  // the inner Toggle's own onClick fires unimpeded; keep <button> for
  // rows whose entire body should navigate (Compte, Premium, etc.).
  const baseClass = `flex w-full items-center gap-3 border-b border-fg/[0.08] px-4 py-3.5 text-left last:border-0 ${tone} ${
    interactive ? 'tappable transition-colors hover:bg-fg/[0.04]' : ''
  }`
  const body = (
    <>
      {icon && (
        <span
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${
            danger
              ? 'bg-accent/15 text-accent'
              : warn
                ? 'bg-[#F59E0B]/15 text-[#F59E0B]'
                : 'bg-fg/[0.06] text-fg/85'
          }`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[15px] font-medium leading-tight ${
            wrap ? 'whitespace-normal' : 'truncate'
          }`}
        >
          {label}
        </span>
        {sub && (
          <span className={`mt-0.5 block text-xs leading-tight text-fg2 ${
            wrap ? 'whitespace-normal' : 'truncate'
          }`}>
            {sub}
          </span>
        )}
      </span>
      {right ??
        (interactive && !noChevron ? (
          <ChevronRight className="h-4 w-4 flex-none text-fg2" />
        ) : null)}
    </>
  )
  if (!interactive) {
    return <div className={baseClass}>{body}</div>
  }
  return (
    <button onClick={onClick} className={baseClass}>
      {body}
    </button>
  )
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange?: () => void
  disabled?: boolean
}) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange?.()
      }}
      role="switch"
      aria-checked={checked}
      className={`relative inline-block h-6 w-11 flex-none rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-fg/15'
      } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      style={
        checked ? { boxShadow: '0 0 12px rgba(232,32,58,0.35)' } : undefined
      }
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-fg shadow-soft transition-transform ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        }`}
      />
    </span>
  )
}

// ─────────────────────── Page ───────────────────────

export default function Settings() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme } = useTheme()
  const { t, i18n } = useTranslation()

  const [loading, setLoading] = useState(true)
  // Documentation interne — le lien n'apparaît que pour le compte autorisé.
  // Le verdict vient du serveur (/api/tutorial?probe=1) : cacher le lien est
  // un confort d'affichage, la vraie barrière est côté serveur.
  // ⚠️ Réservé au créateur pour la V1 — voir server/tutorial-access.js.
  const [tutorialOk, setTutorialOk] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [pseudo, setPseudo] = useState('')
  const [ville, setVille] = useState('')
  const [dreamCar, setDreamCar] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<Blob | null>(null)
  // Object URL of the just-picked file while the crop modal is open.
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  // Profile extras introduced by migration 0041 — daily-driver brand
  // surfaced as a Settings row, plus optional Instagram / TikTok
  // handles for the public profile card. All three nullable.
  const [garageBrand, setGarageBrand] = useState('')
  /** LA source de vérité du véhicule principal (migration 0094). */
  const [primarySpotId, setPrimarySpotId] = useState<string | null>(null)
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [garageOpen, setGarageOpen] = useState(false)
  const [socialOpen, setSocialOpen] = useState(false)
  const [garageBusy, setGarageBusy] = useState(false)
  const [socialBusy, setSocialBusy] = useState(false)
  const [garageMsg, setGarageMsg] = useState<string | null>(null)
  const [socialMsg, setSocialMsg] = useState<string | null>(null)
  // "Mes passions auto" (0060) — editable copies of the onboarding
  // answers: preferred brands (1–3), universes (1–3), single ambition.
  const [preferredBrands, setPreferredBrands] = useState<string[]>([])
  const [preferredUniverses, setPreferredUniverses] = useState<string[]>([])
  const [ambition, setAmbition] = useState<string | null>(null)
  const [passionsQuery, setPassionsQuery] = useState('')
  const [passionsOpen, setPassionsOpen] = useState(false)
  const [passionsBusy, setPassionsBusy] = useState(false)
  const [passionsMsg, setPassionsMsg] = useState<string | null>(null)
  const [isPublic, setIsPublic] = useState(true)
  const [geo, setGeo] = useState(false)
  const [geoDenied, setGeoDenied] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [role, setRole] = useState<string>('user')
  // Les spots de l'utilisateur, uniquement pour le hero : c'est d'eux que sort
  // la photo du véhicule principal (voir src/lib/primaryVehicle.ts). Aucune
  // nouvelle donnée n'est créée — on lit ce qui existe déjà.
  const [spots, setSpots] = useState<Spot[]>([])
  const [unread, setUnread] = useState(0)
  /** Replie/déplie les réglages fins du push (likes, commentaires…). */
  const [pushPrefsOpen, setPushPrefsOpen] = useState(false)
  /** Le bloc bas : sécurité, appareil, actions sensibles. Fermé par défaut —
   *  la page principale est un centre de configuration, pas un inventaire. */
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [tourMsg, setTourMsg] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // La pastille de la ligne « Notifications ». Le même compteur que la cloche
  // de l'accueil — une seule source (`my_unread_count()`), pas deux comptes
  // qui se contrediraient d'un écran à l'autre.
  useEffect(() => {
    const refresh = () => void fetchUnreadCount().then(setUnread)
    refresh()
    return onUnreadChanged(refresh)
  }, [])

  // Verdict d'accès au tutoriel interne. Une seule requête par chargement de
  // page (le résultat est mémorisé dans src/lib/tutorial.ts). En cas d'échec
  // réseau, la sonde renvoie false : le lien reste simplement masqué.
  useEffect(() => {
    let alive = true
    void hasTutorialAccess().then((ok) => {
      if (alive) setTutorialOk(ok)
    })
    return () => {
      alive = false
    }
  }, [])

  // Global session signout — invalidates every session token for the
  // user across ALL devices via Supabase's scope:'global' option. The
  // App.tsx auth gate observes the session becoming null and redirects
  // to /auth automatically, so we don't need to navigate manually.
  async function signOutAllDevices() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('settingspage.signOutAllConfirm'))
    ) {
      return
    }
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' })
      if (error) throw error
      hapticSuccess()
    } catch (e) {
      setErr(translateError(e))
    }
  }


  /**
   * Enregistre le véhicule principal.
   *
   * L'écriture est IMMÉDIATE et l'état local suit la réponse du serveur, pas
   * l'inverse : c'est ce qui garantit qu'aucune surface n'affiche une valeur
   * que la base n'a pas acceptée. Le déclencheur `check_primary_spot_owner`
   * (0094) refuse un spot qui n'appartient pas à l'appelant.
   */
  async function savePrimarySpot(spotId: string | null) {
    if (!userId || garageBusy) return
    setGarageBusy(true)
    setGarageMsg(null)
    const previous = primarySpotId
    setPrimarySpotId(spotId)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ primary_spot_id: spotId })
        .eq('user_id', userId)
      if (error) throw error
      hapticSuccess()
      setGarageMsg(t('settingspage.vehicleSaved'))
      window.setTimeout(() => setGarageMsg(null), 2000)
    } catch (e) {
      setPrimarySpotId(previous)
      setGarageMsg(translateError(e))
    } finally {
      setGarageBusy(false)
    }
  }

  function togglePassionBrand(id: string) {
    setPreferredBrands((prev) => toggleCapped(prev, id, MAX_BRANDS))
  }
  function togglePassionUniverse(id: string) {
    setPreferredUniverses((prev) => toggleCapped(prev, id, MAX_UNIVERSES))
  }

  async function savePassions() {
    if (!userId || passionsBusy) return
    setPassionsBusy(true)
    setPassionsMsg(null)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          preferred_brands: preferredBrands,
          preferred_universes: preferredUniverses,
          ambition,
        })
        .eq('user_id', userId)
      if (error) throw error
      hapticSuccess()
      setPassionsMsg(t('settingspage.passionsSaved'))
      window.setTimeout(() => setPassionsMsg(null), 2000)
      setPassionsOpen(false)
    } catch (e) {
      setPassionsMsg(translateError(e))
    } finally {
      setPassionsBusy(false)
    }
  }

  async function saveSocial() {
    if (!userId || socialBusy) return
    setSocialBusy(true)
    setSocialMsg(null)
    // Strip leading @ / spaces / URLs — store the raw handle only.
    // Une seule règle de normalisation pour toute l'application
    // (src/lib/social.ts), doublée par le déclencheur SQL de la 0094 : un
    // nettoyage côté navigateur ne couvre que les chemins qu'on a pensés.
    const clean = (v: string) => canonicalHandle(v)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ instagram: clean(instagram), tiktok: clean(tiktok) })
        .eq('user_id', userId)
      if (error) throw error
      hapticSuccess()
      setSocialMsg(t('settingspage.socialSaved'))
      window.setTimeout(() => setSocialMsg(null), 2000)
      setSocialOpen(false)
    } catch (e) {
      setSocialMsg(translateError(e))
    } finally {
      setSocialBusy(false)
    }
  }

  // Native Web Share — opens the iOS / Android share sheet so the
  // user can pick any installed messaging / mail / Whatsapp app and
  // send the install link. Falls back to clipboard + toast when the
  // browser doesn't expose navigator.share (older desktops, embedded
  // webviews). Title / text / url match the spec exactly.
  async function shareApp() {
    const url =
      typeof window !== 'undefined' ? window.location.origin : 'https://revs-ten.vercel.app'
    const payload = {
      title: t('settingspage.shareTitle'),
      text: t('settingspage.shareText'),
      url,
    }
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      try {
        await navigator.share(payload)
        hapticSuccess()
        return
      } catch {
        // User cancelled or share API threw — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      hapticSuccess()
      setMsg(t('settingspage.inviteCopied'))
      window.setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg(t('settingspage.copyLinkManually', { url }))
      window.setTimeout(() => setMsg(null), 4000)
    }
  }

  // E-mail change inline editor.
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)
  const [emailErr, setEmailErr] = useState<string | null>(null)

  // Password change inline editor (current + new + confirm).
  const [pwOpen, setPwOpen] = useState(false)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwErr, setPwErr] = useState<string | null>(null)

  // Premium tier + Mode Radar inline section.
  const [tier, setTier] = useState<'premium' | 'vip' | null>(null)
  const [radarPrefs, setRadarPrefs] = useState<RadarPrefs | null>(null)
  const [radarBusy, setRadarBusy] = useState(false)
  const [radarErr, setRadarErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Statut du dossier organisateur — lu via `my_organizer_request()`, qui
   *  ne remonte que l'état, jamais les notes d'instruction. */
  const [orgStatus, setOrgStatus] = useState<OrganizerStatus | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  // ── LES CATÉGORIES DE NOTIFICATION ──
  // Sécurité, compte et modération n'ont volontairement PAS d'interrupteur :
  // pouvoir les couper reviendrait à pouvoir ignorer une sanction sans jamais
  // l'avoir lue. Tout le reste se règle ici.
  const [npref, setNpref] = useState({
    likes: true,
    comments: true,
    reactions: true,
    followers: true,
    following_spots: true,
    nearby: true,
    events: true,
    revs_news: true,
    streak: true,
  })

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !active) return
      setUserId(user.id)
      setEmail(user.email ?? '')

      const [{ data: prof }, { data: orgReq }, { data: np }, { data: mySpots }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('pseudo, ville, avatar, is_public, role, garage_brand, instagram, tiktok, dream_car, preferred_brands, preferred_universes, ambition, primary_spot_id')
            .eq('user_id', user.id)
            .maybeSingle(),
          // `my_organizer_request()` : une seule ligne, servie par l'index
          // (user_id, created_at desc). La page Paramètres n'a jamais besoin
          // de plus que le statut courant.
          supabase.rpc('my_organizer_request'),
          supabase
            .from('notification_prefs')
            .select(
              'likes, comments, reactions, followers, following_spots, nearby, events, revs_news, streak',
            )
            .eq('user_id', user.id)
            .maybeSingle(),
          // Pour le hero seulement. On ne remonte que les colonnes dont
          // `pickPrimaryVehicle()` a besoin : inutile de tirer toute la ligne.
          supabase
            .from('spots')
            .select('id, user_id, brand, model, rarity, photo_url, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        ])
      if (!active) return
      if (mySpots) setSpots(mySpots as unknown as Spot[])
      if (prof) {
        setPseudo(prof.pseudo ?? '')
        setVille(prof.ville ?? '')
        setDreamCar(
          (prof as { dream_car?: string | null }).dream_car ?? '',
        )
        setAvatarUrl(prof.avatar ?? null)
        setIsPublic(prof.is_public ?? true)
        setRole((prof.role as string | undefined) ?? 'user')
        setGarageBrand((prof as { garage_brand?: string | null }).garage_brand ?? '')
        setPrimarySpotId(
          (prof as { primary_spot_id?: string | null }).primary_spot_id ?? null,
        )
        setInstagram((prof as { instagram?: string | null }).instagram ?? '')
        setTiktok((prof as { tiktok?: string | null }).tiktok ?? '')
        const pp = prof as {
          preferred_brands?: string[] | null
          preferred_universes?: string[] | null
          ambition?: string | null
        }
        setPreferredBrands(
          Array.isArray(pp.preferred_brands) ? pp.preferred_brands : [],
        )
        setPreferredUniverses(
          Array.isArray(pp.preferred_universes) ? pp.preferred_universes : [],
        )
        setAmbition(pp.ambition ?? null)
      }
      if (np)
        setNpref({
          likes: np.likes ?? true,
          comments: np.comments ?? true,
          reactions: np.reactions ?? true,
          followers: np.followers ?? true,
          following_spots: np.following_spots ?? true,
          nearby: np.nearby ?? true,
          events: np.events ?? true,
          revs_news: np.revs_news ?? true,
          streak: np.streak ?? true,
        })
      {
        const row = Array.isArray(orgReq) ? orgReq[0] : orgReq
        const st = (row as { status?: OrganizerStatus } | null)?.status
        if (st) setOrgStatus(st)
      }

      try {
        setGeo(localStorage.getItem('revs_geo') === '1')
        setAnalytics(localStorage.getItem('revs_consent_analytics') === '1')
        setMarketing(localStorage.getItem('revs_consent_marketing') === '1')
      } catch {
        /* ignore */
      }
      const q = navigator.permissions?.query?.bind(navigator.permissions)
      if (q) {
        try {
          const g = await q({ name: 'geolocation' as PermissionName })
          if (active) {
            setGeoDenied(g.state === 'denied')
            if (g.state === 'granted') setGeo(true)
          }
        } catch {
          /* ignore */
        }
      }
      if (!active) return
      setLoading(false)

      // Tier + radar prefs — fetched after first paint so they don't
      // block the rest of the page. Radar section renders only for
      // premium/vip; for free users the whole block is hidden.
      supabase
        .rpc('user_tier', { p_user: user.id })
        .then(({ data }) => {
          if (!active) return
          setTier(((data as 'premium' | 'vip' | null) ?? null))
        })
      fetchMyRadarPrefs().then((p) => {
        if (!active) return
        setRadarPrefs(
          p ?? {
            enabled: false,
            radius_km: 10,
            lat: null,
            lng: null,
            updated_at: '',
          },
        )
      })
    })()
    return () => {
      active = false
    }
  }, [])

  // Pick → open the circular crop modal. The modal renders the chosen
  // region to a 512×512 JPEG blob which becomes the avatar to upload.
  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCropSrc(URL.createObjectURL(file))
  }

  // On "Valider": close the modal, show the crop instantly, then upload the
  // cropped 512² JPEG to Supabase Storage and persist it on the profile
  // (column `avatar`) right away — no separate save step for the photo.
  async function onCropConfirm(blob: Blob) {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
    const localUrl = URL.createObjectURL(blob)
    setAvatarUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return localUrl
    })
    if (!userId) {
      // No session yet — defer to the normal Save flow.
      setAvatarFile(blob)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const url = await uploadAvatar(userId, blob)
      setAvatarUrl(url)
      setAvatarFile(null)
      hapticSuccess()
      setMsg(t('settingspage.profileSaved'))
    } catch (e) {
      // Fall back to the normal Save (keep the blob queued).
      setAvatarFile(blob)
      setErr(translateError(e))
    } finally {
      setSaving(false)
    }
  }

  function onCropCancel() {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  async function saveProfile() {
    if (!userId) return
    setErr(null)
    setMsg(null)
    setSaving(true)
    try {
      let avatar = avatarUrl
      if (avatarFile) avatar = await uploadAvatar(userId, avatarFile)
      // UPDATE et non UPSERT : la ligne existe depuis l'inscription, et un
      // UPSERT ferait lever le garde-fou d'âge sur la ligne proposée
      // (migration 0118). C'est ce qui empêchait TOUT enregistrement de
      // profil — photo, pseudo, ville, voiture de rêve.
      const { error } = await supabase
        .from('profiles')
        .update({
          pseudo: pseudo.trim(),
          ville: ville.trim(),
          dream_car: dreamCar.trim() || null,
          avatar,
        })
        .eq('user_id', userId)
      if (error) {
        console.error('profile save failed:', error)
        setErr(translateError(error))
        return
      }
      setAvatarFile(null)
      setMsg(t('settingspage.profileSaved'))
      setEditOpen(false)
    } catch (e) {
      console.error('profile save crashed:', e)
      setErr(translateError(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleRadar() {
    if (!radarPrefs || radarBusy) return
    setRadarErr(null)
    setRadarBusy(true)
    try {
      const next = !radarPrefs.enabled
      let lat = radarPrefs.lat
      let lng = radarPrefs.lng
      // First activation captures the user's position so the fanout
      // RPC has coordinates to compute distance against.
      if (next && (lat === null || lng === null)) {
        try {
          const pos = await getCurrentPosition()
          lat = pos.lat
          lng = pos.lng
        } catch {
          setRadarErr(t('settingspage.radarEnableGeo'))
          return
        }
      }
      const saved = await saveRadarPrefs({ enabled: next, lat, lng })
      if (saved) setRadarPrefs(saved)
    } finally {
      setRadarBusy(false)
    }
  }

  async function setRadarRadius(r: 5 | 10 | 20) {
    if (!radarPrefs || radarBusy) return
    setRadarBusy(true)
    const saved = await saveRadarPrefs({ radius_km: r })
    if (saved) setRadarPrefs(saved)
    setRadarBusy(false)
  }

  async function refreshRadarPosition() {
    if (radarBusy) return
    setRadarErr(null)
    setRadarBusy(true)
    try {
      const pos = await getCurrentPosition()
      const saved = await saveRadarPrefs({ lat: pos.lat, lng: pos.lng })
      if (saved) setRadarPrefs(saved)
    } catch {
      setRadarErr(t('settingspage.radarPositionError'))
    } finally {
      setRadarBusy(false)
    }
  }

  async function submitEmailChange() {
    setEmailErr(null)
    setEmailMsg(null)
    const target = newEmail.trim().toLowerCase()
    if (!target || !/.+@.+\..+/.test(target)) {
      setEmailErr(t('settingspage.emailInvalid'))
      return
    }
    if (target === email.toLowerCase()) {
      setEmailErr(t('settingspage.emailAlreadyCurrent'))
      return
    }
    setEmailBusy(true)
    const { error } = await supabase.auth.updateUser({ email: target })
    setEmailBusy(false)
    if (error) {
      setEmailErr(translateError(error))
      return
    }
    setEmailMsg(t('settingspage.emailConfirmationSent', { target }))
    setNewEmail('')
  }

  async function submitPasswordChange() {
    setPwErr(null)
    setPwMsg(null)
    if (pwNew.length < 6) {
      setPwErr(t('settingspage.passwordTooShort'))
      return
    }
    if (pwNew !== pwConfirm) {
      setPwErr(t('settingspage.passwordMismatch'))
      return
    }
    // Ensure the session is alive before hitting updateUser — Supabase
    // returns a confusing error otherwise.
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user?.email) {
      setPwErr(t('settingspage.sessionExpired'))
      return
    }
    setPwBusy(true)
    // Step 1 — verify the current password by re-authenticating. Supabase
    // doesn't natively re-prompt for the current password on updateUser;
    // we sign in again (replaces the access token in place) so wrong
    // input fails fast with a clear message.
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: pwCurrent,
    })
    if (signErr) {
      setPwBusy(false)
      const m = signErr.message?.toLowerCase() ?? ''
      if (m.includes('invalid') || m.includes('credential')) {
        setPwErr(t('settingspage.currentPasswordIncorrect'))
      } else {
        setPwErr(translateError(signErr))
      }
      return
    }
    // Step 2 — apply the new password.
    const { error: updErr } = await supabase.auth.updateUser({
      password: pwNew,
    })
    setPwBusy(false)
    if (updErr) {
      setPwErr(translateError(updErr))
      return
    }
    setPwMsg(t('settingspage.passwordChanged'))
    setPwCurrent('')
    setPwNew('')
    setPwConfirm('')
    // Auto-close the editor so the user lands back on a clean settings
    // surface; the success message stays visible for ~2 s in the meantime.
    setTimeout(() => {
      setPwOpen(false)
      setPwMsg(null)
    }, 2000)
  }

  function persist(key: string, on: boolean) {
    try {
      localStorage.setItem(key, on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  function toggleGeo() {
    if (geo) {
      setGeo(false)
      persist('revs_geo', false)
      return
    }
    if (!navigator.geolocation) {
      setErr(t('settingspage.geoNotAvailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setGeo(true)
        setGeoDenied(false)
        persist('revs_geo', true)
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) setGeoDenied(true)
        else setErr(t('settingspage.positionUnavailable'))
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 },
    )
  }

  function toggleAnalytics() {
    const next = !analytics
    setAnalytics(next)
    persist('revs_consent_analytics', next)
  }

  function toggleMarketing() {
    const next = !marketing
    setMarketing(next)
    persist('revs_consent_marketing', next)
  }

  async function togglePrivacy() {
    if (!userId) return
    const next = !isPublic
    setIsPublic(next)
    // UPDATE : un UPSERT ferait lever le garde-fou d'âge sur la ligne
    // proposée, où `age_confirmed` prend sa valeur par défaut (voir 0118).
    const { error } = await supabase
      .from('profiles')
      .update({ is_public: next })
      .eq('user_id', userId)
    if (error) {
      setIsPublic(!next)
      setErr(translateError(error))
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    navigate('/auth', { replace: true })
  }

  async function deleteAccount() {
    setErr(null)
    setSaving(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error(t('settingspage.sessionNotFound'))
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { deleted?: boolean; error?: string }
      if (!res.ok || !data.deleted) {
        throw new Error(data.error || t('settingspage.deleteFailed'))
      }
      await supabase.auth.signOut()
      navigate('/auth', { replace: true })
    } catch (e) {
      setErr(translateError(e))
      setSaving(false)
    }
  }

  async function enableDevicePush() {
    if (!pushSupported()) {
      setPushMsg(t('settingspage.pushNotSupported'))
      return
    }
    setPushBusy(true)
    setPushMsg(t('settingspage.pushActivating'))
    const ok = await enablePush()
    setPushBusy(false)
    setPushMsg(
      ok
        ? t('settingspage.pushEnabled')
        : t('settingspage.pushFailed'),
    )
  }

  async function toggleNpref(key: keyof typeof npref) {
    if (!userId) return
    const next = { ...npref, [key]: !npref[key] }
    setNpref(next)
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId, ...next }, { onConflict: 'user_id' })
    if (error) setNpref(npref)
  }

  /**
   * Rejoue le tutoriel de découverte.
   *
   * ⚠️ NE PAS CONFONDRE avec `/tutorial`, qui est la DOCUMENTATION INTERNE
   * réservée au compte créateur et gardée côté serveur. Le tutoriel
   * UTILISATEUR est le parcours en dix écrans (`TutorialTour`), monté dans
   * MainLayout et déclenché par `profiles.tutorial_completed = false`.
   *
   * On remet donc ce drapeau à false et on renvoie à l'accueil, où le
   * composant se montera de lui-même. Aucun nouveau système : on réutilise
   * exactement le déclencheur existant.
   */
  async function replayTutorial() {
    if (!userId) return
    const { error } = await supabase
      .from('profiles')
      .update({ tutorial_completed: false })
      .eq('user_id', userId)
    if (error) {
      setTourMsg(translateError(error))
      return
    }
    hapticSuccess()
    navigate('/')
  }

  async function resetOnboarding() {
    try {
      localStorage.removeItem('onboarding_completed')
      localStorage.removeItem('revs_onboarded')
      localStorage.removeItem('revs_profile_done')
    } catch {
      /* ignore */
    }
    // Also clear the DB flag, otherwise the profile check re-hides the
    // onboarding even after the local flags are gone.
    try {
      if (userId) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: false })
          .eq('user_id', userId)
      }
    } catch {
      /* ignore — reload anyway */
    }
    window.location.reload()
  }

  const isOrganizer = role === 'organizer' || role === 'admin'

  // ─────────────────────── Inline garage / social editors ───────────────────────

  /**
   * « Mon véhicule » — un CHOIX parmi ses propres spots.
   *
   * ── POURQUOI PLUS UN CHAMP LIBRE ──
   * Avant, c'était une zone de texte alimentant `garage_brand` : on y écrivait
   * « Porsche ». Une marque, pas une voiture — impossible d'y lire « Ferrari
   * 488 Pista », ce que le produit demande. Et surtout, cette valeur n'était
   * lue par AUCUNE autre surface : personne d'autre ne la voyait jamais.
   *
   * Désigner un spot règle les deux : la marque, le modèle, la couleur, la
   * photo protégée et le futur Garage Visual viennent avec, sans rien saisir.
   * `garage_brand` n'est pas effacé pour autant — il reste le repli de ceux
   * qui n'ont pas encore spotté leur propre voiture.
   */
  const VehiclePicker = (
    <div className="px-4 pb-4 pt-2">
      {spots.length === 0 ? (
        <p className="rounded-2xl px-3 py-3 text-[12.5px] leading-snug text-fg2"
           style={{ background: 'var(--color-glass-mid)', border: '1px solid var(--color-border)' }}>
          {t('settingspage.vehicleNoSpots')}
        </p>
      ) : (
        <>
          <p className="mb-2.5 px-1 text-[11.5px] leading-snug text-fg2">
            {t('settingspage.vehiclePickHint')}
          </p>
          <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
            {spots.map((sp) => {
              const on = primarySpotId === sp.id
              const label = [sp.brand, sp.model].filter(Boolean).join(' ')
              return (
                <button
                  key={sp.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void savePrimarySpot(on ? null : sp.id)}
                  disabled={garageBusy}
                  className="tappable relative overflow-hidden rounded-2xl text-left transition-transform active:scale-[0.98] disabled:opacity-60"
                  style={{
                    border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    boxShadow: on ? '0 0 18px rgba(232,32,58,0.18)' : undefined,
                  }}
                >
                  {(sp.garage_render_url || sp.photo_url) && (
                    <img
                      src={sp.garage_render_url || sp.photo_url || ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-20 w-full object-cover"
                    />
                  )}
                  <span className="block px-2.5 py-2">
                    <span className="block truncate text-[12px] font-bold text-fg">
                      {label || t('settingspage.myVehicleCardEmpty')}
                    </span>
                    {sp.color && (
                      <span className="mt-0.5 block truncate text-[10.5px] text-fg2">
                        {sp.color}
                      </span>
                    )}
                  </span>
                  {on && (
                    <span
                      className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full"
                      style={{ background: 'rgb(var(--color-accent))' }}
                    >
                      <Check className="h-3 w-3 text-white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
      {garageMsg && (
        <p className="mt-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-400"
          style={{ border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          {garageMsg}
        </p>
      )}
    </div>
  )

  const SocialEditor = (
    <div className="space-y-3 px-4 pb-4 pt-2">
      <label className="block space-y-1.5">
        <span className="label-up block px-1 text-[10px] text-fg2">
          {t('settingspage.instagram')}
        </span>
        <input
          type="text"
          autoComplete="off"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
          placeholder={t('settingspage.handlePlaceholder')}
          maxLength={60}
          className="w-full rounded-2xl bg-card px-4 py-3 text-sm text-fg placeholder-fg2/60 outline-none focus:ring-2 focus:ring-accent/45"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="label-up block px-1 text-[10px] text-fg2">
          {t('settingspage.tiktok')}
        </span>
        <input
          type="text"
          autoComplete="off"
          value={tiktok}
          onChange={(e) => setTiktok(e.target.value)}
          placeholder={t('settingspage.handlePlaceholder')}
          maxLength={60}
          className="w-full rounded-2xl bg-card px-4 py-3 text-sm text-fg placeholder-fg2/60 outline-none focus:ring-2 focus:ring-accent/45"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={saveSocial}
          disabled={socialBusy}
          className="flex-1 rounded-full bg-accent py-2.5 text-xs font-extrabold tracking-wider text-fg disabled:opacity-50"
        >
          {socialBusy ? '…' : t('settingspage.save')}
        </button>
        <button
          type="button"
          onClick={() => setSocialOpen(false)}
          className="rounded-full bg-card px-4 py-2.5 text-xs font-semibold text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {t('settingspage.cancel')}
        </button>
      </div>
      {socialMsg && (
        <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-400"
          style={{ border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          {socialMsg}
        </p>
      )}
    </div>
  )

  // ─────────────────────── Inline "passions auto" editor ───────────────────────

  const passionBrandQ = passionsQuery.trim().toLowerCase()
  const passionBrandList = passionBrandQ
    ? CAR_MAKES.filter((m) => m.toLowerCase().includes(passionBrandQ))
    : CAR_MAKES
  const passionBrandsFull = preferredBrands.length >= MAX_BRANDS
  const passionUniversesFull = preferredUniverses.length >= MAX_UNIVERSES

  // Small option pill shared by the brand grid + universe grid + ambition
  // list. `key` is required because callers return it straight from .map().
  const passionPill = (
    key: string,
    selected: boolean,
    onClick: () => void,
    label: string,
    dimmed = false,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`tappable rounded-2xl px-3.5 py-3 text-left text-[13px] font-semibold transition-all active:scale-[0.98] ${
        selected
          ? 'bg-accent/15 text-fg'
          : `bg-card text-fg2 ${dimmed ? 'opacity-45' : ''}`
      }`}
      style={{
        border: `1.5px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
      }}
    >
      {label}
    </button>
  )

  const PassionsEditor = (
    <div className="space-y-5 px-4 pb-4 pt-2">
      {/* Marques préférées */}
      <div className="space-y-2">
        <span className="label-up block px-1 text-[10px] text-fg2">
          {t('settingspage.passionsBrands')} · {preferredBrands.length}/{MAX_BRANDS}
        </span>
        {preferredBrands.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {preferredBrands.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => togglePassionBrand(b)}
                className="tappable flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1.5 text-[13px] font-semibold text-fg active:scale-95"
                style={{ border: '1px solid var(--color-accent)' }}
              >
                {b}
                <span className="text-fg2">×</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg2/60" />
          <input
            type="text"
            autoComplete="off"
            value={passionsQuery}
            onChange={(e) => setPassionsQuery(e.target.value)}
            placeholder={t('onboarding.brands.searchPlaceholder')}
            className="w-full rounded-2xl bg-card py-3 pl-10 pr-4 text-sm text-fg placeholder-fg2/60 outline-none focus:ring-2 focus:ring-accent/45"
            style={{ border: '1px solid var(--color-border)' }}
          />
        </div>
        <div className="grid max-h-[34vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
          {passionBrandList.map((b) => {
            const sel = preferredBrands.includes(b)
            return passionPill(
              b,
              sel,
              () => togglePassionBrand(b),
              b,
              !sel && passionBrandsFull,
            )
          })}
          {passionBrandList.length === 0 && (
            <p className="col-span-2 py-4 text-center text-[12px] text-fg2">
              {t('onboarding.brands.empty')}
            </p>
          )}
        </div>
      </div>

      {/* Univers auto */}
      <div className="space-y-2">
        <span className="label-up block px-1 text-[10px] text-fg2">
          {t('settingspage.passionsUniverses')} · {preferredUniverses.length}/{MAX_UNIVERSES}
        </span>
        <div className="grid grid-cols-2 gap-2">
          {UNIVERSES.map((id) => {
            const sel = preferredUniverses.includes(id)
            return passionPill(
              id,
              sel,
              () => togglePassionUniverse(id),
              t(`onboarding.universes.options.${id}`),
              !sel && passionUniversesFull,
            )
          })}
        </div>
      </div>

      {/* Ambition */}
      <div className="space-y-2">
        <span className="label-up block px-1 text-[10px] text-fg2">
          {t('settingspage.passionsAmbition')}
        </span>
        <div className="grid grid-cols-1 gap-2">
          {AMBITIONS.map((id) =>
            passionPill(
              id,
              ambition === id,
              () => setAmbition(id),
              t(`onboarding.ambition.options.${id}`),
            ),
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={savePassions}
          disabled={passionsBusy}
          className="flex-1 rounded-full bg-accent py-2.5 text-xs font-extrabold tracking-wider text-fg disabled:opacity-50"
        >
          {passionsBusy ? '…' : t('settingspage.save')}
        </button>
        <button
          type="button"
          onClick={() => setPassionsOpen(false)}
          className="rounded-full bg-card px-4 py-2.5 text-xs font-semibold text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {t('settingspage.cancel')}
        </button>
      </div>
      {passionsMsg && (
        <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-400"
          style={{ border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          {passionsMsg}
        </p>
      )}
    </div>
  )

  // ─────────────────────── Inline profile editor ───────────────────────

  const ProfileEditor = (
    <div className="space-y-4 border-b border-fg/5 p-4 last:border-0">
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          aria-label={t('settingspage.changePhotoAria')}
          className="relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-2xl font-bold text-fg"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
          ) : (
            (pseudo.charAt(0) || '?').toUpperCase()
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/60 py-0.5">
            <Camera className="h-3.5 w-3.5" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onPickAvatar}
          className="hidden"
        />
        <p className="text-xs text-fg/40">
          {t('settingspage.tapPhotoToChange')}
        </p>
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-widest text-fg/40">
          {t('settingspage.pseudo')}
        </label>
        <input
          value={pseudo}
          maxLength={24}
          onChange={(e) => setPseudo(e.target.value)}
          className="w-full rounded-lg bg-fg/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-widest text-fg/40">
          {t('settingspage.ville')}
        </label>
        <input
          value={ville}
          maxLength={48}
          onChange={(e) => setVille(e.target.value)}
          className="w-full rounded-lg bg-fg/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-widest text-fg/40">
          {t('settingspage.dreamCar')}
        </label>
        <input
          value={dreamCar}
          maxLength={60}
          placeholder={t('settingspage.dreamCarPlaceholder')}
          onChange={(e) => setDreamCar(e.target.value)}
          className="w-full rounded-lg bg-fg/5 px-3 py-3 text-fg placeholder-fg/30 outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <button
        onClick={saveProfile}
        disabled={saving}
        className="w-full rounded-full bg-accent py-3 text-sm font-semibold disabled:opacity-50"
      >
        {saving ? '…' : t('settingspage.saveProfile')}
      </button>
    </div>
  )

  const EmailEditor = (
    <div className="space-y-3 border-b border-fg/5 p-4 last:border-0">
      <div className="space-y-2">
        <label className="label-up text-[10px] text-fg2">{t('settingspage.newEmail')}</label>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={t('settingspage.newEmailPlaceholder')}
          autoComplete="email"
          className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none placeholder:text-fg2/40 focus:border-accent"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-fg2">
        {t('settingspage.emailEditorHint')}
      </p>
      {emailErr && <p className="text-sm text-accent">{emailErr}</p>}
      {emailMsg && (
        <p className="rounded-2xl bg-green-500/10 px-3 py-2 text-sm text-green-300">
          {emailMsg}
        </p>
      )}
      <button
        onClick={submitEmailChange}
        disabled={emailBusy || !newEmail.trim()}
        className="tappable w-full rounded-full bg-accent py-3 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
        style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
      >
        {emailBusy ? '…' : t('settingspage.sendConfirmation')}
      </button>
    </div>
  )

  const PasswordEditor = (
    <div className="space-y-3 border-b border-fg/5 p-4 last:border-0">
      <div className="space-y-2">
        <label className="label-up text-[10px] text-fg2">
          {t('settingspage.currentPassword')}
        </label>
        <input
          type="password"
          value={pwCurrent}
          onChange={(e) => setPwCurrent(e.target.value)}
          autoComplete="current-password"
          className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </div>
      <div className="space-y-2">
        <label className="label-up text-[10px] text-fg2">
          {t('settingspage.newPassword')}
        </label>
        <input
          type="password"
          value={pwNew}
          onChange={(e) => setPwNew(e.target.value)}
          autoComplete="new-password"
          className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </div>
      <div className="space-y-2">
        <label className="label-up text-[10px] text-fg2">
          {t('settingspage.confirmNewPassword')}
        </label>
        <input
          type="password"
          value={pwConfirm}
          onChange={(e) => setPwConfirm(e.target.value)}
          autoComplete="new-password"
          className="w-full rounded-2xl bg-card px-4 py-3.5 text-fg outline-none focus:border-accent"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </div>
      {pwErr && <p className="text-sm text-accent">{pwErr}</p>}
      {pwMsg && (
        <p className="rounded-2xl bg-green-500/10 px-3 py-2 text-sm text-green-300">
          {pwMsg}
        </p>
      )}
      <button
        onClick={submitPasswordChange}
        disabled={
          pwBusy || !pwCurrent || !pwNew || !pwConfirm
        }
        className="tappable w-full rounded-full bg-accent py-3 text-sm font-extrabold tracking-wider text-fg disabled:opacity-50"
        style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
      >
        {pwBusy ? '…' : t('settingspage.updatePassword')}
      </button>
    </div>
  )

  // ─────────────────────── Render ───────────────────────

  // Le véhicule principal — MÊME source que le hero du Profil
  // (src/lib/primaryVehicle.ts). Les deux écrans ne peuvent pas diverger, et
  // le jour où l'utilisateur choisira lui-même sa voiture, il n'y aura qu'un
  // seul endroit à changer. Cette mission n'implémente PAS ce choix.
  const vehicle = pickPrimaryVehicle(spots, garageBrand, primarySpotId)

  return (
    <div className="min-h-screen bg-bg px-4 pb-32 pt-[calc(max(1rem,env(safe-area-inset-top))+15px)] text-fg">
      {/* ── EN-TÊTE ── */}
      <div className="flex items-center gap-3 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('settingspage.back')}
          className="tappable -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">{t('settingspage.pageTitle')}</h1>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-fg2">{t('settingspage.loading')}</p>
      ) : (
        <div className="space-y-7">
          {/* ══════════ HERO PROFIL ══════════
              Photo du véhicule principal en fond, identité par-dessus. Le
              véhicule vient de `pickPrimaryVehicle()` : aucune donnée nouvelle,
              aucun sélecteur — on montre ce qui existe déjà. */}
          <div
            className="relative isolate overflow-hidden rounded-3xl"
            style={{
              border: '1px solid rgba(232,32,58,0.26)',
              boxShadow: '0 14px 40px rgba(0,0,0,0.5), 0 0 34px rgba(232,32,58,0.09)',
            }}
          >
            {vehicle.photo ? (
              /* Flou léger + agrandissement : le texte se pose ici DIRECTEMENT
                 sur la photo, et une photo de voiture peut être claire,
                 contrastée, pleine de reflets. Floutée, elle devient une
                 matière — l'ambiance reste, le pseudo reste lisible quelle que
                 soit la prise. Le `scale` masque les bords ramollis par le
                 flou. */
              <img
                src={vehicle.photo}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  objectPosition: 'center 55%',
                  filter: 'blur(10px) saturate(1.15)',
                  transform: 'scale(1.15)',
                }}
              />
            ) : (
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(120% 90% at 80% 0%, rgba(232,32,58,0.22), transparent 62%)',
                }}
              />
            )}
            {/* Voile : la photo doit rester une ambiance, jamais concurrencer
                le pseudo qui est l'information réelle de ce bloc. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(105deg, rgba(10,10,11,0.93) 0%, rgba(10,10,11,0.84) 52%, rgba(10,10,11,0.58) 100%)',
              }}
            />

            <div className="relative flex items-center gap-4 p-4">
              <span
                className="flex h-16 w-16 flex-none items-center justify-center rounded-full p-[2.5px]"
                style={{
                  background:
                    'conic-gradient(from 220deg, #E8203A 0%, #b91528 28%, #4a0f16 58%, #E8203A 100%)',
                  boxShadow: '0 6px 20px rgba(232,32,58,0.34)',
                }}
              >
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-card font-display text-2xl font-extrabold tracking-tighter text-fg">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    (pseudo.charAt(0) || '?').toUpperCase()
                  )}
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="min-w-0 truncate font-display text-[21px] font-black tracking-tight text-fg">
                    {pseudo || t('settingspage.defaultPseudo')}
                  </p>
                  {(role === 'admin' || tier === 'vip') && (
                    <BadgeCheck
                      className="h-[18px] w-[18px] flex-none"
                      style={{ color: '#E8203A' }}
                      aria-hidden
                    />
                  )}
                </div>
                {ville && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-fg2">
                    <MapPin className="h-3 w-3 flex-none" />
                    {ville}
                  </p>
                )}
                {vehicle.label && (
                  <span
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] font-bold text-fg/85"
                    style={{
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.11)',
                    }}
                  >
                    <Car className="h-3 w-3 flex-none" style={{ color: '#E8203A' }} />
                    <span className="truncate">{vehicle.label}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ══════════ RACCOURCIS ══════════ */}
          <div className="grid grid-cols-2 gap-3">
            <ShortcutCard
              icon={<UserPlus className="h-4 w-4" />}
              title={t('settingspage.myProfileCard')}
              sub={t('settingspage.myProfileCardSub')}
              active={editOpen}
              onClick={() => {
                setGarageOpen(false)
                setEditOpen((v) => !v)
              }}
            />
            <ShortcutCard
              icon={<Car className="h-4 w-4" />}
              title={t('settingspage.myVehicleCard')}
              sub={vehicle.label ?? t('settingspage.myVehicleCardEmpty')}
              active={garageOpen}
              onClick={() => {
                setEditOpen(false)
                setGarageMsg(null)
                setGarageOpen((v) => !v)
              }}
            />
          </div>

          {/* Les éditeurs existants, dépliés sous la carte concernée. Aucun
              nouveau formulaire : ce sont exactement ceux d'avant. */}
          {editOpen && (
            <div
              className="overflow-hidden rounded-3xl bg-card"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {ProfileEditor}
              <Row
                icon={<AtSign className="h-4 w-4" />}
                label={t('settingspage.socialNetworks')}
                sub={
                  instagram || tiktok
                    ? [
                        instagram ? `IG ${displayHandle(instagram)}` : null,
                        tiktok ? `TT @${tiktok}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : t('settingspage.socialNetworksSub')
                }
                onClick={() => {
                  setSocialMsg(null)
                  setSocialOpen((v) => !v)
                }}
              />
              {socialOpen && SocialEditor}
            </div>
          )}
          {garageOpen && (
            <div
              className="overflow-hidden rounded-3xl bg-card"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {VehiclePicker}
            </div>
          )}

          {(msg || err) && (
            <p
              className={`rounded-2xl px-4 py-3 text-sm ${
                err ? 'bg-accent/15 text-accent' : 'bg-card text-fg/85'
              }`}
              style={err ? undefined : { border: '1px solid var(--color-border)' }}
            >
              {err ?? msg}
            </p>
          )}

          {/* ══════════ EXPÉRIENCE ══════════ */}
          <Section title={t('settingspage.sectionExperience')}>
            <Row
              icon={<Bell className="h-4 w-4" />}
              label={t('settingspage.notifications')}
              sub={t('settingspage.notifCenterSub')}
              onClick={() => navigate('/notifications')}
              right={
                unread > 0 ? (
                  <span className="flex items-center gap-2">
                    <span
                      className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold text-white"
                      style={{
                        background: 'rgb(var(--color-accent))',
                        boxShadow: '0 0 10px rgba(232,32,58,0.45)',
                      }}
                    >
                      {unread > 99 ? '99+' : unread}
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-fg2" />
                  </span>
                ) : undefined
              }
            />
            <Row
              icon={<Globe className="h-4 w-4" />}
              label={t('settings.language.label')}
              sub={t('settingspage.languageSub')}
              noChevron
              right={
                <span className="flex flex-none rounded-full bg-fg/10 p-0.5">
                  {(['fr', 'en'] as Lang[]).map((l) => {
                    const active =
                      (i18n.language?.startsWith('en') ? 'en' : 'fr') === l
                    return (
                      <button
                        key={l}
                        onClick={(e) => {
                          e.stopPropagation()
                          hapticSuccess()
                          setLanguage(l)
                          if (userId)
                            void supabase
                              .from('profiles')
                              .update({ language: l })
                              .eq('user_id', userId)
                        }}
                        className={`rounded-full px-3 py-1 text-[11px] font-bold tracking-wide transition-colors ${
                          active ? 'bg-accent text-white' : 'text-fg2'
                        }`}
                      >
                        {l.toUpperCase()}
                      </button>
                    )
                  })}
                </span>
              }
            />
            <Row
              icon={<Palette className="h-4 w-4" />}
              label={t('settingspage.appearance')}
              sub={
                theme === 'light'
                  ? t('settingspage.lightMode')
                  : t('settingspage.darkMode')
              }
              // L'onClick est requis pour que le <button> extérieur reste
              // actif : un <button disabled> avale les événements de ses
              // enfants, ce qui figeait le Toggle (corrigé le 02/06/2026).
              onClick={() => {
                hapticSuccess()
                setTheme(theme === 'light' ? 'dark' : 'light')
              }}
              right={
                <Toggle
                  checked={theme === 'light'}
                  onChange={() => {
                    hapticSuccess()
                    setTheme(theme === 'light' ? 'dark' : 'light')
                  }}
                />
              }
              noChevron
            />
            {/* Les notifications push sont le SEUL système d'envoi : l'ancien
                interrupteur « Notifications », qui n'écrivait qu'un drapeau
                local lu par personne, a disparu — deux systèmes apparents
                pour une seule réalité était précisément ce qu'il fallait
                arrêter. Les réglages fins ci-dessous pilotent `send-push.ts`. */}
            <Row
              icon={<Smartphone className="h-4 w-4" />}
              label={t('settingspage.enablePush')}
              sub={pushMsg ?? t('settingspage.enablePushSub')}
              onClick={pushBusy ? undefined : enableDevicePush}
            />
            <Row
              icon={<BellRing className="h-4 w-4" />}
              label={t('settingspage.pushWhat')}
              sub={t('settingspage.pushWhatSub')}
              onClick={() => setPushPrefsOpen((v) => !v)}
            />
            {pushPrefsOpen && (
              <>
                <Row
                  icon={<Heart className="h-4 w-4" />}
                  label={t('settingspage.likesOnSpots')}
                  right={
                    <Toggle
                      checked={npref.likes}
                      onChange={() => toggleNpref('likes')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<MessageCircle className="h-4 w-4" />}
                  label={t('settingspage.comments')}
                  right={
                    <Toggle
                      checked={npref.comments}
                      onChange={() => toggleNpref('comments')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<SmilePlus className="h-4 w-4" />}
                  label={t('settingspage.reactionsOnSpots')}
                  right={
                    <Toggle
                      checked={npref.reactions}
                      onChange={() => toggleNpref('reactions')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<UserPlus className="h-4 w-4" />}
                  label={t('settingspage.newFollowers')}
                  right={
                    <Toggle
                      checked={npref.followers}
                      onChange={() => toggleNpref('followers')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<Radio className="h-4 w-4" />}
                  label={t('settingspage.followingSpots')}
                  right={
                    <Toggle
                      checked={npref.following_spots}
                      onChange={() => toggleNpref('following_spots')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<CalendarDays className="h-4 w-4" />}
                  label={t('settingspage.eventNotifs')}
                  right={
                    <Toggle
                      checked={npref.events}
                      onChange={() => toggleNpref('events')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<Sparkles className="h-4 w-4" />}
                  label={t('settingspage.revsNews')}
                  right={
                    <Toggle
                      checked={npref.revs_news}
                      onChange={() => toggleNpref('revs_news')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<BellRing className="h-4 w-4" />}
                  label={t('settingspage.spotsNearMe')}
                  right={
                    <Toggle
                      checked={npref.nearby}
                      onChange={() => toggleNpref('nearby')}
                    />
                  }
                  noChevron
                />
                <Row
                  icon={<Flame className="h-4 w-4" />}
                  label={t('settingspage.streakReminder')}
                  right={
                    <Toggle
                      checked={npref.streak}
                      onChange={() => toggleNpref('streak')}
                    />
                  }
                  noChevron
                />
              </>
            )}
          </Section>

          {/* ══════════ REVS & COMMUNAUTÉ ══════════ */}
          <Section title={t('settingspage.sectionRevsCommunity')}>
            <Row
              icon={<Flame className="h-4 w-4" />}
              label={t('settingspage.sectionPassions')}
              sub={
                preferredBrands.length > 0
                  ? preferredBrands.join(' · ')
                  : preferredUniverses.length > 0
                    ? preferredUniverses
                        .map((u) => t(`onboarding.universes.options.${u}`))
                        .join(' · ')
                    : t('settingspage.passionsShortSub')
              }
              onClick={() => {
                setPassionsMsg(null)
                setPassionsOpen((v) => !v)
              }}
            />
            {passionsOpen && PassionsEditor}
            <Row
              icon={<UserPlus className="h-4 w-4" />}
              label={t('settingspage.inviteFriends')}
              sub={t('settingspage.inviteShortSub')}
              onClick={shareApp}
            />
            {/* « REVS Master Tutorial » = le parcours de découverte en dix
                écrans, celui que voit un nouvel inscrit. Ce n'est PAS
                /tutorial, qui est la documentation interne réservée au compte
                créateur et gardée côté serveur — elle reste plus bas. */}
            <Row
              icon={<BookOpen className="h-4 w-4" />}
              label={t('settingspage.masterTutorial')}
              sub={tourMsg ?? t('settingspage.masterTutorialSub')}
              onClick={replayTutorial}
            />
          </Section>

          {/* ══════════ MODE RADAR — premium uniquement ══════════
              Absent de la maquette mais bien réel et payant : le retirer
              reviendrait à supprimer une contrepartie d'abonnement. */}
          {tier && (
            <Section title={t('settingspage.sectionPremium')}>
              <div className="px-4 py-4">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-accent"
                    style={{
                      background: 'rgba(232,32,58,0.12)',
                      border: '1px solid rgba(232,32,58,0.35)',
                    }}
                  >
                    <RadarIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display text-base font-extrabold tracking-tighter text-fg">
                        {t('settingspage.radarMode')}
                      </p>
                      <button
                        onClick={toggleRadar}
                        disabled={radarBusy || !radarPrefs}
                        aria-pressed={radarPrefs?.enabled ?? false}
                        className={`relative h-7 w-12 flex-none rounded-full transition-colors disabled:opacity-50 ${
                          radarPrefs?.enabled ? 'bg-accent' : 'bg-fg/15'
                        }`}
                        style={
                          radarPrefs?.enabled
                            ? { boxShadow: '0 0 12px rgba(232,32,58,0.45)' }
                            : undefined
                        }
                      >
                        <span
                          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-transform ${
                            radarPrefs?.enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-fg2">
                      {t('settingspage.radarModeSub')}
                    </p>
                  </div>
                </div>
                {radarPrefs?.enabled && (
                  <>
                    <div className="mt-4">
                      <p className="label-up text-[10px] text-fg2">
                        {t('settingspage.detectionRadius')}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {([5, 10, 20] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setRadarRadius(r)}
                            disabled={radarBusy}
                            className={`tappable rounded-2xl py-2.5 text-sm font-extrabold tracking-wider transition-colors disabled:opacity-50 ${
                              radarPrefs.radius_km === r
                                ? 'bg-accent text-fg'
                                : 'bg-fg/[0.04] text-fg2 hover:bg-fg/[0.08]'
                            }`}
                            style={
                              radarPrefs.radius_km === r
                                ? { boxShadow: '0 6px 18px rgba(232,32,58,0.35)' }
                                : { border: '1px solid var(--color-border)' }
                            }
                          >
                            {t('settingspage.radiusKm', { r })}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-fg/[0.03] px-3 py-2.5">
                      <div className="min-w-0 text-[11px] text-fg2">
                        <span className="label-up text-[9px]">
                          {t('settingspage.referencePosition')}
                        </span>
                        <p className="mt-0.5 truncate font-mono text-fg/80">
                          {radarPrefs.lat !== null && radarPrefs.lng !== null
                            ? `${radarPrefs.lat.toFixed(3)}, ${radarPrefs.lng.toFixed(3)}`
                            : '—'}
                        </p>
                      </div>
                      <button
                        onClick={refreshRadarPosition}
                        disabled={radarBusy}
                        className="tappable flex-none rounded-full bg-fg/[0.06] px-3 py-1.5 text-[11px] font-bold text-fg/80 disabled:opacity-50"
                        style={{ border: '1px solid var(--color-border)' }}
                      >
                        {radarBusy ? '…' : t('settingspage.refresh')}
                      </button>
                    </div>
                  </>
                )}
                {radarErr && <p className="mt-3 text-xs text-accent">{radarErr}</p>}
              </div>
            </Section>
          )}

          {/* ══════════ CONFIDENTIALITÉ & LÉGAL ══════════ */}
          <Section title={t('settingspage.sectionPrivacy')}>
            <Row
              icon={<Eye className="h-4 w-4" />}
              label={
                isPublic
                  ? t('settingspage.publicProfile')
                  : t('settingspage.privateProfile')
              }
              sub={t('settingspage.profileVisibilitySub')}
              right={<Toggle checked={isPublic} onChange={togglePrivacy} />}
              noChevron
            />
            {/* ⚠️ HONNÊTETÉ DU RÉGLAGE — vérifié le 30/09/2026 :
                `revs_consent_analytics` n'est lu NULLE PART dans le dépôt.
                Aucun outil de mesure n'est branché à REVS. L'interrupteur est
                conservé (le consentement recueilli garde sa valeur le jour où
                un outil arrivera) mais le sous-titre dit la vérité au lieu de
                laisser croire qu'une mesure d'audience tourne. */}
            <Row
              icon={<Cookie className="h-4 w-4" />}
              label={t('settingspage.analyticsCookies')}
              sub={t('settingspage.analyticsNotWired')}
              right={<Toggle checked={analytics} onChange={toggleAnalytics} />}
              noChevron
              wrap
            />
            <Row
              icon={<Megaphone className="h-4 w-4" />}
              label={t('settingspage.marketingComms')}
              sub={t('settingspage.marketingCommsSub')}
              right={<Toggle checked={marketing} onChange={toggleMarketing} />}
              noChevron
              wrap
            />
            <Row
              icon={<Shield className="h-4 w-4" />}
              label={t('settingspage.privacyPolicy')}
              onClick={() => navigate('/legal/privacy')}
            />
            <Row
              icon={<Scale className="h-4 w-4" />}
              label={t('settingspage.terms')}
              onClick={() => navigate('/legal/terms')}
            />
            <Row
              icon={<Scale className="h-4 w-4" />}
              label={t('settingspage.legalNotice')}
              onClick={() => navigate('/legal/mentions')}
            />
            {/* « À propos de REVS » — le second accès aux nouveautés, celui
                qu'on retrouve quand on ne se souvient plus d'où venait la
                cloche. Il porte la version, ce qui en fait aussi la réponse à
                « quelle version j'ai ? ». */}
            <Row
              icon={<Info className="h-4 w-4" />}
              label={t('notif.about')}
              sub={t('notif.aboutSub', { version: APP_VERSION })}
              onClick={() => navigate('/notifications?tab=updates')}
            />
          </Section>

          {/* ══════════ SUPPORT ══════════
              Pas de système de tickets : il n'en existe aucun, et en inventer
              un serait promettre un suivi qui n'arriverait jamais. La ligne
              ouvre le client mail sur l'adresse déjà utilisée par REVS. */}
          <Section title={t('settingspage.sectionSupport')}>
            <Row
              icon={<HelpCircle className="h-4 w-4" />}
              label={t('settingspage.helpContact')}
              sub={CONTACT_EMAIL}
              onClick={() => {
                window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  t('settingspage.helpMailSubject', { version: APP_VERSION }),
                )}`
              }}
            />
          </Section>

          {/* ══════════ DEVIENS ORGANISATEUR ══════════
              Visuellement à part : c'est une DEMANDE, pas un réglage. Et son
              bouton est ambre, jamais rouge — voir le commentaire du bouton
              de déconnexion plus bas. */}
          {isOrganizer ? (
            <Section title={t('settingspage.sectionOrganizer')}>
              <Row
                icon={<Crown className="h-4 w-4" />}
                label={t('settingspage.createEvent')}
                sub={t('settingspage.createEventSub')}
                onClick={() => navigate('/new-event')}
              />
            </Section>
          ) : (
            <div
              className="relative isolate overflow-hidden rounded-3xl"
              style={{
                border: '1px solid rgba(232,32,58,0.3)',
                boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
              }}
            >
              {vehicle.photo && (
                <img
                  src={vehicle.photo}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ filter: 'blur(14px)', transform: 'scale(1.2)' }}
                />
              )}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background: vehicle.photo
                    ? 'linear-gradient(180deg, rgba(10,10,11,0.93), rgba(10,10,11,0.97))'
                    : 'linear-gradient(160deg, #141415, #0e0e0f)',
                }}
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(90% 70% at 100% 0%, rgba(232,32,58,0.16), transparent 62%)',
                }}
              />

              <div className="relative p-5">
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-accent"
                    style={{
                      background: 'rgba(232,32,58,0.14)',
                      border: '1px solid rgba(232,32,58,0.34)',
                    }}
                  >
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[17px] font-black tracking-tight text-fg">
                      {t('settingspage.organizerTitle')}
                    </p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg2">
                      {t('settingspage.organizerPitch')}
                    </p>
                  </div>
                </div>

                {/* L'ÉTAT RÉEL DU DOSSIER, pas un drapeau local.
                    `my_organizer_request()` ne renvoie que le statut et les
                    dates du dossier de l'appelant — ni les notes internes, ni
                    l'identité de qui l'a instruit. */}
                {orgStatus === 'pending' ? (
                  <button
                    onClick={() => navigate('/become-organizer')}
                    className="tappable mt-4 flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left"
                    style={{
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.3)',
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-extrabold text-[#F59E0B]">
                        {t('organizer.settings.pendingTitle')}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-fg2">
                        {t('organizer.settings.pendingSub')}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-[#F59E0B]" />
                  </button>
                ) : (
                  <div className="mt-4 flex justify-end">
                    {/* AMBRE ET CONTOURÉ, délibérément.
                        Deux gros boutons rouges empilés — « Faire une demande »
                        puis « Se déconnecter » — c'est une déconnexion par
                        erreur qui attend de se produire. La couleur, le
                        remplissage et la taille les séparent tous les trois. */}
                    <button
                      onClick={() => navigate('/become-organizer')}
                      className="tappable rounded-full px-4 py-2.5 text-[12px] font-extrabold tracking-wider transition-colors"
                      style={{
                        color: '#F59E0B',
                        background: 'rgba(245,158,11,0.07)',
                        border: '1px solid rgba(245,158,11,0.45)',
                      }}
                    >
                      {orgStatus === 'rejected'
                        ? t('organizer.settings.reapply')
                        : t('settingspage.makeRequest')}{' '}
                      →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════ DÉCONNEXION ══════════
              Séparée par une vraie respiration (pt-6) du bloc organisateur :
              c'est la seule garantie qui tienne quand le pouce descend vite. */}
          <div className="pt-6">
            <button
              onClick={logout}
              className="tappable flex w-full items-center justify-center gap-2.5 rounded-full py-4 text-sm font-extrabold tracking-wider text-white transition-transform active:scale-[0.99]"
              style={{
                background: '#E8203A',
                boxShadow: '0 10px 30px rgba(232,32,58,0.42)',
              }}
            >
              <LogOut className="h-4 w-4" />
              {t('settingspage.signOut')}
            </button>
          </div>

          {/* ══════════ ZONE SECONDAIRE ══════════
              Compte, appareil, sécurité, suppression. Tout ce qui existait est
              conservé — simplement replié, pour que la page principale reste un
              centre de configuration et non un inventaire. */}
          <div className="pt-2">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="tappable flex w-full items-center justify-center gap-1.5 py-2 text-[12px] font-semibold text-fg2"
            >
              {advancedOpen
                ? t('settingspage.advancedHide')
                : t('settingspage.advancedShow')}
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${
                  advancedOpen ? 'rotate-90' : ''
                }`}
              />
            </button>
          </div>

          {advancedOpen && (
            <div className="space-y-7">
              <Section title={t('settingspage.sectionSecurity')}>
                <Row
                  icon={<AtSign className="h-4 w-4" />}
                  label={t('settingspage.editEmail')}
                  sub={email}
                  onClick={() => {
                    setEmailErr(null)
                    setEmailMsg(null)
                    setEmailOpen((v) => !v)
                  }}
                />
                {emailOpen && EmailEditor}
                <Row
                  icon={<KeyRound className="h-4 w-4" />}
                  label={t('settingspage.editPassword')}
                  onClick={() => {
                    setPwErr(null)
                    setPwMsg(null)
                    setPwOpen((v) => !v)
                  }}
                />
                {pwOpen && PasswordEditor}
                <Row
                  icon={<Shield className="h-4 w-4" />}
                  label={t('settingspage.signOutAllDevices')}
                  sub={t('settingspage.signOutAllDevicesSub')}
                  onClick={signOutAllDevices}
                  warn
                  wrap
                />
              </Section>

              <Section title={t('settingspage.sectionDevice')}>
                {/* La localisation quitte la page principale : elle se demande
                    déjà dans le questionnaire et sur la carte, qui réécrivent
                    tous deux `revs_geo`. Elle reste ici parce qu'elle est
                    réellement branchée (src/lib/geo.ts la relit) — la retirer
                    tout à fait aurait supprimé le seul moyen de la couper. */}
                <Row
                  icon={<MapPin className="h-4 w-4" />}
                  label={t('settingspage.location')}
                  sub={
                    !geo || geoDenied
                      ? t('settingspage.locationDisabled')
                      : t('settingspage.locationEnabled')
                  }
                  right={<Toggle checked={geo} onChange={toggleGeo} />}
                  noChevron
                />
                <Row
                  icon={<RotateCcw className="h-4 w-4" />}
                  label={t('settingspage.resetOnboarding')}
                  sub={t('settingspage.resetOnboardingSub')}
                  onClick={resetOnboarding}
                  wrap
                />
                {/* Documentation interne — visible uniquement pour le compte
                    créateur, et de toute façon gardée côté serveur. Sans
                    rapport avec le « REVS Master Tutorial » plus haut, qui est
                    le parcours utilisateur. */}
                {tutorialOk && (
                  <Row
                    icon={<BookOpen className="h-4 w-4" />}
                    label={t('settingspage.internalDoc')}
                    sub={t('settingspage.internalDocSub')}
                    onClick={() => navigate('/tutorial')}
                    wrap
                  />
                )}
              </Section>

              <section className="space-y-3">
                <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent/70">
                  {t('settingspage.sensitiveZone')}
                </h2>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-accent/40 px-4 py-3.5 text-left transition-colors hover:bg-accent/5"
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <Trash2 className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-[15px] font-semibold text-accent">
                      {t('settingspage.deleteAccount')}
                    </span>
                  </button>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
                    <p className="text-sm text-accent">
                      {t('settingspage.deleteConfirmText')}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 rounded-full border border-fg/15 py-3 text-sm text-fg/70"
                      >
                        {t('settingspage.cancel')}
                      </button>
                      <button
                        onClick={deleteAccount}
                        disabled={saving}
                        className="flex-1 rounded-full bg-accent py-3 text-sm font-semibold disabled:opacity-50"
                      >
                        {saving ? '…' : t('settingspage.yesDelete')}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Version — tout en bas, discrète. Source unique : APP_VERSION dans
              src/lib/constants.ts, la même constante que le chip BÊTA de
              l'accueil. */}
          <p className="pt-6 text-center text-[11px] text-fg2 opacity-50">
            REVS v{APP_VERSION}
          </p>
        </div>
      )}
      {cropSrc && (
        <AvatarCropModal
          imageSrc={cropSrc}
          onCancel={onCropCancel}
          onConfirm={onCropConfirm}
        />
      )}
    </div>
  )
}

/**
 * Les deux raccourcis sous le hero.
 *
 * Ils n'ouvrent rien de neuf : ils déplient les éditeurs qui existaient déjà
 * dans la page. Leur rôle est de donner aux deux actions les plus fréquentes
 * une cible large, au lieu de deux lignes perdues dans une liste.
 */
function ShortcutCard({
  icon,
  title,
  sub,
  onClick,
  active,
}: {
  icon: ReactNode
  title: string
  sub: string
  onClick: () => void
  active: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={active}
      className="tappable flex min-w-0 flex-col items-start gap-2 rounded-3xl bg-card p-4 text-left transition-transform active:scale-[0.98]"
      style={{
        border: `1px solid ${active ? 'rgba(232,32,58,0.42)' : 'var(--color-border)'}`,
        boxShadow: active ? '0 0 22px rgba(232,32,58,0.12)' : undefined,
      }}
    >
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
        style={{
          background: 'rgba(232,32,58,0.13)',
          border: '1px solid rgba(232,32,58,0.3)',
          color: '#E8203A',
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 max-w-full">
        <span className="block truncate text-[14px] font-bold text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-fg2">{sub}</span>
      </span>
    </button>
  )
}
