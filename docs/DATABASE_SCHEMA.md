# Database Schema (PostgreSQL 16 + PostGIS 3)

> Conventions: UUID v7 primary keys; `created_at`/`updated_at timestamptz` everywhere
> (omitted below for brevity); all geo columns `geography(Point, 4326)` + GiST index;
> enums as Postgres enum types; FKs `ON DELETE RESTRICT` unless noted.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============ identity ============
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');

CREATE TABLE users (
  id                uuid PRIMARY KEY,
  email             citext UNIQUE NOT NULL,
  full_name         text NOT NULL,
  phone             text UNIQUE,              -- E.164
  avatar_url        text,
  bio               text,
  city              text,
  country           text NOT NULL DEFAULT 'TR',
  rating_average    numeric(3,2) NOT NULL DEFAULT 0,
  rating_count      int NOT NULL DEFAULT 0,
  completed_exchanges int NOT NULL DEFAULT 0,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,              -- gate for exchange requests
  status            user_status NOT NULL DEFAULT 'active',
  last_active_at    timestamptz,
  kvkk_consent_at   timestamptz NOT NULL,
  kvkk_policy_version text NOT NULL
);

-- hash isolated so it can't leak through a careless SELECT/serializer
CREATE TABLE user_credentials (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL                 -- Argon2id
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,                  -- SHA-256 of opaque token
  family_id   uuid NOT NULL,                  -- rotation family; replay revokes whole family
  device_info text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX ON refresh_tokens (token_hash);
CREATE INDEX ON refresh_tokens (family_id);

CREATE TABLE phone_otps (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,          -- max 3
  expires_at timestamptz NOT NULL             -- now() + 5 min
);

-- ============ location ============
-- ephemeral GPS fixes; worker deletes rows > 30 days old (KVKK)
CREATE TABLE user_locations (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location        geography(Point, 4326) NOT NULL,
  accuracy_meters real
);
CREATE INDEX ON user_locations USING GIST (location);
CREATE INDEX ON user_locations (user_id, created_at);

-- ============ books ============
CREATE TYPE book_condition AS ENUM ('new', 'like_new', 'good', 'worn');

CREATE TABLE books (
  id              uuid PRIMARY KEY,
  owner_id        uuid NOT NULL REFERENCES users(id),
  title           text NOT NULL,
  author          text,
  isbn            text,
  description     text,
  category        text NOT NULL,
  language        text NOT NULL DEFAULT 'tr',
  condition       book_condition NOT NULL,
  is_available    boolean NOT NULL DEFAULT true,
  city            text NOT NULL,
  location        geography(Point, 4326) NOT NULL,  -- TRUE point. NEVER in API responses.
  public_location geography(Point, 4326) NOT NULL,  -- snapped to ~1km grid at write time
  deleted_at      timestamptz
);
CREATE INDEX ON books USING GIST (public_location);
CREATE INDEX ON books USING GIST (location);
CREATE INDEX ON books (owner_id);
CREATE INDEX ON books (isbn) WHERE isbn IS NOT NULL;

CREATE TABLE book_photos (
  id         uuid PRIMARY KEY,
  book_id    uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  url        text NOT NULL,                   -- EXIF-stripped, re-encoded
  position   int NOT NULL DEFAULT 0
);

CREATE TABLE wishlist_items (
  id      uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title   text,
  isbn    text,
  radius_km int NOT NULL DEFAULT 10,
  UNIQUE (user_id, isbn)
);

CREATE TABLE favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, book_id)
);

-- ============ exchange lifecycle ============
CREATE TYPE exchange_status AS ENUM (
  'pending','accepted','rejected','cancelled',
  'meetup_proposed','meetup_confirmed','completion_pending','completed','expired'
);

CREATE TABLE exchange_requests (
  id                   uuid PRIMARY KEY,
  book_id              uuid NOT NULL REFERENCES books(id),
  requested_by         uuid NOT NULL REFERENCES users(id),
  requested_to         uuid NOT NULL REFERENCES users(id),
  status               exchange_status NOT NULL DEFAULT 'pending',
  initial_message      text NOT NULL,
  completion_marked_by uuid REFERENCES users(id),
  expires_at           timestamptz NOT NULL,  -- created_at + 14 days
  CHECK (requested_by <> requested_to)
);
-- one active request per (book, requester)
CREATE UNIQUE INDEX uq_active_request ON exchange_requests (book_id, requested_by)
  WHERE status NOT IN ('rejected','cancelled','completed','expired');

CREATE TYPE meetup_status AS ENUM ('proposed','confirmed','rejected','cancelled');
CREATE TYPE place_source  AS ENUM ('google','yandex','apple','manual');
CREATE TYPE place_validation AS ENUM ('verified_public','warning','blocked');

