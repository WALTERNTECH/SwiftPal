import Link from "next/link";

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#0d6b4e" />
      <path
        d="M17.5 7.25H10.25a2.75 2.75 0 0 0 0 5.5h3.5a2.75 2.75 0 0 1 0 5.5H6.5"
        stroke="#fff"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="17.5" cy="7.25" r="1.6" fill="#c9ecd9" />
    </svg>
  );
}

export function Logo({ href = "/", size = 24, label = true }: { href?: string; size?: number; label?: boolean }) {
  return (
    <Link href={href} className="logo" aria-label="SwiftPal home">
      <LogoMark size={size} />
      {label && <span className="logo-word">swiftpal</span>}
    </Link>
  );
}
