/**
 * Small hand-drawn inline SVG icon set for the dashboard chrome.
 *
 * No icon library is installed in this project (no network access to
 * install one either), so every icon here is a minimal, original stroke
 * drawing built from basic primitives (circles/lines/paths).
 */

type IconProps = {
  className?: string;
};

const BASE_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function LogoMark({ className }: IconProps) {
  return (
    <span className={`logo-mark ${className ?? ''}`.trim()} aria-hidden="true">
      К
    </span>
  );
}

export function DashboardIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
    </svg>
  );
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M6.5 3.5h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5v4h4" />
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
      <line x1="8.5" y1="16" x2="15.5" y2="16" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" />
    </svg>
  );
}

export function HelpIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.4 2.4 0 1 1 3.55 2.1c-.85.5-1.15.95-1.15 1.85" />
      <line x1="12" y1="16.7" x2="12" y2="16.75" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M9.5 20H5.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
      <path d="M15.5 16.5 20 12l-4.5-4.5" />
      <line x1="20" y1="12" x2="9.5" y2="12" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <line x1="20" y1="20" x2="15.4" y2="15.4" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M6 10.5a6 6 0 1 1 12 0c0 3.7 1.2 5 1.9 5.7H4.1c.7-.7 1.9-2 1.9-5.7Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5Z" />
      <path d="M3.5 12 12 16.5 20.5 12" />
      <path d="M3.5 16 12 20.5 20.5 16" />
    </svg>
  );
}

export function MaskIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M4 8c0-2.5 2-4.5 4.6-4.5 1.6 0 2.5.7 3.4.7s1.8-.7 3.4-.7C18 3.5 20 5.5 20 8c0 5.4-3.4 10-8 10S4 13.4 4 8Z" />
      <path d="M8.3 9.3c.5-.6 1.6-.6 2.1 0" />
      <path d="M13.6 9.3c.5-.6 1.6-.6 2.1 0" />
      <path d="M9.2 13.4c1.7 1.1 3.9 1.1 5.6 0" />
    </svg>
  );
}

export function ArrowUpRightIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

export function TicketIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M3.5 9.2a2 2 0 0 0 0 5.6V17a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-2.2a2 2 0 0 1 0-5.6V7a1 1 0 0 0-1-1h-15a1 1 0 0 0-1 1v2.2Z" />
      <line x1="14.5" y1="6" x2="14.5" y2="18" strokeDasharray="1.6 2.2" />
    </svg>
  );
}
