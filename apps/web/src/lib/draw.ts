/** Topologi alat gambar (garis/poligon): fungsi murni, tanpa peta. Koordinat [lng, lat] WGS84. */
export type Pt = [number, number];

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const within = (o: Pt, a: Pt, p: Pt) =>
  Math.min(o[0], a[0]) <= p[0] && p[0] <= Math.max(o[0], a[0]) && Math.min(o[1], a[1]) <= p[1] && p[1] <= Math.max(o[1], a[1]);

/** Ruas ab dan cd bersinggungan/berpotongan (termasuk segaris yang tumpang tindih). */
export const segmentsMeet = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b)) || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d));
};

/**
 * Garis (atau cincin bila `closed`) memotong dirinya sendiri. Ruas bertetangga berbagi satu titik sudut: itu bukan
 * potongan, kecuali keduanya segaris dan berbalik arah (ruas menumpuk).
 * ponytail: O(n²) atas jumlah titik sudut; cukup untuk gambar tangan (puluhan titik), sweep-line bila dipakai untuk impor.
 */
export function selfIntersects(pts: Pt[], closed: boolean): boolean {
  const segs: [Pt, Pt][] = pts.slice(1).map((p, i) => [pts[i]!, p]);
  if (closed && pts.length > 2) segs.push([pts.at(-1)!, pts[0]!]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i]!, [c, d] = segs[j]!;
      const adjacent = j === i + 1 || (closed && i === 0 && j === segs.length - 1);
      if (!adjacent) {
        if (segmentsMeet(a, b, c, d)) return true;
        continue;
      }
      // Bertetangga: titik bersama = ujung salah satu ruas; menumpuk bila titik lain jatuh di ruas tetangganya.
      const [shared, p, q] = same(b, c) ? [b, a, d] : [a, b, c];
      if (cross(shared, p, q) === 0 && (within(shared, p, q) || within(shared, q, p))) return true;
    }
  }
  return false;
}

/** Semua titik pada satu garis lurus (area tanpa luas). Bukan uji luas bertanda: dasi kupu-kupu simetris juga berluas 0. */
const collinear = (pts: Pt[]) => pts.every((p) => cross(pts[0]!, pts[1]!, p) === 0);

export type Geom = 'LineString' | 'Polygon';
export type DrawProblem = 'cross' | 'flat';

/**
 * Tambah titik sudut. Klik ulang titik terakhir (garis) atau titik pertama (poligon, >= 3 titik) = selesai.
 * Titik yang membuat gambar memotong dirinya ditolak (`problem: 'cross'`), gambar tidak berubah.
 */
export function addVertex(pts: Pt[], p: Pt, geom: Geom): { pts: Pt[]; done?: boolean; problem?: DrawProblem } {
  const last = pts.at(-1);
  if (last && same(last, p)) return { pts, done: geom === 'LineString' && pts.length >= 2 };
  if (geom === 'Polygon' && pts.length >= 3 && same(pts[0]!, p)) return { pts, done: true };
  if (pts.some((q) => same(q, p))) return { pts, problem: 'cross' };
  const next = [...pts, p];
  return selfIntersects(next, false) ? { pts, problem: 'cross' } : { pts: next };
}

/** Masalah topologi bila gambar diselesaikan sekarang; null = siap (jumlah titik minimum diperiksa terpisah). */
export function finishProblem(pts: Pt[], geom: Geom): DrawProblem | null {
  if (geom === 'LineString') return null;
  if (pts.length >= 3 && collinear(pts)) return 'flat';
  return selfIntersects(pts, true) ? 'cross' : null;
}
