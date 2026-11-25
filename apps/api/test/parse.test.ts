import { describe, expect, it } from 'vitest';
import { parseKawasanCsv, parseKmlPolygons, parseKoordinat, parseLpju, parseMiskin, miskinOutliers, parseRuasSk, parseRuasCsv, ruasMeta, splitCsvLine } from '../src/db/parse.js';

describe('parser import', () => {
  it('CSV ruas: angka "01.05", sel kosong, baris kosong', () => {
    const csv = 'Ruas Jalan,Baik,Sedang,Rusak Ringan,Rusak Berat,Perbaikan 2026\r\nBogo - Boro,2.70,01.05,0.65,,x\r\n\r\n';
    expect(parseRuasCsv(csv)).toEqual([{ ruas: 'Bogo - Boro', baik: 2.7, sedang: 1.05, rusakRingan: 0.65, rusakBerat: 0, perbaikan: 0 }]);
    expect(parseRuasCsv('h\nPendek,1')[0]).toMatchObject({ baik: 1, perbaikan: 0 });
    // Nama ruas berkoma dalam kutip tidak boleh menggeser angka.
    expect(parseRuasCsv('h\n"Jl. Wates, Sentolo",1.5,2,0,0,0')[0]).toMatchObject({ ruas: 'Jl. Wates, Sentolo', baik: 1.5, sedang: 2 });
    expect(splitCsvLine('a;"b;""c""";', ';')).toEqual(['a', 'b;"c"', '']);
  });

  it('metadata dari nama file', () => {
    expect(ruasMeta('Data Jalan  - KALIBAWANG II 2025.csv')).toEqual({ wilayah: 'Kalibawang II', kecamatan: 'Kalibawang', tahun: 2025 });
    expect(() => ruasMeta('jalan.csv')).toThrow(/tidak dikenali/);
  });

  it('sheet kemiskinan: kapanewon merge, baris Total & kosong dilewati', () => {
    const rows = [
      [null, null, 'Jumlah penduduk Miskin (Th)', null],
      ['Kapanewon', 'Kal/Kelurahan', 2024, 2025],
      ['Temon', 'Jangkaran', 19, 29.4],
      [null, 'Sindutan', 28, null],
      [null, 'Total', 47, 29],
      [null, null, null, null],
    ];
    expect(parseMiskin(rows)).toEqual([
      { kecamatan: 'Temon', kalurahan: 'Jangkaran', tahun: 2024, jumlah: 19 },
      { kecamatan: 'Temon', kalurahan: 'Jangkaran', tahun: 2025, jumlah: 29 },
      { kecamatan: 'Temon', kalurahan: 'Sindutan', tahun: 2024, jumlah: 28 },
    ]);
    expect(() => parseMiskin([['a', 'b', 'c']])).toThrow(/Header/);
  });

  it('peringatan tahun penduduk miskin yang menyimpang jauh', () => {
    const r = (tahun: number, jumlah: number) => ({ kecamatan: 'K', kalurahan: 'A', tahun, jumlah });
    // 2024 kurang satu digit -> diperingatkan; 2025 vs 2026 wajar; tahun bernilai 0 dilewati.
    expect(miskinOutliers([r(2026, 670), r(2024, 98), r(2025, 714), r(2023, 0)])).toEqual([expect.stringMatching(/^penduduk miskin 2024: total 98 vs 2025 714/)]);
    expect(miskinOutliers([r(2024, 4000), r(2025, 900)])).toHaveLength(1);
  });

  it('koordinat bertitik ribuan, termasuk baris rusak', () => {
    expect(parseKoordinat('-7.859.664', 1)).toBeCloseTo(-7.859664, 6);
    expect(parseKoordinat('110.157.833', 3)).toBeCloseTo(110.157833, 6);
    expect(parseKoordinat('11.013.136.466.468.200', 3)).toBeCloseTo(110.131364, 5);
    const csv = 'Kawasan;Tema;Nama_Tempat;Latitude;Longitude\r\nKPPD 1;Perkotaan Wates;Alun-Alun Wates;-7.859.664;110.157.833\r\n;;;;\r\n';
    expect(parseKawasanCsv(csv)).toEqual([{ kawasan: 'KPPD 1', tema: 'Perkotaan Wates', nama: 'Alun-Alun Wates', lat: -7.859664, lng: 110.157833 }]);
  });

  it('KML: hanya placemark berawalan, ring luar + dalam', () => {
    const kml = `<Placemark><name>SRS A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
      110,-7,0 111,-7,0 111,-8,0 110,-7,0</coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>110.1,-7.1 110.2,-7.1 110.2,-7.2 110.1,-7.1</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
      <Placemark><Polygon><outerBoundaryIs><coordinates>0,0 1,1 0,0</coordinates></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>SRS tanpa poligon</name><Point><coordinates>110,-7</coordinates></Point></Placemark>
      <Placemark><name>SRS ring kosong</name><Polygon></Polygon></Placemark>
      <Placemark><name>Kalurahan X</name><Polygon><outerBoundaryIs><coordinates>0,0 1,1 0,0</coordinates></outerBoundaryIs></Polygon></Placemark>`;
    const out = parseKmlPolygons(kml, 'SRS');
    expect(out).toHaveLength(1); // tanpa nama, tanpa poligon, dan poligon tanpa ring dilewati
    expect(parseKmlPolygons(kml)).toHaveLength(3); // tanpa prefiks: placemark tanpa nama ikut
    expect(out[0]!.name).toBe('SRS A');
    expect(out[0]!.geometry.coordinates[0]).toHaveLength(2);
    expect(out[0]!.geometry.coordinates[0]![0]![1]).toEqual([111, -7]);
  });
  it('LPJU Dishub: jenis lampu diseragamkan, angka dari teks, "-" kosong', () => {
    expect(parseLpju({ NAMA: 'APJ WTS NAS 1', ALAMAT: 'JLPURWOREJO KM. 1', Jenis_Lamp: 'SON T', Daya_Lampu: '250 watt', Tinggi_Tia: '9 meter', Daya_KWH: '4400 VA', Tahun_Peng: '-', Pengadaan: 'Dishub KP', NO_TIANG: '-', KET: 'KWH 2004' }))
      .toEqual({ nama: 'APJ WTS NAS 1', lokasi: 'Jl. PURWOREJO KM. 1', jenis_lampu: 'SON-T', daya_watt: 250, tinggi_tiang: '9 m', daya_kwh_va: 4400, tahun_pasang: null, pengadaan: 'DISHUB KP', no_tiang: null, keterangan: 'KWH 2004' });
    expect(parseLpju({ Jenis_Lamp: 'SONT', Tinggi_Tia: 'stang' })).toMatchObject({ jenis_lampu: 'SON-T', tinggi_tiang: 'Stang', lokasi: null });
    expect(parseLpju({ Jenis_Lamp: 'HILANG' }).jenis_lampu).toBe('Hilang');
    expect(parseLpju({ Jenis_Lamp: '-' }).jenis_lampu).toBe('Tidak Tercatat');
  });
  it('SK jalan: kode kapanewon dibuang, salah ketik dibetulkan, nomor + sub ruas, fungsi seragam', () => {
    expect(parseRuasSk({ Nomor_Ruas: 109, Sub_Ruas: 2, Nama_Ruas: 'Kaliwangan Lor � Kaligondang', Fungsi_Jln: 'Jalan Lingkungan Primer (JLing.P)', Kapanewon: '912 Samigaluh -  Kalibawang', Panjang: 1.23456 }))
      .toEqual({ nama_ruas: 'Kaliwangan Lor – Kaligondang', nomor_ruas: '109.2', fungsi: 'Jalan Lingkungan Primer (Jling.P)', kapanewon: 'Samigaluh - Kalibawang', kecamatan: 'Samigaluh', panjang_km: 1.235 });
    expect(parseRuasSk({ Nomor_Ruas: 98, Sub_Ruas: 0, Kapanewon: '912 Samiguluh' })).toMatchObject({ nomor_ruas: '98', kapanewon: 'Samigaluh', nama_ruas: null });
  });
});
