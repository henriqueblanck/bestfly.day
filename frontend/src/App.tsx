import { useState } from "react";
import { SearchForm } from "./components/SearchForm";
import { PriceMatrix } from "./components/PriceMatrix";
import { startSearch, waitForMatrix } from "./api/search";
import type { Matrix, SearchPayload } from "./api/search";

export default function App() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);

  async function handleSearch(payload: SearchPayload) {
    setLoading(true);
    setError(null);
    setMatrix(null);
    setOrigins(payload.origins);
    setActiveOrigin(payload.origins[0]);
    try {
      const jobId = await startSearch(payload);
      const result = await waitForMatrix(jobId, (s) => setStatus(s));
      setMatrix(result);
      setStatus("complete");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
      <SearchForm onSubmit={handleSearch} loading={loading} />

      {loading && (
        <div style={{ color: "#888", fontSize: 13 }}>
          ⏳ {status || "queued"} — fetching concurrent batches…
        </div>
      )}

      {error && (
        <div style={{ color: "#f66", background: "#1a0000", border: "1px solid #500", borderRadius: 8, padding: "12px 16px", maxWidth: 640, width: "100%" }}>
          {error}
        </div>
      )}

      {matrix && (
        <div style={{ maxWidth: "100%", width: "100%" }}>
          {origins.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {origins.map((o) => (
                <button key={o} onClick={() => setActiveOrigin(o)} style={{
                  padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                  background: activeOrigin === o ? "#1a3a1a" : "#111122",
                  border: `1px solid ${activeOrigin === o ? "#4c4" : "#333"}`,
                  color: activeOrigin === o ? "#6f6" : "#888",
                }}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <PriceMatrix matrix={matrix} origin={activeOrigin ?? origins[0]} />
        </div>
      )}
    </div>
  );
}
