-- D1 şeması. Kurulum:
--   npx wrangler d1 create lig
--   npx wrangler d1 execute lig --remote --file=./schema.sql
--   (yerel geliştirme için --remote yerine --local)

CREATE TABLE IF NOT EXISTS tournaments (
  code         TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  state        TEXT    NOT NULL,            -- JSON: {settings, players, matches, playoffRound}
  version      INTEGER NOT NULL DEFAULT 1,  -- her yazmada artar, istemci yoklaması bunu izler
  pin_hash     TEXT    NOT NULL,            -- PBKDF2-SHA256, 120k tur
  pin_salt     TEXT    NOT NULL,
  pin_fails    INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,  -- ms; brute force kilidi
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tournaments_updated ON tournaments(updated_at);
