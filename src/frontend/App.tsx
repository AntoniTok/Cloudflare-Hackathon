import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import type { AgentEvent, TransformRequest } from "../CONTRACTS";

type Phase = "idle" | "transforming" | "complete" | "error";

const presets: Array<TransformRequest & { label: string }> = [
  {
    label: "Docs dungeon",
    url: "https://developers.cloudflare.com/workers/",
    instruction:
      "Turn this documentation into a dungeon crawler where each concept unlocks the next room.",
  },
  {
    label: "Site dating game",
    url: "https://www.cloudflare.com/",
    instruction:
      "Turn this website into a playful dating game where visitors match with the right product.",
  },
  {
    label: "Article on trial",
    url: "https://blog.cloudflare.com/",
    instruction:
      "Put this page on trial. Present its main claims as evidence and let the visitor deliver a verdict.",
  },
];

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;

  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "status":
    case "error":
      return typeof event.msg === "string";
    case "chunk":
      return typeof event.html === "string";
    case "done":
      return typeof event.id === "string";
    default:
      return false;
  }
}

function normalizeUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  const parsed = new URL(candidate);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Enter an http or https URL.");
  }

  return parsed.toString();
}

export default function App() {
  const [sessionName] = useState(() => crypto.randomUUID());
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Waiting for a page to transform");
  const [error, setError] = useState("");
  const [html, setHtml] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [pageId, setPageId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const activeRequestId = useRef(0);
  const terminalRequestId = useRef<number | null>(null);
  const requestPending = useRef(false);
  const requestTimeout = useRef<number | null>(null);
  const htmlRef = useRef("");

  const clearRequestTimeout = () => {
    if (requestTimeout.current !== null) {
      window.clearTimeout(requestTimeout.current);
      requestTimeout.current = null;
    }
  };

  const failRequest = (message: string, requestId: number) => {
    if (requestId !== activeRequestId.current) return;

    clearRequestTimeout();
    requestPending.current = false;
    activeRequestId.current += 1;
    setIsRunning(false);
    setPhase("error");
    setStatus("Transformation stopped");
    setError(message);
  };

  const agent = useAgent({
    agent: "TransformerAgent",
    name: sessionName,
    onOpen: () => setIsConnected(true),
    onClose: () => {
      setIsConnected(false);
      if (requestPending.current) {
        failRequest(
          "The agent connection was interrupted. Please try the transformation again.",
          activeRequestId.current,
        );
      }
    },
  });

  useEffect(() => {
    htmlRef.current = html;

    if (!html) setPreviewHtml("");
    if (phase === "complete") setPreviewHtml(html);
  }, [html, phase]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      setPreviewHtml(htmlRef.current);
    }, 500);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => () => clearRequestTimeout(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!instruction.trim()) {
      setPhase("error");
      setStatus("Transformation needs a brief");
      setError("Describe how you want the page to be transformed.");
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(url);
    } catch {
      setPhase("error");
      setStatus("Transformation needs a source");
      setError("Enter a valid website URL.");
      return;
    }

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;
    terminalRequestId.current = null;
    requestPending.current = true;
    setIsRunning(true);
    setUrl(normalizedUrl);
    setPhase("transforming");
    setStatus("Sending the page to the transformer");
    setError("");
    setHtml("");
    setPreviewHtml("");
    setPageId("");
    setCopyState("idle");
    clearRequestTimeout();
    requestTimeout.current = window.setTimeout(() => {
      failRequest(
        "The transformation took longer than two minutes. Please try again.",
        requestId,
      );
    }, 120_000);

    const handleEvent = (value: unknown) => {
      if (requestId !== activeRequestId.current) return;

      if (!isAgentEvent(value)) {
        failRequest(
          "The agent returned an event the interface could not understand.",
          requestId,
        );
        return;
      }

      switch (value.type) {
        case "status":
          setStatus(value.msg);
          break;
        case "chunk":
          setHtml((current) => current + value.html);
          break;
        case "done":
          terminalRequestId.current = requestId;
          setPageId(value.id);
          setStatus("Transformation complete");
          setPhase("complete");
          break;
        case "error":
          terminalRequestId.current = requestId;
          setPhase("error");
          setStatus("Transformation stopped");
          setError(value.msg);
          break;
      }
    };

    try {
      await agent.call("transform", [
        { url: normalizedUrl, instruction: instruction.trim() },
      ], {
        onChunk: handleEvent,
        onDone: () => {
          if (requestId !== activeRequestId.current) return;

          clearRequestTimeout();
          requestPending.current = false;
          setIsRunning(false);
          if (terminalRequestId.current !== requestId) {
            failRequest(
              "The transformation ended before a saved page was returned.",
              requestId,
            );
          }
        },
        onError: (message) => failRequest(message, requestId),
      });
    } catch (caught) {
      failRequest(
        caught instanceof Error ? caught.message : "Unable to reach the agent.",
        requestId,
      );
    }
  };

  const selectPreset = (preset: (typeof presets)[number]) => {
    if (isRunning) return;
    setUrl(preset.url);
    setInstruction(preset.instruction);
    setError("");
  };

  const reset = () => {
    if (isRunning) return;
    setPhase("idle");
    setStatus("Waiting for a page to transform");
    setError("");
    setHtml("");
    setPreviewHtml("");
    setPageId("");
    setCopyState("idle");
  };

  const sharePath = pageId ? `/view/${encodeURIComponent(pageId)}` : "";
  const copyShareLink = async () => {
    if (!sharePath) return;

    try {
      await navigator.clipboard.writeText(
        new URL(sharePath, window.location.origin).toString(),
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const hasPreview = html.length > 0 && previewHtml.length > 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Internet Transformer home">
          <span className="brand-mark" aria-hidden="true">
            IT
          </span>
          <span>Internet Transformer</span>
        </a>
        <div className="connection" data-connected={isConnected}>
          <span className="connection-dot" aria-hidden="true" />
          {isConnected ? "Agent online" : "Connecting"}
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Software has no final form</p>
        <h1 id="page-title">
          Give any page a
          <span> different reality.</span>
        </h1>
        <p className="intro-copy">
          Enter a URL, describe the experience you want, and watch the original
          information reassemble itself into something new.
        </p>
      </section>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p className="panel-kicker">Transformation brief</p>
              <h2>Choose the raw material</h2>
            </div>
          </div>

          <form onSubmit={submit}>
            <label htmlFor="source-url">Website URL</label>
            <div className="url-field">
              <span aria-hidden="true">//</span>
              <input
                id="source-url"
                name="url"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="example.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={isRunning}
                maxLength={2048}
                required
              />
            </div>

            <label htmlFor="instruction">Creative instruction</label>
            <textarea
              id="instruction"
              name="instruction"
              placeholder="Turn this documentation into a dungeon..."
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={isRunning}
              maxLength={1000}
              rows={6}
              required
            />

            <div className="presets" aria-label="Example transformations">
              <span>Try a direction</span>
              <div className="preset-list">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => selectPreset(preset)}
                    disabled={isRunning}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <button className="transform-button" type="submit" disabled={isRunning}>
              <span>{isRunning ? "Transforming" : "Transform this page"}</span>
              <span className="button-arrow" aria-hidden="true">
                {isRunning ? "···" : "↗"}
              </span>
            </button>
          </form>

          <div className="status-block" data-phase={phase} aria-live="polite">
            <span className="status-index" aria-hidden="true">
              {phase === "complete" ? "✓" : phase === "error" ? "!" : "02"}
            </span>
            <div>
              <p>{status}</p>
              {error && <span>{error}</span>}
            </div>
          </div>
        </aside>

        <section className="result-panel" aria-labelledby="result-title">
          <div className="result-heading">
            <div>
              <p className="panel-kicker">Live output</p>
              <h2 id="result-title">The transformed internet</h2>
            </div>
            <span className="phase-label" data-phase={phase}>
              {phase}
            </span>
          </div>

          <div className="browser-frame">
            <div className="browser-bar" aria-hidden="true">
              <div className="browser-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="browser-address">
                {pageId ? `internet-transformer/view/${pageId.slice(0, 8)}...` : "new-experience.html"}
              </div>
              <span className="browser-spark">✦</span>
            </div>

            <div className="preview-stage">
              {hasPreview ? (
                <iframe
                  title="Generated interactive webpage"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="empty-preview">
                  <div className="orbit" aria-hidden="true">
                    <span>WWW</span>
                  </div>
                  <p>{isRunning ? "The new interface is taking shape" : "No fixed form"}</p>
                  <span>
                    {isRunning
                      ? "The first generated fragments will appear here."
                      : "Your transformed page will materialize in this frame."}
                  </span>
                </div>
              )}

              {isRunning && hasPreview && (
                <div className="building-indicator" aria-live="polite">
                  <span />
                  Building live
                </div>
              )}
            </div>
          </div>

          {pageId && (
            <div className="share-bar">
              <div>
                <span>Shareable for 24 hours</span>
                <strong>{sharePath}</strong>
              </div>
              <button type="button" onClick={copyShareLink}>
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy link"}
              </button>
              <a href={sharePath} target="_blank" rel="noreferrer">
                Open page ↗
              </a>
            </div>
          )}

          {(phase === "complete" || phase === "error") && (
            <button className="reset-button" type="button" onClick={reset}>
              Start another transformation
            </button>
          )}
        </section>
      </section>

      <footer>
        <span>Built at the edge</span>
        <span>Cloudflare Workers · Agents · AI</span>
      </footer>
    </main>
  );
}
