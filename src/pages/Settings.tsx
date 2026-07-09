import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AtSign,
  Bell,
  BellRing,
  Camera,
  ChevronRight,
  Cookie,
  Crown,
  Eye,
  EyeOff,
  Flame,
  Heart,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Radar as RadarIcon,
  RotateCcw,
  Scale,
  Shield,
  Car,
  Smartphone,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Globe,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/theme'
import { hapticSuccess } from '../lib/haptic'
import { clearVault, hasVault, readVault } from '../lib/passwordVault'
import AvatarCropModal from '../components/AvatarCropModal'
import { enablePush, pushSupported } from '../lib/push'
import { translateError } from '../lib/errors'
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
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [garageOpen, setGarageOpen] = useState(false)
  const [socialOpen, setSocialOpen] = useState(false)
  const [garageBusy, setGarageBusy] = useState(false)
  const [socialBusy, setSocialBusy] = useState(false)
  const [garageMsg, setGarageMsg] = useState<string | null>(null)
  const [socialMsg, setSocialMsg] = useState<string | null>(null)
  // Password reveal — Sécurité row. revealed holds the decrypted
  // plaintext when the user taps the eye, null otherwise. The vault
  // is auto-populated at every login so we don't track its existence
  // in state; togglePasswordReveal calls hasVault() on demand.
  const [revealed, setRevealed] = useState<string | null>(null)
  const [isPublic, setIsPublic] = useState(true)
  const [notif, setNotif] = useState(false)
  const [geo, setGeo] = useState(false)
  const [geoDenied, setGeoDenied] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [role, setRole] = useState<string>('user')

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
      clearVault()
      const { error } = await supabase.auth.signOut({ scope: 'global' })
      if (error) throw error
      hapticSuccess()
    } catch (e) {
      setErr(translateError(e))
    }
  }

  // Toggle handler for the "Voir mon mot de passe" row. Vault is
  // auto-populated at every login, so the happy path is just decrypt
  // + show / re-mask. Sessions that pre-date the auto-store rollout
  // surface a soft toast asking the user to re-login once.
  async function togglePasswordReveal() {
    if (revealed) {
      setRevealed(null)
      return
    }
    if (!userId) return
    if (!hasVault()) {
      setMsg(t('settingspage.vaultResyncLogin'))
      window.setTimeout(() => setMsg(null), 3500)
      return
    }
    try {
      const pt = await readVault(userId)
      if (pt) {
        setRevealed(pt)
        hapticSuccess()
      } else {
        // Vault entry exists but decryption failed (different user,
        // corrupt entry). Wipe so the next login starts clean.
        clearVault()
          setMsg(t('settingspage.vaultDesync'))
        window.setTimeout(() => setMsg(null), 3500)
      }
    } catch {
      setMsg(t('settingspage.vaultReadError'))
      window.setTimeout(() => setMsg(null), 2000)
    }
  }

  async function saveGarage() {
    if (!userId || garageBusy) return
    setGarageBusy(true)
    setGarageMsg(null)
    const value = garageBrand.trim().slice(0, 80) || null
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ garage_brand: value })
        .eq('user_id', userId)
      if (error) throw error
      hapticSuccess()
      setGarageMsg(t('settingspage.garageSaved'))
      window.setTimeout(() => setGarageMsg(null), 2000)
      setGarageOpen(false)
    } catch (e) {
      setGarageMsg(translateError(e))
    } finally {
      setGarageBusy(false)
    }
  }

  async function saveSocial() {
    if (!userId || socialBusy) return
    setSocialBusy(true)
    setSocialMsg(null)
    // Strip leading @ / spaces / URLs — store the raw handle only.
    const clean = (s: string) =>
      s
        .trim()
        .replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\//i, '')
        .replace(/^@+/, '')
        .replace(/\/.*$/, '')
        .slice(0, 60) || null
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
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgRaison, setOrgRaison] = useState('')
  const [orgSending, setOrgSending] = useState(false)
  const [orgSent, setOrgSent] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [npref, setNpref] = useState({
    likes: true,
    comments: true,
    followers: true,
    nearby: true,
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

      const [{ data: prof }, { data: orgReq }, { data: np }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('pseudo, ville, avatar, is_public, role, garage_brand, instagram, tiktok, dream_car')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('organizer_requests')
            .select('id')
            .eq('user_id', user.id)
            .limit(1),
          supabase
            .from('notification_prefs')
            .select('likes, comments, followers, nearby, streak')
            .eq('user_id', user.id)
            .maybeSingle(),
        ])
      if (!active) return
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
        setInstagram((prof as { instagram?: string | null }).instagram ?? '')
        setTiktok((prof as { tiktok?: string | null }).tiktok ?? '')
      }
      if (np)
        setNpref({
          likes: np.likes ?? true,
          comments: np.comments ?? true,
          followers: np.followers ?? true,
          nearby: np.nearby ?? true,
          streak: np.streak ?? true,
        })
      if (orgReq && orgReq.length > 0) setOrgSent(true)

      try {
        setNotif(
          localStorage.getItem('revs_notifications') === '1' &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted',
        )
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
      const path = `${userId}/avatar.jpg`
      const up = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${pub.publicUrl}?v=${Date.now()}`
      const { error } = await supabase
        .from('profiles')
        .upsert({ user_id: userId, avatar: url }, { onConflict: 'user_id' })
      if (error) throw error
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
      if (avatarFile) {
        const path = `${userId}/avatar.jpg`
        const up = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, {
            upsert: true,
            contentType: 'image/jpeg',
          })
        if (up.error) throw up.error
        const { data: pub } = supabase.storage
          .from('avatars')
          .getPublicUrl(path)
        avatar = `${pub.publicUrl}?v=${Date.now()}`
      }
      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: userId,
          pseudo: pseudo.trim(),
          ville: ville.trim(),
          dream_car: dreamCar.trim() || null,
          avatar,
        },
        { onConflict: 'user_id' },
      )
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

  async function toggleNotif() {
    if (notif) {
      try {
        localStorage.setItem('revs_notifications', '0')
      } catch {
        /* ignore */
      }
      setNotif(false)
      return
    }
    if (typeof Notification === 'undefined') {
      setErr(t('settingspage.notifNotSupported'))
      return
    }
    const perm = await Notification.requestPermission()
    if (perm === 'granted') {
      try {
        localStorage.setItem('revs_notifications', '1')
      } catch {
        /* ignore */
      }
      setNotif(true)
    } else {
      setErr(t('settingspage.notifDenied'))
    }
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
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id: userId, is_public: next }, { onConflict: 'user_id' })
    if (error) {
      setIsPublic(!next)
      setErr(translateError(error))
    }
  }

  async function logout() {
    clearVault()
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
      clearVault()
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

  async function submitOrganizerRequest() {
    if (!userId || orgSending) return
    setErr(null)
    setMsg(null)
    setOrgSending(true)
    const { error } = await supabase.from('organizer_requests').insert({
      user_id: userId,
      pseudo: pseudo.trim() || null,
      ville: ville.trim() || null,
      raison: orgRaison.trim() || null,
    })
    setOrgSending(false)
    if (error) {
      setErr(t('settingspage.orgRequestFailed'))
      return
    }
    setOrgSent(true)
    setOrgOpen(false)
    setOrgRaison('')
    setMsg(t('settingspage.orgRequestSent'))
  }

  const isOrganizer = role === 'organizer' || role === 'admin'

  // ─────────────────────── Inline garage / social editors ───────────────────────

  const GarageEditor = (
    <div className="px-4 pb-4 pt-2">
      <label className="block space-y-1.5">
        <span className="label-up block px-1 text-[10px] text-fg2">
          {t('settingspage.garageFieldLabel')}
        </span>
        <input
          type="text"
          autoComplete="off"
          value={garageBrand}
          onChange={(e) => setGarageBrand(e.target.value)}
          placeholder={t('settingspage.garagePlaceholder')}
          maxLength={80}
          className="w-full rounded-2xl bg-card px-4 py-3 text-sm text-fg placeholder-fg2/60 outline-none focus:ring-2 focus:ring-accent/45"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={saveGarage}
          disabled={garageBusy}
          className="flex-1 rounded-full bg-accent py-2.5 text-xs font-extrabold tracking-wider text-fg disabled:opacity-50"
        >
          {garageBusy ? '…' : t('settingspage.save')}
        </button>
        <button
          type="button"
          onClick={() => setGarageOpen(false)}
          className="rounded-full bg-card px-4 py-2.5 text-xs font-semibold text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {t('settingspage.cancel')}
        </button>
      </div>
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

  return (
    <div className="min-h-screen bg-bg px-4 pt-[calc(max(1rem,env(safe-area-inset-top))+15px)] text-fg">
      <div className="flex items-center gap-3 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('settingspage.back')}
          className="tappable -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">{t('settingspage.pageTitle')}</h1>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-fg2">{t('settingspage.loading')}</p>
      ) : (
        <div className="space-y-8 pb-6">
          {/* Identité — header avec avatar ring gradient */}
          <div className="flex flex-col items-center pt-4 text-center">
            <button
              onClick={() => setEditOpen((v) => !v)}
              aria-label={t('settingspage.editPhotoAria')}
              className="tappable flex h-24 w-24 items-center justify-center rounded-full p-[3px]"
              style={{
                background:
                  'conic-gradient(from 220deg, #E8203A 0%, #b91528 25%, #4a0f16 55%, #E8203A 100%)',
                boxShadow: '0 6px 22px rgba(232,32,58,0.32)',
              }}
            >
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-card font-display text-3xl font-extrabold tracking-tighter text-fg">
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
            </button>
            <p className="mt-3 line-clamp-1 font-display text-xl font-extrabold tracking-tighter text-fg">
              {pseudo || t('settingspage.defaultPseudo')}
            </p>
            {ville && (
              <p className="mt-0.5 line-clamp-1 text-sm text-fg2">{ville}</p>
            )}
          </div>

          {(msg || err) && (
            <p
              className={`rounded-2xl px-4 py-3 text-sm ${
                err ? 'bg-accent/15 text-accent' : 'bg-card text-fg/85'
              }`}
              style={
                err ? undefined : { border: '1px solid var(--color-border)' }
              }
            >
              {err ?? msg}
            </p>
          )}

          {/* 1 — MON COMPTE — identity-facing rows only. The two
              security-facing rows (e-mail + password) moved to the
              new Sécurité section below per the 2026-06-03 settings
              restructure spec. */}
          <Section title={t('settingspage.sectionAccount')}>
            <Row
              icon={<UserPlus className="h-4 w-4" />}
              label={t('settingspage.editProfile')}
              sub={t('settingspage.editProfileSub')}
              onClick={() => setEditOpen((v) => !v)}
            />
            {editOpen && ProfileEditor}
            <Row
              icon={<Car className="h-4 w-4" />}
              label={t('settingspage.myVehicle')}
              sub={garageBrand || t('settingspage.myVehicleSub')}
              onClick={() => {
                setGarageMsg(null)
                setGarageOpen((v) => !v)
              }}
            />
            {garageOpen && GarageEditor}
            <Row
              icon={<AtSign className="h-4 w-4" />}
              label={t('settingspage.socialNetworks')}
              sub={
                instagram || tiktok
                  ? [
                      instagram ? `IG @${instagram}` : null,
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
          </Section>

          {/* 1bis — SÉCURITÉ — relocated email + password + new global
              session signout. Supabase doesn't expose a per-device
              session list to clients, so device management is collapsed
              into a single "Déconnexion sur tous les appareils" action
              that calls signOut({ scope: 'global' }) — invalidates
              every session token for the user across devices. */}
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
            {/* Voir mon mot de passe — always-on. The vault is
                auto-populated at every login, so the eye reveals the
                actual plaintext stored encrypted in localStorage via
                AES-GCM with a userId-derived key. clearVault() runs
                on every signout / account-delete path so a different
                user on this browser never inherits the prior
                password. */}
            <div className="flex w-full items-center gap-3 border-b border-fg/[0.08] px-4 py-3.5 text-left last:border-0 text-fg">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-fg/[0.06] text-fg/85">
                <Eye className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-tight">
                  {t('settingspage.viewPassword')}
                </span>
                <span
                  className="mt-0.5 block truncate font-mono text-xs leading-tight text-fg"
                  style={{ letterSpacing: revealed ? '0' : '0.20em' }}
                >
                  {revealed ? revealed : '••••••••••••'}
                </span>
              </span>
              <button
                type="button"
                onClick={togglePasswordReveal}
                aria-label={
                  revealed ? t('settingspage.hidePasswordAria') : t('settingspage.showPasswordAria')
                }
                className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full text-fg2 transition-colors hover:bg-fg/[0.04] hover:text-fg"
              >
                {revealed ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Section>

          {/* 2 — PREMIUM features. Hidden for free users; Mode Radar
              activation captures the user's home coords on first toggle
              and persists radius preference. */}
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
                            radarPrefs?.enabled
                              ? 'translate-x-5'
                              : 'translate-x-0.5'
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
                                ? {
                                    boxShadow:
                                      '0 6px 18px rgba(232,32,58,0.35)',
                                  }
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
                {radarErr && (
                  <p className="mt-3 text-xs text-accent">{radarErr}</p>
                )}
              </div>
            </Section>
          )}

          {/* 3 — PRÉFÉRENCES */}
          <Section title={t('settings.sections.preferences')}>
            <Row
              icon={<Globe className="h-4 w-4" />}
              label={t('settings.language.label')}
              sub={t('settings.language.sub')}
              noChevron
              right={
                <span className="flex flex-none rounded-full bg-fg/10 p-0.5">
                  {(['fr', 'en'] as Lang[]).map((l) => {
                    const active = (i18n.language?.startsWith('en')
                      ? 'en'
                      : 'fr') === l
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
              icon={<Sun className="h-4 w-4" />}
              label={t('settingspage.appearance')}
              sub={theme === 'light' ? t('settingspage.lightMode') : t('settingspage.darkMode')}
              // onClick on Row is required so the outer <button> stays
              // enabled — a disabled <button> blocks pointer events on
              // its children, which made the Toggle inert. Tapping the
              // row body OR the toggle directly both flip the theme.
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
            <Row
              icon={<Bell className="h-4 w-4" />}
              label={t('settingspage.notifications')}
              sub={t('settingspage.notificationsSub')}
              right={<Toggle checked={notif} onChange={toggleNotif} />}
              noChevron
            />
            <Row
              icon={<Smartphone className="h-4 w-4" />}
              label={t('settingspage.enablePush')}
              sub={pushMsg ?? t('settingspage.enablePushSub')}
              onClick={pushBusy ? undefined : enableDevicePush}
            />
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
          </Section>

          {/* 4 — CONFIDENTIALITÉ & LÉGAL */}
          <Section title={t('settingspage.sectionPrivacy')}>
            <Row
              icon={<Eye className="h-4 w-4" />}
              label={isPublic ? t('settingspage.publicProfile') : t('settingspage.privateProfile')}
              sub={t('settingspage.profileVisibilitySub')}
              right={<Toggle checked={isPublic} onChange={togglePrivacy} />}
              noChevron
            />
            <Row
              icon={<Cookie className="h-4 w-4" />}
              label={t('settingspage.analyticsCookies')}
              sub={t('settingspage.analyticsCookiesSub')}
              right={<Toggle checked={analytics} onChange={toggleAnalytics} />}
              noChevron
            />
            <Row
              icon={<Megaphone className="h-4 w-4" />}
              label={t('settingspage.marketingComms')}
              sub={t('settingspage.marketingCommsSub')}
              right={<Toggle checked={marketing} onChange={toggleMarketing} />}
              noChevron
            />
            <Row
              icon={<Scale className="h-4 w-4" />}
              label={t('settingspage.legalNotice')}
              onClick={() => navigate('/legal/mentions')}
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
          </Section>

          {/* 5 — COMMUNAUTÉ */}
          <Section title={t('settingspage.sectionCommunity')}>
            <Row
              icon={<UserPlus className="h-4 w-4" />}
              label={t('settingspage.inviteFriends')}
              sub={t('settingspage.inviteFriendsSub')}
              onClick={shareApp}
            />
            {isOrganizer ? (
              <Row
                icon={<Crown className="h-4 w-4" />}
                label={t('settingspage.createEvent')}
                sub={t('settingspage.createEventSub')}
                onClick={() => navigate('/new-event')}
              />
            ) : orgSent ? (
              <Row
                icon={<Users className="h-4 w-4" />}
                label={t('settingspage.becomeOrganizer')}
                sub={t('settingspage.organizerRequestSentSub')}
                right={
                  <span className="rounded-full bg-fg/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg/55">
                    {t('settingspage.pending')}
                  </span>
                }
                noChevron
              />
            ) : !orgOpen ? (
              <div className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-fg">
                      {t('settingspage.becomeOrganizer')}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-fg/55">
                      {t('settingspage.organizerPitch')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOrgOpen(true)}
                  className="w-full rounded-full bg-accent/15 py-2 text-xs font-bold tracking-wider text-accent transition-colors hover:bg-accent/20"
                >
                  {t('settingspage.makeRequest')}
                </button>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <p className="text-xs text-fg/55">
                  {t('settingspage.organizerReasonHint')}
                </p>
                <textarea
                  value={orgRaison}
                  rows={3}
                  onChange={(e) => setOrgRaison(e.target.value)}
                  placeholder={t('settingspage.motivationPlaceholder')}
                  className="w-full resize-none rounded-lg bg-fg/5 px-3 py-3 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setOrgOpen(false)
                      setOrgRaison('')
                    }}
                    className="flex-1 rounded-full bg-fg/5 py-3 text-sm font-medium text-fg"
                  >
                    {t('settingspage.cancel')}
                  </button>
                  <button
                    onClick={submitOrganizerRequest}
                    disabled={orgSending}
                    className="flex-1 rounded-full bg-accent py-3 text-sm font-semibold text-fg disabled:opacity-50"
                  >
                    {orgSending ? '…' : t('settingspage.sendRequest')}
                  </button>
                </div>
              </div>
            )}
          </Section>

          {/* 6 — AVANCÉ */}
          <Section title={t('settingspage.sectionAdvanced')}>
            <Row
              icon={<RotateCcw className="h-4 w-4" />}
              label={t('settingspage.resetOnboarding')}
              sub={t('settingspage.resetOnboardingSub')}
              onClick={resetOnboarding}
              wrap
            />
          </Section>

          {/* 7 — ZONE SENSIBLE */}
          <section className="space-y-3 pt-4">
            <div className="h-px bg-fg/10" />
            <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent/70">
              {t('settingspage.sensitiveZone')}
            </h2>
            <div className="space-y-3">
              <button
                onClick={signOutAllDevices}
                className="flex w-full items-center gap-3 rounded-2xl border border-[#F59E0B]/30 px-4 py-3.5 text-left transition-colors hover:bg-[#F59E0B]/5"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#F59E0B]/15 text-[#F59E0B]">
                  <Shield className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-semibold text-[#F59E0B]">
                    {t('settingspage.signOutAllDevices')}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-fg2">
                    {t('settingspage.signOutAllDevicesSub')}
                  </span>
                </span>
              </button>

              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-2xl border border-[#F59E0B]/30 px-4 py-3.5 text-left transition-colors hover:bg-[#F59E0B]/5"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#F59E0B]/15 text-[#F59E0B]">
                  <LogOut className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[15px] font-semibold text-[#F59E0B]">
                  {t('settingspage.signOut')}
                </span>
              </button>

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
            </div>
          </section>

          <p className="pt-4 text-center text-[10px] text-fg/30">
            <Mail className="mr-1 inline h-3 w-3" />
            contact@revs.app
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
