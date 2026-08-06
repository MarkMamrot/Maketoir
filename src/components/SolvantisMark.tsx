import type { CSSProperties } from 'react';

type SolvantisMarkVariant = 'default' | 'reversed' | 'tile' | 'mono';

interface SolvantisMarkProps {
  size?: number;
  variant?: SolvantisMarkVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function SolvantisMark({
  size = 24,
  variant = 'default',
  className,
  style,
  title,
}: SolvantisMarkProps) {
  const isReversed = variant === 'reversed' || variant === 'tile';
  const isMono = variant === 'mono';
  const upper = isMono ? 'currentColor' : isReversed ? '#35BFD6' : '#1EA8C2';
  const lower = isMono ? 'currentColor' : isReversed ? '#FFFFFF' : '#0F172A';
  const junction = isMono ? 'currentColor' : isReversed ? '#1EA8C2' : '#35BFD6';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {variant === 'tile' && <rect width="64" height="64" rx="13" fill="#0F172A" />}
      <path d="M51 12H27C18.72 12 12 18.72 12 27s6.72 15 15 15h10" fill="none" stroke={upper} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 52h24c8.28 0 15-6.72 15-15s-6.72-15-15-15H27" fill="none" stroke={lower} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="4.5" fill={junction} />
    </svg>
  );
}