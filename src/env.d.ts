// Shared environment bindings. Matches wrangler.jsonc.
// If you add a binding, update wrangler.jsonc too and tell the team.

export interface Env {
  /** Workers AI — generation (Person C) */
  AI: Ai;
  /** Browser Rendering — SPA extraction fallback (Person B) */
  BROWSER: Fetcher;
  /** Durable Object namespace for the agent (Person A) */
  TransformerAgent: DurableObjectNamespace;
  /** KV for saved /view/{id} pages (Person A writes, Person D reads) */
  PAGES: KVNamespace;
}
