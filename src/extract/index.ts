import puppeteer from "@cloudflare/puppeteer";
import type { ExtractedContent } from "../CONTRACTS";
import type { Env } from "../env";

const THIN_TEXT_LENGTH = 500;
const MAX_TEXT_LENGTH = 60_000;
const MAX_TITLE_LENGTH = 300;
const MAX_IMAGES = 30;
const MAX_LINKS = 80;
const MAX_HTML_BYTES = 5_000_000;
// The Agent enforces a 20s extraction deadline, so the fallback must stay inside it.
const STATIC_TIMEOUT_MS = 6_000;
const BROWSER_LAUNCH_TIMEOUT_MS = 4_000;
const BROWSER_RENDER_TIMEOUT_MS = 8_000;
const BROWSER_CLOSE_TIMEOUT_MS = 1_000;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

type PageContent = Pick<ExtractedContent, "title" | "text" | "images" | "links">;

type TextCollector = {
  handler: HTMLRewriterElementContentHandlers;
  value: () => string;
};

export async function extract(url: string, env: Env): Promise<ExtractedContent> {
  const target = normalizeUrl(url);
  const staticContent = await extractStatic(target);

  if (
    staticContent.text.length >= THIN_TEXT_LENGTH &&
    !looksLikeBotBlock(staticContent)
  ) {
    return { url: target.href, ...staticContent };
  }

  try {
    const renderedContent = await extractRendered(target, env);
    return { url: target.href, ...renderedContent };
  } catch (error) {
    throw new Error(
      `Could not extract ${target.href} with Browser Rendering: ${errorMessage(error)}`,
    );
  }
}

async function extractStatic(target: URL): Promise<PageContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATIC_TIMEOUT_MS);

  try {
    const response = await fetch(target.href, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "user-agent": BROWSER_USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Site returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      );
    }

    assertHtmlResponse(response);
    const baseUrl = response.url ? new URL(response.url) : target;
    return await parseHtml(response, baseUrl);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Static fetch timed out after ${STATIC_TIMEOUT_MS / 1_000}s`);
    }

    if (error instanceof Error && error.message.startsWith("Site returned HTTP")) {
      throw error;
    }

    throw new Error(`Static extraction failed for ${target.href}: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function extractRendered(target: URL, env: Env): Promise<PageContent & { screenshot: string }> {
  const launch = puppeteer.launch(env.BROWSER);
  let browser;

  try {
    browser = await withTimeout(
      launch,
      BROWSER_LAUNCH_TIMEOUT_MS,
      "Browser session launch timed out",
    );
  } catch (error) {
    void launch.then((lateBrowser) => lateBrowser.close()).catch(() => undefined);
    throw error;
  }

  try {
    return await withTimeout(
      (async () => {
        const page = await browser.newPage();
        await page.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 });
        await page.setUserAgent(BROWSER_USER_AGENT);

        const navigation = await page.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: 5_000,
        });
        const status = navigation?.status();
        if (status !== undefined && status >= 400) {
          throw new Error(`Site returned HTTP ${status} in the browser`);
        }

        // Give client-side frameworks a short chance to commit their content.
        await page
          .waitForNetworkIdle({ idleTime: 500, timeout: 1_500, concurrency: 2 })
          .catch(() => undefined);

        const renderedHtml = await page.content();
        if (renderedHtml.length > MAX_HTML_BYTES) {
          throw new Error("Rendered page is too large to extract safely");
        }

        const finalUrl = page.url() ? new URL(page.url()) : target;
        const content = await parseHtml(
          new Response(renderedHtml, {
            headers: { "content-type": "text/html;charset=utf-8" },
          }),
          finalUrl,
        );

        if (!hasUsableContent(content)) {
          throw new Error("Browser rendered no readable content");
        }
        if (looksLikeBotBlock(content)) {
          throw new Error("Site blocked automated browser access");
        }

        const screenshot = await page.screenshot({
          type: "png",
          encoding: "base64",
          optimizeForSpeed: true,
        });

        return { ...content, screenshot };
      })(),
      BROWSER_RENDER_TIMEOUT_MS,
      "Browser rendering timed out",
    );
  } finally {
    await withTimeout(
      browser.close(),
      BROWSER_CLOSE_TIMEOUT_MS,
      "Browser cleanup timed out",
    ).catch(() => undefined);
  }
}

