-- Pakka production schema (portable subset: runs on SQLite 3.35+ and PostgreSQL 14+).
-- Production on Postgres would swap TEXT ids for uuid, TEXT timestamps for timestamptz,
-- and payload TEXT for jsonb. Money is always integer paise (never float).
-- Write path: append to `events`, then update the projections below in the same transaction.

CREATE TABLE trips (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  destination     TEXT NOT NULL,
  phase           TEXT NOT NULL CHECK (phase IN ('draft','aligning','committing','failed','ready_to_book','booked','on_trip','settling','closed','cancelled')),
  stay_total_paise     INTEGER NOT NULL CHECK (stay_total_paise > 0),
  advance_paise        INTEGER NOT NULL CHECK (advance_paise >= 0),
  transport_pp_paise   INTEGER NOT NULL DEFAULT 0 CHECK (transport_pp_paise >= 0),
  food_pp_day_paise    INTEGER NOT NULL DEFAULT 0 CHECK (food_pp_day_paise >= 0),
  pact_need       INTEGER CHECK (pact_need IS NULL OR pact_need >= 2),
  pact_deadline   TEXT,
  pact_rule       TEXT CHECK (pact_rule IS NULL OR pact_rule IN ('keep','absorb')),
  chosen_option_id TEXT,
  album_url       TEXT,
  created_at      TEXT NOT NULL,
  CHECK (advance_paise <= stay_total_paise),
  CHECK (phase IN ('draft','aligning','cancelled') OR pact_need IS NOT NULL)
);

CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
  is_organiser  INTEGER NOT NULL DEFAULT 0 CHECK (is_organiser IN (0,1)),
  status        TEXT NOT NULL CHECK (status IN ('invited','in','out','withdrawn','replaced')),
  budget_max_paise INTEGER CHECK (budget_max_paise IS NULL OR budget_max_paise >= 50000), -- private: never exposed per person by the API
  replaced_by   TEXT REFERENCES people(id)
);
CREATE INDEX idx_people_trip ON people(trip_id);
CREATE UNIQUE INDEX uq_people_name ON people(trip_id, lower(name)) WHERE status <> 'replaced';
CREATE UNIQUE INDEX uq_one_organiser ON people(trip_id) WHERE is_organiser = 1;

CREATE TABLE date_options (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  nights     INTEGER NOT NULL CHECK (nights BETWEEN 1 AND 7),
  UNIQUE (trip_id, start_date, nights)
);

CREATE TABLE availability (
  person_id      TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date_option_id TEXT NOT NULL REFERENCES date_options(id) ON DELETE CASCADE,
  can_make       INTEGER NOT NULL CHECK (can_make IN (0,1)),
  PRIMARY KEY (person_id, date_option_id)
);
CREATE INDEX idx_avail_option ON availability(date_option_id);

CREATE TABLE bookings (
  trip_id     TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  reference   TEXT NOT NULL CHECK (length(trim(reference)) > 0),
  amount_paid_paise INTEGER NOT NULL CHECK (amount_paid_paise > 0),
  paid_by     TEXT NOT NULL REFERENCES people(id),
  cancel_by   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('confirmed','needs_recheck')),
  note        TEXT,
  confirmed_at TEXT NOT NULL
);

CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  paid_by     TEXT NOT NULL REFERENCES people(id),
  source      TEXT NOT NULL,            -- 'advance' | 'manual' | 'item:<id>'
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_expenses_trip ON expenses(trip_id);
CREATE UNIQUE INDEX uq_one_advance ON expenses(trip_id) WHERE source = 'advance';

-- Exact split, materialised at write time (remainder paise to the first people in order).
CREATE TABLE expense_shares (
  expense_id  TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people(id),
  share_paise INTEGER NOT NULL CHECK (share_paise >= 0),
  PRIMARY KEY (expense_id, person_id)
);
CREATE INDEX idx_shares_person ON expense_shares(person_id);

CREATE TABLE payments (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_person TEXT NOT NULL REFERENCES people(id),
  to_person   TEXT NOT NULL REFERENCES people(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  ref         TEXT,                     -- optional UPI reference typed by the payer; never verified automatically
  created_at  TEXT NOT NULL,
  CHECK (from_person <> to_person)
);
CREATE INDEX idx_payments_trip ON payments(trip_id);

CREATE TABLE itinerary_items (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day         INTEGER NOT NULL CHECK (day >= 1),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  place       TEXT,
  cost_pp_paise INTEGER NOT NULL DEFAULT 0 CHECK (cost_pp_paise >= 0),
  expense_id  TEXT REFERENCES expenses(id),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_items_trip_day ON itinerary_items(trip_id, day, start_time);

-- Append-only event log: the source of truth; tables above are projections of it.
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- Postgres: bigint GENERATED ALWAYS AS IDENTITY
  trip_id    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  actor_id   TEXT REFERENCES people(id),
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,                      -- Postgres: jsonb
  summary    TEXT NOT NULL
);
CREATE INDEX idx_events_trip_seq ON events(trip_id, seq);
