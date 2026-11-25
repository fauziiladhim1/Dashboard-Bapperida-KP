import { describe, expect, it } from 'vitest';
import { headingOf, metersPerPixel } from '@/components/map/UserLocation';

describe('UserLocation helpers', () => {
  it('meter per piksel: separuh tiap naik satu zoom, mengecil ke kutub', () => {
    const z10 = metersPerPixel(0, 10);
    expect(z10).toBeCloseTo(76.44, 1);
    expect(metersPerPixel(0, 11)).toBeCloseTo(z10 / 2, 5);
    expect(metersPerPixel(60, 10)).toBeCloseTo(z10 / 2, 1);
  });

  it('arah hadap: kompas iOS, alpha absolut dibalik, layar diputar', () => {
    expect(headingOf({ webkitCompassHeading: 90 } as never)).toBe(90);
    expect(headingOf({ absolute: true, alpha: 90 } as never)).toBe(270);
    expect(headingOf({ absolute: true, alpha: 0 } as never, 90)).toBe(90);
    expect(headingOf({ absolute: false, alpha: 90 } as never)).toBeNull();
  });
});
