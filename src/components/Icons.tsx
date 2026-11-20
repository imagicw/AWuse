import React from "react";

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size = 15, className?: string): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className,
});

export const IconAWuseLogo: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
    <path d="M7.2 8.5 9.6 15.5 12 10.5 14.4 15.5 16.8 8.5" />
  </svg>
);

export const IconDisc: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export const IconLibrary: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 19V5a1 1 0 0 1 1-1h3v16H5a1 1 0 0 1-1-1Z" />
    <path d="M8 4h4v16H8" />
    <path d="m14 5 5 1.5-2.5 13-5-1.5Z" />
  </svg>
);

export const IconInbox: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
    <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconGrid: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
  </svg>
);

export const IconColumns: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <path d="M12 4v9" />
    <path d="M3.5 13h17" />
  </svg>
);

export const IconTable: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 9.5h17" />
    <path d="M3.5 14.5h17" />
    <path d="M9.5 9.5v10" />
  </svg>
);

export const IconFolderTree: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 5v14h4" />
    <path d="M4 10h4" />
    <rect x="8" y="8" width="12" height="4" rx="1" />
    <rect x="8" y="16" width="12" height="4" rx="1" />
  </svg>
);

export const IconLayers: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="m12 4 8 4.5-8 4.5-8-4.5Z" />
    <path d="m4 12.5 8 4.5 8-4.5" />
    <path d="m4 16.5 8 4.5 8-4.5" />
  </svg>
);

export const IconCodeTag: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="m8 8-4 4 4 4" />
    <path d="m16 8 4 4-4 4" />
    <path d="m13.5 6-3 12" />
  </svg>
);

export const IconLanguages: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 6h10" />
    <path d="M9 4v2" />
    <path d="M12 6c-.8 4-3.5 7.5-7 9.5" />
    <path d="M6.5 10c1.5 2 3.5 3.8 6 5" />
    <path d="m13 19 3.5-9 3.5 9" />
    <path d="M14.2 16h4.6" />
  </svg>
);

export const IconGlobe: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5a12.5 12.5 0 0 1 0 17 12.5 12.5 0 0 1 0-17Z" />
  </svg>
);

export const IconShieldCheck: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M12 3.5 5 6.5v5.5c0 4.2 3 7.5 7 8.5 4-1 7-4.3 7-8.5V6.5Z" />
    <path d="m9.2 12.2 2 2 3.8-4.2" />
  </svg>
);

export const IconUndo: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

export const IconSave: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z" />
    <path d="M8 4v5h7V4" />
    <rect x="8" y="14" width="8" height="6" />
  </svg>
);

export const IconPlay: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <polygon points="7 5 19 12 7 19 7 5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSunMoon: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2" />
    <path d="M12 19v2" />
    <path d="m4.9 4.9 1.4 1.4" />
    <path d="m17.7 17.7 1.4 1.4" />
    <path d="M3 12h2" />
    <path d="M19 12h2" />
  </svg>
);

export const IconAlert: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5" />
    <circle cx="12" cy="15.8" r="0.6" fill="currentColor" />
  </svg>
);

export const IconUpload: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </svg>
);

export const IconClose: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </svg>
);

export const IconTrash: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4.5 7h15" />
    <path d="M9.5 4h5a1 1 0 0 1 1 1v2h-7V5a1 1 0 0 1 1-1Z" />
    <path d="M6.5 7l.9 11.5a1.5 1.5 0 0 0 1.5 1.5h6.2a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
    <path d="M10 11v5" />
    <path d="M14 11v5" />
  </svg>
);

export const IconFolderPlus: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l1.8 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" />
    <path d="M12 11.5v5" />
    <path d="M9.5 14h5" />
  </svg>
);

export const IconFolder: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l1.8 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" />
  </svg>
);

export const IconRefresh: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M20 11a8 8 0 0 0-14.5-4.3L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 14.5 4.3L20 15.5" />
    <path d="M20 20v-4.5h-4.5" />
  </svg>
);

export const IconFilter: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 6h16" />
    <path d="M7 12h10" />
    <path d="M10 18h4" />
  </svg>
);

export const IconVinylRecord: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9.5" />
    <circle cx="12" cy="12" r="6.5" strokeOpacity="0.45" strokeWidth="1" />
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconEditRule: React.FC<IconProps> = ({ size, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 7h10" />
    <path d="M4 12h7" />
    <path d="M4 17h5" />
    <path d="m14.5 16.5 4.8-4.8a1.4 1.4 0 0 1 2 2l-4.8 4.8-2.6.6.6-2.6Z" />
  </svg>
);
