import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { domMax, LazyMotion, MotionConfig } from 'motion/react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Loading } from '@/components/common/Loading';
import { can, useMe } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';
import { ErrorPage } from '@/features/errors/ErrorPage';
import { PrefsProvider } from '@/lib/prefs';
import type { Role } from '@/lib/types';

// Setiap halaman di-split per route: halaman login tidak ikut memuat MapLibre/Recharts.
const AuthPage = lazy(() => import('@/features/auth/AuthPage'));
const OverviewPage = lazy(() => import('@/features/overview/OverviewPage'));
const PetaPage = lazy(() => import('@/features/peta/PetaPage'));
const DataPage = lazy(() => import('@/features/data/DataPage'));
const UsersPage = lazy(() => import('@/features/users/UsersPage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));
const AccountPage = lazy(() => import('@/features/account/AccountPage'));

export const createQueryClient = () => {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
    // Sesi habis di tengah jalan -> kembali ke halaman login.
    queryCache: new QueryCache({ onError: (e) => onSessionError(e) }),
    mutationCache: new MutationCache({ onError: (e) => onSessionError(e) }),
  });
  const onSessionError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) client.setQueryData(['me'], null);
  };
  return client;
};

/** Shell dirender sekali untuk semua halaman internal, jadi indikator navigasi bisa beranimasi antar halaman. */
function Protected() {
  const { data: user, isPending } = useMe();
  if (isPending) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell user={user} />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: user } = useMe();
  return can(user, ...roles) ? children : <ErrorPage code={403} />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route element={<Protected />}>
          <Route index element={<OverviewPage />} />
          <Route path="peta" element={<PetaPage />} />
          <Route path="data/:slug?" element={<DataPage />} />
          <Route path="pengguna" element={<RequireRole roles={['superadmin']}><UsersPage /></RequireRole>} />
          <Route path="log" element={<RequireRole roles={['superadmin', 'editor']}><AuditPage /></RequireRole>} />
          <Route path="akun" element={<AccountPage />} />
          <Route path="*" element={<ErrorPage code={404} />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export function App({ client: given }: { client?: QueryClient }) {
  // Dibuat sekali: default parameter akan membuat client (dan cache) baru setiap App dirender ulang.
  const [client] = useState(() => given ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <PrefsProvider>
      <LazyMotion features={domMax} strict>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </MotionConfig>
      </LazyMotion>
      </PrefsProvider>
    </QueryClientProvider>
  );
}
