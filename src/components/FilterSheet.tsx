import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type SheetOption = { key: string; label: string }

/** Reusable bottom sheet for picking a single value from a list of pills.
 *  Dark overlay (tap to close), #141414 sheet with a top handle, a wrapped
 *  pill grid (scrolls vertically when long) and a red "Appliquer" button. */
export default function FilterSheet({
  open,
  title,
  options,
  selected,
  onClose,
  onApply,
}: {
  open: boolean
  title: string
  options: SheetOption[]
  selected: string
  onClose: () => void
  onApply: (key: string) => void
}) {
  const [draft, setDraft] = useState(selected)

  // Re-sync the draft to the applied value each time the sheet opens.
  useEffect(() => {
    if (open) setDraft(selected)
  }, [open, selected])

  if (!open) return null

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col"
        style={{
          background: '#141414',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '80vh',
          paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <span
            style={{
              width: 40,
              height: 4,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.25)',
            }}
          />
        </div>

        {/* Title */}
        <h2
          className="px-5 pt-2 pb-4 font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '20px' }}
        >
          {title}
        </h2>

        {/* Pills — wrap grid, scrolls vertically when long */}
        <div className="no-scrollbar flex-1 overflow-y-auto px-5">
          <div className="flex flex-wrap gap-2.5 pb-4">
            {options.map((o) => {
              const on = draft === o.key
              return (
                <button
                  key={o.key}
                  onClick={() => setDraft(o.key)}
                  className="tappable font-semibold transition-colors"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 20,
                    fontSize: 14,
                    background: on ? '#E8203A' : '#1a1a1a',
                    color: on ? '#fff' : 'rgba(255,255,255,0.72)',
                    border: on
                      ? '1px solid #E8203A'
                      : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Apply */}
        <div className="px-5 pt-3">
          <button
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="tappable w-full rounded-full py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]"
            style={{ background: '#E8203A' }}
          >
            Appliquer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
