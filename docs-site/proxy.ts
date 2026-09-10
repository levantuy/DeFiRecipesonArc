import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';
import { i18n } from '@/lib/i18n';

// adds/negotiates the `en`/`vi` locale prefix; legacy `/docs/...` URLs (no prefix)
// are redirected here too, falling back to `en` when no locale is negotiated
export default createI18nMiddleware(i18n);

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml).*)'],
};
