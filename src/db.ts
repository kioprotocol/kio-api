import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Verdict } from "./kio.js";

let _sb: SupabaseClient | null = null;

export function supa(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null; // Supabase optional; degrade gracefully
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

/**
 * Atomically increment today's query count for an IP and return the new count.
 * Relies on the SQL function `kio_bump_quota` (see schema.sql). If Supabase is
 * not configured, returns -1 (meaning: no limiting).
 */
export async function bumpQuota(ip: string): Promise<number> {
  const sb = supa();
  if (!sb) return -1;
  const { data, error } = await sb.rpc("kio_bump_quota", { p_ip: ip });
  if (error) {
    // fail-open: don't block users if the limiter errors
    console.error("[quota] rpc error:", error.message);
    return -1;
  }
  return typeof data === "number" ? data : -1;
}

/** Fire-and-forget write of a pushback/corrected verdict to the public log. */
export async function logVerdict(entry: {
  label: Verdict;
  prompt: string;
  text: string;
  ip_hash: string;
}): Promise<void> {
  const sb = supa();
  if (!sb) return;
  // Only log the interesting verdicts (the public "track record").
  if (entry.label === "AGREE") return;
  const { error } = await sb.from("kio_verdicts").insert({
    label: entry.label,
    prompt: entry.prompt.slice(0, 500),
    text: entry.text.slice(0, 1200),
    ip_hash: entry.ip_hash,
  });
  if (error) console.error("[log] insert error:", error.message);
}

export async function recentVerdicts(limit = 30) {
  const sb = supa();
  if (!sb) return [];
  const { data, error } = await sb
    .from("kio_verdicts")
    .select("label, prompt, text, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));
  if (error) {
    console.error("[log] select error:", error.message);
    return [];
  }
  return data ?? [];
}
