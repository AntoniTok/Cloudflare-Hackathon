// ============================================================================
// CONTRACTS.ts — SINGLE SOURCE OF TRUTH
// ----------------------------------------------------------------------------
// Every module in Internet Transformer depends on these types. DO NOT change
// a shape without telling the whole team — three other modules break if you do.
// ============================================================================

/**
 * Output of the extraction pipeline (Person B).
 * Consumed by the generator (Person C) via the agent (Person A).
 */
export type ExtractedContent = {
  url: string;
  title: string;
  text: string;
  images: string[];
  links: { href: string; label: string }[];
  /** base64 PNG. Only present on the SPA / Browser Rendering path. */
  screenshot?: string;
};

/**
 * Events streamed from TransformerAgent (Person A) to the frontend (Person D)
 * over the WebSocket. The frontend switches on `type`.
 */
export type AgentEvent =
  | { type: "status"; msg: string }
  | { type: "chunk"; html: string } // streamed HTML fragment; append in order
  | { type: "done"; id: string } // saved to KV; viewable at /view/{id}
  | { type: "error"; msg: string };

/**
 * Request payload sent from the frontend to the agent's transform() method.
 */
export type TransformRequest = {
  url: string;
  instruction: string;
};
