// ============================================================================
// EXTRACTION PIPELINE — Person B (branch: feature/extract)
// ----------------------------------------------------------------------------
// Export: extract(url, env) => ExtractedContent
//   STATIC (default): fetch(url) + HTMLRewriter → title/text/images/links
//   SPA FALLBACK: if body text < ~500 chars, use env.BROWSER (Browser Rendering)
//     to render + screenshot; fill `screenshot` (base64 PNG).
// Throw a clear Error on bot-block/timeout — never hang.
//
// Consumed by: src/agent (Person A) → passes result to src/generate (Person C).
// Shape MUST match CONTRACTS.ts exactly.
// ============================================================================

import type { ExtractedContent } from "../CONTRACTS";
import type { Env } from "../env";

export async function extract(url: string, env: Env): Promise<ExtractedContent> {
  // TODO(Person B): implement static path (HTMLRewriter) + SPA fallback (BROWSER).
  // Temporary mock so Person A can integrate immediately:
  return {
    url,
    title: "MOCK: extracted title",
    text: "MOCK: extracted body text from " + url,
    images: [],
    links: [],
  };
}
