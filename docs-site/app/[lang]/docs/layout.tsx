import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';

const navTitles: Record<string, string> = {
  en: 'DeFi Recipes on Arc',
  vi: 'DeFi Recipes on Arc',
};

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;

  return (
    <DocsLayout
      tree={source.pageTree[lang]}
      nav={{
        title: navTitles[lang] ?? navTitles.en,
        url: 'https://www.defirecipes.com/',
      }}
      sidebar={{
        collapsible: true,
      }}
    >
      {children}
    </DocsLayout>
  );
}
