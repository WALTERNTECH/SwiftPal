"use client";

import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "swiftpal-theme";

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=d?'dark':'light';r.dataset.themePref=p;}catch(e){document.documentElement.dataset.theme='light';}})();`;

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themePref = pref;
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    setPref((document.documentElement.dataset.themePref as ThemePref) || "system");
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);

  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    apply(p);
    setPref(p);
  };
  return [pref, set];
}

const ICONS: Record<ThemePref, string> = {
  system: "M3 4.5h14v9H3zM7 16.5h6M10 13.5v3",
  light: "M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1",
  dark: "M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z",
};

export function ThemeSwitch({ label = true }: { label?: boolean }) {
  const [pref, setPref] = useThemePref();
  return (
    <div className="theme-switch">
      {label && <span className="eyebrow">Theme</span>}
      <div className="segmented" role="group" aria-label="Theme">
        {(["system", "light", "dark"] as ThemePref[]).map((p) => (
          <button key={p} type="button" aria-pressed={pref === p} aria-label={`${p[0].toUpperCase()}${p.slice(1)} theme`} title={`${p[0].toUpperCase()}${p.slice(1)}`} onClick={() => setPref(p)}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ICONS[p]} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
