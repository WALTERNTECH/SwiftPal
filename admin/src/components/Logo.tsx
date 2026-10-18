"use client";

import Link from "next/link";
import { useId } from "react";

/** The mark: an S drawn as one stroke inside a green tile. It draws itself on load and again on hover. */
export function LogoMark({ size = 26 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 24 24">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1ad68e" />
            <stop offset="1" stopColor="#057a47" />
          </linearGradient>
          <linearGradient id={`h${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6.5" fill={`url(#g${id})`} />
        <rect width="24" height="24" rx="6.5" fill={`url(#h${id})`} />
        <path
          className="logo-s"
          pathLength={1}
          d="M17.5 7.25H10.25a2.75 2.75 0 0 0 0 5.5h3.5a2.75 2.75 0 0 1 0 5.5H6.5"
          stroke="#fff"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
        <circle className="logo-dot" cx="17.5" cy="7.25" r="1.7" fill="#d6ffe9" />
      </svg>
      <span className="logo-shine" />
    </span>
  );
}

export function Logo({ href = "/", size = 26, label = true }: { href?: string; size?: number; label?: boolean }) {
  return (
    <Link href={href} className="logo" aria-label="SwiftPal home">
      <LogoMark size={size} />
      {label && (
        <span className="logo-word">
          swift<span>pal</span>
        </span>
      )}
    </Link>
  );
}
