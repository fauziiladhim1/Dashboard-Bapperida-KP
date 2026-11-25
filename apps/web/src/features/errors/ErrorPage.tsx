import { ArrowLeft, ArrowRotateLeft } from '@gravity-ui/icons';
import { Button, buttonVariants } from '@heroui/react';
import { m } from 'motion/react';
import { Link } from 'react-router';
import { EASE } from '@/components/common/motion';
import { useT } from '@/lib/prefs';
import { cn } from '@/lib/utils';

export type ErrorCode = 404 | 403 | 500;

const LOOP = { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } as const;

/** Peta lipat dengan rute putus-putus dan pin yang tersesat (404), terkunci (403), atau patah (500). */
function LostMap({ code }: { code: ErrorCode }) {
  const panels = ['M20 60 L100 40 L100 170 L20 190 Z', 'M100 40 L180 60 L180 190 L100 170 Z', 'M180 60 L260 40 L260 170 L180 190 Z'];
  return (
    <svg viewBox="0 0 280 230" className="h-auto w-full max-w-[320px]" aria-hidden>
      {panels.map((d, i) => (
        <m.path key={d} d={d} fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: i * 0.08 }} />
      ))}
      {/* Garis kontur samar di tiap panel. */}
      <g stroke="var(--muted)" strokeOpacity="0.18" fill="none" strokeWidth="1.2">
        <path d="M30 100 Q60 85 95 95" /><path d="M30 130 Q65 115 95 125" />
        <path d="M110 90 Q140 105 172 98" /><path d="M110 140 Q140 125 172 135" />
        <path d="M188 105 Q220 90 252 100" /><path d="M188 145 Q220 130 252 140" />
      </g>
      <m.path d="M40 165 C80 150 90 110 130 120 S190 160 215 115" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: EASE, delay: 0.3 }} />
      <circle cx="40" cy="165" r="5" fill="var(--foreground)" />

      {/* Bayangan pin mengecil saat pin naik. */}
      <m.ellipse cx="215" cy="118" rx="14" ry="4" fill="var(--foreground)" fillOpacity="0.15"
        animate={code === 500 ? undefined : { scaleX: [1, 0.7, 1] }} transition={LOOP} style={{ transformOrigin: '215px 118px' }} />
      <m.g
        initial={{ y: -40, opacity: 0 }}
        animate={code === 500 ? { y: 0, opacity: 1, rotate: 28 } : { y: [0, -10, 0], opacity: 1, rotate: code === 404 ? [-6, 6, -6] : 0 }}
        transition={code === 500 ? { type: 'spring', stiffness: 260, damping: 12, delay: 0.9 } : { ...LOOP, opacity: { duration: 0.3, delay: 0.9 } }}
        style={{ transformOrigin: '215px 115px' }}
      >
        <path d="M215 115 C200 92 192 82 192 68 a23 23 0 0 1 46 0 c0 14 -8 24 -23 47 Z" fill="var(--accent)" />
        <circle cx="215" cy="68" r="11" fill="var(--surface)" />
        {code === 404 && <text x="215" y="73" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--accent)">?</text>}
        {code === 403 && (
          <g fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round">
            <rect x="209" y="66" width="12" height="9" rx="2" fill="var(--accent)" stroke="none" />
            <path d="M211 66 v-3 a4 4 0 0 1 8 0 v3" />
          </g>
        )}
        {code === 500 && <path d="M209 62 l12 12 M221 62 l-12 12" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />}
      </m.g>
    </svg>
  );
}

export function ErrorPage({ code, onRetry }: { code: ErrorCode; onRetry?: () => void }) {
  const t = useT();
  return (
    <section className="grid min-h-[70dvh] place-items-center px-4 py-10 text-center">
      <div className="flex max-w-md flex-col items-center gap-6">
        <LostMap code={code} />
        <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.2 }} className="flex flex-col items-center gap-2">
          <p className="text-7xl leading-none font-medium tracking-tight text-accent">{code}</p>
          <h1 className="mt-2 text-xl leading-tight font-medium">{t(`err.${code}.title`)}</h1>
          <p className="text-sm text-muted">{t(`err.${code}.desc`)}</p>
        </m.div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/" onClick={onRetry} className={cn(buttonVariants(), 'group')}>
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" /> {t('err.home')}
          </Link>
          {onRetry && (
            <Button variant="secondary" onPress={onRetry} className="group">
              <ArrowRotateLeft className="size-4 transition-transform duration-500 group-hover:-rotate-180" /> {t('err.retry')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
