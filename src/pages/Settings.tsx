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
      <div className="overflow-hidden rounded-2xl bg-card">{children}</div>
    </section>
  )
}

function Row({
  label,
  onClick,
  danger,
  warn,
  right,
}: {
  label: string
  onClick?: () => void
  danger?: boolean
  warn?: boolean
  right?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center justify-between gap-3 border-b border-white/5 px-4 py-3.5 text-left text-sm last:border-0 ${
        danger ? 'text-accent' : warn ? 'text-[#F59E0B]' : 'text-fg'
      } ${onClick ? 'hover:bg-white/5' : ''}`}
    >
      <span>{label}</span>
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 text-fg/30" /> : null)}
    </button>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: () => void
}) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={`relative inline-block h-6 w-11 cursor-pointer rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-white/15'
      }`}
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

  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !active) return
      setUserId(user.id)
      setEmail(user.email ?? '')
      const { data } = await supabase
        .from('profiles')
        .select('pseudo, ville, avatar, is_public')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      if (data) {
        setPseudo(data.pseudo ?? '')
        setVille(data.ville ?? '')
        setAvatarUrl(data.avatar ?? null)
        setIsPublic(data.is_public ?? true)
      }
      try {
        setNotif(
          localStorage.getItem('revs_notifications') === '1' &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted',
        )
      } catch {
        /* ignore */
      }
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

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
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
          {(msg || err) && (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                err
                  ? 'bg-accent/15 text-accent'
                  : 'bg-card text-fg/80'
              }`}
            >
              {err ?? msg}
            </p>
          )}

          {/* Mon profil */}
          <Section title="Mon profil">
            <div className="flex items-center gap-4 border-b border-white/5 p-4">
              <button
                onClick={() => fileRef.current?.click()}
                className="relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-2xl font-bold text-fg"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
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
            <div className="space-y-4 p-4">
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
          </Section>

          {/* Mon compte */}
          <Section title="Mon compte">
            <Row label="Email" right={<span className="text-fg/40">{email}</span>} />
            <Row label="Changer mon mot de passe" onClick={changePassword} />
          </Section>

          {/* Notifications */}
          <Section title="Notifications">
            <Row
              label="Notifications push"
              right={<Toggle checked={notif} onChange={toggleNotif} />}
            />
          </Section>

          {/* Confidentialité */}
          <Section title="Confidentialité">
            <Row
              label={isPublic ? 'Profil public' : 'Profil privé'}
              right={<Toggle checked={isPublic} onChange={togglePrivacy} />}
            />
          </Section>

          {/* Avancé */}
          <Section title="Avancé">
            <Row
              label="Effacer le cache et relancer l'onboarding"
              onClick={resetOnboarding}
            />
          </Section>

          {/* Danger zone */}
          <Section title="Danger zone">
            <Row label="Se déconnecter" warn onClick={logout} />
            {!confirmDelete ? (
              <Row
                label="Supprimer mon compte"
                danger
                onClick={() => setConfirmDelete(true)}
              />
            ) : (
              <div className="space-y-3 p-4">
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
          </Section>
        </div>
      )}
    </div>
  )
}