CREATE TABLE meetup_places (
  id                  uuid PRIMARY KEY,
  exchange_request_id uuid NOT NULL REFERENCES exchange_requests(id) ON DELETE CASCADE,
  proposed_by         uuid NOT NULL REFERENCES users(id),
  name                text NOT NULL,
  address             text,
  place_category      text,                   -- cafe, library, mall...
  source              place_source NOT NULL,
  location            geography(Point, 4326) NOT NULL,
  google_place_id     text,
  validation_status   place_validation NOT NULL,
  scheduled_at        timestamptz NOT NULL,   -- a meetup needs a time
  status              meetup_status NOT NULL DEFAULT 'proposed'
);
CREATE INDEX ON meetup_places USING GIST (location);

-- admin-curated dangerous locations (checked with ST_DWithin 100m)
CREATE TABLE blocked_places (
  id       uuid PRIMARY KEY,
  location geography(Point, 4326) NOT NULL,
  google_place_id text,
  reason   text NOT NULL
);
CREATE INDEX ON blocked_places USING GIST (location);

-- ============ chat ============
CREATE TABLE chats (
  id                  uuid PRIMARY KEY,
  exchange_request_id uuid UNIQUE NOT NULL REFERENCES exchange_requests(id) ON DELETE CASCADE
);

CREATE TABLE messages (
  id         uuid PRIMARY KEY,
  chat_id    uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id),
  text       text NOT NULL CHECK (char_length(text) <= 2000),
  read_at    timestamptz,
  deleted_at timestamptz
);
CREATE INDEX ON messages (chat_id, created_at);

-- ============ trust ============
CREATE TABLE ratings (
  id                  uuid PRIMARY KEY,
  exchange_request_id uuid NOT NULL REFERENCES exchange_requests(id),
  rated_by            uuid NOT NULL REFERENCES users(id),
  rated_user_id       uuid NOT NULL REFERENCES users(id),
  rating              int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment             text,
  revealed_at         timestamptz,            -- double-blind: set when both submitted or +14d
  UNIQUE (exchange_request_id, rated_by)
);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TYPE report_target AS ENUM ('user','book','message','place');
CREATE TYPE report_status AS ENUM ('open','reviewing','resolved','dismissed');

CREATE TABLE reports (
  id               uuid PRIMARY KEY,
  reporter_id      uuid NOT NULL REFERENCES users(id),
  target_type      report_target NOT NULL,
  target_id        uuid NOT NULL,
  reason           text NOT NULL,
  content_snapshot jsonb,                     -- moderatable even if content deleted
  status           report_status NOT NULL DEFAULT 'open',
  moderator_id     uuid REFERENCES users(id),
  moderator_notes  text
);

-- ============ ops ============
CREATE TABLE notifications (
  id      uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    text NOT NULL,
  payload jsonb NOT NULL,
  read_at timestamptz
);
CREATE INDEX ON notifications (user_id, created_at);

CREATE TABLE audit_log (                      -- security events; NO PII
  id         uuid PRIMARY KEY,
  user_id    uuid,
  event      text NOT NULL,  -- login_failed, token_reuse_detected, user_blocked, report_filed...
  ip_hash    text,
  meta       jsonb
);
```

## Canonical Queries

Nearby books (note: selects `public_location` only; excludes blocked users both ways):

```sql
SELECT b.id, b.title, b.author, b.category, b.condition, b.city,
       ST_Y(b.public_location::geometry) AS lat,
       ST_X(b.public_location::geometry) AS lng,
       round(ST_Distance(b.location, :user_point)::numeric / 500) * 0.5 AS distance_km
FROM books b
WHERE b.is_available AND b.deleted_at IS NULL
  AND b.owner_id <> :user_id
  AND ST_DWithin(b.location, :user_point, :radius_m)   -- true point for accuracy; output stays blurred
  AND NOT EXISTS (SELECT 1 FROM blocks
                  WHERE (blocker_id = :user_id AND blocked_id = b.owner_id)
                     OR (blocker_id = b.owner_id AND blocked_id = :user_id))
ORDER BY b.location <-> :user_point
LIMIT 50;
```

Turkey geofence (bounding box prefilter in app code: lat 35.8–42.1, lng 25.7–44.8; then):

```sql
SELECT ST_Contains(boundary, :point::geometry) FROM country_boundaries WHERE code = 'TR';
-- country_boundaries loaded once from a Turkey GeoJSON polygon in a migration
```

Blur function (write time, in Python or SQL): snap to 0.01° grid ≈ 1.1 km:
`ST_SetSRID(ST_MakePoint(round(lng/0.01)*0.01, round(lat/0.01)*0.01), 4326)`.

## Migration Rules

- Every schema change is an Alembic migration; CI fails if models and migrations diverge
  (`alembic check`). Never edit an applied migration. Enums grow via `ALTER TYPE ... ADD VALUE`.
