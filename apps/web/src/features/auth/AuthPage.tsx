import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle, CircleCheckFill, Envelope, Eye, EyeSlash, Lock, Person } from '@gravity-ui/icons';
import { Button, Card, Checkbox, Form, InputGroup, Label, TextField } from '@heroui/react';
import { m } from 'motion/react';
import { useState, type ComponentType, type FormEvent, type SVGProps } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { PrefControls } from '@/components/layout/PrefControls';
import { Logo } from '@/components/layout/Logo';
import { Collapse, EASE } from '@/components/common/motion';
import { useMe } from '@/hooks/use-auth';
import { endpoints } from '@/lib/api';
import { toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const { data: me } = useMe();
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mode: Mode = useLocation().pathname === '/register' ? 'register' : 'login';
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const v = (k: string) => String(form.get(k));
      if (mode === 'login') return (await endpoints.login({ email: v('email'), password: v('password'), remember: form.get('remember') !== null })).user;
      await endpoints.register({ name: v('name'), email: v('email'), password: v('password') });
      return null;
    },
    onSuccess: (user) => {
      if (user) {
        qc.setQueryData(['me'], user);
        navigate('/');
        return;
      }
      toast(t('auth.registered'), 'success', t('auth.registeredText'));
      navigate('/login');
    },
    // Semua pesan (gagal masuk, akun pending, dsb.) tampil sebagai toast pojok kanan bawah, di luar formulir.
    onError: (e) => toastError(e.message),
  });

  if (me) return <Navigate to="/" replace />;

  const switchMode = (next: Mode) => {
    mutation.reset();
    navigate(next === 'login' ? '/login' : '/register');
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // Konfirmasi hanya dicek di klien: API menerima satu password.
    if (mode === 'register' && form.get('password') !== form.get('confirm')) return toastError(t('auth.passwordMismatch'));
    mutation.mutate(form);
  };

  const isLogin = mode === 'login';
  return (
    // Satu layar tanpa gulir: kartu di tengah; ritme jarak 4/8px (field & blok 16px). Layar pendek (<= 760px,
    // laptop 768px dengan bar browser): logo & subjudul disembunyikan agar formulir daftar tetap muat.
    <main className="relative grid min-h-svh place-items-center bg-background px-4 py-4">
      <PrefControls className="absolute top-4 right-4" />
      <Card className="w-full max-w-[420px] gap-4 p-6 shadow-card sm:p-7">
        <header className="flex flex-col items-center text-center">
          <div className="mb-3"><Logo size={32} /></div>
          <m.div key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
            <h1 className="font-heading text-xl font-medium text-heading">{isLogin ? t('auth.welcome') : t('auth.create')}</h1>
            <p className="mt-1 text-sm text-muted [@media(max-height:760px)]:hidden">{isLogin ? t('auth.loginHint') : t('auth.registerHint')}</p>
          </m.div>
        </header>

        {/* Segmen mode: role tab (bukan tombol) agar tombol kirim tetap satu-satunya tombol "Masuk".
            Latar tab aktif bergeser antar tab (layoutId). */}
        <div role="tablist" aria-label={`${t('auth.login')} / ${t('auth.register')}`} className="grid grid-cols-2 rounded-control bg-default p-1 text-sm">
          {(['login', 'register'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => mode !== k && switchMode(k)}
              className={cn('relative h-8 rounded-lg font-medium transition-colors', mode === k ? 'text-heading' : 'text-muted hover:text-heading')}>
              {mode === k && <m.span layoutId="auth-tab" transition={{ duration: 0.3, ease: EASE }} className="absolute inset-0 rounded-lg bg-surface shadow-card" />}
              <span className="relative">{k === 'login' ? t('auth.login') : t('auth.register')}</span>
            </button>
          ))}
        </div>

        <Form onSubmit={submit} className="flex flex-col gap-4 text-xs">
          {/* Field khusus satu mode masuk/keluar dengan animasi tinggi (Collapse melepas field saat tertutup, jadi
              field daftar tidak ikut validasi wajib di mode masuk). `-m-1 p-1`: cincin fokus tidak terpotong. */}
          <Collapse open={!isLogin} className={COLLAPSE}>
            <Field id="name" icon={Person} label={t('auth.name')} required minLength={3} autoComplete="name" />
          </Collapse>
          <Field id="email" icon={Envelope} label={t('auth.email')} type="email" required autoComplete="email" placeholder="nama@kulonprogokab.go.id" />
          <PasswordField isLogin={isLogin} value={password} onChange={setPassword} />
          <Collapse open={isLogin} className={COLLAPSE}>
            <div className="flex items-center justify-between gap-3">
              <Checkbox name="remember">
                <Checkbox.Content className="items-center gap-2">
                  {/* Kotak 18px; isian hijau (::before) memakai radius dalam = radius luar − tebal tepi, agar sudut
                      isian mengikuti bentuk kotak dan tanda centang tidak terpotong. */}
                  <Checkbox.Control className="size-[18px] rounded-[5px] before:rounded-[4px]">
                    <Checkbox.Indicator className="size-3" />
                  </Checkbox.Control>
                  <Label className="text-sm">{t('auth.remember')}</Label>
                </Checkbox.Content>
              </Checkbox>
              <span className="text-xs text-muted">{t('auth.forgot')}</span>
            </div>
          </Collapse>
          <Collapse open={!isLogin} className={COLLAPSE}>
            <div className="flex flex-col gap-3">
              <PasswordField isLogin={false} confirm />
              <PasswordRules value={password} />
            </div>
          </Collapse>
          <Button type="submit" isDisabled={mutation.isPending} fullWidth className="mt-1">
            {mutation.isPending ? t('common.processing') : isLogin ? t('auth.login') : t('auth.create')}
          </Button>
        </Form>
      </Card>
    </main>
  );
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type FieldProps = { id: string; label: string; icon: Icon; type?: string; required?: boolean; minLength?: number; autoComplete?: string; placeholder?: string };

