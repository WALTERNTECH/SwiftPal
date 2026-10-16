// A small, consistent icon set: 20px grid, 1.6 stroke, round caps.
const PATHS = {
  home: "M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1z",
  collect: "M10 3v10m0 0-4-4m4 4 4-4M4 16.5h12",
  payout: "M10 17V7m0 0-4 4m4-4 4 4M4 3.5h12",
  wallet: "M3.5 6.5a2 2 0 0 1 2-2h9v3M3.5 6.5v8a2 2 0 0 0 2 2h11v-9h-13zM13 12h.01",
  channel: "M4 4.5h12v4H4zM4 11.5h12v4H4zM7 6.5h.01M7 13.5h.01",
  key: "M12.5 3.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM9.7 10.3 3.5 16.5m2-2 2 2m-.5-4.5 2 2",
  webhook: "M8 7.5a3 3 0 1 1 4.5 2.6L15 14.5M6 13.5a3 3 0 1 0 2.9 3.6h5.6M14 17a3 3 0 1 0-1-5.8L10 6",
  logs: "M5 4.5h10M5 8.5h10M5 12.5h6M5 16.5h4",
  settings: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 10l1.5-1-1.2-2.6-1.8.3-1.2-1.2.3-1.8L11 2.5 10 4 9 2.5 6.4 3.7l.3 1.8-1.2 1.2-1.8-.3L2.5 9 4 10l-1.5 1 1.2 2.6 1.8-.3 1.2 1.2-.3 1.8L9 17.5l1-1.5 1 1.5 2.6-1.2-.3-1.8 1.2-1.2 1.8.3 1.2-2.6z",
  team: "M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 16.5a5 5 0 0 1 10 0M13 4a3 3 0 0 1 0 5.5M17.5 16.5a5 5 0 0 0-3-4.6",
  shield: "M10 2.5 4 5v4.5c0 3.8 2.5 6.6 6 8 3.5-1.4 6-4.2 6-8V5zM7.5 10l2 2 3.5-3.5",
  check: "M4.5 10.5 8 14l7.5-8",
  x: "M5 5l10 10M15 5 5 15",
  plus: "M10 4v12M4 10h12",
  arrowRight: "M4 10h12m0 0-5-5m5 5-5 5",
  arrowLeft: "M16 10H4m0 0 5-5m-5 5 5 5",
  arrowUpRight: "M6 14 14 6m0 0H7m7 0v7",
  chevronDown: "M5.5 8 10 12.5 14.5 8",
  chevronRight: "M8 5.5 12.5 10 8 14.5",
  copy: "M7 7V4.5a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H13M4.5 7H12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
  eye: "M2.5 10S5 4.5 10 4.5 17.5 10 17.5 10 15 15.5 10 15.5 2.5 10 2.5 10zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  eyeOff: "M3 3l14 14M8.6 8.6a2 2 0 0 0 2.8 2.8M6 6.2C3.8 7.6 2.5 10 2.5 10S5 15.5 10 15.5c1.5 0 2.8-.5 3.9-1.2M9 4.6c.3 0 .7-.1 1-.1 5 0 7.5 5.5 7.5 5.5s-.6 1.3-1.8 2.7",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.8-3.8",
  filter: "M3.5 5h13M6 10h8M8.5 15h3",
  download: "M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5M4 16.5h12",
  upload: "M10 12.5v-9m0 0L6.5 7M10 3.5 13.5 7M4 16.5h12",
  info: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 9.5v4M10 6.5h.01",
  alert: "M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.5h.01",
  phone: "M6.5 2.5h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM9 15h2",
  bolt: "M11 2.5 4.5 11H10l-1 6.5L15.5 9H10z",
  book: "M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16",
  code: "M7 6 3 10l4 4M13 6l4 4-4 4",
  refresh: "M16 10a6 6 0 1 1-1.8-4.3M16 3.5V7h-3.5",
  logout: "M8 4H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1H8M12.5 13.5 16 10l-3.5-3.5M16 10H8",
  clock: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 6v4l2.5 2",
  building: "M4 17V4.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V17M12 8h3a1 1 0 0 1 1 1v8M3 17h14M7 7h2M7 10h2M7 13h2",
  user: "M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 17.5a6.5 6.5 0 0 1 13 0",
  bell: "M5 8a5 5 0 0 1 10 0c0 5 2 6 2 6H3s2-1 2-6M8.5 17a1.5 1.5 0 0 0 3 0",
  lock: "M5.5 9h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM7 9V6.5a3 3 0 0 1 6 0V9",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  play: "M6.5 4.5v11l9-5.5z",
  sandbox: "M3 7.5 10 3.5l7 4-7 4zM3 7.5v5l7 4 7-4v-5M10 11.5v5",
  menu: "M3.5 6h13M3.5 10h13M3.5 14h13",
  external: "M11 3.5h5.5V9M16.5 3.5 9 11M14 12v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8",
  receipt: "M5 2.5h10v15l-2-1.3-1.7 1.3-1.3-1.3-1.3 1.3L7 16.2l-2 1.3zM7.5 6.5h5M7.5 9.5h5M7.5 12.5h3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
