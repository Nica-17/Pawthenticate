import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    '⚠️ OPENAI_API_KEY is missing. Add it to pawthenticate-server/.env (OPENAI_API_KEY=...)'
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------------------------
// Firebase Admin Init
// -------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(
  __dirname,
  process.env.FIREBASE_SERVICE_ACCOUNT
);

const serviceAccount = JSON.parse(
  fs.readFileSync(serviceAccountPath, "utf-8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// -------------------------------
// Routes
// -------------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Save case
app.post("/api/cases", async (req, res) => {
  try {
    const { patientName, species, summary } = req.body;

    if (!patientName || !summary) {
      return res.status(400).json({
        error: "patientName and summary are required",
      });
    }

    const docRef = await db.collection("cases").add({
      patientName,
      species: species || null,
      summary,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    console.error("Error saving case:", error);
    res.status(500).json({ error: "Failed to save case" });
  }
});

// List cases
app.get("/api/cases", async (req, res) => {
  try {
    const snapshot = await db
      .collection("cases")
      .orderBy("createdAt", "desc")
      .limit(25)
      .get();

    const cases = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ cases });
  } catch (error) {
    console.error("Error fetching cases:", error);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

app.post("/summarize", async (req, res) => {
  try {
    const { recordText } = req.body

    // Basic validation
    if (!recordText || recordText.trim().length < 20) {
      return res.status(400).json({
        error: "recordText is required (minimum ~20 characters).",
      })
    }

    // -------------------------------
    // Prompt content (kept simple)
    // -------------------------------
    // NOTE: We are using json_schema below, so we don't have to "hope"
    // the model returns JSON—it's enforced.
    const prompt = `
Convert the veterinary medical record below into a structured clinical summary.

Rules:
- Use concise clinical phrasing.
- If a section is missing, return an empty string.
- Do NOT invent diagnostics or treatments not supported by the text.

Medical record:
"""${recordText}"""
`

    // -------------------------------
    // OpenAI call (Responses API)
    // -------------------------------
    // IMPORTANT:
    // - input must be an array of messages when you're using roles
    // - json_schema forces valid JSON output with a defined structure
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You convert veterinary records into structured clinical summaries. Return ONLY valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "vet_summary",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              Signalment: { type: "string" },
              "Presenting Complaint": { type: "string" },
              History: { type: "string" },
              Diagnostics: { type: "string" },
              Treatments: { type: "string" },
              Assessment: { type: "string" },
              Plan: { type: "string" },
            },
            required: [
              "Signalment",
              "Presenting Complaint",
              "History",
              "Diagnostics",
              "Treatments",
              "Assessment",
              "Plan",
            ],
          },
        },
      },
    })

    // -------------------------------
    // Parse the forced JSON output
    // -------------------------------
    // With json_schema, output_text should be valid JSON.
    // We parse it and ALWAYS return: { summary: parsedObject }
    const raw = (response.output_text || "").trim()

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      console.error("❌ Failed to parse JSON from OpenAI output_text:", raw)
      return res.status(500).json({
        error: "Model did not return valid JSON (unexpected).",
        raw,
      })
    }

    // -------------------------------
    // Consistent response shape
    // -------------------------------
    return res.json({ summary: parsed })
  } catch (error) {
    // -------------------------------
    // Helpful error logging
    // -------------------------------
    console.error("❌ /summarize failed:", error?.message || error)

    // If OpenAI SDK provides response details, surface a bit (without leaking secrets)
    return res.status(500).json({
      error: "OpenAI request failed.",
      detail: error?.message || String(error),
    })
  }
})

// -------------------------------
// Start server
// -------------------------------
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`)
})