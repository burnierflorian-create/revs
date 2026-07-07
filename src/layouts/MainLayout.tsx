import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from 'react-router-dom'
import { MapPin, Radio, Home, Newspaper, User } from 'lucide-react'
import UpdateNotification from '../components/UpdateNotification'
import InstallBanner from '../components/InstallBanner'
import WelcomeCelebration from '../components/WelcomeCelebration'
import XpFloater from '../components/XpFloater'
import SpotCelebration from '../components/SpotCelebration'
import StreakBreak from '../components/StreakBreak'
import LevelUpOverlay from '../components/LevelUpOverlay'
import BadgeUnlocked from '../components/BadgeUnlocked'
import ShareCardSheet from '../components/ShareCardSheet'
import TabsContainer, { type TabKey } from './TabsContainer'
import {
  claimReferralCode,
  consumePendingReferral,
} from '../lib/referrals'
import { supabase } from '../lib/supabase'
import { useMyTier } from '../lib/tier'
import { hapticSelection } from '../lib/haptic'
import { useTranslation } from 'react-i18next'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `liquid-tab ${isActive ? 'is-active' : ''}`

// Nav slot order (must match the JSX order) + their routes, used to drive
// the sliding indicator and the finger-follow drag.
const NAV_ORDER = ['map', 'feed', 'home', 'discover', 'profile'] as const
const NAV_ROUTES = ['/map', '/feed', '/', '/discover', '/profile']

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
  const { t } = useTranslation()
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

  // ── Liquid nav: sliding indicator + finger-follow ──
  const navRef = useRef<HTMLElement>(null)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const startXRef = useRef(0)
  const fracRef = useRef(2)
  const navTab = tab ?? lastTabRef.current ?? 'home'
  const activeIndex = Math.max(0, NAV_ORDER.indexOf(navTab as (typeof NAV_ORDER)[number]))

  // Spring the indicator to the active slot on route change (never fights an
  // in-progress drag). useLayoutEffect → set before paint so the initial
  // position never flashes. Pure CSS var → transform, GPU-accelerated.
  useLayoutEffect(() => {
    if (!draggingRef.current) {
      navRef.current?.style.setProperty('--nav-i', String(activeIndex))
      fracRef.current = activeIndex
    }
  }, [activeIndex])

  function slotFromClientX(clientX: number): number {
    const nav = navRef.current
    if (!nav) return activeIndex
    const r = nav.getBoundingClientRect()
    const slotW = (r.width - 16) / 5
    return Math.max(0, Math.min(4, (clientX - r.left - 8) / slotW - 0.5))
  }
  function onNavPointerDown(e: React.PointerEvent) {
    startXRef.current = e.clientX
    movedRef.current = false
  }
  function onNavPointerMove(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.buttons === 0) return
    const dx = e.clientX - startXRef.current
    if (!movedRef.current) {
      if (Math.abs(dx) < 6) return // ignore micro-jitter → keep taps working
      movedRef.current = true
      draggingRef.current = true
      navRef.current?.classList.add('dragging')
      try {
        navRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported — follow still works */
      }
    }
    const frac = slotFromClientX(e.clientX)
    fracRef.current = frac
    navRef.current?.style.setProperty('--nav-i', String(frac))
  }
  function onNavPointerEnd() {
    if (!movedRef.current) return // was a tap → let the NavLink navigate
    movedRef.current = false
    draggingRef.current = false
    navRef.current?.classList.remove('dragging')
    const nearest = Math.round(fracRef.current)
    fracRef.current = nearest
    navRef.current?.style.setProperty('--nav-i', String(nearest)) // spring-snap
    hapticSelection()
    navigate(NAV_ROUTES[nearest])
  }
  const onStack = tab === null


  // Force-relogin sweep: when an admin flips profiles.force_relogin = true
  // (e.g. after a major auth/onboarding change), the user is signed out
  // once. We clear the flag FIRST (while still authenticated) so re-login
  // never loops, then sign out — App's guard redirects to /auth.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!active || !user) return
        const { data } = await supabase
          .from('profiles')
          .select('force_relogin')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!active) return
        if ((data as { force_relogin?: boolean } | null)?.force_relogin === true) {
          await supabase
            .from('profiles')
            .update({ force_relogin: false })
            .eq('user_id', user.id)
          await supabase.auth.signOut()
        }
      } catch {
        /* best-effort */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Hydrate the profile from signup metadata (pseudo / ville / country)
  // on first authenticated mount. Email-confirm signups can't write the
  // profile at signup time (no session yet), so the fields ride along in
  // user_metadata and land here once. Idempotent: only writes when the
  // profile has no pseudo yet, so it never overwrites later edits.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!active || !user) return
        const meta = user.user_metadata as
          | { pseudo?: string; ville?: string; country?: string }
          | undefined
        const metaPseudo = (meta?.pseudo ?? '').trim()
        if (!metaPseudo) return
        const { data: prof } = await supabase
          .from('profiles')
          .select('pseudo')
          .eq('user_id', user.id)
          .maybeSingle()
        const existing = (prof?.pseudo as string | undefined)?.trim()
        if (existing) return // already has a pseudo → leave it alone
        await supabase.from('profiles').upsert(
          {
            user_id: user.id,
            pseudo: metaPseudo,
            ville: (meta?.ville ?? '').trim() || null,
            country: (meta?.country ?? '').trim() || null,
          },
          { onConflict: 'user_id' },
        )
      } catch {
        /* best-effort hydration */
      }
    })()
    return () => {
      active = false
    }
  }, [])

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
      <SpotCelebration />
      <StreakBreak />
      <LevelUpOverlay />
      <BadgeUnlocked />
      <ShareCardSheet />
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
        {/* The Carte's "Spotter" camera FAB now lives in Map.tsx (a single
            60px circle above the pill). The old nav-embedded .liquid-cam was
            removed 2026-06-26 — it duplicated and overlapped the Map FAB. */}
        <nav
          ref={navRef}
          className="liquid-nav"
          aria-label={t('nav.main')}
          onPointerDown={onNavPointerDown}
          onPointerMove={onNavPointerMove}
          onPointerUp={onNavPointerEnd}
          onPointerCancel={onNavPointerEnd}
        >
          {/* Sliding liquid indicator (glow pill behind the active icon). */}
          <span className="liquid-indicator" aria-hidden />

          <NavLink to="/map" onClick={hapticSelection} className={tabClass} aria-label={t('nav.map')}>
            <MapPin className="h-[26px] w-[26px]" strokeWidth={1.5} />
          </NavLink>
          <NavLink to="/feed" onClick={hapticSelection} className={tabClass} aria-label={t('nav.feed')}>
            <Radio className="h-[26px] w-[26px]" strokeWidth={1.5} />
          </NavLink>
          <NavLink to="/" end onClick={hapticSelection} className={tabClass} aria-label={t('nav.home')}>
            <Home className="h-[26px] w-[26px]" strokeWidth={1.5} />
          </NavLink>
          <NavLink to="/discover" onClick={hapticSelection} className={tabClass} aria-label={t('nav.discover')}>
            <Newspaper className="h-[26px] w-[26px]" strokeWidth={1.5} />
          </NavLink>
          <NavLink to="/profile" onClick={hapticSelection} className={tabClass} aria-label={t('nav.profile')}>
            <User className="h-[26px] w-[26px]" strokeWidth={1.5} />
          </NavLink>
        </nav>
      </div>
    </div>
  )
}
