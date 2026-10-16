import type { Metadata } from "next";
import { DashShell } from "@/components/dash/DashShell";
import "./dashboard.css";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashShell>{children}</DashShell>;
}
