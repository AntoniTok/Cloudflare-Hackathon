# Team Guide — Internet Transformer

## Everyone: start here

```bash
git checkout main && git pull && npm install
git checkout -b feature/<your-role>   # agent | extract | generate | frontend
# work, commit, push:
git push -u origin feature/<your-role>
# open a PR into main
```

- **`src/CONTRACTS.ts` is the source of truth.** Do not change those types without telling
  the group — three other modules break if you do.
- Build against the mocks that already exist; integrate at the checkpoints.
- Don't push to `main` directly. PRs only.

## Already done (on `main`)

- Agent orchestration (`src/agent/index.ts`) — calls `extract()` and `generate()` per the
  contracts, streams events, saves to KV, serves `/view/{id}`.
- `wrangler dev` works out of the box: committed `public/index.html` placeholder + bundling
  deps (`ai`, `@cloudflare/workers-types`).
- `PAGES` KV namespace created and wired in `wrangler.jsonc` — **do not touch KV config.**

## Installed SDK reality (verified — differs from some docs)

`agents` is **v0.2.35**:

- Streaming callable: `StreamingResponse.send(chunk)` + `.end(finalChunk?)`. No
  `.close()`/`.error()` — errors are sent as an `AgentEvent` then `.end()`.
- `@callable` uses TC39 decorators → `experimentalDecorators` MUST stay `false`.

## Role notes

**B (extract):** `extract(url, env)` is wired in. Replace the mock in `src/extract/index.ts`.
Use `env.BROWSER` for the SPA/Puppeteer path. Throw a clear `Error` on failure — the agent
catches it and streams an error event.

**C (generate):** `generate(content, instruction, env)` async-generator is wired in — every
string you `yield` is streamed to the client as a chunk. Model: `@cf/moonshotai/kimi-k2.7-code`
(fallbacks: `@cf/zai/glm-5.2`, `@cf/qwen/qwen2.5-coder-32b-instruct`). Verify the exact
`env.AI.run(..., { stream: true })` return shape against the installed SDK.

**D (frontend):** Call the agent like this (v0.2.35):

```ts
agent.call("transform", [{ url, instruction }], {
  stream: {
    onChunk: (e) => { /* e is an AgentEvent: status | chunk | done | error */ },
    onDone:  () => {},
    onError: (msg) => {},
  },
});
```

`onChunk` receives the full `AgentEvent` object — switch on `e.type`. On `{type:"done", id}`
link to `/view/{id}`. Render chunks in `<iframe srcDoc sandbox="allow-scripts">` — never add
`allow-same-origin`.

---

# opencode prompts (paste into opencode inside your cloned repo)

## Person A — Agent & Orchestration

```
We're building "Internet Transformer" for a Cloudflare hackathon (team of 4). It takes a
URL + a creative instruction (e.g. "turn this restaurant site into a dating game") and
generates a brand-new interactive webpage from the original site's content. We do NOT edit
the live site — we extract its content, then an LLM generates a fresh standalone HTML page,
rendered live in a sandboxed iframe and saved to a shareable /view/{id} URL.

Stack: Cloudflare Workers + Agents SDK (Durable Objects) + Workers AI (kimi-k2.7-code) +
Browser Rendering + KV. Single Worker serves API + React frontend. Repo:
github.com/AntoniTok/Cloudflare-Hackathon. Work on branch feature/agent, PR into main.

YOUR ROLE: the Agent & orchestration layer. Build the TransformerAgent Durable Object using
the Agents SDK. It exposes a @callable({streaming:true}) method transform(req:
TransformRequest) that:
  1. emits {type:"status"} events
  2. calls extract(url) [Person B's module — mock it: import type ExtractedContent from
     CONTRACTS.ts and return a fake object until B's code lands]
  3. calls generate(content, instruction) [Person C's streaming module — mock it too]
  4. streams each HTML fragment as {type:"chunk", html}
  5. saves final HTML to KV under a generated id, emits {type:"done", id}
  6. on failure emits {type:"error", msg}
Also own wrangler.jsonc: DO binding + migration for TransformerAgent, AI binding, KV
namespace "PAGES", Browser Rendering binding "BROWSER". Set up routeAgentRequest in the
Worker entrypoint. Do NOT enable experimentalDecorators in tsconfig (breaks @callable).

CONNECTS TO: You import extract() from src/extract (Person B) and generate() from
src/generate (Person C) — both typed by CONTRACTS.ts. Frontend (Person D) connects to your
agent via useAgent and receives your AgentEvent stream. Keep the AgentEvent shape EXACTLY as
in CONTRACTS.ts. Build against mocks first so you're never blocked.

Consult the Agents SDK docs (developers.cloudflare.com/agents) for callable streaming,
routing, and KV usage.
```

## Person B — Extraction pipeline

