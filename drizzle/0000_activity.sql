CREATE TABLE office_activity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot TEXT NOT NULL,
  received_at TEXT NOT NULL
);
