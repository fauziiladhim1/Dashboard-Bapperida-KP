import { describe, expect, it } from 'vitest';
import { colorCodes, parseColor } from '@/lib/color';

describe('color (Hex/RGB/HSL/OKLCH)', () => {
  it('kode empat format dari hex', () => {
    expect(colorCodes('#2563eb')).toEqual({ hex: '#2563EB', rgb: 'rgb(37, 99, 235)', hsl: 'hsl(221, 83%, 53%)', oklch: 'oklch(54.6% 0.215 262.9)' });
    expect(colorCodes('#ffffff').oklch).toBe('oklch(100% 0 0)');
  });
  it('mengurai keempat format kembali ke hex yang sama', () => {
    for (const s of ['#2563eb', '2563EB', 'rgb(37, 99, 235)', 'rgb(37 99 235)', 'hsl(221, 83%, 53%)', 'oklch(54.6% 0.215 262.9)', 'oklch(0.546 0.215 262.9)']) {
      const hex = parseColor(s)!;
      // HSL/OKLCH dibulatkan: selisih maksimal 2 per kanal.
      const d = [1, 3, 5].map((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt('2563EB'.slice(i - 1, i + 1), 16)));
      expect(Math.max(...d), s).toBeLessThanOrEqual(2);
    }
    expect(parseColor('#abc')).toBe('#AABBCC');
    expect(parseColor('biru')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
  });
});
