import assert from "node:assert/strict";
import test from "node:test";

import { generate } from "./index.ts";

const content = {
  url: "https://example.com/restaurant",
  title: "Night Orchard",
  text: "A seasonal restaurant with a six-course tasting menu.",
  images: ["https://example.com/dining-room.jpg"],
  links: [{ href: "https://example.com/book", label: "Book a table" }],
};

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function createStream(body, splitAt = []) {
  const bytes = new TextEncoder().encode(body);
  const boundaries = [0, ...splitAt, bytes.length];

  return new ReadableStream({
    start(controller) {
      for (let index = 0; index < boundaries.length - 1; index += 1) {
        controller.enqueue(bytes.slice(boundaries[index], boundaries[index + 1]));
      }
      controller.close();
    },
  });
}

function createEnv(stream, capture = {}) {
  return {
    AI: {
      async run(model, input) {
        capture.model = model;
        capture.input = input;
        return stream;
      },
    },
  };
}

async function collect(iterable) {
  const fragments = [];
  for await (const fragment of iterable) fragments.push(fragment);
  return fragments;
}

test("streams Kimi content deltas and sends a vision prompt", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning":"planning"}}]}',
    'data: {"choices":[{"delta":{"content":"<!doctype html>"}}]}',
    'data: {"choices":[{"delta":{"content":"<html></html>"}}]}',
    "data: [DONE]",
    "",
  ].join("\r\n\r\n");
  const capture = {};
  const env = createEnv(createStream(sse, [1, 7, 41, 103]), capture);

  const fragments = await collect(
    generate(
      { ...content, screenshot: ` ${PNG_BASE64}\n` },
      " turn this into a dating game ",
      env,
    ),
  );

  assert.deepEqual(fragments, ["<!doctype html>", "<html></html>"]);
  assert.equal(capture.model, "@cf/moonshotai/kimi-k2.7-code");
  assert.equal(capture.input.stream, true);

  const [systemMessage, userMessage] = capture.input.messages;
  assert.match(systemMessage.content, /raw HTML only/);
  assert.match(systemMessage.content, /sandbox="allow-scripts"/);
  assert.match(systemMessage.content, /Do not call fetch/);
  assert.ok(Array.isArray(userMessage.content));
  assert.match(userMessage.content[0].text, /turn this into a dating game/);
  assert.match(userMessage.content[0].text, /Night Orchard/);
  assert.equal(
    userMessage.content[1].image_url.url,
    `data:image/png;base64,${PNG_BASE64}`,
  );
});

test("supports text-only input and legacy Workers AI stream events", async () => {
  const sse = [
    'data: {"response":"<!doctype html>"}',
    'data: {"response":"<html></html>"}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const capture = {};
  const env = createEnv(createStream(sse, [29, 72]), capture);

  const fragments = await collect(generate(content, "Make it a mystery", env));

  assert.deepEqual(fragments, ["<!doctype html>", "<html></html>"]);
  assert.equal(typeof capture.input.messages[1].content, "string");
});

test("surfaces errors delivered inside the AI stream", async () => {
  const env = createEnv(
    createStream('data: {"error":{"message":"model overloaded"}}\n\n'),
  );

  await assert.rejects(
    collect(generate(content, "Make it playful", env)),
    /Workers AI generation failed: model overloaded/,
  );
});

test("rejects a generation truncated by the model", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"<!doctype html><html>"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
    "",
  ].join("\n\n");
  const env = createEnv(createStream(sse));

  await assert.rejects(
    collect(generate(content, "Make it playful", env)),
    /generation ended with length/,
  );
});

test("rejects a stream that closes without a completion marker", async () => {
  const env = createEnv(
    createStream(
      'data: {"choices":[{"delta":{"content":"<!doctype html><html></html>"}}]}\n\n',
    ),
  );

  await assert.rejects(
    collect(generate(content, "Make it playful", env)),
    /stream ended before generation completed/,
  );
});

test("accepts CR-only SSE framing and a stop finish reason", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"<!doctype html>"}}]}',
    'data: {"choices":[{"delta":{"content":"<html></html>"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "",
  ].join("\r\r");
  const env = createEnv(createStream(sse, [5, 67, 119]));

  assert.deepEqual(await collect(generate(content, "Make it playful", env)), [
    "<!doctype html>",
    "<html></html>",
  ]);
});

test("cancels inference when the consumer stops reading", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"<!doctype html>"}}]}\n\n',
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  const iterator = generate(
    content,
    "Make it playful",
    createEnv(stream),
  )[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value, "<!doctype html>");
  await iterator.return();
  assert.equal(cancelled, true);
});

test("rejects invalid screenshot data before calling AI", async () => {
  let called = false;
  const env = {
    AI: {
      async run() {
        called = true;
        return createStream("");
      },
    },
  };

  await assert.rejects(
    collect(
      generate(
        { ...content, screenshot: "aGVsbG8=" },
        "Make it playful",
        env,
      ),
    ),
    /screenshot is not a PNG/,
  );
  assert.equal(called, false);
});

test("rejects an empty transformation instruction before calling AI", async () => {
  let called = false;
  const env = {
    AI: {
      async run() {
        called = true;
        return createStream("");
      },
    },
  };

  await assert.rejects(
    collect(generate(content, "   ", env)),
    /transformation instruction is required/,
  );
  assert.equal(called, false);
});
