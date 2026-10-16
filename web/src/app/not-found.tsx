import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ display: "grid", gap: 16, justifyItems: "start", maxWidth: 420 }}>
        <Logo />
        <div className="code" style={{ width: "100%" }}>
          <pre>
            <code>
              <span className="w">404</span> <span className="s">not_found</span>
              {"\n"}
              <span className="c">{"// No page lives at this address."}</span>
            </code>
          </pre>
        </div>
        <div className="row">
          <Link href="/" className="btn btn-ink">Go home</Link>
          <Link href="/docs" className="btn btn-line">Read the docs</Link>
        </div>
      </div>
    </div>
  );
}
