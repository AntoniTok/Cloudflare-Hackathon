import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAgent } from "agents/react";
import type { AgentEvent } from "../CONTRACTS";
import { agentConnection, createShareUrl, workerOrigin } from "./config";

type Phase = "connecting" | "transforming" | "complete" | "error";

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

function getViewerInput() {
  const params = new URLSearchParams(window.location.search);
  return {
    url: params.get("url") ?? "",
    instruction: params.get("instruction") ?? "",
  };
}

type InterfaceIconName = "back" | "edit" | "share" | "collapse";

function InterfaceIcon({ name }: { name: InterfaceIconName }) {
  let drawing: ReactNode;

  switch (name) {
    case "edit":
      drawing = <path d="m5 19 3.7-.8L19 7.9 16.1 5 5.8 15.3 5 19Zm9.6-12.5 2.9 2.9" />;
      break;
    case "share":
      drawing = <path d="M14 5h5v5M19 5l-8 8M18 13v6H5V6h6" />;
      break;
    case "collapse":
      drawing = <path d="m14 6-6 6 6 6" />;
      break;
    case "back":
      drawing = <path d="M19 12H5m6-6-6 6 6 6" />;
      break;
  }

  return (
    <svg className="interface-icon" viewBox="0 0 24 24" aria-hidden="true">
      {drawing}
    </svg>
  );
}

