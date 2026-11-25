import { ArrowRightFromSquare, Database, FileText, Gear, LayoutCellsLarge, MapPin, Persons } from '@gravity-ui/icons';
import { ScrollShadow } from '@heroui/react';
import type { ReactElement } from 'react';
import { Button as AriaButton, Link as AriaLink } from 'react-aria-components';
import { NavLink, useLocation } from 'react-router';
import { Tip } from '@/components/common/Tip';
import { Logo } from '@/components/layout/Logo';
import { can } from '@/hooks/use-auth';
import type { Key } from '@/lib/i18n';
import { usePrefs } from '@/lib/prefs';
import type { Role, User } from '@/lib/types';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: Key; icon: typeof MapPin; roles?: Role[] };

const MAIN: NavItem[] = [
  { to: '/', label: 'nav.overview', icon: LayoutCellsLarge },
  { to: '/peta', label: 'nav.map', icon: MapPin },
  { to: '/data', label: 'nav.data', icon: Database },
];
const ADMIN: NavItem[] = [
  { to: '/pengguna', label: 'nav.users', icon: Persons, roles: ['superadmin'] },
  { to: '/log', label: 'nav.log', icon: FileText, roles: ['superadmin', 'editor'] },
];
const ACCOUNT: NavItem = { to: '/akun', label: 'nav.account', icon: Gear };
export const NAV = [...MAIN, ...ADMIN, ACCOUNT];

export const isActive = (to: string, path: string) => (to === '/' ? path === '/' : path.startsWith(to));

/**
 * Tautan menu: teks gelap 15px, ikon 20px; aktif = blok gradien bersudut 10px (sama dengan tombol), berjarak 12px dari tepi panel.
 * Mode ringkas: hanya ikon, kotak 48px bersudut 10px di tengah.
 */
const linkClass = (active: boolean, collapsed?: boolean) =>
  // Ikon sedikit membesar saat diarahkan (transform saja, durasi pendek).
  cn('flex items-center gap-3 text-[15px] leading-6 transition-colors [&>svg]:transition-transform [&>svg]:duration-200 hover:[&>svg]:scale-110',
    collapsed ? 'mx-auto size-12 justify-center rounded-control' : 'mx-3 rounded-control px-4 py-3',
    active ? (collapsed ? 'bg-[image:var(--nav-gradient)] text-white shadow-card' : 'nav-active font-medium') : 'text-nav-link hover:text-accent');

const Section = ({ label, collapsed }: { label: string; collapsed?: boolean }) =>
  collapsed
    ? <li aria-hidden className="mx-5 my-3 border-t border-separator" />
    : <li className="mt-4 mb-1 px-7 text-xs leading-8 font-medium text-nav-section">{label}</li>;

type Props = { user: User; onLogout: () => void; onNavigate?: () => void; showBrand?: boolean; collapsed?: boolean };

/** Sidebar kiri FreeDash: section, menu, pengaturan akun & keluar; `collapsed` = hanya ikon (80px). */
export function Sidebar({ user, onLogout, onNavigate, showBrand, collapsed }: Props) {
  const { t } = usePrefs();
  const { pathname } = useLocation();
  const admin = ADMIN.filter((n) => !n.roles || can(user, ...n.roles));

  // Mode ringkas (hanya ikon): nama menu lewat tooltip di kanan, gaya sama dengan tooltip mode gelap/terang di header.
  const tip = (label: string, el: ReactElement) => (collapsed ? <Tip label={label} side="right">{el}</Tip> : el);
  const item = ({ to, label, icon: Icon }: NavItem) => {
    const active = isActive(to, pathname);
    return (
      <li key={to}>
        {/* Link react-aria (bukan NavLink): Tooltip HeroUI butuh anak pressable; navigasi lewat RouterProvider di AppShell. */}
        {tip(t(label), (
          <AriaLink href={to} onPress={onNavigate} aria-label={t(label)} aria-current={active ? 'page' : undefined} className={linkClass(active, collapsed)}>
            <Icon className="size-5 shrink-0" aria-hidden />
            {!collapsed && <span className="break-words">{t(label)}</span>}
          </AriaLink>
        ))}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {showBrand && (
        <NavLink to="/" onClick={onNavigate} className="flex h-20 shrink-0 items-center gap-3 border-b border-border px-7">
          <Logo size={36} />
          <span className="min-w-0 leading-tight">
            <span className="block break-words text-sm font-medium text-heading">{t('app.name')}</span>
            <span className="block break-words text-xs text-muted">{t('app.region')}</span>
          </span>
        </NavLink>
      )}
      <ScrollShadow hideScrollBar className="min-h-0 flex-1 pt-2 pb-6">
        <nav aria-label={t('nav.main')}>
          <ul className="flex flex-col gap-1">
            <Section label={t('nav.sectionMain')} collapsed={collapsed} />
            {MAIN.map(item)}
            {admin.length > 0 && <Section label={t('nav.sectionAdmin')} collapsed={collapsed} />}
            {admin.map(item)}
            <Section label={t('nav.sectionAccount')} collapsed={collapsed} />
            {item(ACCOUNT)}
            <li>
              {tip(t('common.logout'), (
                <AriaButton onPress={onLogout} aria-label={t('common.logout')}
                  className={cn(linkClass(false, collapsed), !collapsed && 'w-[calc(100%-1.5rem)]', 'cursor-pointer hover:text-danger')}>
                  <ArrowRightFromSquare className="size-5 shrink-0" aria-hidden />
                  {!collapsed && t('common.logout')}
                </AriaButton>
              ))}
            </li>
          </ul>
        </nav>
      </ScrollShadow>
    </div>
  );
}
