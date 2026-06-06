import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import { callKio } from "./kio.js";
import { bumpQuota, logVerdict, recentVerdicts } from "./db.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const KIO_MODEL = process.env.KIO_MODEL ?? "anthropic/claude-haiku-4.5";
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT ?? 15);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ??
  "https://kioprotocol.xyz,https://www.kioprotocol.xyz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!OPENROUTER_API_KEY) {
  console.warn("[boot] OPENROUTER_API_KEY is not set — /chat will fail.");
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  trustProxy: true, // Railway sits behind a proxy; needed for real client IP
});

await app.register(cors, {
  origin: (origin, cb) => {
    // allow same-origin / curl (no origin) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST"],
});

// Coarse network-level guard (per-IP burst). Daily cap is enforced in /chat.
await app.register(rateLimit, {
  max: 30,
  timeWindow: "1 minute",
  keyGenerator: (req) => clientIp(req),
});

function clientIp(req: { ip: string; headers: Record<string, unknown> }): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip;
}

function hashIp(ip: string): string {
  const salt = process.env.IP_SALT ?? "kio";
  return createHash("sha256").update(salt + ip).digest("hex").slice(0, 16);
}

app.get("/health", async () => ({ ok: true, agent: "KIO", model: KIO_MODEL }));

app.get("/verdicts", async () => {
  const items = await recentVerdicts(30);
  return { items };
});

app.post("/chat", async (req, reply) => {
  const body = req.body as { message?: unknown } | undefined;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return reply.code(400).send({ error: "message is required" });
  }
  if (message.length > 1000) {
    return reply.code(400).send({ error: "message too long (max 1000 chars)" });
  }

  const ip = clientIp(req);

  // Daily free quota (Supabase). -1 means no limiting configured.
  const used = await bumpQuota(ip);
  if (used !== -1 && used > FREE_DAILY_LIMIT) {
    return reply.code(429).send({
      error: "daily_limit",
      message:
        "Free daily limit reached. Hold $KIO to unlock unlimited interrogation.",
      limit: FREE_DAILY_LIMIT,
    });
  }

  try {
    const result = await callKio(message, {
      apiKey: OPENROUTER_API_KEY,
      model: KIO_MODEL,
    });

    // fire-and-forget log (don't block the response)
    void logVerdict({
      label: result.label,
      prompt: message,
      text: result.text,
      ip_hash: hashIp(ip),
    });

    return {
      label: result.label,
      text: result.text,
      remaining:
        used === -1 ? null : Math.max(0, FREE_DAILY_LIMIT - used),
    };
  } catch (err) {
    req.log.error({ err }, "kio call failed");
    return reply.code(502).send({ error: "agent_unavailable" });
  }
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`KIO online on :${PORT} (model ${KIO_MODEL})`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
