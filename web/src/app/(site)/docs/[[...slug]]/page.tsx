import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsNav, DocsMobileNav } from "../DocsNav";
import { DOCS } from "../content";

type Props = { params: Promise<{ slug?: string[] }> };

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug ? [d.slug] : [] }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = DOCS.find((d) => d.slug === (slug?.join("/") ?? ""));
  return doc ? { title: `${doc.title} — Docs`, description: doc.lede } : {};
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const key = slug?.join("/") ?? "";
  const i = DOCS.findIndex((d) => d.slug === key);
  if (i < 0) notFound();
  const doc = DOCS[i];
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  const items = DOCS.map(({ slug, title, group }) => ({ slug, title, group }));

  return (
    <div className="docs">
      <DocsNav items={items} />
      <article className="doc">
        <DocsMobileNav items={items} current={doc.slug} />
        <div className="eyebrow">{doc.group}</div>
        <h1 style={{ marginTop: 8 }}>{doc.title}</h1>
        <p className="doc-lede">{doc.lede}</p>
        {doc.body()}
        <nav className="doc-pager" aria-label="Pagination">
          {prev && (
            <Link href={`/docs/${prev.slug}`}>
              <span>← Previous</span>
              <b>{prev.title}</b>
            </Link>
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="next">
              <span>Next →</span>
              <b>{next.title}</b>
            </Link>
          )}
        </nav>
      </article>
    </div>
  );
}
