import { describe, expect, it } from 'vitest';
import { fill } from '@/components/common/card-style';

describe('fill (template baris angka kartu)', () => {
  it('mengisi field dikenal, membiarkan field salah ketik terlihat', () => {
    expect(fill('Kemantapan {pct}%, {n} ruas', { pct: '71', n: 22 })).toBe('Kemantapan 71%, 22 ruas');
    expect(fill('{tahunn} tetap', { tahun: 2025 })).toBe('{tahunn} tetap');
    expect(fill('tanpa field', {})).toBe('tanpa field');
  });
});
