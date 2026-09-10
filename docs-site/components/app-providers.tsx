'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { i18n } from '@/lib/i18n';
import { OVERVIEW_SLUG } from '@/lib/source';

export function AppProviders({
  lang,
  slugsByLocale,
  children,
}: {
  lang: string;
  slugsByLocale: Record<string, string[]>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <RootProvider
      i18n={{
        ...i18n.provider(lang),
        onLocaleChange: (nextLocale) => {
          // pathname is `/{lang}/docs/{...slug}`; keep the slug only if it exists in the target locale
          const slug = pathname.split('/').filter(Boolean).slice(2).join('/');
          const available = slugsByLocale[nextLocale] ?? [];
          const target = available.includes(slug) ? slug : OVERVIEW_SLUG;
          router.push(`/${nextLocale}/docs/${target}`);
        },
      }}
    >
      {children}
    </RootProvider>
  );
}
