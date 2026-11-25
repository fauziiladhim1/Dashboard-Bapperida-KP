-- Kondisi ruas jalan SK dihitung saat query dari tabel survei `ruas_jalan` (sumber kebenaran), tidak lagi disimpan
-- ke atribut SHP. SHP hanya memberi geometri + `nama_ruas` sebagai kunci join. Menggantikan syncKondisiRuas (API).

-- Fungsi bersarang ditulis public.* : PG17 membangun indeks ekspresi dengan search_path aman (tanpa public).

-- Nama ruas tanpa awalan "Jl."/"Jalan", huruf kecil.
CREATE FUNCTION ruas_nama(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(t), '^\s*(jl|jalan)(\.|\s)\s*', '')
$$;

-- Kunci join: hanya a-z, sehingga tanda baca, spasi, dan awalan tidak memengaruhi kecocokan.
CREATE FUNCTION ruas_key(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(public.ruas_nama(t), '[^a-z]', '', 'g')
$$;

-- Kunci kedua untuk nama dua bagian dengan ujung dibalik: "A - B" -> "B - A".
CREATE FUNCTION ruas_key_rev(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(split_part(x, '|', 2) || split_part(x, '|', 1), '[^a-z]', '', 'g')
  FROM (SELECT regexp_replace(public.ruas_nama(t), '\s*[-–]\s*', '|', 'g') AS x) s
$$;

-- Kunci tersimpan sekali per baris survei: join tidak menjalankan regex untuk tiap pasangan (ruas SK x baris survei).
ALTER TABLE ruas_jalan ADD COLUMN ruas_k text GENERATED ALWAYS AS (ruas_key(ruas)) STORED;
CREATE INDEX ruas_jalan_key_idx ON ruas_jalan (ruas_k, tahun DESC);

-- Kelas kondisi dari km survei, ambang 20% panjang dari kelas terburuk ke terbaik (kelas km terbesar membuat hampir
-- semua ruas "Baik"): Rusak Berat bila rusak berat >= 20%, Rusak Ringan bila rusak ringan + berat >= 20%,
-- Sedang bila sedang + rusak >= 20%, selain itu Baik.
CREATE FUNCTION ruas_kelas(b float, s float, rr float, rb float) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN b + s + rr + rb = 0 THEN 'Belum Disurvei'
    WHEN rb >= 0.2 * (b + s + rr + rb) THEN 'Rusak Berat'
    WHEN rr + rb >= 0.2 * (b + s + rr + rb) THEN 'Rusak Ringan'
    WHEN s + rr + rb >= 0.2 * (b + s + rr + rb) THEN 'Sedang'
    ELSE 'Baik' END
$$;

-- Properti ruas SK + kondisi survei terakhir <= p_tahun (NULL = survei terbaru). Kunci nama persis didahulukan
-- daripada nama terbalik. Atribut turunan dari SHP selalu dibuang lebih dulu. Ruas tanpa pasangan = Belum Disurvei.
-- plpgsql, bukan sql: rencana kueri di dalamnya di-cache antarpanggilan (sql non-inline direncanakan ulang tiap baris,
-- ~350 ms untuk 415 ruas vs puluhan ms).
CREATE FUNCTION ruas_props(p jsonb, p_tahun int) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  k  text := public.ruas_key(p->>'nama_ruas');
  kr text := public.ruas_key_rev(p->>'nama_ruas');
  o  jsonb;
BEGIN
  IF k <> '' THEN
    SELECT jsonb_build_object(
      'baik_km', r.baik::float, 'sedang_km', r.sedang::float, 'rusak_ringan_km', r.rusak_ringan::float,
      'rusak_berat_km', r.rusak_berat::float, 'tahun_survei', r.tahun,
      'kondisi', public.ruas_kelas(r.baik::float, r.sedang::float, r.rusak_ringan::float, r.rusak_berat::float))
    INTO o
    FROM public.ruas_jalan r
    WHERE r.ruas_k IN (k, kr) AND (p_tahun IS NULL OR r.tahun <= p_tahun)
    ORDER BY r.ruas_k = k DESC, r.tahun DESC, r.id
    LIMIT 1;
  END IF;
  RETURN (p - '{kondisi,baik_km,sedang_km,rusak_ringan_km,rusak_berat_km,tahun_survei}'::text[]) || coalesce(o, '{"kondisi": "Belum Disurvei"}'::jsonb);
END
$$;

-- Bersihkan kelas yang dulu ditempel ke atribut SHP.
UPDATE features f SET properties = f.properties - '{kondisi,baik_km,sedang_km,rusak_ringan_km,rusak_berat_km,tahun_survei}'::text[]
FROM layers l WHERE l.id = f.layer_id AND l.slug = 'jalan-kabupaten' AND f.properties ?| '{kondisi,baik_km,tahun_survei}'::text[];
