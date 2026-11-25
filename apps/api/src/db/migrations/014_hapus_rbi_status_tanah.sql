-- Layer konteks Jaringan Jalan RBI dan layer Status Tanah (tanpa data) tidak dipakai lagi; fitur ikut terhapus (ON DELETE CASCADE).
DELETE FROM layers WHERE slug IN ('jalan-rbi', 'status-tanah');
