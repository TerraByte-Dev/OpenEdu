// AND-token substring match used by the Settings search box: every whitespace-separated term in the query
// must appear (case-insensitively) in the haystack. Pure → unit-tested.
export function matchText(haystack: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const h = haystack.toLowerCase();
  return terms.every((t) => h.includes(t));
}
