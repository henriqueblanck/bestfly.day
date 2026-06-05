export interface SearchPayload {
  origins: string[];
  destinations: string[];
  hubs: string[];
  date_from: string;
  date_to: string;
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
}

export type Matrix = Record<string, Record<string, Record<string, MatrixEntry>>>;

export interface JobResult {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  matrix: Matrix | null;
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
  constructor(matrix: Matrix) {
    super("Search timed out — showing partial results");
    this.matrix = matrix;
  }
}

export async function waitForMatrix(
  jobId: string,
  onProgress: (status: string) => void,
  intervalMs = 2000,
  timeoutMs = 240_000
): Promise<Matrix> {
  const deadline = Date.now() + timeoutMs;
  let lastMatrix: Matrix = {};
  while (Date.now() < deadline) {
    const result = await pollJob(jobId);
    onProgress(result.status);
    if (result.matrix) lastMatrix = result.matrix;
    if (result.status === "complete" && result.matrix) return result.matrix;
    if (result.status === "failed") throw new Error(result.error ?? "Search failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new TimeoutWithPartialResult(lastMatrix);
}
