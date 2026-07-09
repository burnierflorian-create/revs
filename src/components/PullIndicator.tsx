/** Pull-to-refresh visual indicator. Translates with the drag distance
 *  and spins when refreshing. Pairs with `usePullToRefresh`. */
export default function PullIndicator({
  pull,
  refreshing,
}: {
  pull: number
  refreshing: boolean
}) {
  // Fade and rotate progress proportional to pull distance up to the
  // 60 px trigger threshold ; beyond that, the spinner is "armed".
  const progress = Math.min(1, pull / 60)
  const opacity = Math.min(1, pull / 40)
  // While refreshing we lock into a continuous spin (CSS class).
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2"
      style={{
        top: 0,
        transform: `translate(-50%, ${Math.max(0, pull - 36)}px)`,
        opacity,
        transition: refreshing
          ? 'none'
          : 'transform 200ms var(--ease-soft), opacity 200ms linear',
      }}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full bg-card ring-1 ring-fg/10 ${
          refreshing ? 'ptr-spin' : ''
        }`}
        style={{
          transform: refreshing ? undefined : `rotate(${progress * 360}deg)`,
        }}
      >
        <span className="font-display text-[10px] font-extrabold tracking-tighter text-accent">
          REVS
        </span>
      </div>
    </div>
  )
}
