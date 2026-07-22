// ============================================================================
// AGENT & ORCHESTRATION — Person A (branch: feature/agent)
// ----------------------------------------------------------------------------
// TransformerAgent (Durable Object, Agents SDK).
//   @callable({ streaming: true }) transform(req: TransformRequest)
//     1. emit {type:"status"}
//     2. content = extract(req.url, env)        [Person B]
//     3. for await fragment of generate(...)    [Person C]
//          → emit {type:"chunk", html: fragment}
//     4. save full HTML to env.PAGES under id, emit {type:"done", id}
//     5. on failure emit {type:"error", msg}
//
// Also owns wrangler.jsonc + Worker entrypoint (routeAgentRequest) and the
// GET /view/{id} route (coordinate with Person D who reads PAGES).
//
// Do NOT enable experimentalDecorators in tsconfig (breaks @callable).
// ============================================================================

import { Agent, routeAgentRequest, callable } from "agents";
import type { AgentEvent, TransformRequest } from "../CONTRACTS";
import type { Env } from "../env";

export class TransformerAgent extends Agent<Env> {
  @callable({ streaming: true })
  async transform(
    stream: { send: (e: AgentEvent) => void },
    req: TransformRequest,
  ) {
    // TODO(Person A): wire real extract() + generate(), save to env.PAGES.
    // Consult developers.cloudflare.com/agents for the exact streaming
    // callable signature and confirm it against the installed SDK version.
    stream.send({ type: "status", msg: "starting" });
    stream.send({ type: "error", msg: "not implemented yet" });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET /view/{id} → serve saved HTML from KV (Person D may own this handler)
    if (url.pathname.startsWith("/view/")) {
      const id = url.pathname.slice("/view/".length);
      const html = await env.PAGES.get(id);
      if (!html) return new Response("Not found", { status: 404 });
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    return (
      (await routeAgentRequest(req, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
