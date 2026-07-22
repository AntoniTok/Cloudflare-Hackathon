// ============================================================================
// GENERATION LAYER — Person C (branch: feature/generate)
// ----------------------------------------------------------------------------
// Export: generate(content, instruction, env) => AsyncIterable<string>
//   Streams HTML fragments. Calls Workers AI:
//     env.AI.run("@cf/moonshotai/kimi-k2.7-code", {...}, { stream: true })
//   If content.screenshot exists, pass it as vision input.
//
// THE PROMPT MUST demand ONE self-contained HTML document:
//   - inline <style> and <script>
//   - NO external CDNs / imports / fonts
//   (renders inside iframe sandbox="allow-scripts", no network to our app)
//
// Fallback models if kimi latency too high:
//   @cf/zai/glm-5.2  or  @cf/qwen/qwen2.5-coder-32b-instruct
//
// Consumed by: src/agent (Person A) forwards each fragment as {type:"chunk"}.
// ============================================================================

import type { ExtractedContent } from "../CONTRACTS";
import type { Env } from "../env";

export async function* generate(
  content: ExtractedContent,
  instruction: string,
  env: Env,
): AsyncIterable<string> {
  // TODO(Person C): real streaming call to env.AI.run(...).
  // Temporary mock so Person A / D can integrate immediately:
  yield "<!doctype html><html><body><h1>MOCK</h1>";
  yield `<p>Transform "${content.title}" → ${instruction}</p>`;
  yield "</body></html>";
}
