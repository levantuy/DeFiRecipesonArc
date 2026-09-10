import { redirect } from 'next/navigation';
import { OVERVIEW_SLUG } from '@/lib/source';

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/docs/${OVERVIEW_SLUG}`);
}
