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
function SummarySection({ title, body, isLast = false }) {
  return (
    <div className={`${!isLast ? "border-b border-white/10 pb-4" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
        {title}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
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

  const [searchTerm, setSearchTerm] = useState("")
  const [sortOption, setSortOption] = useState("newest")
  const [currentPage, setCurrentPage] = useState(1)

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
  if (!signalment) return "Unknown"

  const s = signalment.toLowerCase()

  const canineTerms = [
    "canine", "dog", "golden retriever", "labrador", "lab", "german shepherd",
    "bulldog", "poodle", "terrier", "beagle", "boxer", "dachshund", "husky",
    "rottweiler", "chihuahua", "corgi", "shih tzu", "mastiff", "doberman"
  ]

  const felineTerms = [
    "feline", "cat", "dsh", "dlh", "dmh", "domestic shorthair",
    "domestic longhair", "domestic medium hair", "siamese", "maine coon",
    "persian", "ragdoll", "bengal", "sphynx"
  ]

  const equineTerms = [
    "equine", "horse", "pony", "mare", "stallion", "gelding"
  ]

  if (canineTerms.some((term) => s.includes(term))) return "Canine"
  if (felineTerms.some((term) => s.includes(term))) return "Feline"
  if (equineTerms.some((term) => s.includes(term))) return "Equine"

  return "Unknown"
}

// Generic helper for extracting a labeled field from messy raw text
// Supports formats like:
// - Client: Sarah K
// - CLIENT = J. Martinez
// - Owner - Jane Doe
function extractLabeledField(sourceText, labels) {
  if (!sourceText) return ""

  const pattern = new RegExp(
    `\\b(?:${labels.join("|")})\\s*[:=\\-]\\s*([^\\n\\r,;]+)`,
    "i"
  )

  const match = sourceText.match(pattern)

  if (!match) return ""

  return match[1]
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()
}

// Attemps to extract patient name from raw input text
function inferPatientName(text) {
  if (!text) return ""

  // First try direct labeled patterns such as:
  // Patient: Luna
  // Name = Bella
  // Pt - Rocky
  const directMatch =
    extractLabeledField(text, ["patient", "name", "pt"]) ||
    extractLabeledField(text, ["p"])

  if (!directMatch) return ""

  // Trim off extra trailing details if the line contains more than just the name
  return directMatch
    .split(/[-–—,(]| {2,}|\?/)[0]
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()
}

// Attemps to extract client/owner name from raw input text
function inferClientName(sourceText) {
  if (!sourceText) return ""

  return extractLabeledField(sourceText, ["client", "owner"])
}

// ===============================
// Derived Display Values
// ===============================

  const patientName = inferPatientName(recordText) || "Unknown Patient"
  const clientName = inferClientName(recordText) || "Unknown Client"
  const species = inferSpeciesFromSignalment(summary?.Signalment) || "Unknown"

  const filteredAndSortedCases = [...savedCases]
    .filter((savedCase) => {
      const patient = getSavedCasePatientName(savedCase).toLowerCase()
      const client = getSavedCaseClientName(savedCase).toLowerCase()
      const speciesValue = getSavedCaseSpecies(savedCase).toLowerCase()
      const query = searchTerm.toLowerCase().trim()

      if (!query) return true

      return (
        patient.includes(query) ||
        client.includes(query) ||
        speciesValue.includes(query)
      )
    })
    .sort((a, b) => {
      if (sortOption === "name") {
        return getSavedCasePatientName(a).localeCompare(getSavedCasePatientName(b))
      }

      // Sort saved cases using raw backend dates so sorting stays accurate
const dateA =
  normalizeCaseDate(
    a.generatedDate || a.timestamp || a.createdAt || a.created_at
  )?.getTime() || 0

const dateB =
  normalizeCaseDate(
    b.generatedDate || b.timestamp || b.createdAt || b.created_at
  )?.getTime() || 0

      if (sortOption === "oldest") {
        return dateA - dateB
      }

      return dateB - dateA
    })

  const casesPerPage = 8
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedCases.length / casesPerPage))
  const paginatedCases = filteredAndSortedCases.slice(
    (currentPage - 1) * casesPerPage,
    currentPage * casesPerPage
  )

  // ===============================
  // Lifecycle Effects
  // ===============================

  // On initial load, fretch previously saved cases
  useEffect(() => {
    fetchSavedCases()
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sortOption])

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

      console.log("Saving clientName:", clientName)

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

// Internal helper: normalize any backend date into a JS Date object
// Handles Firestore timestamps, strings, and Date objects

function normalizeCaseDate(value) {
  if (!value) return null

  if (value?.seconds) {
    return new Date(value.seconds * 1000) // Firestore timestamp
  }

  if (typeof value === "string") {
    return new Date(value)
  }

  if (value instanceof Date) {
    return value
  }

  return null
}


// Formats dates for the Saved Cases table only
// Keeps the display compact and easy to scan
function formatCaseListDate(savedCase) {
  const rawDate =
    savedCase.generatedDate ||
    savedCase.timestamp ||
    savedCase.createdAt ||
    savedCase.created_at ||
    null

  const date = normalizeCaseDate(rawDate)

  if (!date || Number.isNaN(date.getTime())) {
    return "Saved case"
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// Formats a full timestamp for preview documents and PDF export
// This keeps report output more professional and clinically useful
function formatDocumentDateTime(value) {
  const date = normalizeCaseDate(value)

  if (!date || Number.isNaN(date.getTime())) {
    return "Not available"
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function getSavedCasePatientName(savedCase) {
    if (savedCase.patientName && savedCase.patientName !== "Unknown Patient") {
      return savedCase.patientName
    }

    const signalment = savedCase.summary?.Signalment || ""

    const match =
      signalment.match(/^([A-Z][a-zA-Z' -]{1,40})\s*[-–—,]/) ||
      signalment.match(/\bname\s*:\s*([A-Za-z0-9' -]{1,40})/i)

    return match ? match[1].trim() : "Unknown Patient"
  }

  function getSavedCaseSpecies(savedCase) {
    if (savedCase.species && savedCase.species !== "Unknown") {
      return savedCase.species
    }

    return inferSpeciesFromSignalment(savedCase.summary?.Signalment) || "Unknown"
  }

  function getSavedCaseClientName(savedCase) {
    if (savedCase?.clientName) {
      return savedCase.clientName.trim()
    }

    const sourceText =
      savedCase.originalRecordText ||
      savedCase.recordText ||
      ""

    return inferClientName(sourceText) || "Unknown Client"
  }

// Loads a saved case back into the workspace and restores its document metadata
function handleLoadSavedCase(savedCase) {
  setSummary(savedCase.summary || null)
  setRecordText(savedCase.originalRecordText || savedCase.recordText || "")
  // When loading a saved case, preserve a document-style date/time for preview and export
  setGeneratedDate(
    formatDocumentDateTime(
      savedCase.generatedDate ||
      savedCase.timestamp ||
      savedCase.createdAt ||
      savedCase.created_at
    )
  )

  setSaveStatus(null)
  setErrorMessage("")
  setIsPreviewOpen(false)

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  })
}

// Export PDF functionality  
function handleExportPdf() {
    if (!summary) return

  setErrorMessage("")

  const printableSections = SECTION_ORDER.map((section) => {
    const body = summary[section] || "—"

    return `
      <section>
      <h3>${section}</h3>
      <p>${body}</p>
    </section>
    `
  }).join("")

  const printWindow = window.open("", "_blank", "width=900,height=700")

  if (!printWindow) {
    setErrorMessage("Unable to open export window. Please allow pop-ups and try again.")
    return
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Pawthenticate Clinical Summary Report</title>
        <style>
  body {
    font-family: "Helvetica Neue", Arial, sans-serif;
    background: #ffffff;
    color: #111827;
    margin: 0;
    padding: 32px;
  }

  .report {
    max-width: 750px;
    margin: 0 auto;
  }

  .header {
    border-bottom: 2px solid #e5e7eb;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }

  .title {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
  }

  .subtitle {
    font-size: 12px;
    color: #6b7280;
    margin: 4px 0 0 0;
  }

  .meta {
    margin-top: 12px;
    font-size: 13px;
    line-height: 1.5;
  }

  .meta div {
    margin-bottom: 2px;
  }

  .meta strong {
    color: #111827;
  }

  section {
    margin-bottom: 20px;
    padding-bottom: 8px;
  }

  h3 {
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    margin: 0 0 6px 0;
    color: #111827;
    letter-spacing: 0.04em;
  }

  p {
    margin: 0 0 2px 0;
    font-size: 13px;
    line-height: 1.5;
    color: #111827;
    white-space: pre-wrap;
  }

  @media print {
    body {
      padding: 20px;
    }

    section {
      page-break-inside: avoid;
    }
  }
</style>
      </head>
      <body>
        <div class="report">
          <div class="header">
            <h1 class="title">Clinical Summary Report</h1>
            <p class="subtitle">Generated by Pawthenticate</p>

            <div class="meta">
              <div><strong>Patient:</strong> ${patientName}</div>
              <div><strong>Client:</strong> ${clientName}</div>
              <div><strong>Species:</strong> ${species}</div>
              <div><strong>Generated:</strong> ${formatDocumentDateTime(generatedDate)}</div>
            </div>
          </div>

          ${printableSections}

        </div>

        <script>
          window.onload = function () {
            window.print();
          };
        </script>
      </body>
    </html>
  `)

  printWindow.document.close()
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
              <div className="mt-5 rounded-2xl border border-white/10 bg-neutral-950/40 p-5 max-h-[520px] overflow-y-auto">
                <div className="space-y-4">
                  {SECTION_ORDER.map((section, index) => (
                    <SummarySection
                      key={section}
                      title={section}
                      body={summary[section]}
                      isLast={index === SECTION_ORDER.length - 1}
                    />
                  ))}
                </div>
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

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by patient, client, or species..."
                className="w-full rounded-xl border border-white/10 bg-neutral-950/60 px-4 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 md:max-w-md"
              />

              <div className="relative">
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value)}
                  className="rounded-xl border border-white/10 bg-neutral-950/60 pl-4 pr-10 py-2 text-sm text-white/90 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="name">Patient Name</option>
                </select>

                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/40">
                  ▼
                </div>
              </div>
            </div>

            {!isLoadingCases && !casesError && savedCases.length > 0 && filteredAndSortedCases.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/15 bg-neutral-950/40 p-6 text-sm text-white/60">
                No saved cases match your search.
              </div>
            )}
          </div>

            {filteredAndSortedCases.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[2fr_2fr_1fr_1.5fr_auto] gap-4 border-b border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/50">
                  <div>Patient</div>
                  <div>Client</div>
                  <div>Species</div>
                  <div>Date</div>
                  <div>Action</div>
                </div>

                <div className="max-h-[420px] overflow-y-auto">
                  {paginatedCases.map((savedCase, index) => (
                    <div
                      key={savedCase.id || index}
                      className="grid grid-cols-[2fr_2fr_1fr_1.5fr_auto] gap-4 border-b border-white/10 bg-neutral-950/40 px-4 py-3 text-sm text-white/85 last:border-b-0"
                    >
                      <div className="font-medium text-white/90">
                        {getSavedCasePatientName(savedCase)}
                      </div>

                      <div className="text-white/70">
                        {getSavedCaseClientName(savedCase)}
                      </div>

                      <div className="text-white/70">
                        {getSavedCaseSpecies(savedCase)}
                      </div>

                      <div className="text-white/60">
                        {formatCaseListDate(savedCase)}
                      </div>

                      <div>
                        <button
                          onClick={() => handleLoadSavedCase(savedCase)}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
                          type="button"
                        >
                          Load
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredAndSortedCases.length > 0 && (
              <div className="flex items-center justify-between text-sm text-white/60">
                <div>
                  Page {currentPage} of {totalPages}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                  >
                    Previous
                  </button>

                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                  >
                    Next
                  </button>
                </div>
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
      <span className="font-semibold">Generated:</span> {formatDocumentDateTime(generatedDate)}
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