// Accès au panneau de modération — visible uniquement pour les rôles qui en
// ont un. Ce n'est pas une protection : la page et les fonctions SQL
// refusent déjà quiconque n'a pas le rôle. C'est simplement le seul chemin
// vers une URL qu'on ne devine pas.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ModerationLink() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (active) setAllowed(data?.role === 'moderator' || data?.role === 'admin')
    })()
    return () => {
      active = false
    }
  }, [])

  if (!allowed) return null

  return (
    <button
      onClick={() => navigate('/moderation')}
      className="tappable mx-4 mb-3 flex w-[calc(100%-2rem)] items-center gap-2.5 rounded-2xl px-4 py-3 text-left"
      style={{
        background: 'rgb(var(--color-accent) / 0.1)',
        border: '1px solid rgb(var(--color-accent) / 0.35)',
      }}
    >
      <ShieldCheck className="h-[18px] w-[18px] flex-none" style={{ color: 'var(--revs-red)' }} />
      <span className="text-[14px] font-bold text-fg">{t('moderation.title')}</span>
    </button>
  )
}
