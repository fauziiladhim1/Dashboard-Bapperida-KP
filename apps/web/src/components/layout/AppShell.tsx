import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightFromSquare, Bars, ChevronDown, ChevronLeft, ChevronRight, Gear } from '@gravity-ui/icons';
import { Avatar, Button, Drawer, Dropdown, Label } from '@heroui/react';
import { RouterProvider } from 'react-aria-components';
import { AnimatePresence, m } from 'motion/react';
import { Suspense, useState } from 'react';
import { NavLink, useHref, useLocation, useNavigate, useOutlet } from 'react-router';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Loading } from '@/components/common/Loading';
import { PageHeader } from '@/components/common/PageHeader';
import { Logo } from '@/components/layout/Logo';
import { EASE } from '@/components/common/motion';
import { AlertBell } from '@/components/layout/AlertBell';
import { Tip } from '@/components/common/Tip';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { PrefControls } from '@/components/layout/PrefControls';
import { isActive, NAV, Sidebar } from '@/components/layout/Sidebar';
import { endpoints } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AppShell({ user }: { user: User }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const { t } = usePrefs();
  const [menuOpen, setMenuOpen] = useState(false);
  // Sidebar desktop bisa diperkecil jadi ikon saja; pilihan diingat per peramban.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar') === 'collapsed'; } catch { return false; } });
  const toggleSidebar = () => setCollapsed((c) => {
    try { localStorage.setItem('sidebar', c ? 'expanded' : 'collapsed'); } catch { /* penyimpanan diblokir: tetap jalan tanpa ingatan */ }
    return !c;
  });

  // Halaman peta memakai seluruh lebar & tinggi layar di bawah header.
  const fullBleed = pathname.startsWith('/peta');
  // Ringkasan punya header salam sendiri; halaman lain memakai judul dari menu.
  const title = pathname === '/' ? undefined : NAV.find((n) => isActive(n.to, pathname))?.label;
  const initials =user.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  const logout = async () => {
    // Jaringan putus saat keluar: tetap bersihkan sesi lokal; cookie habis sendiri (8 jam) atau ditimpa login berikutnya.
    await endpoints.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(['me'], null);
    navigate('/login');
  };

  return (
    <RouterProvider navigate={(to) => navigate(to)} useHref={useHref}>
    <div className="min-h-dvh bg-background">
      {/* Topbar FreeDash: 80px, transparan, garis bawah tipis; area brand selebar sidebar dengan bayangan. */}
      <header className="app-header sticky top-0 z-30 flex h-20 items-center border-b border-border bg-background/95 backdrop-blur-sm">
        {/* Brand selebar sidebar + jarak 12px; tanpa latar agar tak menempel pada panel sidebar yang melayang. */}
        <NavLink to="/" className={cn('hidden h-full shrink-0 items-center gap-3 overflow-hidden pl-3 transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[92px] justify-center' : 'w-[272px] pl-9')}>
          <Logo size={38} />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block break-words text-sm font-medium text-heading">{t('app.name')}</span>
              <span className="block break-words text-xs text-muted">{t('app.region')}</span>
            </span>
          )}
        </NavLink>
        {/* min-w-0: kotak cari boleh menyempit di tablet, tidak mendorong menu akun keluar layar. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 sm:px-6">
          <Button isIconOnly variant="ghost" onPress={() => setMenuOpen(true)} aria-label={t('nav.openMenu')} className="lg:hidden">
            <Bars className="size-5" />
          </Button>
          <PrefControls />
          {/* ponytail: di layar <640px kotak cari disembunyikan; tambahkan tombol ikon bila perlu cari dari HP. */}
          <GlobalSearch className="hidden max-w-[42rem] sm:flex" />
          {/* Lonceng peringatan tindak lanjut (ml-auto: lonceng + menu akun di ujung kanan). */}
          <AlertBell />
          {/* Menu akun: avatar + nama membuka pengaturan akun dan keluar. */}
          <Dropdown>
            <Tip label={t('nav.userMenuTip')}>
            <Button variant="ghost" aria-label={t('nav.userMenu')} className="gap-3 px-2 text-left">
              <Avatar size="sm" color="accent">
                <Avatar.Fallback className="text-xs font-medium">{initials}</Avatar.Fallback>
              </Avatar>
              <span className="hidden leading-tight sm:block">
                <span className="block max-w-56 break-words text-sm font-medium text-heading">{user.name}</span>
                <span className="block text-xs text-muted">{t(`role.${user.role}`)}</span>
              </span>
              <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden />
            </Button>
            </Tip>
            <Dropdown.Popover placement="bottom end" className="min-w-56">
              <Dropdown.Menu aria-label={t('nav.userMenu')} onAction={(k) => (k === 'logout' ? logout() : navigate('/akun'))}>
                <Dropdown.Item id="account" textValue={t('nav.account')}>
                  <Gear className="size-4 text-muted" /><Label>{t('nav.account')}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="logout" textValue={t('common.logout')} variant="danger">
                  <ArrowRightFromSquare className="size-4" /><Label>{t('common.logout')}</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>

      {/* Sidebar melayang: 12px dari header, tepi kiri & bawah; sudut 20px seperti kartu dasbor.
          Bayangan sama dengan panel layer peta (shadow-float) agar terpisah jelas dari peta di belakangnya; tema gelap ditambah garis tepi tipis. */}
      <aside className={cn('fixed top-[92px] bottom-3 left-3 z-20 hidden overflow-hidden rounded-[20px] bg-surface shadow-float transition-[width] duration-200 lg:block dark:ring-1 dark:ring-white/10', collapsed ? 'w-20' : 'w-[260px]')}>
        <Sidebar user={user} onLogout={logout} collapsed={collapsed} />
      </aside>
      {/* Tab perkecil/perbesar menempel di tepi kanan sidebar, tengah vertikal (seperti panel Google Maps).
          Di luar <aside> karena aside overflow-hidden; tengah sidebar = 50% + 40px (atas 92px, bawah 12px).
          Tanpa bayangan, warna sama dengan sidebar, dan menumpuk 1px di tepi sidebar agar tidak ada garis sambungan. */}
      <button type="button" onClick={toggleSidebar} aria-expanded={!collapsed} aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
        title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
        className={cn('fixed top-[calc(50%+40px)] z-20 hidden h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg bg-surface text-muted transition-[left,color] duration-200 hover:text-heading focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none lg:flex',
          collapsed ? 'left-[91px]' : 'left-[271px]')}>
        {collapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronLeft className="size-4" aria-hidden />}
      </button>

      <Drawer.Backdrop isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <Drawer.Content placement="left" className="w-72">
          <Drawer.Dialog aria-label={t('nav.main')} className="h-full p-0">
            <Sidebar user={user} onLogout={logout} onNavigate={() => setMenuOpen(false)} showBrand />
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      {/* --sidebar-offset = tepi kanan sidebar melayang (12px + lebar). Halaman biasa diberi padding sebesar itu;
          halaman penuh (peta) tidak: peta tetap tergambar di belakang sidebar, panel peta yang digeser. */}
      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:[--sidebar-offset:92px]' : 'lg:[--sidebar-offset:272px]', !fullBleed && 'lg:pl-(--sidebar-offset)')}>
        {/* min-h: footer mulai di bawah layar walau halaman lazy masih dimuat, agar tidak terdorong turun (CLS). 80px = tinggi topbar. */}
        <main className={cn(!fullBleed && "mx-auto min-h-[calc(100dvh-80px)] w-full max-w-[1300px] p-4 md:p-6 lg:p-8")}>
          <AnimatePresence mode="wait" initial={false}>
            {/* Kunci per segmen pertama: /data/a -> /data/b tidak dianggap pindah halaman. */}
            <m.div key={pathname.split('/')[1]} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}>
              {title && !fullBleed && <PageHeader title={t(title)} crumb={t(title)} />}
              <ErrorBoundary resetKey={pathname}>
                <Suspense fallback={<Loading />}>{outlet}</Suspense>
              </ErrorBoundary>
            </m.div>
          </AnimatePresence>
        </main>
        {!fullBleed && (
          <footer className="px-4 py-4 text-center text-sm text-muted">
            © {new Date().getFullYear()} {t('app.footer')}
          </footer>
        )}
      </div>
    </div>
    </RouterProvider>
  );
}
