"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { maskPhone, money } from "@/lib/format";
import { useMode, usePayments } from "@/lib/api";
import { useActions, type Action } from "./actions";
import { ALL_ITEMS } from "./nav";

type Row = { id: string; group: string; label: string; hint?: string; icon: IconName; run: () => void; keywords?: string };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const mode = useMode();
  const { data: payments } = usePayments(mode);
  const { open: openAction, showPayment } = useActions();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const act = (a: Action) => () => openAction(a);
    const all: Row[] = [
      { id: "a-pay", group: "Actions", label: "Request payment", icon: "collect", run: act("payment"), keywords: "stk new charge" },
      { id: "a-po", group: "Actions", label: "Send payout", icon: "payout", run: act("payout"), keywords: "b2c disburse" },
      { id: "a-tf", group: "Actions", label: "Top up fee credit", icon: "plus", run: act("topup-fee"), keywords: "fund wallet" },
      { id: "a-tp", group: "Actions", label: "Top up payout float", icon: "plus", run: act("topup-float"), keywords: "fund wallet" },
      { id: "a-ch", group: "Actions", label: "Add Till or Paybill", icon: "channel", run: act("channel"), keywords: "channel shortcode" },
      { id: "a-key", group: "Actions", label: "Create API key", icon: "key", run: act("key"), keywords: "secret" },
      ...ALL_ITEMS.map((i) => ({
        id: i.href,
        group: "Go to",
        label: i.label,
        hint: i.group === "General" ? undefined : i.group,
        icon: i.icon,
        run: () => router.push(i.href),
        keywords: i.keywords,
      })),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    const match = all.filter((r) => `${r.label} ${r.keywords ?? ""} ${r.hint ?? ""}`.toLowerCase().includes(needle));
    const found = (payments ?? [])
      .filter((p) => [p.reference, p.phone, p.mpesa_receipt ?? "", p.id].some((v) => v.toLowerCase().includes(needle)))
      .slice(0, 6)
      .map<Row>((p) => ({
        id: p.id,
        group: "Payments",
        label: `${money(p.amount)} · ${p.reference}`,
        hint: `${maskPhone(p.phone)} · ${p.status}`,
        icon: "receipt",
        run: () => showPayment(p.id),
      }));
    return [...match, ...found];
  }, [q, mode, payments, openAction, showPayment, router]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const run = (r?: Row) => {
    if (!r) return;
    onClose();
    r.run();
  };

  let lastGroup = "";
  return (
    <div className="overlay cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmdk-input">
          <Icon name="search" size={16} />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, actions, payments…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(rows[sel]);
              } else if (e.key === "Escape") onClose();
            }}
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" ref={list} role="listbox">
          {rows.length === 0 && <div className="cmdk-empty">No matches for “{q}”.</div>}
          {rows.map((r, i) => {
            const head = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <div key={r.id}>
                {head && <div className="cmdk-group">{r.group}</div>}
                <button
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  className="cmdk-row"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(r)}
                >
                  <span className="cmdk-ic"><Icon name={r.icon} size={15} /></span>
                  <span className="grow">{r.label}</span>
                  {r.hint && <span className="cmdk-hint">{r.hint}</span>}
                  {i === sel && <Icon name="arrowRight" size={13} className="dim" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
