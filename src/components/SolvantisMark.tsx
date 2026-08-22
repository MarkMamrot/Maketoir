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
  const source = variant === 'tile'
    ? '/brand/solvantis-favicon.svg?v=20260822'
    : variant === 'mono'
      ? '/brand/solvantis-symbol-mono.svg?v=20260822'
      : '/brand/solvantis-symbol.svg?v=20260822';

  return (
    <img
      src={source}
      alt={title ?? ''}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0, objectFit: 'contain', ...style }}
      aria-hidden={title ? undefined : true}
    />
  );
}