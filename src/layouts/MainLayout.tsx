import { useEffect, useRef, type ChangeEvent } from 'react'
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from 'react-router-dom'
import {
  Map as MapIcon,
  Newspaper,
  Home,
  Compass,
  User,
  Camera,
} from 'lucide-react'
import { setPendingPhoto } from '../lib/pendingPhoto'
import UpdateNotification from '../components/UpdateNotification'
import InstallBanner from '../components/InstallBanner'
import WelcomeCelebration from '../components/WelcomeCelebration'
import XpFloater from '../components/XpFloater'
import TabsContainer, { type TabKey } from './TabsContainer'
import {
  claimReferralCode,
  consumePendingReferral,
} from '../lib/referrals'
import { supabase } from '../lib/supabase'
import { useMyTier } from '../lib/tier'
import { hapticSelection } from '../lib/haptic'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `liquid-tab ${isActive ? 'text-[#E8203A]' : 'text-white/40'}`

// Map a pathname to one of the 5 always-mounted tabs. Returns null for
// stack routes (spot detail, new-spot, public profile, etc.) — those
// render via <Outlet /> on top of the kept-alive tabs.
function pathToTab(pathname: string): {
  tab: TabKey | null
  discoverInitial: 'events' | undefined
} {
  if (pathname === '/') return { tab: 'home', discoverInitial: undefined }
  if (pathname === '/feed') return { tab: 'feed', discoverInitial: undefined }
  if (pathname === '/map') return { tab: 'map', discoverInitial: undefined }
  if (pathname === '/profile')
    return { tab: 'profile', discoverInitial: undefined }
  if (pathname === '/discover' || pathname === '/actu')
    return { tab: 'discover', discoverInitial: undefined }
  if (pathname === '/events')
    return { tab: 'discover', discoverInitial: 'events' }
  return { tab: null, discoverInitial: undefined }
}

