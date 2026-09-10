import { defineI18nUI } from 'fumadocs-ui/i18n';

// shared i18n config consumed by the middleware, the source loader and the RootProvider;
// `displayName` is kept in English to match the project's UI-text convention
export const i18n = defineI18nUI(
  {
    languages: ['en', 'vi'],
    defaultLanguage: 'en',
    parser: 'dir',
  },
  {
    en: { displayName: 'English' },
    vi: { displayName: 'Vietnamese' },
  },
);
