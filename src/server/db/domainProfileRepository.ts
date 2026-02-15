/**
 * Domain Profile Repository
 * CRUD operations for the domain_profiles table.
 *
 * Stores the "winning" crawl configuration per domain, learned from
 * auto-retry escalation or set manually via API.
 */

import { getDatabase } from "./database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DomainProfile {
  id: number;
  domain: string;
  engine: "fast" | "browser" | "stealth";
  render_js: boolean;
  render_delay_ms: number;
  use_proxy: boolean;
  preset: string | null;
  hit_count: number;
  last_status_code: number | null;
  created_at: string;
  updated_at: string;
}

/** Shape used for insert/update (omits DB-managed fields) */
export interface DomainProfileInput {
  engine: "fast" | "browser" | "stealth" | "unblock";
  renderJs?: boolean;
  renderDelayMs?: number;
  useProxy?: boolean;
  preset?: string | null;
  lastStatusCode?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the registrable domain from a URL.
 * Strips protocol, "www." prefix, path, and returns lowercase hostname.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    return url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
  }
}

/** Map a DB row (integers) to a DomainProfile (booleans) */
function rowToProfile(row: any): DomainProfile {
  return {
    ...row,
    render_js: !!row.render_js,
    use_proxy: !!row.use_proxy,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Get a cached profile for a domain
 */
export function getProfile(domain: string): DomainProfile | undefined {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM domain_profiles WHERE domain = ?`).get(domain);
  return row ? rowToProfile(row) : undefined;
}

/**
 * Look up a profile by URL (extracts domain first)
 */
export function getProfileByUrl(url: string): DomainProfile | undefined {
  return getProfile(extractDomain(url));
}

/**
 * Insert or update a domain profile
 */
export function upsertProfile(domain: string, input: DomainProfileInput): DomainProfile {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO domain_profiles (domain, engine, render_js, render_delay_ms, use_proxy, preset, last_status_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      engine = excluded.engine,
      render_js = excluded.render_js,
      render_delay_ms = excluded.render_delay_ms,
      use_proxy = excluded.use_proxy,
      preset = excluded.preset,
      last_status_code = excluded.last_status_code,
      hit_count = hit_count + 1,
      updated_at = datetime('now')
  `).run(
    domain,
    input.engine,
    input.renderJs ? 1 : 0,
    input.renderDelayMs ?? 0,
    (input.useProxy ?? true) ? 1 : 0,
    input.preset ?? null,
    input.lastStatusCode ?? null,
  );

  return getProfile(domain) as DomainProfile;
}

/**
 * Increment hit count for a domain (used when cached profile is reused)
 */
export function incrementHitCount(domain: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE domain_profiles SET hit_count = hit_count + 1, updated_at = datetime('now') WHERE domain = ?
  `).run(domain);
}

/**
 * Delete a domain profile
 */
export function deleteProfile(domain: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`DELETE FROM domain_profiles WHERE domain = ?`).run(domain);
  return result.changes > 0;
}

/**
 * Get all profiles (for admin listing)
 */
export function getAllProfiles(): DomainProfile[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM domain_profiles ORDER BY hit_count DESC, updated_at DESC`).all();
  return rows.map(rowToProfile);
}
