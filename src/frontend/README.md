# Chrome extension frontend

Everything in this directory is source for the Manifest V3 extension. Vite writes the
loadable package to `extension-dist/`; do not edit generated files there.

## Surfaces

| Source | Purpose |
| ------ | ------- |
| `SidePanel.tsx` | Reads the active Chrome tab, accepts a prompt, and opens the viewer |
| `App.tsx` | Full-tab viewer, Agent stream handling, revision sidebar, and sharing |
| `sandbox.html` | Unique-origin renderer and message bridge for generated HTML |
| `static/manifest.json` | Manifest V3 permissions, side panel, CSP, and sandbox declaration |
| `static/background.js` | Opens the side panel when the toolbar action is clicked |

The viewer connects to the Cloudflare `TransformerAgent`; the extension never imports the
extractor or generator directly. `config.ts` reads `VITE_WORKER_ORIGIN` and derives the
WebSocket host and protocol used by `useAgent`.

## Local development

Start the backend:

```bash
npm run dev
```

Build the extension:

```bash
VITE_WORKER_ORIGIN=http://localhost:8787 npm run build
```

Then open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select
`extension-dist/`. After source changes, rebuild and click the extension's reload button.
Use `npm run dev:extension` to rebuild continuously.

For a deployed Worker:

```bash
VITE_WORKER_ORIGIN=https://<worker>.<subdomain>.workers.dev npm run build
```

The manifest currently permits localhost and `*.workers.dev`. Add a custom production origin
to both `host_permissions` and `content_security_policy.extension_pages` if the Worker moves
to another domain.

## Security boundary

The normal extension pages retain Chrome APIs, so generated code must never be inserted into
their DOM. The viewer posts HTML to the manifest sandbox page, which has a unique origin and
no `chrome.*` access. The nested generated-page iframe must remain
`sandbox="allow-scripts"` without `allow-same-origin`.
