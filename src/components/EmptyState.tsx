import type { ComponentType } from 'react'

type IconProps = { size?: number; color?: string; strokeWidth?: number }

export default function EmptyState({
  icon: Icon,
  title,
  subtitle,
  buttonLabel,
  onButton,
}: {
  icon: ComponentType<IconProps>
  title: string
  subtitle?: string
  buttonLabel: string
  onButton: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-8 text-center">
      <Icon size={64} color="#444444" strokeWidth={1.5} />
      <h2 className="mt-6 max-w-xs text-[20px] font-semibold text-fg">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 max-w-xs text-[14px] text-fg2">{subtitle}</p>
      )}
      <button
        onClick={onButton}
        className="mt-10 rounded-full bg-accent px-7 py-3.5 text-sm font-medium text-fg"
      >
        {buttonLabel}
      </button>
    </div>
  )
}
