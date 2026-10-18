import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";

/** One centred card on paper and grain. `alt` sits under the card (e.g. "Have an account? Sign in"). */
export function AuthShell({ children, alt }: { children: ReactNode; alt?: ReactNode }) {
  return (
    <div className="auth">
      <div className="app-bg" aria-hidden />
      <header className="auth-top">
        <Logo />
      </header>
      <main className="auth-center">
        <div className="auth-card">{children}</div>
        {alt && <div className="auth-alt">{alt}</div>}
      </main>
      <footer className="auth-foot">
        <ThemeSwitch />
        <span>© {new Date().getFullYear()} SwiftPal</span>
      </footer>
    </div>
  );
}
