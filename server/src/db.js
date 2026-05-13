import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'kayenta.db');

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'home',
    url TEXT,
    address TEXT,
    city TEXT DEFAULT 'Ivins',
    state TEXT DEFAULT 'UT',
    zip TEXT,
    neighborhood TEXT DEFAULT 'Kayenta',
    price INTEGER,
    sqft INTEGER,
    bedrooms INTEGER,
    bathrooms REAL,
    lot_size TEXT,
    year_built INTEGER,
    property_type TEXT,
    status TEXT,
    amenities TEXT,
    description TEXT,
    image_url TEXT,
    date_posted TEXT,
    date_first_seen TEXT NOT NULL,
    date_last_seen TEXT NOT NULL,
    raw_data TEXT
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (listing_id) REFERENCES listings(id)
  );

  CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    listings_found INTEGER DEFAULT 0,
    listings_new INTEGER DEFAULT 0,
    listings_updated INTEGER DEFAULT 0,
    price_changes INTEGER DEFAULT 0,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(type);
  CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
  CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
  CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);
  CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(recorded_at);
`);

export default db;
