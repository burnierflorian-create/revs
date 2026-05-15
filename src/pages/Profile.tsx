import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Profile() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-10 px-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-light text-fg/30">Profil</h1>
        {email && <p className="text-sm text-fg/60">{email}</p>}
      </div>
      <button
        onClick={handleLogout}
        className="text-sm text-accent hover:opacity-80 transition-opacity"
      >
        Se déconnecter
      </button>
    </div>
  )
}
