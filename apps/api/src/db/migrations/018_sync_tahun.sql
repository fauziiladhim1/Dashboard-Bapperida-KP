-- Atribut `tahun` (mis. penduduk miskin) dan kolom tahun_data menyimpan hal yang sama: disinkronkan di DB agar Ringkasan
-- (yang membaca atribut) ikut berubah saat tahun_data diedit, dan sebaliknya. Berlaku untuk CRUD, unggah SHP, dan import.
-- INSERT: atribut tahun (per baris, mis. xlsx/SHP multi-tahun) menang atas tahun_data unggahan. UPDATE: kolom yang berubah menang.
CREATE FUNCTION year_of(v text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  -- CASE bersarang: cast hanya setelah regex lolos (AND tidak dijamin berhenti di syarat pertama).
  SELECT CASE WHEN v ~ '^\d{4}$' THEN CASE WHEN v::int BETWEEN 1900 AND 2100 THEN v::int END END $$;

CREATE FUNCTION sync_tahun() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attr int := year_of(NEW.properties->>'tahun');
BEGIN
  -- Tanpa atribut tahun, atau bukan angka tahun (mis. "2020-2022"): dibiarkan.
  IF attr IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' OR (NEW.tahun_data = OLD.tahun_data AND attr IS DISTINCT FROM year_of(OLD.properties->>'tahun'))) THEN
    NEW.tahun_data := attr;
  END IF;
  NEW.properties := NEW.properties || jsonb_build_object('tahun', NEW.tahun_data);
  RETURN NEW;
END $$;
CREATE TRIGGER features_sync_tahun BEFORE INSERT OR UPDATE OF properties, tahun_data ON features
  FOR EACH ROW EXECUTE FUNCTION sync_tahun();

