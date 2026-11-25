import { describe, expect, it } from 'vitest';
import { addVertex, finishProblem, segmentsMeet, selfIntersects, type Pt } from '@/lib/draw';

const sq: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

describe('topologi gambar', () => {
  it('selfIntersects: persegi sah; dasi kupu-kupu, ruas menumpuk, dan sentuhan ujung terdeteksi', () => {
    expect(selfIntersects(sq, true)).toBe(false);
    expect(selfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]], true)).toBe(true);
    expect(selfIntersects([[0, 0], [2, 0], [1, 0]], false)).toBe(true); // berbalik di atas ruas sendiri
    expect(selfIntersects([[0, 0], [2, 0], [2, 1], [1, 0]], false)).toBe(true); // ujung menyentuh ruas pertama
    expect(selfIntersects([[0, 0], [1, 0], [2, 0]], false)).toBe(false); // segaris lurus maju: sah
    expect(selfIntersects([[0, 0], [1, 0], [1, 1]], true)).toBe(false);
    expect(selfIntersects([[1, 0], [0, 0], [2, 0]], true)).toBe(true); // cincin menumpuk di titik penutup
  });

  it('addVertex: tambah, tolak potongan & titik berulang, selesai lewat klik ulang', () => {
    expect(addVertex([], [0, 0], 'LineString')).toEqual({ pts: [[0, 0]] });
    expect(addVertex([[0, 0]], [0, 0], 'LineString')).toEqual({ pts: [[0, 0]], done: false });
    expect(addVertex([[0, 0], [1, 0]], [1, 0], 'LineString')).toEqual({ pts: [[0, 0], [1, 0]], done: true });
    expect(addVertex(sq.slice(0, 3), [0, 0], 'Polygon')).toEqual({ pts: sq.slice(0, 3), done: true });
    expect(addVertex(sq.slice(0, 2), [0, 0], 'Polygon').problem).toBe('cross');
    expect(addVertex([[0, 0], [1, 1], [1, 0]], [0, 1], 'Polygon').problem).toBe('cross');
  });

  it('finishProblem: garis selalu boleh; area segaris / berpotongan ditolak', () => {
    expect(finishProblem([[0, 0], [1, 1]], 'LineString')).toBeNull();
    expect(finishProblem(sq, 'Polygon')).toBeNull();
    expect(finishProblem([[0, 0], [1, 0], [2, 0]], 'Polygon')).toBe('flat');
    expect(finishProblem([[0, 0], [1, 1], [1, 0], [0, 1]], 'Polygon')).toBe('cross');
    expect(finishProblem([[0, 0], [1, 0]], 'Polygon')).toBeNull();
  });
});

describe('segmentsMeet', () => {
  it('silang, sejajar terpisah, segaris terpisah/tumpang, dan ujung di ruas lain', () => {
    expect(segmentsMeet([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(segmentsMeet([0, 2], [2, 0], [0, 0], [2, 2])).toBe(true);
    expect(segmentsMeet([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
    expect(segmentsMeet([0, 0], [2, 0], [1, 1], [1, 3])).toBe(false);
    expect(segmentsMeet([0, 0], [1, 0], [2, 0], [3, 0])).toBe(false);
    expect(segmentsMeet([1, 0], [1, 2], [0, 0], [2, 0])).toBe(true); // a di cd
    expect(segmentsMeet([1, 2], [1, 0], [0, 0], [2, 0])).toBe(true); // b di cd
    expect(segmentsMeet([0, 0], [2, 0], [1, 0], [1, 2])).toBe(true); // c di ab
    expect(segmentsMeet([0, 0], [2, 0], [1, 2], [1, 0])).toBe(true); // d di ab
  });
});
