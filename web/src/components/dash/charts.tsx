"use client";

import { useEffect, useId, useRef, useState } from "react";
import { money, num } from "@/lib/format";

/** Animates a number from its previous value to the new one. */
export function CountUp({ value, format = (n: number) => num(Math.round(n)), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(shown)}</>;
}

export const kes = (n: number) => `KES ${num(Math.round(n))}`;
export const shortKes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Tiny trend line for stat cards. */
export function Sparkline({ values, blue }: { values: number[]; blue?: boolean }) {
  const w = 84;
  const h = 26;
  // Until analytics load there are no points; draw a flat baseline rather than an empty path.
  if (values.length < 2) values = [0, 0];
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className={`spark ${blue ? "blue" : ""}`} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path className="a" d={`${line} L${w},${h} L0,${h} Z`} />
      <path className="l" d={line} pathLength={1} />
    </svg>
  );
}

export type Series = { key: string; label: string; cls: "s1" | "s2"; values: number[] };

/**
 * Area/line chart over days. One y-axis in KES for every series, a crosshair
 * tooltip listing each series, and a legend whenever there is more than one.
 */
export function AreaChart({
  labels,
  series,
  height = 240,
  yFormat = shortKes,
  valueFormat = money,
  fixedMax,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  yFormat?: (n: number) => string;
  valueFormat?: (n: number) => string;
  fixedMax?: number;
}) {
  const W = 720;
  const H = height;
  const P = { top: 14, right: 12, bottom: 26, left: 50 };
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const max = fixedMax ?? niceMax(Math.max(...series.flatMap((s) => s.values), 1));
  const iw = W - P.left - P.right;
  const ih = H - P.top - P.bottom;
  const x = (i: number) => P.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => P.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const step = n > 20 ? 5 : n > 10 ? 2 : 1;

  // Monotone-ish smoothing with a light cubic curve.
  const path = (vals: number[]) =>
    vals
      .map((v, i) => {
        const px = x(i);
        const py = y(v);
        if (i === 0) return `M${px},${py}`;
        const cx = (x(i - 1) + px) / 2;
        return `C${cx},${y(vals[i - 1])} ${cx},${py} ${px},${py}`;
      })
      .join(" ");

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(" and ") + " per day"} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`areaFill${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--series-1)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--series-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="grid">
          {ticks.map((t, i) => (
            <line key={t} className={i === 0 ? "base" : ""} x1={P.left} x2={W - P.right} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={P.left - 10} y={y(t) + 3.5} textAnchor="end">
              {yFormat(t)}
            </text>
          ))}
          {labels.map((l, i) =>
            (n - 1 - i) % step === 0 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                {i === n - 1 ? "Today" : l}
              </text>
            ) : null,
          )}
        </g>
        {series[0] && <path d={`${path(series[0].values)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#areaFill${id})`} className="area" style={{ fill: `url(#areaFill${id})` }} />}
        {series.map((s) => (
          <path key={s.key} className={`line ${s.cls}`} d={path(s.values)} pathLength={1} />
        ))}
        {hover !== null && (
          <>
            <line className="xhair" x1={x(hover)} x2={x(hover)} y1={P.top} y2={P.top + ih} />
            {series.map((s) => (
              <circle key={s.key} className={`dot ${s.cls}`} cx={x(hover)} cy={y(s.values[hover])} r={4.5} />
            ))}
          </>
        )}
        {labels.map((_, i) => (
          <rect
            key={i}
            className="hit"
            x={x(i) - iw / Math.max(1, n - 1) / 2}
            y={P.top}
            width={iw / Math.max(1, n - 1)}
            height={ih}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(Math.min(...series.map((s) => y(s.values[hover]))) / H) * 100}%`, marginTop: -10 }}>
          <span className="t">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.key} className="r">
              <i className={`swatch ${s.cls}`} />
              {s.label}
              <b>{valueFormat(s.values[hover])}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Vertical bars over a categorical axis (e.g. hours). Single series, so no legend. */
export function BarChart({ labels, values, format, height = 200, highlight }: { labels: string[]; values: number[]; format: (n: number) => string; height?: number; highlight?: number }) {
  const W = 720;
  const H = height;
  const P = { top: 12, right: 8, bottom: 24, left: 40 };
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const max = niceMax(Math.max(...values, 1));
  const iw = W - P.left - P.right;
  const ih = H - P.top - P.bottom;
  const slot = iw / n;
  const bw = Math.max(4, Math.min(22, slot - 4));
  const y = (v: number) => P.top + ih - (v / max) * ih;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart" onMouseLeave={() => setHover(null)}>
        <g className="grid">
          {[0, max / 2, max].map((t, i) => (
            <line key={t} className={i === 0 ? "base" : ""} x1={P.left} x2={W - P.right} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {[0, max / 2, max].map((t) => (
            <text key={t} x={P.left - 8} y={y(t) + 3.5} textAnchor="end">
              {Math.round(t)}
            </text>
          ))}
          {labels.map((l, i) =>
            i % (n > 12 ? 3 : 1) === 0 ? (
              <text key={i} x={P.left + slot * i + slot / 2} y={H - 6} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
        </g>
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
          const bx = P.left + slot * i + (slot - bw) / 2;
          const top = P.top + ih - h;
          const r = Math.min(4, h);
          const d = h > 0 ? `M${bx},${P.top + ih} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${P.top + ih} Z` : "";
          return (
            <g key={i}>
              {d && (
                <path
                  d={d}
                  className={`bar bar-grow ${(hover !== null && hover !== i) || (hover === null && highlight !== undefined && highlight !== i) ? "dim" : ""}`}
                  style={{ ["--d" as string]: `${i * 18}ms` }}
                />
              )}
              <rect className="hit" x={P.left + slot * i} y={P.top} width={slot} height={ih} onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((P.left + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(values[hover]) / H) * 100}%`, marginTop: -10 }}>
          <span className="t">{labels[hover]}</span>
          <span className="r">
            <b style={{ marginLeft: 0, paddingLeft: 0 }}>{format(values[hover])}</b>
          </span>
        </div>
      )}
    </div>
  );
}

export function SuccessRing({ rate, label = "success rate" }: { rate: number | null; label?: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(rate ?? 0), 80);
    return () => clearTimeout(t);
  }, [rate]);
  return (
    <div className="ring-chart">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
        <circle className="track" cx="66" cy="66" r={r} fill="none" strokeWidth="10" />
        <circle className="val" cx="66" cy="66" r={r} fill="none" strokeWidth="10" strokeDasharray={c} strokeDashoffset={c * (1 - shown)} />
      </svg>
      <div className="lbl">
        <b>{rate === null ? "—" : <CountUp value={rate * 100} format={(n) => `${Math.round(n)}%`} />}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="delta flat">new</span>;
  const pct = Math.round(value * 1000) / 10;
  const good = invert ? pct < 0 : pct > 0;
  const cls = pct === 0 ? "flat" : good ? "up" : "down";
  return (
    <span className={`delta ${cls}`}>
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
