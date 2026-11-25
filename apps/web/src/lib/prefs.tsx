import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setLocale } from './format';
import { DICT, type Key, type Lang } from './i18n';

export type Theme = 'light' | 'dark';
type Vars = Record<string, string | number>;

type Prefs = {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  t: (key: Key, vars?: Vars) => string;
};

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ponytail: mode privat tanpa storage, preferensi hanya untuk sesi ini.
  }
};

const Ctx = createContext<Prefs | null>(null);

/** Bahasa (id/en) dan tema (terang/gelap), disimpan di localStorage. */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (read('lang') === 'en' ? 'en' : 'id'));
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = read('theme');
    return saved === 'dark' || saved === 'light' ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  setLocale(lang === 'en' ? 'en-GB' : 'id-ID');

  useEffect(() => {
    // Kelas eksplisit 'light' juga dipasang: mapcn jatuh ke preferensi sistem bila 'dark' hilang begitu saja.
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    write('lang', l);
    setLangState(l);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    write('theme', t);
    setThemeState(t);
  }, []);

  const value = useMemo<Prefs>(() => {
    const dict = DICT[lang];
    const t = (key: Key, vars?: Vars) => dict[key].replace(/\{(\w+)\}/g, (_, v: string) => String(vars?.[v] ?? `{${v}}`));
    return { lang, setLang, theme, setTheme, t };
  }, [lang, theme, setLang, setTheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePrefs = (): Prefs => useContext(Ctx)!;
export const useT = () => usePrefs().t;
