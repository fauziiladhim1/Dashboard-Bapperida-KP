import { Eye, EyeSlash } from '@gravity-ui/icons';
import { Alert, Button, Form, Input, InputGroup, Label, TextField } from '@heroui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Panel } from '@/components/common/Panel';
import { useMe } from '@/hooks/use-auth';
import { endpoints } from '@/lib/api';
import { useT } from '@/lib/prefs';
import type { User } from '@/lib/types';

/** Pengaturan akun sendiri: profil (nama) dan ganti password. Email & peran hanya bisa diubah superadmin. */
export default function AccountPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const save = useMutation({
    mutationFn: endpoints.updateMe,
    // PATCH tidak mengirim `passwordManaged` (hanya GET /me): gabung, jangan timpa.
    onSuccess: (user) => qc.setQueryData<User>(['me'], (old) => ({ ...old, ...user })),
  });
  const pass = useMutation({
    mutationFn: async (f: FormData) => {
      if (f.get('newPassword') !== f.get('confirm')) throw new Error(t('acc.mismatch'));
      return endpoints.updateMe({ currentPassword: String(f.get('currentPassword')), newPassword: String(f.get('newPassword')) });
    },
  });
  if (!me) return null;

  const onProfile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({ name: String(f.get('name')) });
  };
  const onPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    pass.mutate(new FormData(form), { onSuccess: () => form.reset() });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Panel title={t('acc.profile')} subtitle={t('acc.profileSub')}>
        <Form onSubmit={onProfile} className="flex flex-col gap-4">
          <Field name="name" label={t('auth.name')} defaultValue={me.name} required minLength={3} autoComplete="name" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ReadOnly label={t('auth.email')}>{me.email}</ReadOnly>
            <ReadOnly label={t('acc.role')}>{t(`role.${me.role}`)}</ReadOnly>
          </div>
          <Status m={save} ok={t('acc.saved')} />
          <Button type="submit" isDisabled={save.isPending} className="self-start">{t('common.save')}</Button>
        </Form>
      </Panel>

      <Panel title={t('acc.password')} subtitle={me.passwordManaged ? undefined : t('auth.passwordHint')}>
        {/* Akun superadmin bawaan: password mengikuti SEED_ADMIN_PASSWORD di .env (disamakan API tiap start). */}
        {me.passwordManaged ? <p className="text-sm text-muted">{t('acc.passwordManaged')}</p> : (
        <Form onSubmit={onPassword} className="flex flex-col gap-4">
          <Field name="currentPassword" type="password" label={t('acc.current')} required autoComplete="current-password" />
          <Field name="newPassword" type="password" label={t('acc.new')} required minLength={12} autoComplete="new-password" />
          <Field name="confirm" type="password" label={t('acc.confirm')} required minLength={12} autoComplete="new-password" />
          <Status m={pass} ok={t('acc.passwordSaved')} />
          <Button type="submit" isDisabled={pass.isPending} className="self-start">{t('acc.password')}</Button>
        </Form>
        )}
      </Panel>
    </div>
  );
}

type FieldProps = { name: string; label: string; type?: string; required?: boolean; minLength?: number; defaultValue?: string; autoComplete?: string };

/** Isian teks; tipe password diberi tombol mata agar pengguna bisa melihat yang sedang diketik (hash tidak bisa dibaca). */
function Field({ name, label, type = 'text', required, minLength, defaultValue, ...input }: FieldProps) {
  const t = useT();
  const [show, setShow] = useState(false);
  const secret = type === 'password';
  return (
    <TextField name={name} type={secret && show ? 'text' : type} isRequired={required} minLength={minLength} defaultValue={defaultValue} className="flex flex-col gap-2">
      <Label>{label}</Label>
      {secret ? (
        <InputGroup>
          <InputGroup.Input {...input} />
          <InputGroup.Suffix className="border-0 ps-1 pe-1">
            <Button isIconOnly size="sm" variant="ghost" onPress={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}>
              {show ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </InputGroup.Suffix>
        </InputGroup>
      ) : <Input {...input} />}
    </TextField>
  );
}

const ReadOnly = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2 text-sm">
    <span className="font-medium text-heading">{label}</span>
    <span className="break-words text-muted">{children}</span>
  </div>
);

function Status({ m, ok }: { m: { error: Error | null; isSuccess: boolean }; ok: string }) {
  if (!m.error && !m.isSuccess) return null;
  return (
    <Alert status={m.error ? 'danger' : 'success'} role={m.error ? 'alert' : 'status'}>
      <Alert.Indicator />
      <Alert.Content><Alert.Description>{m.error ? m.error.message : ok}</Alert.Description></Alert.Content>
    </Alert>
  );
}
