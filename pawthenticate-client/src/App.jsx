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
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf"
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
import mammoth from "mammoth"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// ===============================
// Configuration & Constants
// ===============================

// Base URL for backend API
const API_BASE = "http://localhost:3001";

// Defines the order of visit-level clinical sections in the UI
const VISIT_SECTION_ORDER = [
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

  // State for saved case dashboard controls (search, sorting, and pagination)
  const [searchTerm, setSearchTerm] = useState("")
  const [sortOption, setSortOption] = useState("newest")
  const [currentPage, setCurrentPage] = useState(1)

  // File upload state for drag-and-drop referral record intake
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  // Organization preference helps guide the AI when records span multiple visits
  const [organizationPreference, setOrganizationPreference] = useState("oldest")

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

// Normalizes raw DOCX text extracted by Mammoth
// This restores line breaks between common veterinary record labels
// so flattened exports are easier to parse and summarize
function normalizeDocxText(rawText) {
  if (!rawText) return ""

  return rawText
    // Normalize Windows line endings first
    .replace(/\r\n/g, "\n")

    // Insert a line break before common labels if they were flattened together
    // Example:
    // Client: J. MartinezPatient: BellaSpecies: Canine
    // becomes:
    // Client: J. Martinez
    // Patient: Bella
    // Species: Canine
    .replace(
      /(?<!\n)(Client|Owner|Patient|Pet|Species|Breed|Sex|DOB|MRN|Age|Weight|Reason|Assessment|Plan|Diagnostics|Treatments|History|Presenting Complaint)\s*:/gi,
      "\n$1:"
    )

    // Clean up accidental extra blank lines
    .replace(/\n{3,}/g, "\n\n")

    // Trim final result
    .trim()
}

// Cleans a possible patient-name candidate pulled from raw text or signalment
// This prevents common junk values from being used as the displayed patient name
function cleanPatientNameCandidate(value) {
  if (!value) return ""

  const cleaned = value
    // Stop if another flattened label begins immediately after the name
    .split(
      /(?=\b(?:client|owner|patient|species|breed|sex|dob|mrn|age|weight|visit|reason)\b\s*[:=\-])/i
    )[0]
    // Stop at obvious separators after the actual name
    .split(/[\n\r,;()]/)[0]
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()

  if (!cleaned) return ""

  // Reject obvious bad captures
  const invalidValues = new Set([
    "discussed",
    "unknown",
    "patient",
    "name",
    "dog",
    "cat",
    "canine",
    "feline",
  ])

  if (invalidValues.has(cleaned.toLowerCase())) {
    return ""
  }

  // Reject values that are too long to realistically be just a patient name
  if (cleaned.length > 40) {
    return ""
  }

  return cleaned
}

// Extracts patient name from the AI-generated signalment first
// This is safer than relying only on messy raw record text
function inferPatientNameFromSignalment(signalment) {
  if (!signalment) return ""

  const patterns = [
    // Bella - Canine, Golden Retriever, FS
    /^([A-Z][A-Za-z0-9' .-]{0,39})\s*[-–—,]/,

    // Name: Bella
    /\bname\s*[:=]\s*([A-Za-z0-9' .-]{1,40})/i,

    // Patient: Bella
    /\bpatient\s*[:=]\s*([A-Za-z0-9' .-]{1,40})/i,
  ]

  for (const pattern of patterns) {
    const match = signalment.match(pattern)
    const cleaned = cleanPatientNameCandidate(match?.[1] || "")
    if (cleaned) return cleaned
  }

  return ""
}

// Attempts to extract patient name from raw input text
// This fallback is intentionally strict to avoid false matches
function inferPatientName(text) {
  if (!text) return ""

  const directMatch =
    extractLabeledField(text, ["patient", "patient name", "pet", "pet name", "pt"])

  return cleanPatientNameCandidate(directMatch)
}

// Extracts client/owner name from messy raw text, including flattened DOCX text
// Example supported input:
// Client: J. MartinezPatient: BellaSpecies: Canine
function extractClientName(sourceText) {
  if (!sourceText) return ""

  const match = sourceText.match(
    /(?:client|owner)\s*[:=\-]\s*(.+?)(?=(?:patient|pet|species|breed|sex|dob|mrn|age|weight|visit|reason|owner|client)\s*[:=\-]|$)/is
  )

  if (!match) return ""

  return match[1].trim()
}

// Attemps to extract client/owner name from raw input text
function inferClientName(sourceText) {
  if (!sourceText) return ""

  const directMatch = extractClientName(sourceText)
  return cleanClientNameCandidate(directMatch)
}

// Cleans a possible client/owner name pulled from messy raw text
// This prevents flattened DOCX labels from being included in the client field
function cleanClientNameCandidate(value) {
  if (!value) return ""

  const cleaned = value
    // Stop as soon as another common record label begins
    .split(
      /(?=(?:client|owner|patient|pet|name|species|breed|sex|dob|mrn|age|weight|visit|reason)\s*[:=\-])/i
    )[0]
    // Also stop at obvious separators
    .split(/[\n\r,;()]/)[0]
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()

  if (!cleaned) return ""

  // Reject obvious junk values
  const invalidValues = new Set([
    "client",
    "owner",
    "unknown",
    "patient",
  ])

  if (invalidValues.has(cleaned.toLowerCase())) {
    return ""
  }

  // Prevent huge flattened strings from being accepted
  if (cleaned.length > 60) {
    return ""
  }

  return cleaned
}

// ===============================
// Derived Display Values
// ===============================

  // Prefer the AI signalment first because it is usually cleaner and more structured
  // Fall back to raw-text extraction only if signalment does not give us a usable name
  const patientName =
    inferPatientNameFromSignalment(summary?.Signalment) ||
    inferPatientName(recordText) || "Unknown Patient"
  const clientName = inferClientName(recordText) || "Unknown Client"
  const species = inferSpeciesFromSignalment(summary?.Signalment) || "Unknown"

  // Sorts generated visit summaries based on the selected chronology preference
  const sortedSummaryVisits = Array.isArray(summary?.Visits)
    ? [...summary.Visits].sort((a, b) => {
        const dateA = new Date(a.VisitDate).getTime() || 0
        const dateB = new Date(b.VisitDate).getTime() || 0

        if (organizationPreference === "oldest") {
          return dateA - dateB
        }

        return dateB - dateA
      })
    : []

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

  // Reads uploaded text-based files and merges them into the main record input
  // This allows users to work from messy referral exports instead of pasting everything manually
  async function handleFilesSelected(fileList) {
  const files = Array.from(fileList || [])

  if (files.length === 0) return

  try {
    setErrorMessage("")

    const allowedFiles = files.filter((file) => {
      const lowerName = file.name.toLowerCase()
      return (
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".pdf") ||
        lowerName.endsWith(".docx")
      )
    })

    if (allowedFiles.length === 0) {
      setErrorMessage("Please upload .txt, .md, .pdf, or .docx files.")
      return
    }

    const fileContents = await Promise.all(
      allowedFiles.map(async (file) => {
        const lowerName = file.name.toLowerCase()

        let text = ""

        // ---------------------------
        // TXT / MD (simple read)
        // ---------------------------
        if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
          text = await file.text()
        }

        // ---------------------------
        // PDF (text-based only)
        // ---------------------------
        else if (lowerName.endsWith(".pdf")) {
          const arrayBuffer = await file.arrayBuffer()

          // PDF.js works more reliably with Uint8Array input in browser apps
          const pdfData = new Uint8Array(arrayBuffer)

          const pdf = await pdfjsLib.getDocument({
            data: pdfData,
            useWorkerFetch: false,
            isEvalSupported: false,
          }).promise

          console.log("PDF loaded successfully. Pages:", pdf.numPages)

          let pdfText = ""

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const content = await page.getTextContent()

            // Only keep text-like items and join them into readable lines
            const pageText = content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .trim()

            pdfText += `${pageText}\n\n`
          }

          text = pdfText.trim()
        }

        // ---------------------------
        // DOCX (Word)
        // ---------------------------
        else if (lowerName.endsWith(".docx")) {
          const arrayBuffer = await file.arrayBuffer()

          const result = await mammoth.extractRawText({ arrayBuffer })

          // Mammoth raw text often flattens labeled fields together,
          // so normalize the extracted text before merging it into the input
          text = normalizeDocxText(result.value)

          console.log("Normalized DOCX text:", text)
        }

        return {
          name: file.name,
          content: text.trim(),
        }
      })
    )

    setUploadedFiles((prev) => [...prev, ...allowedFiles])

    // Merge uploaded file contents into one block for summarization
    const mergedText = fileContents
      .map(
        (file, index) => `
--- File ${index + 1}: ${file.name} ---
${file.content}
`
      )
      .join("\n")

    setRecordText((prev) => {
      const trimmedPrev = prev.trim()
      if (!trimmedPrev) return mergedText.trim()
      return `${trimmedPrev}\n\n${mergedText.trim()}`
    })
  } catch (error) {
    console.error("Error reading uploaded files:", error)

    setErrorMessage(
      error?.message
        ? `Failed to read uploaded file: ${error.message}`
        : "Failed to read one or more uploaded files."
    )
  }
}

  // Handles file input selection from the browse button
  async function handleFileInputChange(event) {
    await handleFilesSelected(event.target.files)
    event.target.value = ""
  }

  // Handles drag-and-drop upload
  async function handleFileDrop(event) {
    event.preventDefault()
    setIsDraggingFiles(false)
    await handleFilesSelected(event.dataTransfer.files)
  }

  // ===============================
  // Lifecycle Effects
  // ===============================

  // On initial load, fetch previously saved cases
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
      body: JSON.stringify({ 
        recordText,
        organizationPreference, 
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.error || "Failed to generate summary.")
    }

    // If server returns parsed JSON
    if (data.summary) {
      console.log("Generated summary response:", data.summary)
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
    setUploadedFiles([])
    setOrganizationPreference("oldest")
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

  const signalmentName = inferPatientNameFromSignalment(savedCase.summary?.Signalment || "")
  if (signalmentName) {
    return signalmentName
  }

  const sourceText =
    savedCase.originalRecordText ||
    savedCase.recordText ||
    ""

  return inferPatientName(sourceText) || "Unknown Patient"
}

  function getSavedCaseSpecies(savedCase) {
    if (savedCase.species && savedCase.species !== "Unknown") {
      return savedCase.species
    }

    return inferSpeciesFromSignalment(savedCase.summary?.Signalment) || "Unknown"
  }

  function getSavedCaseClientName(savedCase) {
  const storedClientName = cleanClientNameCandidate(savedCase?.clientName || "")
  if (storedClientName) {
    return storedClientName
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

  // Builds PDF output using the visit-based summary structure
  const printableSections = `
  <section class="report-section">
    <h2 class="section-title">Signalment</h2>
    <p>${summary.Signalment || "—"}</p>
  </section>

  <section class="report-section">
    <h2 class="section-title">Case Overview</h2>
    <p>${summary.CaseOverview || "—"}</p>
  </section>

  ${sortedSummaryVisits.map((visit, index) => `
    <section class="visit-block">
      <div class="visit-header">
        <h2 class="visit-title">${visit.VisitLabel || `Visit ${index + 1}`}</h2>
        <div class="visit-meta">
          <div><strong>Date:</strong> ${visit.VisitDate || "Not provided"}</div>
          <div><strong>Source:</strong> ${visit.Source || "Not provided"}</div>
        </div>
      </div>

      <div class="visit-sections">
        ${VISIT_SECTION_ORDER.map((section) => `
          <section class="report-section visit-section">
            <h3>${section}</h3>
            <p>${visit[section] || "—"}</p>
          </section>
        `).join("")}
      </div>
    </section>
  `).join("")}
`

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
  @page {
    size: auto;
    margin: 0.75in;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    background: #f3f4f6;
    margin: 0;
    padding: 0;
    color: #111827;
    font-family: "Helvetica Neue", Arial, sans-serif;
  }

  body {
    padding: 32px 0;
  }

  .report {
    width: 100%;
    max-width: 816px;
    margin: 0 auto;
    background: #ffffff;
    padding: 56px 64px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  }

  .header {
    padding-bottom: 20px;
    margin-bottom: 32px;
  }

  .header-divider {
    margin-top: 18px;
    margin-bottom: 26px;
    border-bottom: 1.5px solid #9ca3af;
  }

  .title {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.2;
    margin: 0;
    color: #111827;
  }

  .subtitle {
    font-size: 12px;
    color: #6b7280;
    margin: 6px 0 0 0;
    letter-spacing: 0.02em;
  }

  .meta {
    margin-top: 18px;
    margin-bottom: 20px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    font-size: 13px;
    line-height: 1.5;
  }

  .meta div {
    margin: 0;
  }

  .meta-full {
    grid-column: 1 / -1;
    padding-bottom: 6px;
    margin-bottom: 2px;
    color: #374151;
  }

  .meta strong {
    color: #111827;
  }

  .report-section {
    margin-bottom: 28px;
  }

  .section-title {
    margin-top: 24px;
    margin-bottom: 6px;
    font-size: 15px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #111827;
  }

  .visit-block {
    margin-top: 32px;
    padding-top: 22px;
    border-top: 1px solid #d1d5db;
    page-break-inside: avoid;
  }

  .visit-header {
    margin-bottom: 18px;
  }

  .visit-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }

  .visit-meta {
    margin-top: 8px;
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: #4b5563;
  }

  .visit-sections {
    display: block;
  }

  .visit-section {
    margin-bottom: 22px;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #1f2937;
  }

  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.65;
    color: #111827;
    white-space: pre-wrap;
  }

  .footer {
    margin-top: 40px;
    padding-top: 14px;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #6b7280;
    text-align: center;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  @media print {
    html, body {
      background: #ffffff;
    }

    body {
      padding: 0;
    }

    .report {
      max-width: none;
      width: auto;
      margin: 0;
      padding: 0;
      box-shadow: none;
    }

    .visit-block {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .report-section {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
</style>
      </head>
      <body>
        <div class="report">
          <div class="header">
            <h1 class="title">Clinical Summary Report</h1>

              <div class="meta">
              <div class="meta-full"><strong>Referring Clinic:</strong> ${sortedSummaryVisits?.[0]?.Source || "Not Provided"}</div>
              <div><strong>Patient:</strong> ${patientName}</div>
              <div><strong>Client:</strong> ${clientName}</div>
              <div><strong>Species:</strong> ${species}</div>
              <div><strong>Generated:</strong> ${formatDocumentDateTime(generatedDate)}</div>
            </div>

            <div class="header-divider"></div>

          ${printableSections}

          <div class="footer">
            Generated by Pawthenticate
          </div>

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
                  Paste patient history notes or upload referral files to generate a structured clinical summary.
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
            
             {/* Drag-and-drop intake better reflects real veterinary referral workflows,
                where records often arrive as separate, unorganized files */}
            <div className="mt-4 space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDraggingFiles(true)
                }}
                onDragLeave={() => setIsDraggingFiles(false)}
                onDrop={handleFileDrop}
                className={`rounded-xl border border-dashed p-4 text-sm transition ${
                  isDraggingFiles
                    ? "border-indigo-400 bg-indigo-500/10 text-white"
                    : "border-white/15 bg-neutral-950/40 text-white/60"
                }`}
              >
                <div className="font-medium text-white/80">
                  Drag and drop referral files here
                </div>
                <div className="mt-1 text-xs text-white/50">
                  Supports .txt, .md, .pdf, and .docx files.
                </div>

                <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10">
                  Browse Files
                  {/* Supports the same document types handled in the upload parser */}
                  <input
                    type="file"
                    multiple
                    accept=".txt,.md,.pdf,.docx"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <label className="text-xs font-medium text-white/60">
                    Organization preference
                  </label>
                  <select
                    value={organizationPreference}
                    onChange={(e) => setOrganizationPreference(e.target.value)}
                    className="mt-1 block rounded-xl border border-white/10 bg-neutral-950/60 px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                  >
                    <option value="oldest">Chronological: Oldest to Newest</option>
                    <option value="newest">Chronological: Newest to Oldest</option>
                  </select>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="text-xs text-white/50">
                    {uploadedFiles.length} file{uploadedFiles.length === 1 ? "" : "s"} added
                  </div>
                )}
              </div>
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
                <div className="space-y-6">
                  <SummarySection title="Signalment" body={summary.Signalment} />
                  <SummarySection
                    title="Case Overview"
                    body={summary.CaseOverview}
                    isLast={!summary.Visits || summary.Visits.length === 0}
                  />

                  {sortedSummaryVisits.map((visit, index) => (
                      <div
                        key={`${visit.VisitDate}-${index}`}
                        className="rounded-xl border border-white/10 bg-white/5 p-4"
                      >
                        <div className="mb-4 border-b border-white/10 pb-3">
                          <div className="text-sm font-semibold text-white/90">
                            {visit.VisitLabel || `Visit ${index + 1}`}
                          </div>
                          <div className="mt-1 text-xs text-white/50">
                            {visit.VisitDate || "Date not provided"}
                            {visit.Source ? ` • ${visit.Source}` : ""}
                          </div>
                        </div>

                        <div className="space-y-4">
                          {VISIT_SECTION_ORDER.map((section, sectionIndex) => (
                            <SummarySection
                              key={`${visit.VisitDate}-${section}-${sectionIndex}`}
                              title={section}
                              body={visit[section]}
                              isLast={sectionIndex === VISIT_SECTION_ORDER.length - 1}
                            />
                          ))}
                        </div>
                      </div>
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
      <div className="space-y-6">
        <div>
          <h3 className="font-semibold text-gray-800">Signalment</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {summary.Signalment || "—"}
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-gray-800">Case Overview</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {summary.CaseOverview || "—"}
          </p>
        </div>

        {sortedSummaryVisits.map((visit, index) => (
          <div key={`${visit.VisitDate}-${index}`} className="border-t border-gray-200 pt-4">
            <h3 className="font-semibold text-gray-900">
              {visit.VisitLabel || `Visit ${index + 1}`}
            </h3>

            <p className="mt-1 text-xs text-gray-500">
              {visit.VisitDate || "Date not provided"}
              {visit.Source ? ` • ${visit.Source}` : ""}
            </p>

            <div className="mt-4 space-y-4">
              {VISIT_SECTION_ORDER.map((section, sectionIndex) => (
                <div key={`${visit.VisitDate}-${section}-${sectionIndex}`}>
                  <h4 className="font-semibold text-gray-800">{section}</h4>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                    {visit[section] || "—"}
                  </p>
                </div>
              ))}
            </div>
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