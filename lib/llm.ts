// One adapter boundary. A future paid provider implements this same interface;
// no provider SDKs or direct model calls belong in brain.ts.
import { GAP_REPLIES, isSafeLlmSay } from "./llm-policy";
export interface LlmRequest {
  system: string;
  user: string;
  candidateCount: number;
  allowedReplies: string[];
}

export interface LanguageModel {
  completeJson(request: LlmRequest): Promise<string>;
}

export function parseLlmReply(raw: string, allowedReplies: string[] = GAP_REPLIES): string | null {
  if (raw.length > 2000) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object" ||
      Object.keys(value).length !== 1 || typeof value.say !== "string") return null;
    const say = value.say.replace(/\s+/g, " ").trim();
    if (!say || say.length > 240 || say.split(/\s+/).length > 45) return null;
    if (!isSafeLlmSay(say) || !allowedReplies.includes(say)) return null;
    return say;
  } catch {
    return null;
  }
}

export function createGroqProvider(apiKey: string, model: string, transport: typeof fetch = fetch): LanguageModel {
  return {
    async completeJson(request) {
      const response = await transport("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_completion_tokens: 256,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
        // One bounded attempt; no hidden retries or provider failover.
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error("LLM request failed");
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Missing LLM reply");
      return content;
    },
  };
}

export function getLanguageModel(): LanguageModel | null {
  // Explicit opt-in: API keys alone must not trigger spending.
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase() || "none";
  if (provider !== "groq" || !process.env.GROQ_API_KEY?.trim()) return null;
  return createGroqProvider(process.env.GROQ_API_KEY, process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant");
}
