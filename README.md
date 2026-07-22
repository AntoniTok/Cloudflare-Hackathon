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
Browser (React shell: URL + instruction)
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
| Frontend         | React + Vite, sandboxed `<iframe>`                |
| Deploy           | Wrangler                                          |

Fallback generation models if Kimi latency is too high: `@cf/zai/glm-5.2` or
`@cf/qwen/qwen2.5-coder-32b-instruct`.

## Shared contracts

All modules build against [`src/CONTRACTS.ts`](src/CONTRACTS.ts). Do not change a shape
without telling the team.

- `ExtractedContent` — extraction output (B → C)
- `AgentEvent` — WebSocket events (A → D)
- `TransformRequest` — `{ url, instruction }` (D → A)

## Division of labour

| Person | Branch             | Owns                                                        |
| ------ | ------------------ | ---------------------------------------------------------- |
| A      | `feature/agent`    | `src/agent` — TransformerAgent DO, orchestration, `wrangler.jsonc`, Worker entry |
| B      | `feature/extract`  | `src/extract` — `extract(url, env)` static + SPA paths     |
| C      | `feature/generate` | `src/generate` — `generate(content, instruction, env)` streaming + prompt |
| D      | `feature/frontend` | `src/frontend` + `src/view` — React shell, iframe, `/view/{id}`, demo |

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

Generated pages render in `<iframe srcDoc={html} sandbox="allow-scripts" />`.
**Never add `allow-same-origin`** — keeping it off is what isolates generated JS from our
app. The generator must therefore output a single self-contained HTML doc (inline
`<style>`/`<script>`, no external CDNs/imports/fonts).