export default function App() {
  const initialInput = useRef(getViewerInput());
  const [sessionName] = useState(() => crypto.randomUUID());
  const [url] = useState(initialInput.current.url);
  const [instruction, setInstruction] = useState(initialInput.current.instruction);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [status, setStatus] = useState("Connecting to the transformer");
  const [error, setError] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [pageId, setPageId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const sandboxFrame = useRef<HTMLIFrameElement>(null);
  const [sandboxReady, setSandboxReady] = useState(false);
  const autoStarted = useRef(false);
  const activeRequestId = useRef(0);
  const terminalRequestId = useRef<number | null>(null);
  const requestPending = useRef(false);
  const requestTimeout = useRef<number | null>(null);
  const streamHtml = useRef("");
  const showLiveStream = useRef(true);

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
    host: agentConnection.host,
    protocol: agentConnection.protocol,
    onOpen: () => setIsConnected(true),
    onClose: () => {
      setIsConnected(false);
      if (requestPending.current) {
        failRequest(
          "The connection was interrupted. Check the Worker URL and try again.",
          activeRequestId.current,
        );
      }
    },
  });

  const runTransformation = async (prompt: string) => {
    if (requestPending.current || !url) return;

    if (!prompt.trim()) {
      setPhase("error");
      setStatus("A prompt is required");
      setError("Describe how you want this page to change.");
      setSidebarOpen(true);
      return;
    }

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;
    terminalRequestId.current = null;
    requestPending.current = true;
    streamHtml.current = "";
    showLiveStream.current = !previewHtml;
    setIsRunning(true);
    setInstruction(prompt.trim());
    setPhase("transforming");
    setStatus(previewHtml ? "Building a new version" : "Opening the source page");
    setError("");
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
        failRequest("The agent returned an event we could not understand.", requestId);
        return;
      }

      switch (value.type) {
        case "status":
          setStatus(value.msg);
          break;
        case "chunk":
          streamHtml.current += value.html;
          break;
        case "done":
          terminalRequestId.current = requestId;
          setPreviewHtml(streamHtml.current);
          setPageId(value.id);
          setStatus("Transformation complete");
          setPhase("complete");
          break;
        case "error":
          terminalRequestId.current = requestId;
          setPhase("error");
          setStatus("Transformation stopped");
          setError(value.msg);
          setSidebarOpen(true);
          break;
      }
    };

    try {
      await agent.call("transform", [{ url, instruction: prompt.trim() }], {
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

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (!url || !instruction) {
      setPhase("error");
      setStatus("Missing transformation details");
      setError("Open Internet Transformer from its side panel to start a transformation.");
      setSidebarOpen(true);
      return;
    }
    void runTransformation(instruction);
  }, [instruction, url]);

  useEffect(() => {
    if (!isRunning || !showLiveStream.current) return;

    const interval = window.setInterval(() => {
      if (streamHtml.current) setPreviewHtml(streamHtml.current);
    }, 500);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (!sandboxReady || !previewHtml || !sandboxFrame.current?.contentWindow) return;
    sandboxFrame.current.contentWindow.postMessage(
      { type: "internet-transformer:render", html: previewHtml },
      "*",
    );
  }, [previewHtml, sandboxReady]);

  useEffect(() => () => clearRequestTimeout(), []);

  const submitRevision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runTransformation(instruction);
  };

  const returnToSource = () => {
    if (/^https?:\/\//i.test(url)) window.location.assign(url);
  };

  const shareUrl = pageId ? createShareUrl(pageId) : "";
  const copyShareLink = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <main className="viewer-app">
      <header className="viewer-bar">
        <div className="viewer-brand" aria-label="Internet Transformer">
          <span className="brand-mark" aria-hidden="true"><i /><i /></span>
          <strong>IT</strong>
        </div>
        <button className="back-source" type="button" onClick={returnToSource}>
          <InterfaceIcon name="back" />
          <strong>Source</strong>
        </button>
        <div className="viewer-address">
          <span>Viewing</span>
          <p>{url.replace(/^https?:\/\//, "")}</p>
        </div>
        <div className="viewer-connection" data-connected={isConnected}>
          <i />
          <span>{isConnected ? "Agent live" : "Connecting"}</span>
        </div>
      </header>

      <section className="viewer-workspace">
        <aside
          className="viewer-sidebar"
          data-open={sidebarOpen}
          aria-label="Transformation controls"
        >
          <div className="viewer-rail">
            <button
              className="rail-brand"
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-expanded={sidebarOpen}
              aria-controls="viewer-sidebar-panel"
              title="Transformation controls"
            >
              <span className="brand-mark" aria-hidden="true"><i /><i /></span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Edit transformation"
              title="Edit transformation"
            >
              <InterfaceIcon name="edit" />
            </button>
            <button
              type="button"
              onClick={returnToSource}
              aria-label="Return to original page"
              title="Original page"
            >
              <InterfaceIcon name="back" />
            </button>
            <div className="rail-fill" />
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open shared page"
                title="Open shared page"
              >
                <InterfaceIcon name="share" />
              </a>
            )}
            <span className="phase-dot" data-phase={phase} title={status} />
          </div>

          <div className="viewer-sidebar-panel" id="viewer-sidebar-panel">
            <div className="viewer-sidebar-heading">
              <div>
                <span>Control surface</span>
                <h1>Reframe the page</h1>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse controls"
              >
                <InterfaceIcon name="collapse" />
              </button>
            </div>

            <div className="source-card">
              <span>Source material</span>
              <strong>{url.replace(/^https?:\/\//, "")}</strong>
            </div>

            <form className="edit-form" onSubmit={submitRevision}>
              <label htmlFor="viewer-prompt">New direction</label>
              <textarea
                id="viewer-prompt"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                disabled={isRunning}
                maxLength={1000}
                rows={9}
              />
              <button type="submit" disabled={isRunning}>
                <span>{isRunning ? "Transforming..." : "Build this version"}</span>
                <b aria-hidden="true"><InterfaceIcon name="share" /></b>
              </button>
            </form>

            <div className="transform-status" data-phase={phase} aria-live="polite">
              <div>
                <i />
                <strong>{status}</strong>
              </div>
              {error && <p>{error}</p>}
            </div>

            {shareUrl && (
              <div className="viewer-share-card">
                <span>Published version</span>
                <strong>{shareUrl}</strong>
                <div>
                  <button type="button" onClick={copyShareLink}>
                    {copyState === "copied"
                      ? "Copied"
                      : copyState === "failed"
                        ? "Try again"
                        : "Copy link"}
                  </button>
                  <a href={shareUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </div>
            )}

            <div className="worker-note">
              <span>Agent route</span>
              <strong>{new URL(workerOrigin).host}</strong>
            </div>

            <button className="return-button" type="button" onClick={returnToSource}>
              <InterfaceIcon name="back" /> Return to source
            </button>
          </div>
        </aside>

        <div className="generated-viewport">
          <iframe
            ref={sandboxFrame}
            className="sandbox-frame"
            title="Sandboxed transformed page"
            src="sandbox.html"
            onLoad={() => setSandboxReady(true)}
          />

          {!previewHtml && phase !== "error" && (
            <div className="viewer-loading">
              <div className="transform-stage" aria-hidden="true">
                <span className="stage-source">SOURCE</span>
                <div className="stage-lens"><i /><i /></div>
                <span className="stage-output">NEW RULES</span>
              </div>
              <span className="loading-kicker">Transformation in progress</span>
              <h2>Rewriting the interface</h2>
              <p>{status}</p>
              <div className="progress-track" aria-hidden="true">
                <span />
              </div>
            </div>
          )}

          {phase === "error" && !previewHtml && (
            <div className="viewer-error">
              <span>ERR</span>
              <h2>Transformation failed</h2>
              <p>{error}</p>
              <button type="button" onClick={() => setSidebarOpen(true)}>
                Edit the prompt
              </button>
            </div>
          )}

          {phase === "error" && previewHtml && (
            <button className="error-toast" type="button" onClick={() => setSidebarOpen(true)}>
              <span>!</span> Revision failed. Open controls to retry.
            </button>
          )}

          {isRunning && previewHtml && (
            <div className="floating-status" aria-live="polite">
              <span /> {status}
            </div>
          )}

          <button
            className="touch-edit-button"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-expanded={sidebarOpen}
            aria-controls="viewer-sidebar-panel"
          >
            <InterfaceIcon name="edit" /> Edit
          </button>
        </div>
      </section>
    </main>
  );
}
