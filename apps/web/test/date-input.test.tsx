import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { DateInput } from '@/components/common/DateInput';
import { dateOf, setDate } from './utils';

it('DateInput: tahun parsial tidak dikirim; kosongkan = null; isi ulang = ISO', async () => {
  const fn = vi.fn();
  function W() { const [v, setV] = useState<string | null>('2026-11-01'); return <DateInput label="Tgl" value={v} onChange={(x) => { fn(x); setV(x); }} />; }
  render(<W />);
  const g = screen.getByRole('group', { name: 'Tgl' });
  await setDate(g, '');
  expect(fn.mock.calls).toEqual([[null]]);
  await setDate(g, '2026-10-05');
  expect(fn.mock.calls.at(-1)).toEqual(['2026-10-05']);
  expect(fn.mock.calls.flat().every((x) => x === null || /^2026-/.test(x))).toBe(true);
  expect(dateOf(g)).toBe('2026-10-05');
});
