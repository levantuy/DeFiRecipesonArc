import { source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { i18n } from '@/lib/i18n';

export default async function Page(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const currentPath = `/${lang}/docs/${(slug ?? []).join('/')}`;
  const languages: Record<string, string> = { [lang]: currentPath };
  for (const otherLang of i18n.languages) {
    if (otherLang === lang) continue;
    const otherPage = source.getPage(slug, otherLang);
    if (otherPage) languages[otherLang] = otherPage.url;
  }

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: currentPath,
      languages,
    },
  };
}
