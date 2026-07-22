// ============================================================================
// AGENT & ORCHESTRATION — Person A (branch: feature/agent)
// ----------------------------------------------------------------------------
// TransformerAgent (Durable Object, Agents SDK).
//   @callable({ streaming: true }) transform(stream, req)
//     → forwards runPipeline() events to the client, records history on done
//   @callable() history()  → recent transforms (for demo / picking backups)
//
// Worker entrypoint owns:
//   - POST /api/transform  → non-streaming end-to-end (returns { id }/{ error })
//   - GET  /view/{id}      → serves saved HTML from KV (shareable page)
//   - everything else      → routeAgentRequest (WebSocket for the callable API)
//
// Orchestration lives in ./pipeline.ts (shared by the callable + the REST route).
//
// Agents SDK v0.2.35 API notes (verified against installed types):
//   - StreamingResponse.send(chunk) / .end(finalChunk?); no .close()/.error()
//   - this.sql`...` is a synchronous tagged template returning rows
//   - @callable uses TC39 decorators → experimentalDecorators MUST be false
// ============================================================================

import { Agent, callable, routeAgentRequest, type StreamingResponse } from "agents";
import type { AgentEvent, TransformRequest } from "../CONTRACTS";
import type { Env } from "../env";
import { runPipeline } from "./pipeline";

export class TransformerAgent extends Agent<Env> {
  /** Create the history table once per DO instance. */
  private ensureSchema() {
    this.sql`CREATE TABLE IF NOT EXISTS transforms (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      instruction TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`;
  }

  @callable({ streaming: true })
  async transform(stream: StreamingResponse, req: TransformRequest) {
    for await (const event of runPipeline(this.env, req)) {
      stream.send(event);
      if (event.type === "done") {
        this.ensureSchema();
        this.sql`INSERT INTO transforms (id, url, instruction, created_at)
          VALUES (${event.id}, ${req.url}, ${req.instruction}, ${Date.now()})`;
      }
    }
    stream.end();
  }

  /** Recent transforms for this session — handy for the demo and backups. */
  @callable()
  history(limit = 20): { id: string; url: string; instruction: string; created_at: number }[] {
    this.ensureSchema();
    const n = Math.min(Math.max(1, limit), 100);
    return this.sql`SELECT id, url, instruction, created_at
      FROM transforms ORDER BY created_at DESC LIMIT ${n}`;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // POST /api/transform → run one transformation, return { id } (non-streaming)
    if (req.method === "POST" && url.pathname === "/api/transform") {
      let body: TransformRequest;
      try {
        body = (await req.json()) as TransformRequest;
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      let id: string | undefined;
      let error: string | undefined;
      for await (const event of runPipeline(env, body)) {
        if (event.type === "done") id = event.id;
        else if (event.type === "error") error = event.msg;
      }

      if (id) return Response.json({ id, view: `/view/${id}` });
      return Response.json({ error: error ?? "Transformation failed" }, { status: 502 });
    }

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
