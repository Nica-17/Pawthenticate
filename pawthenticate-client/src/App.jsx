/**
 * Pawthenticate - Main Application Component
 *
 * This file controls:
 * - User input of raw veterinary notes
 * - AI summary generation (via backend API)
 * - Display of structured clinical summaries
 * - Saving and retrieving past cases
 * - Previewing formatted clinical reports
 *
 * This is the core UI + state management layer of the app.
 */

import { useEffect, useMemo, useState } from "react"

// ===============================
// Configuration & Constants
// ===============================

// Base URL for backend API
const API_BASE = "http://localhost:3001";

// Defines the order of clinical sections int he UI and preview
const SECTION_ORDER = [
  "Signalment",
  "Presenting Complaint",
  "History",
  "Diagnostics",
  "Treatments",
  "Assessment",
  "Plan",
]

// ===============================
// Reusable UI Components
// ===============================

// Displays a single clinical section (e.g., Signalment, History, etc.)
function SectionCard({ title, body }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">
        {body || "—"}
      </div>
    </div>
  )
}

// ===============================
// Main Application Component
// ===============================
export default function App() {

  // ===============================
  // State Management
  // ===============================

  // User input
  const [recordText, setRecordText] = useState("")

  // Generation state
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState(null)

  // UI feedback
  const [saveStatus, setSaveStatus] = useState(null)
  const [errorMessage, setErrorMessage] = useState("")

  // Preview modal
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Metadata
  const [generatedDate, setGeneratedDate] = useState("")

  // Saved cases
  const [savedCases, setSavedCases] = useState([])
  const [isLoadingCases, setIsLoadingCases] = useState(false)
  const [casesError, setCasesError] = useState("")

  // ===============================
  // Derived State / Computed Values
  // ===============================

  // Determines if user can generate a summary
  const canGenerate = useMemo(() => {
    return recordText.trim().length > 30 && !isLoading},
    [recordText, isLoading])

  // ===============================
  // Helper Functions (Data Extraction)
  // ===============================

  // Infers species from AI-generated signalment text
    function inferSpeciesFromSignalment(signalment) {
  if (!signalment) return "";
  const s = signalment.toLowerCase();
  if (s.includes("feline") || s.includes("cat")) return "Feline";
  if (s.includes("canine") || s.includes("dog")) return "Canine";
  if (s.includes("equine") || s.includes("horse")) return "Equine";
  return "";
}

// Attemps to extract patient name from raw input text
function inferPatientName(text) {
  // quick PoC heuristic: look for "Patient: NAME" or "Name: NAME"
  const match =
    text.match(/patient\s*:\s*([^\n\r]+)/i) ||
    text.match(/\bpt\s*:\s*["']?([^\n\r"']+)/i) ||
    text.match(/\bp\s*:\s*["']?([^\n\r"']+)/i) ||
    text.match(/\bname\s*:\s*([^\n\r]+)/i);

  if (!match) return ""

  return match[1]
    .split(/[-–—,(]| {2,}|\?/)[0]
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()
}

// Attemps to extract client/owner name from raw input text
function inferClientName(text) {
  const match =
    text.match(/owner\s*:\s*([^\n\r]+)/i) ||
    text.match(/\bo\s*:\s*([^\n\r]+)/i) ||
    text.match(/client\s*:\s*([^\n\r]+)/i)

  if (!match) return ""

  return match[1]
    .split(/[-–—,(]| {2,}|\?/)[0]
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()
}

// ===============================
// Derived Display Values
// ===============================

  const patientName = inferPatientName(recordText) || "Unknown Patient"
  const clientName = inferClientName(recordText) || "Unknown Client"
  const species = inferSpeciesFromSignalment(summary?.Signalment) || "Unknown"

  // ===============================
  // Lifecycle Effects
  // ===============================

  // On initial load, fretch previously saved cases
  useEffect(() => {
    fetchSavedCases()
  }, [])

  // ===============================
  // Core Actions (User Interactions)
  // ===============================

  // Sends raw notes to backend AI service to generate structured summary
  async function handleGenerate() {
  try {
    setIsLoading(true)
    setSummary(null)
    setSaveStatus(null)
    setErrorMessage("")

    const res = await fetch(`${API_BASE}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordText }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.error || "Failed to generate summary.")
    }

    // If server returns parsed JSON
    if (data.summary) {
      setSummary(data.summary)
      setGeneratedDate(new Date().toLocaleString())
      return
    } 
      if (data.summaryText) {
        throw new Error("The server returned text instead of the expected structured summary.")
      }

      throw new Error("Unexpected response received from the server.")
    } catch (err) {
      console.error(err)
      setErrorMessage(err.message || "Something went wrong while generating the summary.")
    } finally {
      setIsLoading(false)
    }
  }

  // Resets entire form and UI state
  function handleClear() {
    setRecordText("")
    setSummary(null)
    setSaveStatus(null)
    setErrorMessage("")
    setIsPreviewOpen(false)
    setGeneratedDate("")
  }

  // Saves current case (summary + metadata) to backend database
  async function handleSaveCase() {
  if (!summary) return

  try {
    setSaveStatus(null)
      setErrorMessage("")

      const res = await fetch(`${API_BASE}/api/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          clientName,
          species,
          generatedDate,
          originalRecordText: recordText,
          summary,
        }),
      })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.error || "Failed to save case.")
    }

    setSaveStatus(`Case saved successfully${data.id ? ` (ID: ${data.id})` : ""}.`)
    fetchSavedCases()

    setTimeout(() => {
      setSaveStatus(null)
    }, 3000)

  } catch (err) {
    console.error(err)
    setSaveStatus("Failed to save case.")
  }
}

// Retrieves saved cases from backend
async function fetchSavedCases() {
  try {
    setIsLoadingCases(true)
    setCasesError("")

    const res = await fetch(`${API_BASE}/api/cases`)
    const data = await res.json()

    console.log("Saved cases response:", data)

    if (!res.ok) {
      throw new Error(data?.error || "Failed to load saved cases.")
    }

    const cases = Array.isArray(data)
      ? data
      : Array.isArray(data.cases)
        ? data.cases
        : Array.isArray(data.data)
          ? data.data
          : []

    setSavedCases(cases)
  } catch (err) {
    console.error(err)
    setCasesError(err.message || "Failed to load saved cases.")
  } finally {
    setIsLoadingCases(false)
  }
}

// Normalizes various date formats from backend into readable string
function formatCaseDate(savedCase) {
  const rawDate =
    savedCase.generatedDate ||
    savedCase.timestamp ||
    savedCase.createdAt ||
    savedCase.created_at ||
    ""

  if (!rawDate) return "Saved case"

  if (typeof rawDate === "string") return rawDate

  if (rawDate?.seconds) {
    return new Date(rawDate.seconds * 1000).toLocaleString()
  }

  if (rawDate instanceof Date) {
    return rawDate.toLocaleString()
  }

  return "Saved case"
}

// Loads a previously saved case into the UI for review  
function handleLoadSavedCase(savedCase) {
  setSummary(savedCase.summary || null)
  setRecordText(savedCase.originalRecordText || savedCase.recordText || "")
  setGeneratedDate(formatCaseDate(savedCase))
  setSaveStatus(null)
  setErrorMessage("")
  setIsPreviewOpen(false)
}

// Placeholder for future PDF export functionality  
function handleExportPdf() {
    setErrorMessage("")
    alert("Export PDF is the next feature to wire up.")
  }

  // ===============================
  // Render UI
  // ===============================

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-neutral-950/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Pawthenticate</h1>
              <p className="mt-1 text-sm text-white/60">
                AI-assisted veterinary documentation for rapid history review and referral export.
              </p>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                Proof of Concept
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                Desktop/Tablet
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        
        {/* Main Layout - Input (left) and Output (right) panels */}
        <div className="grid gap-6 lg:grid-cols-2">
          
          {/* Input Panel - User pastes raw veterinary notes to generate summary */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Medical Record Input</h2>
                <p className="mt-1 text-sm text-white/60">
                  Paste patient history notes to generate a structured clinical summary.
                </p>
              </div>

              <button
                onClick={handleClear}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
                type="button"
              >
                Clear
              </button>
            </div>

            <label className="mt-4 block text-xs font-medium text-white/60">
              Record text
              <textarea
                value={recordText}
                onChange={(e) => setRecordText(e.target.value)}
                placeholder="Paste visit notes, labs, imaging summaries, treatment logs…"
                className="mt-2 h-56 w-full resize-none rounded-xl border border-white/10 bg-neutral-950/60 p-4 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
              >
                {isLoading ? "Generating…" : "Generate Summary"}
              </button>

              <div className="text-xs text-white/50">
                Paste at least a few lines of notes to enable generation.
              </div>
            </div>

            {isLoading && (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-medium text-white/80">Generating summary</div>
                <div className="mt-2 text-xs text-white/60">
                  Organizing the record into structured clinical sections for review.
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-indigo-500/70" />
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {errorMessage}
              </div>
            )}

          </section>

          {/* Output Panel - Displays AI-generated structured clinical summary */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Structured Summary</h2>
                <p className="mt-1 text-sm text-white/60">
                  Output organized into clinical sections for faster review and documentation.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPreviewOpen(true)}
                  disabled={!summary || isLoading}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
                >
                  Preview
                </button>

                <button
                  onClick={handleSaveCase}
                  disabled={!summary || isLoading}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                >
                  Save Case
                </button>
                <button
                  onClick={handleExportPdf}
                  disabled={!summary || isLoading}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                >
                  Export PDF
                </button>
              </div>
            </div>

            {saveStatus && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
                {saveStatus}
              </div>
            )}

            {!summary && !isLoading && !errorMessage && (
              <div className="mt-6 rounded-xl border border-dashed border-white/15 bg-neutral-950/40 p-6 text-sm text-white/60">
                No summary yet. Paste a record and click <span className="text-white/80">Generate Summary</span>.
              </div>
            )}

            {summary && (
              <div className="mt-5 grid gap-3">
                {SECTION_ORDER.map((section) => (
                  <SectionCard key={section} title={section} body={summary[section]} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Saved Cases - List of previously saved summaries from database */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Saved Cases</h2>
              <p className="mt-1 text-sm text-white/60">
                Review previously saved case summaries from the database.
              </p>
            </div>

            <button
              onClick={fetchSavedCases}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              type="button"
            >
              Refresh Cases
            </button>
          </div>

          {isLoadingCases && (
            <div className="mt-4 text-sm text-white/60">
              Loading saved cases...
            </div>
          )}

          {casesError && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {casesError}
            </div>
          )}

          {!isLoadingCases && !casesError && savedCases.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-neutral-950/40 p-6 text-sm text-white/60">
              No saved cases found yet.
            </div>
          )}

          {savedCases.length > 0 && (
            <div className="mt-5 grid gap-3">
              {savedCases.map((savedCase, index) => (
                <button
                  key={savedCase.id || index}
                  onClick={() => handleLoadSavedCase(savedCase)}
                  className="rounded-xl border border-white/10 bg-neutral-950/50 p-4 text-left transition hover:bg-white/10"
                  type="button"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white/90">
                        {savedCase.patientName || "Unknown Patient"}
                      </div>
                      <div className="mt-1 text-xs text-white/60">
                        {savedCase.clientName || "Unknown Client"} • {savedCase.species || "Unknown Species"}
                      </div>
                    </div>

                    <div className="text-xs text-white/50">
                      {formatCaseDate(savedCase)}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-white/50">
                    Click to load this saved summary into the review panel.
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Footer note */}
        <div className="mt-8 text-xs text-white/40">
          Current proof of concept demonstrates the core summary generation and case-saving workflow.
        </div>

        {/* Preview Modal - Displays formatted clinical report for review/export */}
        {isPreviewOpen && summary && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    onClick={() => setIsPreviewOpen(false)}
  >
    <div
      className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl bg-white p-8 text-black shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Close Button */}
      <button
        onClick={() => setIsPreviewOpen(false)}
        className="absolute right-4 top-4 text-gray-500 hover:text-black"
      >
        ✕
      </button>

      {/* Document Header */}
      <div className="mb-6 border-b border-gray-200 pb-4">
  <h2 className="text-xl font-semibold">Clinical Summary Report</h2>
  <p className="mt-1 text-sm text-gray-500">Generated by Pawthenticate</p>

  <div className="mt-4 grid gap-y-2 text-sm text-gray-700">
    <div>
      <span className="font-semibold">Patient:</span> {patientName}
    </div>
    <div>
      <span className="font-semibold">Client:</span> {clientName}
    </div>
    <div>
      <span className="font-semibold">Species:</span> {species}
    </div>
    <div>
      <span className="font-semibold">Generated:</span> {generatedDate || "Not generated yet"}
    </div>
  </div>
</div>

      {/* Sections */}
      <div className="space-y-4">
        {SECTION_ORDER.map((section) => (
          <div key={section}>
            <h3 className="font-semibold text-gray-800">{section}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
              {summary[section] || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  </div>
)}
      </main>
    </div>
  )
}