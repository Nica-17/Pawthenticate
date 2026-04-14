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
    // Prompt content
    // -------------------------------
    const prompt = `
You are a veterinary clinical documentation assistant.

Convert the following unstructured veterinary medical record into a clean, professional, and clinically appropriate summary.

Requirements:
- Rewrite the content using formal veterinary medical language suitable for internal review or referral documentation.
- Do NOT copy informal, conversational, or disorganized phrasing from the original notes.
- Remove filler language, side comments, uncertainty chatter (e.g., "idk", "maybe", "lol"), and irrelevant details.
- Preserve all clinically relevant information accurately.
- If uncertainty is medically relevant, rewrite it in a professional manner.
- Do NOT invent diagnostics, treatments, or findings that are not supported by the source text.
- If a section is missing, return an empty string.

Style Guidelines:
- Use concise, professional clinical phrasing.
- Write as if another veterinarian will read this summary.
- Normalize messy phrasing into clear medical statements.
- Avoid repetition and unnecessary wording.

Tone & Output Expectations:
- Write in a formal, objective, clinical tone.
- Prefer medically appropriate terminology over casual wording.
- Present information clearly and efficiently, similar to a SOAP or referral summary.
- Avoid speculation unless explicitly supported by the text.
- Do not include jokes, conversational tone, or administrative side comments unless clinically relevant.

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