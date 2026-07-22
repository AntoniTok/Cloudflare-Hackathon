import { useEffect, useState, type FormEvent } from "react";
import { workerOrigin } from "./config";

const promptIdeas = [
  "Dungeon crawler",
  "Courtroom trial",
  "Dating game",
];

function getSourceFromExtensionUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "chrome-extension:" && parsed.pathname.endsWith("viewer.html")) {
      return parsed.searchParams.get("url") ?? "";
    }
  } catch {
    return "";
  }

  return value;
}

function normalizeUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https pages can be transformed.");
  }
  return parsed.toString();
}

export default function SidePanel() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [tabTitle, setTabTitle] = useState("Current tab");
  const [error, setError] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    const readActiveTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      setTabId(tab.id);
      setTabTitle(tab.title || "Current tab");
      const source = getSourceFromExtensionUrl(tab.url || "");
      if (/^https?:\/\//i.test(source)) {
        setUrl(source);
        setError("");
      } else {
        setUrl("");
        setError("Open a regular website before transforming it.");
      }
    };

    void readActiveTab();
    const updateFromTab = () => void readActiveTab();
    chrome.tabs.onActivated.addListener(updateFromTab);
    chrome.tabs.onUpdated.addListener(updateFromTab);

    void chrome.storage.local.get("lastInstruction").then((stored) => {
      if (typeof stored.lastInstruction === "string") {
        setInstruction(stored.lastInstruction);
      }
    });

    return () => {
      chrome.tabs.onActivated.removeListener(updateFromTab);
      chrome.tabs.onUpdated.removeListener(updateFromTab);
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tabId === null || isOpening) return;

    if (!instruction.trim()) {
      setError("Describe how you want this page to change.");
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a valid URL.");
      return;
    }

    setIsOpening(true);
    setError("");
    await chrome.storage.local.set({ lastInstruction: instruction.trim() });
    const query = new URLSearchParams({
      url: normalizedUrl,
      instruction: instruction.trim(),
    });

    try {
      await chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL(`viewer.html?${query.toString()}`),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the viewer.");
      setIsOpening(false);
    }
  };

  let sourceHost = "No page selected";
  try {
    sourceHost = new URL(url).hostname.replace(/^www\./, "") || sourceHost;
  } catch {
    // Keep the empty-state label while the URL is incomplete.
  }

  return (
    <main className="side-panel-app">
      <header className="panel-brand">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <p>
            <strong>Internet</strong>
            <span>Transformer</span>
          </p>
        </div>
        <span className="panel-live"><i /> Agent ready</span>
      </header>

      <section className="panel-intro">
        <span className="panel-kicker">Shape what you see</span>
        <h1>
          <span>Same page.</span>
          <strong>Different rules.</strong>
        </h1>
        <p>Give the current page a new premise. The useful content stays; the interface mutates.</p>
      </section>

      <section className="current-page">
        <div className="section-label">
          <span>Source captured</span>
          <i aria-hidden="true" />
        </div>
        <div className="source-readout">
          <span className="source-tag">URL</span>
          <p>
            <strong>{sourceHost}</strong>
            <span>{tabTitle}</span>
          </p>
        </div>
      </section>

      <form className="panel-form" onSubmit={submit}>
        <label htmlFor="extension-url">Source address</label>
        <input
          id="extension-url"
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com"
          maxLength={2048}
          required
        />

        <div className="prompt-heading">
          <label htmlFor="extension-prompt">Set the new premise</label>
          <span>Plain language works best</span>
        </div>
        <div className="panel-prompt">
          <textarea
            id="extension-prompt"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Turn this restaurant into a dating game..."
            maxLength={1000}
            rows={8}
            required
          />
          <span>{instruction.length}/1000</span>
        </div>

        <div className="idea-list">
          {promptIdeas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setInstruction(`Turn this page into a ${idea.toLowerCase()}`)}
            >
              <span aria-hidden="true">+</span> {idea}
            </button>
          ))}
        </div>

        {error && (
          <div className="panel-error" role="alert">
            <span>!</span>
            {error}
          </div>
        )}

        <button className="panel-submit" type="submit" disabled={!url || isOpening}>
          <span>{isOpening ? "Opening viewer..." : "Transform this page"}</span>
          <b aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </b>
        </button>
      </form>

      <footer className="panel-footer">
        <span><i /> Agent online</span>
        <code>{new URL(workerOrigin).host}</code>
      </footer>
    </main>
  );
}
