# Internet Transformer

Turn any existing webpage into a completely new interactive experience on demand.

Give it a URL and a creative instruction — "turn this restaurant website into a dating
game", "put this news article on trial", "make this documentation into a dungeon" — and it
understands the original content, preserves the useful information, and generates a new
interface around it in seconds.

**We do NOT edit the live site.** We extract its content, then an LLM generates a fresh,
self-contained HTML page that renders live in a sandboxed iframe and is saved to a shareable
`/view/{id}` URL.

## Architecture

```
Chrome active tab ──► Extension side panel (prompt)
                              │
                              ▼
                     Full-tab React viewer
                              │  WebSocket (useAgent)
                              ▼
Worker (routeAgentRequest)  ── GET /view/{id} → serves saved HTML from KV
   │
   ▼
TransformerAgent (Durable Object, Agents SDK)
   ├─ 1. extract(url)              → src/extract   (Person B)
   ├─ 2. generate(content, instr)  → src/generate  (Person C)
   ├─ 3. stream {type:"chunk"} events to client
   └─ 4. save final HTML to KV, emit {type:"done", id}
```

## Tech stack

| Layer            | Choice                                            |
| ---------------- | ------------------------------------------------- |
| Runtime          | Cloudflare Workers                                |
| Session/state    | Durable Objects via Agents SDK (`TransformerAgent`) |
| Real-time        | WebSocket (`useAgent` / `@callable` streaming)    |
| Extraction (static) | `fetch` + `HTMLRewriter`                       |
| Extraction (SPA) | Browser Rendering (Puppeteer) → HTML + screenshot |
| Generation       | Workers AI `@cf/moonshotai/kimi-k2.7-code` (vision) |
| Storage          | DO SQLite (session) + KV (shareable `/view/{id}`) |
| Frontend         | Manifest V3 Chrome extension + React + Vite       |
| Isolation        | Manifest sandbox page + nested `allow-scripts` iframe |
| Deploy           | Wrangler backend + unpacked/packaged extension    |

Fallback generation models if Kimi latency is too high: `@cf/zai/glm-5.2` or
`@cf/qwen/qwen2.5-coder-32b-instruct`.

## Shared contracts

All modules build against [`src/CONTRACTS.ts`](src/CONTRACTS.ts). Do not change a shape
without telling the team.

- `ExtractedContent` — extraction output (B → C)
- `AgentEvent` — WebSocket events (A → D)
- `TransformRequest` — `{ url, instruction }` (D → A)

## Connecting backend work to the frontend

The frontend does not import the extraction or generation modules directly. Integration flows
through `TransformerAgent`, so Persons B and C only need to keep their exported functions and
the types in [`src/CONTRACTS.ts`](src/CONTRACTS.ts) unchanged:

```text
extract(url, env) -> ExtractedContent
                              |
                              v
generate(content, instruction, env) -> AsyncIterable<string>
                              |
                              v
TransformerAgent -> AgentEvent stream -> React frontend
```

- **Person B:** replace the mock in `src/extract/index.ts`. Return `ExtractedContent`; do not
  send frontend events.
- **Person C:** replace the mock in `src/generate/index.ts`. Yield HTML strings in order; the
  agent wraps each string as `{ type: "chunk", html }`.
- **Person A:** keep `transform` callable and emit the exact `AgentEvent` union. Send
  `{ type: "done", id }` only after the complete HTML has been saved to `PAGES`, then end the
  stream.
- **Person D:** no changes should be needed when B or C lands if the contracts remain stable.

The frontend connects with `useAgent` from `agents/react`. With the installed
`agents@0.2.35`, streaming callbacks are passed directly as the third argument to
`agent.call` (not nested under a `stream` property):

```tsx
const agent = useAgent({
  agent: "TransformerAgent",
  name: sessionId,
  host: agentConnection.host,
  protocol: agentConnection.protocol,
});

await agent.call("transform", [{ url, instruction }], {
  onChunk: (value) => {
    // value is one full AgentEvent object; validate it and switch on value.type.
  },
  onDone: () => {
    // Transport stream ended. The share id comes from the AgentEvent above.
  },
  onError: (message) => {
    // WebSocket/RPC error. Domain errors arrive as { type: "error", msg }.
  },
});
```

The event behavior expected by `src/frontend/App.tsx` is:

| Event | Frontend behavior |
| ----- | ----------------- |
| `{ type: "status", msg }` | Updates the progress message |
| `{ type: "chunk", html }` | Appends HTML to the sandboxed live preview |
| `{ type: "done", id }` | Shows the shareable `/view/{id}` link |
| `{ type: "error", msg }` | Stops the run and presents a retryable error |

To test all modules together, start the Worker backend:

```bash
npm install
npm run dev
```

Build the extension in another terminal:

```bash
VITE_WORKER_ORIGIN=http://localhost:8787 npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select
`extension-dist/`. Open a normal website and click the extension action. The side panel reads
the active tab URL; submitting a prompt replaces that tab with the full-page viewer. The
viewer's edge rail expands on hover or keyboard focus for revisions and sharing.

For a deployed backend, build with its origin instead:

```bash
VITE_WORKER_ORIGIN=https://<worker>.<subdomain>.workers.dev npm run build
```

`extension-dist/` is generated and ignored by Git. All extension source, including its
manifest source and sandbox, lives under `src/frontend/`.

## Division of labour

| Person | Branch             | Owns                                                        |
| ------ | ------------------ | ---------------------------------------------------------- |
| A      | `feature/agent`    | `src/agent` — TransformerAgent DO, orchestration, `wrangler.jsonc`, Worker entry |
| B      | `feature/extract`  | `src/extract` — `extract(url, env)` static + SPA paths     |
| C      | `feature/generate` | `src/generate` — `generate(content, instruction, env)` streaming + prompt |
| D      | `feature/frontend` | `src/frontend` — Chrome extension, sandboxed viewer, demo  |

## Workflow

```bash
git clone https://github.com/AntoniTok/Cloudflare-Hackathon.git
cd Cloudflare-Hackathon
npm install
git checkout -b feature/<your-role>   # agent | extract | generate | frontend
# ...work, commit...
git push -u origin feature/<your-role>
# open a PR into main
```

**Build against mocks first** so no one is blocked in hour 1. Integrate at the checkpoints.

## The iframe security boundary (read this, Person D especially)

Generated pages never execute in a privileged extension page. `viewer.html` sends generated
HTML to the manifest-declared `sandbox.html` page using `postMessage`; that page renders it in
`<iframe srcDoc={html} sandbox="allow-scripts" />`. **Never add `allow-same-origin`** or give
the sandbox access to `chrome.*`. The generator must output one self-contained HTML document
with inline styles and scripts and no external code imports.
