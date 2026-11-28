import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagInput } from '@/components/common/TagInput';

function Harness() {
  const [v, setV] = useState<string[]>(['Baik']);
  return <><TagInput label="Opsi" value={v} onChange={setV} /><output>{v.join('|')}</output></>;
}

describe('TagInput (opsi Pilihan)', () => {
  it('Enter/koma menambah, duplikat diabaikan, Backspace di isian kosong menghapus terakhir', async () => {
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Opsi' });
    await userEvent.type(box, 'Rusak ringan{Enter}');
    await userEvent.type(box, 'Baik,Rusak berat,');
    expect(screen.getByRole('status').textContent).toBe('Baik|Rusak ringan|Rusak berat');
    await userEvent.type(box, '{Backspace}');
    expect(screen.getByRole('status').textContent).toBe('Baik|Rusak ringan');
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Baik' }));
    expect(screen.getByRole('status').textContent).toBe('Rusak ringan');
  });
});
