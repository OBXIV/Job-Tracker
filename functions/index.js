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

const MODEL = "claude-haiku-4-5";

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

// A string is already a real street address if it has a number and a street-type word.
function looksLikeStreetAddress(s) {
  return /\d/.test(s) && /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|cir|circle|plaza|pkwy|parkway|hwy|highway|ste|suite|floor|fl)\b/i.test(s);
}

// Look up a company's real HQ street address via Claude + web search.
// Returns a cleaned address string, or '' if nothing confident is found.
async function lookupHqAddress(client, company, locationHint) {
  const hint = locationHint && !/\b(remote|hybrid|onsite)\b/i.test(locationHint) ? ` It is near ${locationHint}.` : "";
  let resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You find the corporate headquarters mailing address of a company using web search. " +
      "Reply with ONLY the full street address on one line — street, city, state, ZIP — " +
      "or exactly NONE if you cannot find a confident answer. No commentary, no extra lines.",
    messages: [{ role: "user", content: `What is the corporate headquarters street address of "${company}"?${hint}` }],
    tools: [{ type: "web_search_20260209", name: "web_search" }]
  });

  // Server-side web search runs its own loop; resume if it pauses.
  for (let i = 0; i < 3 && resp.stop_reason === "pause_turn"; i++) {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages: [
        { role: "user", content: `What is the corporate headquarters street address of "${company}"?${hint}` },
        { role: "assistant", content: resp.content }
      ]
    });
  }

  const out = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!out || /^none\b/i.test(out)) return "";
  return out.replace(/,?\s*(United States|USA|U\.S\.A\.?)\s*$/i, "").trim();
}

export const parseJob = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY],
    cors: ["https://obxiv.github.io"], // your GitHub Pages origin
    region: "us-central1",
    timeoutSeconds: 60
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

      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

      // 3. Structured extraction of the posting itself.
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: posting }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } }
      });
      const parsed = JSON.parse(msg.content.find((b) => b.type === "text")?.text || "{}");

      // 4. If the posting didn't give a real HQ street address, look it up.
      if (parsed.company && !looksLikeStreetAddress(parsed.address || "")) {
        try {
          const hq = await lookupHqAddress(client, parsed.company, parsed.address);
          if (hq) parsed.address = hq;
        } catch (e) {
          console.warn("HQ lookup failed (keeping posting address):", e.message);
        }
      }

      return res.status(200).json(parsed);
    } catch (e) {
      console.error("parseJob failed:", e);
      return res.status(500).json({ error: "Parse failed" });
    }
  }
);
