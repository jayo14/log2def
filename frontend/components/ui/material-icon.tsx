import React from 'react';

export interface MaterialIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  className?: string;
  size?: number | string;
  filled?: boolean;
  spin?: boolean;
  ariaLabel?: string;
  ariaHidden?: boolean;
}

export function MaterialIcon({
  name,
  className = '',
  size,
  filled = false,
  spin = false,
  ariaLabel,
  ariaHidden = true,
  style,
  ...props
}: MaterialIconProps) {
  const isAccessible = Boolean(ariaLabel);
  const sizeStyle = typeof size === 'number' ? { fontSize: `${size}px`, width: `${size}px`, height: `${size}px` } : undefined;

  return (
    <span
      className={`material-symbols-rounded shrink-0 select-none ${filled ? 'filled' : ''} ${spin ? 'animate-spin' : ''} ${className}`}
      style={{ ...sizeStyle, ...style }}
      role={isAccessible ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={isAccessible ? undefined : ariaHidden}
      {...props}
    >
      {name}
    </span>
  );
}

export default MaterialIcon;
