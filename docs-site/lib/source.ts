import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';
import { i18n } from '@/lib/i18n';

// central page-tree loader consumed by the docs layout, page renderer and search API
export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  i18n,
});

// canonical page used as the "/" redirect target and as the locale-switch fallback
export const OVERVIEW_SLUG = 'contracts-overview';
