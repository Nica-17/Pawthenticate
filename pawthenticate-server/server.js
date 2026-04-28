/**
 * Pawthenticate - Backend API Server
 *
 * Responsibilities:
 * - Configure the Express server and middleware
 * - Initialize Firebase Admin for Firestore access
 * - Save and retrieve veterinary case summaries
 * - Send raw medical records to OpenAI for structured summarization
 *
 * This file currently acts as the main backend controller for the proof of concept.
 */

import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import OpenAI from "openai"
import admin from "firebase-admin"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// Load environment variables from .env
dotenv.config()

// ==============================
// Process Error Handling
// ==============================

// Log unhandled promise rejections so backend failures are easier to diagnose
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason)
})

// Log uncaught exceptions so unexpected crashes are visible in the terminal
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err)
})

// ==============================
// App Configuration
// ==============================

const app = express()
const PORT = process.env.PORT || 3001

// ==============================
// Middleware
// ==============================

// Enable cross-origin requests from the frontend
app.use(cors())

// Accept JSON request bodies up to 2 MB
app.use(express.json({ limit: "2mb" }))

// ==============================
// OpenAI Configuration
// ==============================

// Warn during startup if the OpenAI key is missing
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "⚠️ OPENAI_API_KEY is missing. Add it to pawthenticate-server/.env (OPENAI_API_KEY=...)"
  )
}

// Initialize the OpenAI client for summary generation
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// ==============================
// Firebase Configuration
// ==============================

// Resolve the current file path so the Firebase service account path works correctly
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Build the full path to the Firebase service account file from the environment variable
const serviceAccountPath = path.join(
  __dirname,
  process.env.FIREBASE_SERVICE_ACCOUNT
)

// Read and parse the Firebase service account credentials
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"))

// Initialize Firebase Admin so the backend can read and write Firestore documents
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

// Firestore database instance used throughout the API routes
const db = admin.firestore()

// ==============================
// Health Route
// ==============================

// Basic health-check endpoint to confirm the API is running
app.get("/api/health", (req, res) => {
  res.json({ ok: true })
})

// ==============================
// Case Routes
// ==============================

// Saves a generated case summary and its supporting metadata to Firestore
app.post("/api/cases", async (req, res) => {
  try {
    const {
      patientName,
      clientName,
      species,
      generatedDate,
      originalRecordText,
      summary,
    } = req.body

    // Require the minimum fields needed to store a meaningful case
    if (!patientName || !summary) {
      return res.status(400).json({
        error: "patientName and summary are required",
      })
    }

    const caseData = {
      patientName,
      clientName: clientName || null,
      species: species || null,
      generatedDate: generatedDate || null,
      originalRecordText: originalRecordText || null,
      summary,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    const docRef = await db.collection("cases").add(caseData)

    res.status(201).json({
      id: docRef.id,
      ...caseData,
    })
  } catch (error) {
    console.error("Error saving case:", error)
    res.status(500).json({ error: "Failed to save case" })
  }
})

// Returns the most recent saved cases for the frontend dashboard
app.get("/api/cases", async (req, res) => {
  try {
    const snapshot = await db
      .collection("cases")
      .orderBy("createdAt", "desc")
      .limit(25)
      .get()

    const cases = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    res.json({ cases })
  } catch (error) {
    console.error("Error fetching cases:", error)
    res.status(500).json({ error: "Failed to fetch cases" })
  }
})

// ==============================
// Summarization Route
// ==============================

// Generates a structured veterinary summary from raw source text
app.post("/summarize", async (req, res) => {
  try {
    const { recordText, organizationPreference } = req.body

    // Require enough source text to build a meaningful summary
    if (!recordText || recordText.trim().length < 20) {
      return res.status(400).json({
        error: "recordText is required (minimum ~20 characters).",
      })
    }

    // Adjust how the model should organize multi-visit or multi-document records
    const organizationInstruction =
      organizationPreference === "newest"
        ? "When the source material contains multiple visits, events, or documents, organize the summary so the timeline is understood from the most recent information back to the earliest."
        : "When the source material contains multiple visits, events, or documents, organize the summary so the timeline is understood from the earliest information through to the most recent."

    // Build the clinical summarization prompt sent to the model
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
- Convert all patient weights to kilograms using kg = lb / 2.20462 when weights are provided in pounds.
- Display converted weights in this format: "35.7 kg" and include the original value in parentheses only if clinically helpful, such as "35.7 kg (78.6 lb)".
- Prefer kilograms as the primary weight unit in all signalment and clinical summary sections.

Style Guidelines:
- Use concise, professional clinical phrasing.
- Write as if another veterinarian will read this summary.
- Normalize messy phrasing into clear medical statements.
- Avoid repetition and unnecessary wording.

Organization Instructions:
- ${organizationInstruction}
- If the input appears to include multiple records or uploaded documents, synthesize them into one coherent summary.
- Preserve the clinical timeline as clearly as possible when summarizing the case history.
- If the record contains multiple visits or entries, separate them into distinct visit summaries.
- Do NOT combine all visits into one summary.
- Maintain chronological order based on the provided organization preference.
- Provide a brief overall case overview summarizing the full case progression.

Tone & Output Expectations:
- Write in a formal, objective, clinical tone.
- Prefer medically appropriate terminology over casual wording.
- Present information clearly and efficiently, similar to a SOAP or referral summary.
- Avoid speculation unless explicitly supported by the text.
- Do not include jokes, conversational tone, or administrative side comments unless clinically relevant.

Medical record:
"""${recordText}"""
`

    // Request a structured JSON response from OpenAI using a strict schema
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
              CaseOverview: { type: "string" },
              Visits: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    VisitLabel: { type: "string" },
                    VisitDate: { type: "string" },
                    Source: { type: "string" },
                    "Presenting Complaint": { type: "string" },
                    History: { type: "string" },
                    Diagnostics: { type: "string" },
                    Treatments: { type: "string" },
                    Assessment: { type: "string" },
                    Plan: { type: "string" },
                  },
                  required: [
                    "VisitLabel",
                    "VisitDate",
                    "Source",
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
            required: ["Signalment", "CaseOverview", "Visits"],
          },
        },
      },
    })

    // Parse the model response, which should already match the required schema
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

    // Return the structured summary using the response shape expected by the frontend
    return res.json({ summary: parsed })
  } catch (error) {
    console.error("❌ /summarize failed:", error?.message || error)

    return res.status(500).json({
      error: "OpenAI request failed.",
      detail: error?.message || String(error),
    })
  }
})

// ==============================
// Start Server
// ==============================

// Start the API server and log the local address
app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`)
})