"use client";

import { useMemo, useState } from "react";
import { money, num } from "@/lib/format";
import type { Payment } from "@/lib/store";

const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 48 };

function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Successful collections per day, last 14 days. One series, so no legend; the panel title names it. */
export function VolumeChart({ payments }: { payments: Payment[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo(() => {
    const out: { label: string; date: Date; total: number; count: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      out.push({ label: d.toLocaleDateString("en-KE", { day: "numeric", month: "short" }), date: d, total: 0, count: 0 });
    }
    for (const p of payments) {
      if (p.status !== "succeeded") continue;
      const t = new Date(p.createdAt);
      t.setHours(0, 0, 0, 0);
      const slot = out.find((d) => d.date.getTime() === t.getTime());
      if (slot) {
        slot.total += p.amount;
        slot.count++;
      }
    }
    return out;
  }, [payments]);

  const max = niceMax(Math.max(...days.map((d) => d.total)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / days.length;
  const bw = Math.min(22, slot - 6);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];

  return (
    <div className="chart" style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Collected per day over the last 14 days">
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end">
              {short(t)}
            </text>
          ))}
          {days.map((d, i) =>
            i % 2 === 1 || i === days.length - 1 ? (
              <text key={i} x={PAD.left + slot * i + slot / 2} y={H - 8} textAnchor="middle">
                {i === days.length - 1 ? "Today" : d.label}
              </text>
            ) : null,
          )}
        </g>
        {days.map((d, i) => {
          const h = Math.max(d.total > 0 ? 2 : 0, (d.total / max) * ih);
          const x = PAD.left + slot * i + (slot - bw) / 2;
          const top = PAD.top + ih - h;
          const r = Math.min(4, h);
          // Rounded data-end, square at the baseline.
          const path =
            h > 0
              ? `M${x},${PAD.top + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${PAD.top + ih} Z`
              : "";
          return (
            <g key={i}>
              {path && <path d={path} className={`bar ${hover !== null && hover !== i ? "dim" : ""}`} />}
              <rect
                className="hit"
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={ih}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%`,
            top: `${(y(days[hover].total) / H) * 100}%`,
            marginTop: -8,
          }}
        >
          <span>{days[hover].label}</span> · <b>{money(days[hover].total)}</b> · <span>{num(days[hover].count)} paid</span>
        </div>
      )}
    </div>
  );
}
