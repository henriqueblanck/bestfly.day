export interface SearchPayload {
  origins: string[];
  destinations: string[];
  date_from: string;
  date_to: string;
  trip_type: "oneway" | "roundtrip";
  return_date_from?: string;
  return_date_to?: string;
  max_connections: number;
  max_duration_hours: number;
  markup_percent: number;
}

export interface MatrixEntry {
  total_price: number;
  longhaul_price: number;
  intraeu_price: number;
  hub: string;
  currency: string;
  longhaul_offer_id: string;
  intraeu_offer_id: string;
  longhaul_airline: string;
  intraeu_airline: string;
  longhaul_duration_minutes: number;
  intraeu_duration_minutes: number;
  longhaul_departure_time: string;
  intraeu_departure_time: string;
  longhaul_connections: number;
  intraeu_connections: number;
  // Direct flight baseline (cheapest single ticket)
  direct_price: number | null;
  direct_airline: string;
  direct_duration_minutes: number;
  direct_connections: number;
  direct_departure_time: string;
  // Best split alternative (populated when direct wins)
  split_price?: number;
  split_hub?: string;
  // Historical price intelligence (Camada 3)
  hist_avg: number | null;
  deal_pct: number | null;   // positive = below avg (deal), negative = above avg
  trend: "up" | "down" | "stable" | null;
  hist_obs: number;
}

export type Matrix = Record<string, Record<string, Record<string, MatrixEntry>>>;

export interface RoundTripDirectOffer {
  total: number;
  outbound: number;
  return: number;
  outbound_airline: string;
  return_airline: string;
  outbound_duration_minutes: number;
  return_duration_minutes: number;
  outbound_connections: number;
  return_connections: number;
  outbound_date: string;
  return_date: string;
}

export interface SplitRTOffer {
  total: number;
  lh_total: number;
  eu_total: number;
  hub: string;
  lh_airline: string;
  eu_airline: string;
  outbound_date: string;
  return_date: string;
}

export interface JobResult {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  matrix: Matrix | null;
  return_matrix: Matrix | null;
  roundtrip_direct: Record<string, Record<string, Record<string, RoundTripDirectOffer>>> | null;
  split_rt: Record<string, Record<string, SplitRTOffer>> | null;
  logs: string[];
  error: string | null;
}

const BASE = "/api";

export async function startSearch(payload: SearchPayload): Promise<string> {
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const data: JobResult = await res.json();
  return data.job_id;
}

export async function pollJob(jobId: string): Promise<JobResult> {
  const res = await fetch(`${BASE}/search/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export class TimeoutWithPartialResult extends Error {
  matrix: Matrix;
  return_matrix: Matrix | null;
  constructor(matrix: Matrix, return_matrix: Matrix | null) {
    super("Search timed out — showing partial results");
    this.matrix = matrix;
    this.return_matrix = return_matrix;
  }
}

export async function waitForMatrix(
  jobId: string,
  onProgress: (status: string, newLogs: string[]) => void,
  intervalMs = 2000,
  timeoutMs = 480_000
): Promise<JobResult> {
  const deadline = Date.now() + timeoutMs;
  let lastMatrix: Matrix = {};
  let lastReturnMatrix: Matrix | null = null;
  let seenLogs = 0;
  let completeAt: number | null = null;

  while (Date.now() < deadline) {
    const result = await pollJob(jobId);
    const newLogs = result.logs.slice(seenLogs);
    seenLogs = result.logs.length;
    onProgress(result.status, newLogs);
    if (result.matrix) lastMatrix = result.matrix;
    if (result.return_matrix) lastReturnMatrix = result.return_matrix;
    if (result.status === "failed") throw new Error(result.error ?? "Search failed");

    if (result.status === "complete" && result.matrix) {
      // Keep polling for up to 90s after complete to capture background round-trip results
      if (completeAt === null) completeAt = Date.now();
      if (result.roundtrip_direct || Date.now() - completeAt > 90_000) {
        return result;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new TimeoutWithPartialResult(lastMatrix, lastReturnMatrix);
}
