import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import Anthropic from "@anthropic-ai/sdk";

admin.initializeApp();

// Stored as a Firebase secret — never in the repo. Set it once with:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Only this account may call the parser (matches the Realtime Database rules).
const OWNER_EMAIL = "mechev14@gmail.com";

// The shape the tracker's parse form expects back, enforced server-side so the
// model can't return anything off-schema.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["company", "role", "address", "website", "hmContact", "notes"],
  properties: {
    company:   { type: "string", description: "The hiring company's name only — not the job board or staffing firm. '' if unclear." },
    role:      { type: "string", description: "The job title." },
    address:   { type: "string", description: "HQ street address if stated, else 'City, ST', else ''. Never a remote/hybrid label." },
    website:   { type: "string", description: "The company's homepage URL (https://...), or ''. Never a job-board/ATS URL." },
    hmContact: { type: "string", description: "Named hiring manager or recruiter, or ''." },
    notes:     { type: "string", description: "Concise ' · '-separated tags: location, remote/hybrid/onsite, salary, leadership scope, key tech/requirements." }
  }
};

const SYSTEM = "You extract structured fields from a job posting for a personal job-application tracker. " +
  "Return only what the posting states — use an empty string for anything missing. " +
  "Never invent a company name or a URL. Keep notes short and scannable.";

export const parseJob = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY],
    cors: ["https://obxiv.github.io"], // your GitHub Pages origin
    region: "us-central1"
  },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    try {
      // 1. Verify the caller is the signed-in owner.
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!idToken) return res.status(401).json({ error: "Missing auth token" });

      const decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded.email !== OWNER_EMAIL) return res.status(403).json({ error: "Forbidden" });

      // 2. Validate input.
      const posting = String(req.body?.text || "").slice(0, 20000);
      if (!posting.trim()) return res.status(400).json({ error: "No posting text" });

      // 3. One structured extraction call to Claude Haiku.
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const msg = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: posting }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } }
      });

      // output_config.format guarantees the first text block is valid JSON.
      const text = msg.content.find((b) => b.type === "text")?.text || "{}";
      return res.status(200).json(JSON.parse(text));
    } catch (e) {
      console.error("parseJob failed:", e);
      return res.status(500).json({ error: "Parse failed" });
    }
  }
);
