# Frontend + /view — Person D (branch: feature/frontend)

## Build here

1. **React shell** (`src/frontend/`): inputs for URL + transformation instruction, a large
   result area. On submit, connect to `TransformerAgent` via `useAgent` (`agents/react`) and
   call its streaming `transform()` method with `{ url, instruction }` (`TransformRequest`).

2. **Live render**: `<iframe srcDoc={html} sandbox="allow-scripts" />`. Append incoming
   `{type:"chunk", html}` events to build the page live. Show `{type:"status"}` as progress.
   On `{type:"done", id}` show a shareable link to `/view/{id}`. Handle `{type:"error"}`.

   > IMPORTANT: sandbox must be `"allow-scripts"` ONLY. Do NOT add `allow-same-origin` —
   > that isolation is the security boundary between generated JS and our app.

3. **/view/{id} route** (`src/view/`): read saved HTML from KV namespace `PAGES` and serve
   as full `text/html`. (A stub already exists in `src/agent/index.ts` — coordinate with
   Person A on who owns the final handler.)

4. **Demo**: pre-generate and save TWO tested backup transformations; rehearse the live demo.

## Connects to

- Consumes the `AgentEvent` stream from Person A's agent (types in `../CONTRACTS.ts`).
- HTML rendered is produced by Person C via Person A.
- Build against a mock agent emitting fake `status`/`chunk`/`done` events until A is ready.

## Docs

- Client SDK (`useAgent`, calling streaming callable methods): developers.cloudflare.com/agents
- Serving static assets from a Worker (Vite build → `./public`, see `wrangler.jsonc` assets).
