// ============================================================================
// AGENT & ORCHESTRATION — Person A (branch: feature/agent)
// ----------------------------------------------------------------------------
// TransformerAgent (Durable Object, Agents SDK).
//   @callable({ streaming: true }) transform(stream, req)
//     1. emit {type:"status"}
//     2. content = extract(req.url, env)        [Person B]
//     3. for await fragment of generate(...)    [Person C]
//          → emit {type:"chunk", html: fragment}
//     4. save full HTML to env.PAGES under id, emit {type:"done", id}
//     5. on failure emit {type:"error", msg}
//
// Also owns wrangler.jsonc + Worker entrypoint (routeAgentRequest) and the
// GET /view/{id} route (Person D reads PAGES; handler lives here).
//
// Agents SDK v0.2.35 API notes (verified against installed types):
//   - StreamingResponse.send(chunk: unknown)  — accepts objects, sends as-is
//   - StreamingResponse.end(finalChunk?)       — ends the stream
//   - no .close()/.error(); represent errors as an AgentEvent then end()
//   - @callable uses TC39 decorators → experimentalDecorators MUST be false
// ============================================================================

import { Agent, callable, routeAgentRequest, type StreamingResponse } from "agents";
import type { AgentEvent, TransformRequest } from "../CONTRACTS";
import type { Env } from "../env";
import { extract } from "../extract";
import { generate } from "../generate";

export class TransformerAgent extends Agent<Env> {
  @callable({ streaming: true })
  async transform(stream: StreamingResponse, req: TransformRequest) {
    const send = (e: AgentEvent) => stream.send(e);

    try {
      if (!req?.url || !req?.instruction) {
        send({ type: "error", msg: "Missing url or instruction" });
        stream.end();
        return;
      }

      send({ type: "status", msg: `Fetching ${req.url}` });
      const content = await extract(req.url, this.env);

      send({ type: "status", msg: "Generating new experience" });
      let html = "";
      for await (const fragment of generate(content, req.instruction, this.env)) {
        html += fragment;
        send({ type: "chunk", html: fragment });
      }

      send({ type: "status", msg: "Saving" });
      const id = crypto.randomUUID();
      // Keep for the demo window; tweak TTL as needed (min 60s).
      await this.env.PAGES.put(id, html, { expirationTtl: 60 * 60 * 24 });

      send({ type: "done", id });
      stream.end();
    } catch (err) {
      send({ type: "error", msg: err instanceof Error ? err.message : String(err) });
      stream.end();
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET /view/{id} → serve saved HTML from KV (shareable standalone page)
    if (url.pathname.startsWith("/view/")) {
      const id = url.pathname.slice("/view/".length);
      if (!id) return new Response("Missing id", { status: 400 });
      const html = await env.PAGES.get(id);
      if (!html) return new Response("Not found", { status: 404 });
      return new Response(html, {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    }

    return (
      (await routeAgentRequest(req, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
