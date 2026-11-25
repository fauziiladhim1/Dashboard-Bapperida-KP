CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('superadmin', 'editor', 'viewer');
CREATE TYPE user_status AS ENUM ('pending', 'active', 'rejected');

CREATE TABLE users (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  nip           varchar(18),
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'viewer',
  status        user_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE layers (
  id              serial PRIMARY KEY,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  name            text NOT NULL,
  category        text NOT NULL,
  year            int,
  geom_type       text NOT NULL CHECK (geom_type IN ('Point', 'LineString', 'Polygon')),
  style           jsonb NOT NULL DEFAULT '{}',
  fields          jsonb NOT NULL DEFAULT '[]',
  source_layer_id int REFERENCES layers (id) ON DELETE CASCADE,
  filter          jsonb,
  visible_default boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE features (
  id         bigserial PRIMARY KEY,
  layer_id   int NOT NULL REFERENCES layers (id) ON DELETE CASCADE,
  properties jsonb NOT NULL DEFAULT '{}',
  geom       geometry(Geometry, 4326) NOT NULL,
  created_by int REFERENCES users (id) ON DELETE SET NULL,
  updated_by int REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX features_geom_idx ON features USING gist (geom);
CREATE INDEX features_props_idx ON features USING gin (properties jsonb_path_ops);
CREATE INDEX features_layer_idx ON features (layer_id);

CREATE TABLE media (
  id         serial PRIMARY KEY,
  feature_id bigint NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  webp       text NOT NULL,
  avif       text NOT NULL,
  width      int NOT NULL,
  height     int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_feature_idx ON media (feature_id);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  user_id    int REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  detail     jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_logs (created_at DESC);

-- updated_at layer naik otomatis tiap fitur berubah; dipakai klien untuk cache-busting vector tiles.
CREATE FUNCTION touch_layer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE layers SET updated_at = clock_timestamp() WHERE id IN (SELECT DISTINCT layer_id FROM old_rows);
  ELSE
    UPDATE layers SET updated_at = clock_timestamp() WHERE id IN (SELECT DISTINCT layer_id FROM new_rows);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER features_touch_ins AFTER INSERT ON features REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION touch_layer();
CREATE TRIGGER features_touch_upd AFTER UPDATE ON features REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION touch_layer();
CREATE TRIGGER features_touch_del AFTER DELETE ON features REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION touch_layer();
