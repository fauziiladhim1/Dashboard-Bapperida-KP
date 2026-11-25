import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, TrashBin, Xmark } from '@gravity-ui/icons';
import { Avatar, Button, Chip, ListBox, Select, Table, Tabs } from '@heroui/react';
import { useState } from 'react';
import { Panel } from '@/components/common/Panel';
import { Tip } from '@/components/common/Tip';
import { useMe } from '@/hooks/use-auth';
import { endpoints } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { confirmDanger, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { Role, User } from '@/lib/types';

type Status = 'pending' | 'active' | 'rejected';
const ROLES: Role[] = ['superadmin', 'editor', 'viewer'];
const STATUSES: Status[] = ['pending', 'active', 'rejected'];
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function UsersPage() {
  const t = useT();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('pending');
  const users = useQuery({ queryKey: ['users', status], queryFn: () => endpoints.users(status) });

  const onDone = (msg: string) => {
    toast(msg);
    return qc.invalidateQueries({ queryKey: ['users'] });
  };
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: string; role?: string }) => endpoints.updateUser(id, body),
    onSuccess: (u) => onDone(t('users.updated', { name: u.name })),
    onError: (e) => toastError(e.message),
  });
  const remove = useMutation({
    mutationFn: (u: User) => endpoints.deleteUser(u.id),
    onSuccess: (_r, u) => onDone(t('users.deleted', { name: u.name })),
    onError: (e) => toastError(e.message),
  });
  // Jadi superadmin = akses penuh (kelola akun, hapus layer): minta konfirmasi; peran lain langsung.
  const changeRole = async (u: User, role: string) => {
    if (role === 'superadmin' && !(await confirmDanger({ title: t('users.confirmSuper', { name: u.name }), text: t('users.confirmSuperText'), confirm: t('common.ok'), cancel: t('confirm.no') }))) return;
    update.mutate({ id: u.id, role });
  };
  const confirmRemove = async (u: User) => {
    if (await confirmDanger({ title: t('users.confirmTitle', { name: u.name }), text: t('data.confirmText'), confirm: t('confirm.yesDelete'), cancel: t('confirm.no') })) remove.mutate(u);
  };

  return (
    <Panel title={t('users.title')} subtitle={t('users.sub')}>
      <Tabs aria-label={t('users.status')} selectedKey={status} onSelectionChange={(k) => setStatus(k as Status)} className="w-full sm:w-fit">
        <Tabs.ListContainer>
          <Tabs.List>
            {STATUSES.map((st) => <Tabs.Tab key={st} id={st}>{t(`users.${st}`)}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={t('users.title')} className="min-w-[640px]">
            <Table.Header>
              <Table.Column isRowHeader>{t('auth.name')}</Table.Column>
              <Table.Column>Email</Table.Column>
              <Table.Column>{t('users.role')}</Table.Column>
              <Table.Column>{t('users.registered')}</Table.Column>
              <Table.Column className="text-right">{t('data.actions')}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-12 text-center text-sm text-muted">{users.isPending ? t('common.loading') : t('users.none')}</p>}>
              {(users.data ?? []).map((u) => {
                const self = u.id === me?.id;
                return (
                  <Table.Row key={u.id} id={u.id}>
                    <Table.Cell>
                      <span className="flex items-center gap-3 font-medium">
                        <Avatar size="sm" variant="soft"><Avatar.Fallback className="text-xs">{initials(u.name)}</Avatar.Fallback></Avatar>
                        {u.name}{self && <Chip size="sm" variant="soft">{t('users.you')}</Chip>}
                      </span>
                    </Table.Cell>
                    <Table.Cell>{u.email}</Table.Cell>
                    <Table.Cell>
                      <Select aria-label={t('users.roleOf', { name: u.name })} selectedKey={u.role} isDisabled={self} className="w-36"
                        onSelectionChange={(r) => r !== u.role && changeRole(u, String(r))}>
                        <Select.Trigger className="text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover>
                          <ListBox>{ROLES.map((r) => <ListBox.Item key={r} id={r} textValue={t(`role.${r}`)}>{t(`role.${r}`)}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox>
                        </Select.Popover>
                      </Select>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-muted">{fmtDateTime(u.createdAt!)}</Table.Cell>
                    <Table.Cell className="text-right whitespace-nowrap">
                      {!self && u.status !== 'active' && (
                        <Tip label={t('users.approve')}>
                          <Button isIconOnly size="sm" variant="ghost" onPress={() => update.mutate({ id: u.id, status: 'active' })} aria-label={t('users.approveOf', { name: u.name })} className="text-success"><Check className="size-4" /></Button>
                        </Tip>
                      )}
                      {!self && u.status !== 'rejected' && (
                        <Tip label={t('users.reject')}>
                          <Button isIconOnly size="sm" variant="ghost" onPress={() => update.mutate({ id: u.id, status: 'rejected' })} aria-label={t('users.rejectOf', { name: u.name })}><Xmark className="size-4" /></Button>
                        </Tip>
                      )}
                      {!self && (
                        <Tip label={t('common.delete')}>
                          <Button isIconOnly size="sm" variant="ghost" onPress={() => confirmRemove(u)} aria-label={`${t('common.delete')} ${u.name}`} className="text-danger"><TrashBin className="size-4" /></Button>
                        </Tip>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Panel>
  );
}
