// Cues that a question is asking for a time extremum rather than the most relevant snippet.
const FIRST =
  /\b(first|earliest|oldest|begin|began|begun|start|started|starting|create[d]?|introduc\w*|origin\w*|initial\w*|inception|since when)\b/i;
const LAST = /\b(latest|last|newest|most recent|recently|current|currently|up to date)\b/i;

/** Detect temporal-extremum intent so /ask can pull the boundary (oldest/newest) matching
 * message into context — e.g. "when was the X branch started" needs the *earliest* match,
 * which relevance ranking alone won't surface. Returns 'first', 'last', or null. */
export function detectTemporal(question: string): "first" | "last" | null {
  const first = FIRST.test(question);
  const last = LAST.test(question);
  if (first && !last) return "first";
  if (last && !first) return "last";
  if (first && last) return "first"; // ambiguous → prefer the origin
  return null;
}
