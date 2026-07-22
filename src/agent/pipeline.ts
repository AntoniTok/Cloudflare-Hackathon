// ============================================================================
// SHARED TRANSFORM PIPELINE
// ----------------------------------------------------------------------------
// The single orchestration used by BOTH:
//   - the streaming @callable transform() (forwards each event to the client)
//   - the non-streaming POST /api/transform route (consumes to completion)
//
// Yields AgentEvents (CONTRACTS.ts). Validation → extract (retry+timeout) →
// generate (timeout) → save to KV → {type:"done", id}. Never throws to the
// caller; failures are yielded as {type:"error"}.
// ============================================================================

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

/**
 * Run one transformation end to end, yielding progress events.
 * The KV write happens here; the caller decides what to do with {done, id}.
 */
export async function* runPipeline(
  env: Env,
  req: TransformRequest,
): AsyncIterable<AgentEvent> {
  try {
    if (!req?.url || !req?.instruction) {
      yield { type: "error", msg: "Missing url or instruction" };
      return;
    }

    let target: URL;
    try {
      target = new URL(req.url);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error("URL must be http(s)");
      }
    } catch {
      yield { type: "error", msg: `Invalid URL: ${req.url}` };
      return;
    }

    yield { type: "status", msg: `Fetching ${target.hostname}` };
    const content = await withTimeout(
      withRetry(() => extract(target.href, env), { attempts: 3 }),
      EXTRACT_TIMEOUT_MS,
      "extract",
    );

    yield { type: "status", msg: "Generating new experience" };
    let html = "";
    const start = Date.now();
    for await (const fragment of generate(content, req.instruction, env)) {
      if (Date.now() - start > GENERATE_TIMEOUT_MS) {
        throw new Error(`generate timed out after ${GENERATE_TIMEOUT_MS}ms`);
      }
      html += fragment;
      yield { type: "chunk", html: fragment };
    }

    if (!html.trim()) {
      yield { type: "error", msg: "Generator produced no output" };
      return;
    }

    yield { type: "status", msg: "Saving" };
    const id = crypto.randomUUID();
    await env.PAGES.put(id, html, { expirationTtl: PAGE_TTL_SECONDS });

    yield { type: "done", id };
  } catch (err) {
    yield { type: "error", msg: err instanceof Error ? err.message : String(err) };
  }
}
