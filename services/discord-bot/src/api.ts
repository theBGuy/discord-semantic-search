import { type Citation, config, type SearchFilters, type SearchHit } from "@app/shared";

const base = config.SEARCH_API_URL.replace(/\/$/, "");

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`search-api ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export function apiSearch(body: {
  query: string;
  mode: "semantic" | "hybrid";
  filters?: SearchFilters;
}): Promise<{ mode: string; hits: SearchHit[] }> {
  return post("/search", body);
}

export function apiAsk(body: {
  question: string;
  filters?: SearchFilters;
}): Promise<{ answer: string; citations: Citation[] }> {
  return post("/ask", body);
}

type AccessFilters = Pick<SearchFilters, "guildIds" | "channelIds">;

export function apiSummarize(body: {
  channelId?: string;
  hours?: number;
  filters?: AccessFilters;
}): Promise<{ summary: string; messageCount: number }> {
  return post("/summarize", body);
}

export function apiDigest(body: {
  hours?: number;
  filters?: AccessFilters;
}): Promise<{ digest: string; messageCount: number }> {
  return post("/digest", body);
}

export function apiKb(body: {
  topic: string;
  kind: string;
  filters?: AccessFilters;
}): Promise<{ content: string; citations: Citation[] }> {
  return post("/kb", body);
}