async function parseHtml(response: Response, baseUrl: URL): Promise<PageContent> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    await response.body?.cancel();
    throw new Error("Page HTML is too large to extract safely");
  }

  const title = createTextCollector(MAX_TITLE_LENGTH);
  const heading = createTextCollector(MAX_TITLE_LENGTH);
  const body = createTextCollector(MAX_TEXT_LENGTH);
  const main = createTextCollector(MAX_TEXT_LENGTH);
  const roleMain = createTextCollector(MAX_TEXT_LENGTH);
  const article = createTextCollector(MAX_TEXT_LENGTH);
  const images: string[] = [];
  const imageSet = new Set<string>();
  const links: ExtractedContent["links"] = [];
  let metaTitle = "";

  const removeHandler: HTMLRewriterElementContentHandlers = {
    element(element) {
      element.remove();
    },
  };

  const imageHandler: HTMLRewriterElementContentHandlers = {
    element(element) {
      addImageCandidates(
        [
          ...srcsetCandidates(element.getAttribute("srcset")),
          element.getAttribute("src"),
          element.getAttribute("data-src"),
          element.getAttribute("data-lazy-src"),
          element.getAttribute("data-original"),
        ],
        baseUrl,
        images,
        imageSet,
      );
    },
  };

  const linkHandler = createLinkHandler(baseUrl, links);
  const rewriter = new HTMLRewriter()
    .on("script", removeHandler)
    .on("style", removeHandler)
    .on("noscript", removeHandler)
    .on("template", removeHandler)
    .on("svg", removeHandler)
    .on("title", title.handler)
    .on("h1", heading.handler)
    .on("body", body.handler)
    .on("main", main.handler)
    .on('[role="main"]', roleMain.handler)
    .on("article", article.handler)
    .on("img", imageHandler)
    .on("a", linkHandler.handler)
    .on('meta[property="og:title"]', {
      element(element) {
        if (!metaTitle) {
          metaTitle = normalizeText(element.getAttribute("content") ?? "").slice(
            0,
            MAX_TITLE_LENGTH,
          );
        }
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        addImageCandidates(
          [element.getAttribute("content")],
          baseUrl,
          images,
          imageSet,
        );
      },
    });

  await drainResponse(rewriter.transform(response));
  linkHandler.finish();

  const bodyText = body.value();
  const semanticText = [main.value(), roleMain.value(), article.value()].sort(
    (left, right) => right.length - left.length,
  )[0];

  return {
    title: title.value() || metaTitle || heading.value() || baseUrl.hostname,
    text: semanticText.length >= 100 ? semanticText : bodyText,
    images,
    links,
  };
}

function createTextCollector(limit: number): TextCollector {
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = "";
  let length = 0;

  const flush = () => {
    const segment = normalizeText(current);
    current = "";

    if (!segment || seen.has(segment) || length >= limit) return;
    const value = segment.slice(0, limit - length);
    seen.add(segment);
    segments.push(value);
    length += value.length + 1;
  };

  return {
    handler: {
      text(chunk) {
        const remaining = limit - length - current.length;
        if (remaining > 0) current += chunk.text.slice(0, remaining);
        if (chunk.lastInTextNode) flush();
      },
    },
    value() {
      flush();
      return segments.join("\n").slice(0, limit).trim();
    },
  };
}

function createLinkHandler(baseUrl: URL, links: ExtractedContent["links"]) {
  type LinkDraft = { href: string; label: string } | null;
  const active: LinkDraft[] = [];
  const byHref = new Map<string, ExtractedContent["links"][number]>();

  const complete = (draft: LinkDraft) => {
    if (!draft) return;
    const label = normalizeText(draft.label).slice(0, 200) || labelFromUrl(draft.href);
    const existing = byHref.get(draft.href);
    if (existing) {
      if (!existing.label && label) existing.label = label;
      return;
    }

    if (links.length >= MAX_LINKS) return;
    const link = { href: draft.href, label };
    byHref.set(link.href, link);
    links.push(link);
  };

  const handler: HTMLRewriterElementContentHandlers = {
    element(element) {
      const href = resolveLinkUrl(element.getAttribute("href"), baseUrl);
      const draft =
        href && links.length + active.length < MAX_LINKS
          ? {
              href,
              label:
                element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "",
            }
          : null;
      active.push(draft);
      element.onEndTag(() => complete(active.pop() ?? null));
    },
    text(chunk) {
      const draft = active.at(-1);
      if (draft && draft.label.length < 300) {
        draft.label += chunk.text.slice(0, 300 - draft.label.length);
      }
    },
  };

  return {
    handler,
    finish() {
      while (active.length) complete(active.pop() ?? null);
    },
  };
}

function addImageCandidates(
  candidates: Array<string | null>,
  baseUrl: URL,
  images: string[],
  seen: Set<string>,
): void {
  for (const candidate of candidates) {
    if (images.length >= MAX_IMAGES) return;
    const image = resolveHttpUrl(candidate, baseUrl);
    if (!image || seen.has(image)) continue;
    seen.add(image);
    images.push(image);
    return;
  }
}

function srcsetCandidates(srcset: string | null): Array<string | null> {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0] || null)
    .reverse();
}

function resolveHttpUrl(value: string | null, baseUrl: URL): string | null {
  if (!value) return null;

  try {
    const resolved = new URL(value.trim(), baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

function resolveLinkUrl(value: string | null, baseUrl: URL): string | null {
  if (!value) return null;

  try {
    const resolved = new URL(value.trim(), baseUrl);
    return ["http:", "https:", "mailto:", "tel:"].includes(resolved.protocol)
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): URL {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("URL is required");

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid URL");
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing credentials are not supported");
  }

  return parsed;
}

function assertHtmlResponse(response: Response): void {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    void response.body?.cancel();
    throw new Error(`URL returned ${contentType}, not HTML`);
  }
}

async function drainResponse(response: Response): Promise<void> {
  if (!response.body) throw new Error("Page returned an empty response body");

  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("Page HTML is too large to extract safely");
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const failure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });

  try {
    return await Promise.race([promise, failure]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function hasUsableContent(content: PageContent): boolean {
  return Boolean(content.text || content.images.length || content.links.length);
}

function looksLikeBotBlock(content: PageContent): boolean {
  const sample = `${content.title} ${content.text.slice(0, 2_000)}`.toLowerCase();
  return [
    "verify you are human",
    "checking your browser",
    "enable javascript and cookies to continue",
    "unusual traffic from your computer network",
    "attention required! | cloudflare",
    "access denied",
  ].some((marker) => sample.includes(marker));
}

function labelFromUrl(href: string): string {
  try {
    const parsed = new URL(href);
    if (parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
      return decodeURIComponent(parsed.pathname);
    }
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 200);
  } catch {
    return href.slice(0, 200);
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
