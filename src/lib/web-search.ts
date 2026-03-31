import { fetch } from "@tauri-apps/plugin-http";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export async function searchTavily(
  query: string,
  apiKey: string,
  numResults = 5,
): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      max_results: numResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const data = await response.json() as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "";

  let text = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join("\n\n");

  // Cap at 3000 chars to avoid bloating the research prompt
  if (text.length > 3000) {
    text = text.slice(0, 3000) + "...";
  }
  return text;
}
