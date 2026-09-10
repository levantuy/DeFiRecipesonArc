import '../global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppProviders } from '@/components/app-providers';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

const titles: Record<string, string> = {
  en: 'DeFi Recipes on Arc — Documentation',
  vi: 'DeFi Recipes on Arc — Tài liệu',
};

const descriptions: Record<string, string> = {
  en: 'Technical documentation for the DeFi Recipes on Arc project: smart contract architecture, development workflow, and operations.',
  vi: 'Tài liệu kỹ thuật của dự án DeFi Recipes on Arc: kiến trúc smart contract, quy trình phát triển và vận hành.',
};

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return {
    title: {
      default: titles[lang] ?? titles[i18n.defaultLanguage],
      template: '%s | DeFi Recipes on Arc',
    },
    description: descriptions[lang] ?? descriptions[i18n.defaultLanguage],
  };
}

export default async function RootLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;
  if (!(i18n.languages as string[]).includes(lang)) notFound();

  const slugsByLocale = Object.fromEntries(
    i18n.languages.map((locale) => [
      locale,
      source.getPages(locale).map((page) => page.slugs.join('/')),
    ]),
  );

  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <AppProviders lang={lang} slugsByLocale={slugsByLocale}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
