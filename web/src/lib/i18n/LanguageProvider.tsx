'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { en } from './en';
import { vi } from './vi';
import type { DictKey, Dictionary } from './types';

export type Lang = 'en' | 'vi';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: DictKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const dictionaries: Record<Lang, Dictionary> = { en, vi };

export function LanguageProvider({ children, initialLang = 'en' }: { children: React.ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (nextLang: Lang) => {
    setLangState(nextLang);
    document.cookie = `NEXT_LOCALE=${nextLang}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.lang = nextLang;
  };

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    setLang,
    t: (key) => dictionaries[lang][key] ?? dictionaries.en[key],
  }), [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