// Ikon di dalam field: tanpa garis pemisah bawaan InputGroup; bawaan `ps-0` pada input membuat teks menempel ikon,
// jadi diberi jarak 10px.
const PREFIX = 'border-0 ps-3 pe-0';
const INPUT = 'min-w-0 ps-2.5!';
// Collapse memotong isi (overflow-hidden); margin negatif + padding memberi ruang cincin fokus.
const COLLAPSE = '-m-1 p-1';

function Field({ id, label, icon: Icon, type = 'text', required, minLength, ...input }: FieldProps) {
  return (
    <TextField name={id} type={type} isRequired={required} minLength={minLength} className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-sm">{label}</Label>
      <InputGroup>
        <InputGroup.Prefix className={PREFIX}><Icon aria-hidden className="size-4 text-subtle" /></InputGroup.Prefix>
        <InputGroup.Input id={id} className={INPUT} {...input} />
      </InputGroup>
    </TextField>
  );
}

/** Aturan sama dengan `registerSchema` di API: >= 12 karakter, huruf besar + kecil, angka, simbol. */
const RULES = [
  { key: 'auth.rule.length', ok: (p: string) => p.length >= 12 },
  { key: 'auth.rule.case', ok: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { key: 'auth.rule.digit', ok: (p: string) => /\d/.test(p) },
  { key: 'auth.rule.symbol', ok: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

function PasswordField({ isLogin, confirm, value, onChange }: { isLogin: boolean; confirm?: boolean; value?: string; onChange?: (v: string) => void }) {
  const t = useT();
  const [show, setShow] = useState(false);
  const id = confirm ? 'confirm' : 'password';
  return (
    <TextField name={id} type={show ? 'text' : 'password'} isRequired minLength={isLogin ? 1 : 12} value={value} onChange={onChange} className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-sm">{confirm ? t('auth.confirmPassword') : t('auth.password')}</Label>
      <InputGroup>
        <InputGroup.Prefix className={PREFIX}><Lock aria-hidden className="size-4 text-subtle" /></InputGroup.Prefix>
        <InputGroup.Input id={id} className={INPUT} autoComplete={isLogin ? 'current-password' : 'new-password'} />
        <InputGroup.Suffix className="border-0 ps-1 pe-1">
          <Button isIconOnly size="sm" variant="ghost" onPress={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}>
            {show ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
    </TextField>
  );
}

/** Checklist langsung saat mengetik: kisi 2×2 berkolom sama lebar, rata kiri, menggantikan teks petunjuk statis. */
function PasswordRules({ value }: { value: string }) {
  const t = useT();
  return (
    <ul aria-label={t('auth.passwordHint')} className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {RULES.map((r) => {
        const ok = r.ok(value);
        return (
          <li key={r.key} className={cn('flex items-center gap-1.5 transition-colors', ok ? 'text-success' : 'text-muted')}>
            {ok ? <CircleCheckFill aria-hidden className="size-3.5 shrink-0" /> : <Circle aria-hidden className="size-3.5 shrink-0" />}
            {t(r.key)}
          </li>
        );
      })}
    </ul>
  );
}
