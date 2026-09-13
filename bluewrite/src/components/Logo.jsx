/**
 * BlueWrite logo — "a report being written under protection."
 *
 * A police shield (service) holding three report text bars, the last line
 * ending in a block caret (documentation in progress / AI-assisted writing).
 * One source of truth for every brand surface:
 *
 *   variant="mark"    square plate + shield (sidebar collapsed, favicon)
 *   variant="mark-only"  bare shield, no plate (login hero icon, inline)
 *   variant="lockup"  plate + shield + wordmark (welcome screen, splash)
 *
 * The caret blinks by default; pass `animated={false}` where motion is
 * unwanted (print, static exports, reduced-motion is respected here too).
 */

export default function Logo({
  variant = 'mark',
  size = 24,
  animated = true,
  className = '',
  title = 'BlueWrite',
}) {
  const px = typeof size === 'number' ? `${size}px` : size;
  const common = {
    width: px,
    height: px,
    className: className || undefined,
    role: 'img',
    'aria-label': title,
  };

  if (variant === 'mark-only') {
    return (
      <svg viewBox="0 0 64 64" {...common}>
        <path
          d="M32 8 L52 14.5 V30 C52 42 43.5 50 32 55 C20.5 50 12 42 12 30 V14.5 Z"
          fill="rgba(0,240,255,0.07)"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinejoin="miter"
        />
        <rect x="20" y="22" width="21" height="4" fill="currentColor" opacity="0.92" />
        <rect x="20" y="30" width="21" height="4" fill="currentColor" opacity="0.92" />
        <rect x="20" y="38" width="12" height="4" fill="currentColor" />
        <Caret animated={animated} />
      </svg>
    );
  }

  if (variant === 'lockup') {
    return (
      <svg viewBox="0 0 64 64" {...common}>
        <rect width="64" height="64" rx="6" fill="#0A1120" />
        <rect x="0.5" y="0.5" width="63" height="63" rx="5.5" fill="none" stroke="#374151" />
        <path
          d="M32 8 L52 14.5 V30 C52 42 43.5 50 32 55 C20.5 50 12 42 12 30 V14.5 Z"
          fill="rgba(0,240,255,0.07)"
          stroke="#00F0FF"
          strokeWidth="3.5"
          strokeLinejoin="miter"
        />
        <rect x="20" y="22" width="21" height="4" fill="#FFFFFF" opacity="0.92" />
        <rect x="20" y="30" width="21" height="4" fill="#FFFFFF" opacity="0.92" />
        <rect x="20" y="38" width="12" height="4" fill="#00F0FF" />
        <Caret animated={animated} />
      </svg>
    );
  }

  // variant="mark" (default)
  return (
    <svg viewBox="0 0 64 64" {...common}>
      <rect width="64" height="64" rx="6" fill="#0A1120" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="5.5" fill="none" stroke="#374151" />
      <path
        d="M32 8 L52 14.5 V30 C52 42 43.5 50 32 55 C20.5 50 12 42 12 30 V14.5 Z"
        fill="rgba(0,240,255,0.07)"
        stroke="#00F0FF"
        strokeWidth="3.5"
        strokeLinejoin="miter"
      />
      <rect x="20" y="22" width="21" height="4" fill="#FFFFFF" opacity="0.92" />
      <rect x="20" y="30" width="21" height="4" fill="#FFFFFF" opacity="0.92" />
      <rect x="20" y="38" width="12" height="4" fill="#00F0FF" />
      <Caret animated={animated} />
    </svg>
  );
}

function Caret({ animated }) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animated || reduceMotion) {
    return <rect x="35" y="38" width="4" height="4" fill="#00F0FF" />;
  }
  return (
    <rect x="35" y="38" width="4" height="4" fill="#00F0FF">
      <animate
        attributeName="opacity"
        values="1;0.15;1"
        dur="1.2s"
        repeatCount="indefinite"
      />
    </rect>
  );
}