export default function MainLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const navType = useNavigationType()
  const [params] = useSearchParams()
  const { tab, discoverInitial } = pathToTab(pathname)
  // POP = back gesture or browser back button → slide from the LEFT.
  // PUSH/REPLACE = forward navigation → slide from the RIGHT.
  const stackDirection = navType === 'POP' ? 'pop-in' : 'push-in'

  // Tier-aware theming: stamps `data-tier` on <html> so CSS overrides
  // can subtly tint card borders + dividers app-wide without touching
  // individual components.
  const tier = useMyTier()
  useEffect(() => {
    const root = document.documentElement
    if (tier) root.dataset.tier = tier
    else delete root.dataset.tier
  }, [tier])
  // Remember the last visited tab so we keep the right pane visible
  // underneath stack routes (e.g. /spot/:id over /feed).
  const lastTabRef = useRef<TabKey | null>(null)
  if (tab) lastTabRef.current = tab
  const onStack = tab === null

  // Central camera button — fires the native camera synchronously inside
  // the tap (iOS requirement), stashes the photo and lands on /new-spot.
  const camInputRef = useRef<HTMLInputElement>(null)
  function onCamCapture(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    hapticSelection()
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  // Redeem a pending referral code on first authenticated mount.
  // Two sources, checked in order:
  //   1) localStorage (instant claim on same-device email confirm)
  //   2) user_metadata.referral_code (survives device/browser switch)
  // The code is removed from localStorage only AFTER a successful claim
  // so a transient RPC failure doesn't burn the user's +50 XP forever.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const peek = localStorage.getItem('revs.pending-referral')
        let code = peek?.trim().toUpperCase() || null
        if (!code) {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          const meta = user?.user_metadata as
            | { referral_code?: string }
            | undefined
          code = (meta?.referral_code ?? '').trim().toUpperCase() || null
        }
        if (!active || !code || code.length !== 6) return
        const ok = await claimReferralCode(code)
        if (ok) consumePendingReferral()
      } catch {
        /* swallow — claim is best-effort */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Presence heartbeat — keeps the current user's profiles.last_seen
  // warm so the "EN LIGNE MAINTENANT" counter on Home reflects them.
  // Beats: on mount, every 60s, and when the tab becomes visible again.
  // Server-side bump_last_seen() is a no-op when unauthenticated.
  useEffect(() => {
    const bump = () => void supabase.rpc('bump_last_seen')
    bump()
    const t = setInterval(bump, 60_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Post-checkout celebration — triggered by `?status=success&tier=`
  // on ANY route (we redirect Stripe to `/?status=success` so this
  // overlay rises over the home tab, never over the Premium pricing
  // page). Dismissing clears the params and lands on /.
  const celebrate =
    params.get('status') === 'success'
      ? params.get('tier') === 'vip'
        ? 'vip'
        : 'premium'
      : null

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <main className="app-main relative flex-1">
        <TabsContainer
          activeTab={tab ?? lastTabRef.current}
          discoverInitial={discoverInitial}
        />

        {onStack && (
          <div className="stack-overlay">
            {/* Key by pathname so each stack-route navigation remounts
                this wrapper and fires a fresh transition (push from the
                right on forward, pop from the left on back). */}
            <div key={pathname} className={`stack-page ${stackDirection}`}>
              <Outlet />
            </div>
          </div>
        )}
      </main>

      <XpFloater />
      <UpdateNotification />
      <InstallBanner />

      {celebrate && (
        <WelcomeCelebration
          tier={celebrate}
          onClose={() => navigate('/', { replace: true })}
        />
      )}

      {/* Liquid-glass floating nav — a centred 280px pill with a separate
          red camera button hovering above it. Both float over the
          content, which scrolls (blurred) underneath. */}
      <div className="liquid-nav-wrap">
        <input
          ref={camInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onCamCapture}
          className="hidden"
        />
        <nav className="liquid-nav" aria-label="Navigation principale">
          {/* Camera — separate, floating 12px above the pill. ONLY on the
              Carte tab; every other tab (and stack routes) hides it
              entirely. The Home SPOTTER button is a different element and
              is unaffected. */}
          {tab === 'map' && (
            <button
              type="button"
              onClick={() => camInputRef.current?.click()}
              className="liquid-cam"
              aria-label="Spotter une voiture"
            >
              <Camera className="h-6 w-6 text-white" strokeWidth={2} />
            </button>
          )}

          <NavLink to="/map" onClick={hapticSelection} className={tabClass} aria-label="Carte">
            {({ isActive }) => (
              <>
                <MapIcon className="h-[22px] w-[22px]" strokeWidth={2} />
                {isActive && <span className="liquid-dot" />}
              </>
            )}
          </NavLink>

          <NavLink to="/feed" onClick={hapticSelection} className={tabClass} aria-label="Fil">
            {({ isActive }) => (
              <>
                <Newspaper className="h-[22px] w-[22px]" strokeWidth={2} />
                {isActive && <span className="liquid-dot" />}
              </>
            )}
          </NavLink>

          <NavLink to="/" end onClick={hapticSelection} className={tabClass} aria-label="Accueil">
            {({ isActive }) => (
              <>
                <Home className="h-[22px] w-[22px]" strokeWidth={2} />
                {isActive && <span className="liquid-dot" />}
              </>
            )}
          </NavLink>

          <NavLink to="/discover" onClick={hapticSelection} className={tabClass} aria-label="Explorer">
            {({ isActive }) => (
              <>
                <Compass className="h-[22px] w-[22px]" strokeWidth={2} />
                {isActive && <span className="liquid-dot" />}
              </>
            )}
          </NavLink>

          <NavLink to="/profile" onClick={hapticSelection} className={tabClass} aria-label="Profil">
            {({ isActive }) => (
              <>
                <User className="h-[22px] w-[22px]" strokeWidth={2} />
                {isActive && <span className="liquid-dot" />}
              </>
            )}
          </NavLink>
        </nav>
      </div>
    </div>
  )
}
