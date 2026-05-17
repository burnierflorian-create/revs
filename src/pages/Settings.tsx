import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resizeImageToJpeg } from '../lib/spots'

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-[#888888]">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl bg-[#1c1c1c]">{children}</div>
    </section>
  )
}

function Row({
  label,
  sub,
  onClick,
  danger,
  warn,
  right,
}: {
  label: string
  sub?: string
  onClick?: () => void
  danger?: boolean
  warn?: boolean
  right?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center justify-between gap-3 border-b border-white/5 px-4 py-3.5 text-left last:border-0 ${
        danger ? 'text-accent' : warn ? 'text-[#F59E0B]' : 'text-fg'
      } ${onClick ? 'transition-colors hover:bg-white/5 active:bg-white/10' : ''}`}
    >
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {sub && <span className="mt-0.5 block text-xs text-fg/40">{sub}</span>}
      </span>
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 flex-none text-fg/30" /> : null)}
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
      className={`relative inline-block h-6 w-11 flex-none rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-white/15'
      } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-fg transition-transform ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        }`}
      />
    </span>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [pseudo, setPseudo] = useState('')
  const [ville, setVille] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<Blob | null>(null)
  const [isPublic, setIsPublic] = useState(true)
  const [notif, setNotif] = useState(false)
  const [geo, setGeo] = useState(false)
  const [geoDenied, setGeoDenied] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [role, setRole] = useState<string>('user')
  const [plan, setPlan] = useState<string | null>(null)
  const [subStatus, setSubStatus] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgRaison, setOrgRaison] = useState('')
  const [orgSending, setOrgSending] = useState(false)
  const [orgSent, setOrgSent] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !active) return
      setUserId(user.id)
      setEmail(user.email ?? '')

      const [{ data: prof }, { data: orgReq }, { data: sub }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('pseudo, ville, avatar, is_public, role')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('organizer_requests')
            .select('id')
            .eq('user_id', user.id)
            .limit(1),
          supabase
            .from('subscriptions')
            .select('plan, status')
            .eq('user_id', user.id)
            .maybeSingle(),
        ])
      if (!active) return
      if (prof) {
        setPseudo(prof.pseudo ?? '')
        setVille(prof.ville ?? '')
        setAvatarUrl(prof.avatar ?? null)
        setIsPublic(prof.is_public ?? true)
        setRole((prof.role as string | undefined) ?? 'user')
      }
      if (orgReq && orgReq.length > 0) setOrgSent(true)
      if (sub) {
        setPlan((sub.plan as string | undefined) ?? null)
        setSubStatus((sub.status as string | undefined) ?? null)
      }

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
    })()
    return () => {
      active = false
    }
  }, [])

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { blob } = await resizeImageToJpeg(file, 512, 0.85)
      setAvatarFile(blob)
      setAvatarUrl(URL.createObjectURL(blob))
    } catch {
      setErr('Image illisible.')
    }
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
        { user_id: userId, pseudo: pseudo.trim(), ville: ville.trim(), avatar },
        { onConflict: 'user_id' },
      )
      if (error) {
        console.error('profile save failed:', error)
        setErr(`Échec (${error.code ?? 'err'}): ${error.message}`)
        return
      }
      setAvatarFile(null)
      setMsg('Profil enregistré ✅')
      setEditOpen(false)
    } catch (e) {
      const m = e as { message?: string }
      console.error('profile save crashed:', e)
      setErr(m?.message ?? 'Échec de l’enregistrement')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setErr(null)
    setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    })
    if (error) setErr(error.message)
    else setMsg('Email de réinitialisation envoyé 📧')
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
      setErr('Notifications non supportées sur cet appareil.')
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
      setErr('Permission notifications refusée.')
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
      setErr('Géolocalisation non disponible sur cet appareil.')
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
        else setErr('Position indisponible, réessaie.')
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
      setErr(error.message)
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
      if (!token) throw new Error('Session introuvable')
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { deleted?: boolean; error?: string }
      if (!res.ok || !data.deleted) {
        throw new Error(data.error || 'Suppression échouée')
      }
      await supabase.auth.signOut()
      navigate('/auth', { replace: true })
    } catch (e) {
      const m = e as { message?: string }
      setErr(m?.message ?? 'Suppression échouée')
      setSaving(false)
    }
  }

  function resetOnboarding() {
    try {
      localStorage.removeItem('revs_onboarded')
      localStorage.removeItem('revs_profile_done')
    } catch {
      /* ignore */
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
      setErr("Échec de l'envoi de la demande. Réessaie plus tard.")
      return
    }
    setOrgSent(true)
    setOrgOpen(false)
    setOrgRaison('')
    setMsg('Demande envoyée — on revient vers toi rapidement.')
  }

  const subscribed = subStatus === 'active' || subStatus === 'trialing'
  const planLabel = subscribed
    ? plan
      ? plan.charAt(0).toUpperCase() + plan.slice(1)
      : 'Premium'
    : 'Free'

  const ProfileEditor = (
    <div className="space-y-4 border-b border-white/5 p-4 last:border-0">
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-2xl font-bold text-fg"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (pseudo.charAt(0) || '?').toUpperCase()
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/50 py-0.5">
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
          Touche la photo pour la changer (caméra ou galerie)
        </p>
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-widest text-fg/40">
          Pseudo
        </label>
        <input
          value={pseudo}
          maxLength={24}
          onChange={(e) => setPseudo(e.target.value)}
          className="w-full rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-widest text-fg/40">
          Ville
        </label>
        <input
          value={ville}
          maxLength={48}
          onChange={(e) => setVille(e.target.value)}
          className="w-full rounded-lg bg-white/5 px-3 py-3 text-fg outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <button
        onClick={saveProfile}
        disabled={saving}
        className="w-full rounded-full bg-accent py-3 text-sm font-medium disabled:opacity-50"
      >
        {saving ? '…' : 'Sauvegarder'}
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#111111] px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="text-fg/60 transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-2xl font-bold">Paramètres</h1>
      </div>

      {loading ? (
        <p className="px-1 py-10 text-center text-sm text-fg/40">Chargement…</p>
      ) : (
        <div className="space-y-7 pb-10">
          {/* Header profil */}
          <div className="flex flex-col items-center pt-2 text-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-accent text-3xl font-bold text-fg ring-2 ring-accent/40">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                (pseudo.charAt(0) || '?').toUpperCase()
              )}
            </div>
            <p className="mt-3 font-display text-xl font-bold">
              {pseudo || 'Spotter'}
            </p>
            <button
              onClick={() => setEditOpen((v) => !v)}
              className="mt-1 text-sm font-medium text-accent"
            >
              Modifier le profil
            </button>
          </div>

          {(msg || err) && (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                err ? 'bg-accent/15 text-accent' : 'bg-card text-fg/80'
              }`}
            >
              {err ?? msg}
            </p>
          )}

          {/* MON COMPTE */}
          <Section title="Mon compte">
            <Row
              label="Modifier le profil"
              sub="Pseudo, ville, photo"
              onClick={() => setEditOpen((v) => !v)}
            />
            {editOpen && ProfileEditor}
            <Row
              label="Email"
              right={<span className="text-sm text-fg/40">{email}</span>}
            />
            <Row label="Changer mon mot de passe" onClick={changePassword} />
            <Row
              label="Mon abonnement"
              sub={subscribed ? 'Merci pour ton soutien' : undefined}
              right={
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    subscribed
                      ? 'bg-accent/15 text-accent'
                      : 'bg-white/10 text-fg/50'
                  }`}
                >
                  {planLabel}
                </span>
              }
            />
            {!subscribed && (
              <div className="p-4">
                <button
                  onClick={() => navigate('/premium')}
                  className="w-full rounded-full bg-accent py-3 text-sm font-semibold text-fg"
                >
                  Passer Premium ✨
                </button>
              </div>
            )}
          </Section>

          {/* PRÉFÉRENCES */}
          <Section title="Préférences">
            <Row
              label="Notifications"
              sub="Spots près de toi et événements"
              right={<Toggle checked={notif} onChange={toggleNotif} />}
            />
            <div className="border-b border-white/5 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg">Localisation</span>
                <Toggle checked={geo} onChange={toggleGeo} />
              </div>
              <p className="mt-1 text-xs text-fg/40">
                Nécessaire pour spotter et voir les voitures près de toi
              </p>
              {(!geo || geoDenied) && (
                <p className="mt-2 text-xs text-accent">
                  Désactivée — active-la dans Réglages → Confidentialité →
                  Localisation (iOS) ou Paramètres → Applications → REVS
                  (Android)
                </p>
              )}
            </div>
            <Row
              label="Mode sombre"
              sub="Toujours activé"
              right={<Toggle checked disabled />}
            />
          </Section>

          {/* CONFIDENTIALITÉ & LÉGAL */}
          <Section title="Confidentialité & légal">
            <Row
              label={isPublic ? 'Profil public' : 'Profil privé'}
              sub="Visibilité de ton profil dans le classement"
              right={<Toggle checked={isPublic} onChange={togglePrivacy} />}
            />
            <Row
              label="Cookies analytiques"
              sub="Mesure d'audience anonyme (RGPD)"
              right={<Toggle checked={analytics} onChange={toggleAnalytics} />}
            />
            <Row
              label="Communications marketing"
              sub="Newsletters et offres Premium (RGPD)"
              right={<Toggle checked={marketing} onChange={toggleMarketing} />}
            />
            <Row
              label="Politique de confidentialité"
              onClick={() => navigate('/confidentialite')}
            />
            <Row
              label="Mentions légales"
              onClick={() => navigate('/mentions-legales')}
            />
            <Row
              label="Conditions d'utilisation"
              onClick={() => navigate('/cgu')}
            />
          </Section>

          {/* AVANCÉ */}
          <Section title="Avancé">
            <Row
              label="Effacer le cache et relancer l'onboarding"
              onClick={resetOnboarding}
            />
            {role === 'organizer' || role === 'admin' ? (
              <Row
                label="Statut organisateur"
                right={
                  <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent">
                    Vérifié
                  </span>
                }
              />
            ) : orgSent ? (
              <Row
                label="Devenir organisateur"
                right={
                  <span className="text-xs text-fg/40">Demande envoyée</span>
                }
              />
            ) : !orgOpen ? (
              <Row
                label="Devenir organisateur"
                onClick={() => setOrgOpen(true)}
              />
            ) : (
              <div className="space-y-3 p-4">
                <p className="text-xs text-fg/40">
                  Explique pourquoi tu veux organiser des événements (club,
                  marque, association…).
                </p>
                <textarea
                  value={orgRaison}
                  rows={3}
                  onChange={(e) => setOrgRaison(e.target.value)}
                  placeholder="Ta motivation"
                  className="w-full resize-none rounded-lg bg-white/5 px-3 py-3 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setOrgOpen(false)
                      setOrgRaison('')
                    }}
                    className="flex-1 rounded-full bg-white/5 py-3 text-sm font-medium text-fg"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={submitOrganizerRequest}
                    disabled={orgSending}
                    className="flex-1 rounded-full bg-accent py-3 text-sm font-semibold text-fg disabled:opacity-50"
                  >
                    {orgSending ? '…' : 'Envoyer la demande'}
                  </button>
                </div>
              </div>
            )}
          </Section>

          {/* DANGER ZONE */}
          <section className="space-y-3 pt-2">
            <div className="h-px bg-white/10" />
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-accent/70">
              Danger zone
            </h2>
            <button
              onClick={logout}
              className="w-full rounded-full border border-[#F59E0B] py-3 text-sm font-semibold text-[#F59E0B] transition-colors hover:bg-[#F59E0B]/10"
            >
              Se déconnecter
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full rounded-full border border-accent py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
              >
                Supprimer mon compte
              </button>
            ) : (
              <div className="space-y-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
                <p className="text-sm text-accent">
                  Êtes-vous sûr ? Cette action est définitive et supprime
                  toutes tes données.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-full border border-white/15 py-3 text-sm text-fg/70"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={deleteAccount}
                    disabled={saving}
                    className="flex-1 rounded-full bg-accent py-3 text-sm font-semibold disabled:opacity-50"
                  >
                    {saving ? '…' : 'Oui, supprimer'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
