import type { MetadataRoute } from 'next';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

const baseUrl = 'https://docs.defirecipes.com';

// indexes every localized doc page so both `en` and `vi` are discoverable
export default function sitemap(): MetadataRoute.Sitemap {
  return i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      url: `${baseUrl}${page.url}`,
    })),
  );
}
