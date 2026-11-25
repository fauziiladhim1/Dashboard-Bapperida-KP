import { useQuery } from '@tanstack/react-query';
import { ApiError, endpoints } from '@/lib/api';
import type { Role, User } from '@/lib/types';

/** User aktif; null bila belum login. */
export const useMe = () =>
  useQuery<User | null>({
    queryKey: ['me'],
    queryFn: () => endpoints.me().catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const can = (user: User | null | undefined, ...roles: Role[]): boolean => Boolean(user && roles.includes(user.role));
export const canEdit = (user: User | null | undefined): boolean => can(user, 'superadmin', 'editor');