```
We're building "Internet Transformer" for a Cloudflare hackathon (team of 4). It takes a
URL + a creative instruction (e.g. "turn this restaurant site into a dating game") and
generates a brand-new interactive webpage from the original site's content. We do NOT edit
the live site — we extract its content, then an LLM generates a fresh standalone HTML page.

Stack: Cloudflare Workers + Agents SDK (Durable Objects) + Workers AI (kimi-k2.7-code) +
Browser Rendering + KV. Single Worker. Repo: github.com/AntoniTok/Cloudflare-Hackathon.
Work on branch feature/extract, PR into main.

YOUR ROLE: the content extraction pipeline. Export one function:
  extract(url: string, env: Env): Promise<ExtractedContent>   // type from CONTRACTS.ts
Two paths:
  - STATIC (default): fetch(url), parse with HTMLRewriter to pull title, main text, image
    URLs, and links{href,label}. Fast, native.
  - SPA FALLBACK: if the static HTML body is empty/thin (heuristic: <500 chars of text),
    use Browser Rendering (Puppeteer via the BROWSER binding) to render the page, then grab
    rendered HTML + a base64 PNG screenshot into the screenshot field.
Handle failures gracefully (bot blocks, timeouts) — throw a clear Error; never hang.

CONNECTS TO: Person A's TransformerAgent imports and calls your extract(). Your output
(ExtractedContent) is consumed by Person C's generate(). The shape MUST match CONTRACTS.ts
exactly. Test in isolation with a few URLs (a news article, a docs page, a JS-heavy SPA)
before integration.

Consult developers.cloudflare.com for HTMLRewriter and Browser Rendering (Puppeteer)
binding setup. The BROWSER binding is already configured in wrangler.jsonc.
```

## Person C — Generation & prompting

```
We're building "Internet Transformer" for a Cloudflare hackathon (team of 4). It takes a
URL + a creative instruction (e.g. "turn this restaurant site into a dating game") and
generates a brand-new interactive webpage from the original site's content. We do NOT edit
the live site — we extract content, then YOUR module has an LLM generate a fresh standalone
HTML page that renders in a sandboxed iframe.

Stack: Cloudflare Workers + Agents SDK + Workers AI (kimi-k2.7-code, vision-capable) + KV.
Single Worker. Repo: github.com/AntoniTok/Cloudflare-Hackathon. Work on branch
feature/generate, PR into main.

YOUR ROLE: the generation layer. Export a streaming function:
  generate(content: ExtractedContent, instruction: string, env: Env): AsyncIterable<string>
Call Workers AI: env.AI.run("@cf/moonshotai/kimi-k2.7-code", {...}, {stream:true}).
When content.screenshot exists, pass it to the model's vision input for better layout.
Own the PROMPT: it must instruct the model to output ONE self-contained HTML document —
inline <style> and <script>, NO external CDNs/imports/fonts — because it renders inside an
iframe with sandbox="allow-scripts" (no allow-same-origin, no network to your app). Preserve
the useful info from content (title, key text, images by URL) while transforming the
experience per instruction. Keep a faster fallback model noted (glm-5.2 or
qwen2.5-coder-32b-instruct) in case kimi latency is too high.

CONNECTS TO: Person B's extract() produces the ExtractedContent you receive. Person A's
TransformerAgent calls your generate() and forwards each yielded fragment as an
{type:"chunk", html} AgentEvent to the frontend. Types come from CONTRACTS.ts. Test your
prompt standalone with a hardcoded ExtractedContent object and eyeball the generated HTML in
a browser before integration.

Consult developers.cloudflare.com/workers-ai for the AI binding, streaming, and the
kimi-k2.7-code model page for the exact input schema and vision usage.
```

## Person D — Frontend, /view route, demo

```
We're building "Internet Transformer" for a Cloudflare hackathon (team of 4). It takes a
URL + a creative instruction (e.g. "turn this restaurant site into a dating game") and
generates a brand-new interactive webpage from the original site's content, rendered live in
a sandboxed iframe and saved to a shareable /view/{id} URL. We do NOT edit the live site.

Stack: Cloudflare Workers + Agents SDK + Workers AI + KV. React + Vite frontend served by
the same Worker. Repo: github.com/AntoniTok/Cloudflare-Hackathon. Work on branch
feature/frontend, PR into main.

YOUR ROLE: frontend + view route + demo.
  1. React shell: an input for URL + an input for the transformation instruction, and a
     large result area. On submit, connect to the TransformerAgent via useAgent
     (agents/react) and call its streaming transform() method with {url, instruction}.
  2. Render results in <iframe srcDoc={html} sandbox="allow-scripts" />. Append incoming
     {type:"chunk", html} events to build the page live. Show {type:"status"} messages as a
     progress indicator. On {type:"done", id}, show a shareable link to /view/{id}. Handle
     {type:"error"}. IMPORTANT: sandbox must be "allow-scripts" ONLY — do NOT add
     allow-same-origin (that's the security boundary isolating generated JS from our app).
  3. Worker route GET /view/{id}: already implemented on main (reads KV "PAGES").
  4. Pre-generate and save TWO tested backup transformations; rehearse the live demo.

Call pattern (agents v0.2.35):
  agent.call("transform", [{url, instruction}], {stream:{onChunk, onDone, onError}})
onChunk receives the full AgentEvent object — switch on e.type.

CONNECTS TO: You consume the AgentEvent stream from Person A's TransformerAgent (types in
CONTRACTS.ts) — do not change that shape. The HTML you render is produced by Person C via
Person A. Build against a mock agent that emits fake status/chunk/done events until A's
agent is ready.

Consult developers.cloudflare.com/agents (client SDK: useAgent, calling streaming callable
methods).
```
