import { Moon, Sun } from '@gravity-ui/icons';
import { Button } from '@heroui/react';
import { AnimatePresence, m } from 'motion/react';
import { Segmented } from '@/components/common/motion';
import { Tip } from '@/components/common/Tip';
import { usePrefs } from '@/lib/prefs';
import { cn } from '@/lib/utils';

/** Toggle bahasa + tema; dipakai juga di halaman login. */
export function PrefControls({ className }: { className?: string }) {
  const { lang, setLang, theme, setTheme, t } = usePrefs();
  const dark = theme === 'dark';
  const label = dark ? t('common.themeLight') : t('common.themeDark');
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Segmented id="lang" label={t('common.language')} value={lang} onChange={setLang} 
        options={[{ value: 'id', label: 'ID', tip: t('common.langId') }, { value: 'en', label: 'EN', tip: t('common.langEn') }]} />
      <Tip label={label}>
        <Button isIconOnly variant="ghost" onPress={() => setTheme(dark ? 'light' : 'dark')} aria-label={label} className="text-muted hover:text-accent">
          <AnimatePresence mode="wait" initial={false}>
            <m.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </m.span>
          </AnimatePresence>
        </Button>
      </Tip>
    </div>
  );
}
