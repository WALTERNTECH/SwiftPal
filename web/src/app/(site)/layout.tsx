import { RevealObserver } from "@/components/motion";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="frame">
      <noscript>
        <style>{`.reveal{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}
