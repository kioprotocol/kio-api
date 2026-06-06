import { KIO_SYSTEM_PROMPT } from "./prompt.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Verdict = "AGREE" | "PUSHBACK" | "CORRECTED";

export interface KioReply {
  label: Verdict;
  text: string;
  raw: string;
}

const VALID: Verdict[] = ["AGREE", "PUSHBACK", "CORRECTED"];

/**
 * Parse the leading [LABEL] off the model output.
 * Falls back to PUSHBACK (KIO's default stance) if no clean label is found.
 */
export function parseVerdict(raw: string): KioReply {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\[?\s*(AGREE|PUSHBACK|CORRECTED)\s*\]?/i);
  let label: Verdict = "PUSHBACK";
  let text = trimmed;

  if (m) {
    const found = m[1].toUpperCase() as Verdict;
    if (VALID.includes(found)) {
      label = found;
      text = trimmed.slice(m[0].length).trim();
    }
  }
  // strip a leading bracket leftover if model wrote "[AGREE]\n\n..."
  text = text.replace(/^\]?\s*/, "").trim();
  return { label, text: text || trimmed, raw: trimmed };
}

export async function callKio(
  message: string,
  opts: { apiKey: string; model: string; referer?: string; title?: string }
): Promise<KioReply> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      // OpenRouter attribution headers (optional but recommended)
      "HTTP-Referer": opts.referer ?? "https://kioprotocol.xyz",
      "X-Title": opts.title ?? "KIO — Keep It Out",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 400,
      temperature: 0.4,
      messages: [
        { role: "system", content: KIO_SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Empty completion from OpenRouter");

  return parseVerdict(content);
}
