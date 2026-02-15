/**
 * Database setup for Crawler Service
 * Uses better-sqlite3 for synchronous SQLite operations.
 *
 * Stores domain_profiles — cached crawl configurations per domain,
 * learned from auto-retry escalation or set manually.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

/**
 * Get or create the database connection
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  const dataDir = process.env.DATA_DIR || "./data";
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "crawler.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma("journal_mode = WAL");

  return db;
}

/**
 * Initialize database schema
 */
export function initializeDatabase(): void {
  const database = getDatabase();

  // ─── Domain Profiles: cached crawl config per domain ───────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS domain_profiles (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      domain           TEXT UNIQUE NOT NULL,
      engine           TEXT NOT NULL DEFAULT 'fast',
      render_js        INTEGER DEFAULT 0,
      render_delay_ms  INTEGER DEFAULT 0,
      use_proxy        INTEGER DEFAULT 1,
      preset           TEXT,
      hit_count        INTEGER DEFAULT 1,
      last_status_code INTEGER,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_domain_profiles_domain ON domain_profiles(domain);
  `);

  console.log("✅ Crawler database initialized");
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
