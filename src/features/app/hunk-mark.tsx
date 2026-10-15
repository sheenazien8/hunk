export function HunkMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-hidden focusable="false">
      <g fill="currentColor">
        <rect x="40" y="24" width="56" height="176" rx="3" />
        <rect x="160" y="56" width="56" height="176" rx="3" />
        <rect x="96" y="104" width="64" height="40" rx="3" />
      </g>
    </svg>
  )
}
