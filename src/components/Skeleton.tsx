// Skeleton primitives — shimmer (left→right moving gradient) over a card
// surface. Uses the design-system tokens (card / fg) + the `shimmer`
// animation declared in tailwind.config.js.

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-card ${className}`}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-fg/10 to-transparent" />
    </div>
  )
}

// Mirrors a Feed card: 16:9 photo + title / subtitle / author lines.
export function SkeletonCard() {
  return (
    <div className="py-5">
      <Skeleton className="aspect-video w-full rounded-2xl" />
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-3 w-1/2 rounded" />
        <Skeleton className="h-3 w-1/4 rounded" />
      </div>
    </div>
  )
}

// Full-surface map placeholder with faint marker-shaped blocks.
export function SkeletonMap() {
  return (
    <div className="absolute inset-0 z-10 bg-bg">
      <Skeleton className="absolute inset-0 !bg-bg" />
      <Skeleton className="absolute left-[22%] top-[34%] h-12 w-12 rounded-full" />
      <Skeleton className="absolute left-[58%] top-[28%] h-12 w-12 rounded-full" />
      <Skeleton className="absolute left-[44%] top-[58%] h-12 w-12 rounded-full" />
      <Skeleton className="absolute left-[70%] top-[64%] h-12 w-12 rounded-full" />
    </div>
  )
}
