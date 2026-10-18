"use client";

import { useEffect, type ReactNode } from "react";
import { wakeApi } from "@/lib/api";
import { LogoMark } from "./Logo";
import { ThemeSwitch } from "./ThemeSwitch";

/** The sign-in card. Starts the API while the form is being filled in. */
export function AuthCard({ children }: { children: ReactNode }) {
  useEffect(() => {
    wakeApi().catch(() => {});
  }, []);
  return (
    <div className="auth">
      <div className="app-bg" aria-hidden />
      <header className="auth-top">
        <span className="logo">
          <LogoMark size={26} />
          <span className="logo-word">
            swift<span>pal</span>
          </span>
          <span className="admin-badge">Admin</span>
        </span>
      </header>
      <main className="auth-center">
        <div className="auth-card">{children}</div>
      </main>
      <footer className="auth-foot">
        <ThemeSwitch />
        <span>Restricted. Every action is recorded.</span>
      </footer>
    </div>
  );
}
