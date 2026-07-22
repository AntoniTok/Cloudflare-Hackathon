// ============================================================================
// AGENT & ORCHESTRATION — Person A (branch: feature/agent)
// ----------------------------------------------------------------------------
// TransformerAgent (Durable Object, Agents SDK).
//   @callable({ streaming: true }) transform(stream, req)
//     1. emit {type:"status"}
//     2. content = extract(req.url, env)        [Person B]  (retried + timed out)
//     3. for await fragment of generate(...)    [Person C]  (timed out)
//          → emit {type:"chunk", html: fragment}
//     4. save full HTML to env.PAGES under id, emit {type:"done", id}
//     5. on failure emit {type:"error", msg}
//   @callable() history()  → recent transforms (for demo / picking backups)
//
// Also owns wrangler.jsonc + Worker entrypoint (routeAgentRequest) and the
// GET /view/{id} route (Person D reads PAGES; handler lives here).
//
// Agents SDK v0.2.35 API notes (verified against installed types):
//   - StreamingResponse.send(chunk: unknown)  — accepts objects, sends as-is
//   - StreamingResponse.end(finalChunk?)       — ends the stream
//   - no .close()/.error(); represent errors as an AgentEvent then end()
//   - no built-in this.retry(); we use a small local withRetry() helper
//   - this.sql`...` is a synchronous tagged template returning rows
//   - @callable uses TC39 decorators → experimentalDecorators MUST be false
// ============================================================================

import { Agent, callable, routeAgentRequest, type StreamingResponse } from "agents";
import type { AgentEvent, TransformRequest } from "../CONTRACTS";
import type { Env } from "../env";
import { extract } from "../extract";
import { generate } from "../generate";

const EXTRACT_TIMEOUT_MS = 20_000;
const GENERATE_TIMEOUT_MS = 60_000;
const PAGE_TTL_SECONDS = 60 * 60 * 24; // 24h — plenty for the demo window

/** Reject if `promise` doesn't settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Retry a flaky async op with exponential backoff. */
async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 500 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}

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
    const send = (e: AgentEvent) => stream.send(e);

    try {
      if (!req?.url || !req?.instruction) {
        send({ type: "error", msg: "Missing url or instruction" });
        stream.end();
        return;
      }

      let target: URL;
      try {
        target = new URL(req.url);
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          throw new Error("URL must be http(s)");
        }
      } catch {
        send({ type: "error", msg: `Invalid URL: ${req.url}` });
        stream.end();
        return;
      }

      send({ type: "status", msg: `Fetching ${target.hostname}` });
      const content = await withTimeout(
        withRetry(() => extract(target.href, this.env), { attempts: 3 }),
        EXTRACT_TIMEOUT_MS,
        "extract",
      );

      send({ type: "status", msg: "Generating new experience" });
      let html = "";
      const start = Date.now();
      for await (const fragment of generate(content, req.instruction, this.env)) {
        if (Date.now() - start > GENERATE_TIMEOUT_MS) {
          throw new Error(`generate timed out after ${GENERATE_TIMEOUT_MS}ms`);
        }
        html += fragment;
        send({ type: "chunk", html: fragment });
      }

      if (!html.trim()) {
        send({ type: "error", msg: "Generator produced no output" });
        stream.end();
        return;
      }

      send({ type: "status", msg: "Saving" });
      const id = crypto.randomUUID();
      await this.env.PAGES.put(id, html, { expirationTtl: PAGE_TTL_SECONDS });

      this.ensureSchema();
      this.sql`INSERT INTO transforms (id, url, instruction, created_at)
        VALUES (${id}, ${target.href}, ${req.instruction}, ${Date.now()})`;

      send({ type: "done", id });
      stream.end();
    } catch (err) {
      send({ type: "error", msg: err instanceof Error ? err.message : String(err) });
      stream.end();
    }
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
