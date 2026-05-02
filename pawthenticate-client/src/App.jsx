/**
 * Pawthenticate - Main Application Component
 *
 * Responsibilities:
 * - Accept raw veterinary medical records and uploaded referral files
 * - Send source text to the backend for AI summarization
 * - Display structured visit-based clinical summaries
 * - Save and retrieve prior cases from the database
 * - Preview and export formatted clinical reports
 *
 * This file currently acts as the main UI controller for the proof of concept.
 */

import { useEffect, useMemo, useState } from "react"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf"
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
import mammoth from "mammoth"

// Configure PDF.js worker for client-side PDF text extraction
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// ==============================
// App Configuration
// ==============================

// Base URL for backend API
const API_BASE = "http://localhost:3001"

// Defines the display order of visit-level clinical sections
const VISIT_SECTION_ORDER = [
  "Presenting Complaint",
  "History",
  "Diagnostics",
  "Treatments",
  "Assessment",
  "Plan",
]

// Maps each generation stage to a user-facing label and progress value
const GENERATION_STAGE_CONFIG = {
  preparing: {
    label: "Preparing referral record for processing...",
    progress: 15,
  },
  sending: {
    label: "Submitting record for clinical summarization...",
    progress: 45,
  },
  structuring: {
    label: "Organizing findings into structured clinical sections...",
    progress: 80,
  },
  finalizing: {
    label: "Finalizing report output for review...",
    progress: 100,
  },
}

// ==============================
// Reusable Display Components
// ==============================

// Shared summary block used across the generated summary and visit sections
function SummarySection({
  title,
  body,
  onChange,
  isLast = false,
  multiline = true,
}) {
  return (
    <div className={`${!isLast ? "border-b border-white/10 pb-4" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
        {title}
      </div>

      {multiline ? (
        <textarea
          value={body || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-neutral-950/60 p-3 text-sm leading-relaxed text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
          placeholder={`Enter ${title.toLowerCase()}...`}
        />
      ) : (
        <input
          type="text"
          value={body || ""}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/60 p-3 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
          placeholder={`Enter ${title.toLowerCase()}...`}
        />
      )}
    </div>
  )
}

// Read-only summary block used for quick review mode without editable scroll fields
function ReadOnlySummarySection({ title, body, isLast = false }) {
  return (
    <div className={`${!isLast ? "border-b border-white/10 pb-4" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
        {title}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
        {body || "—"}
      </p>
    </div>
  )
}

// ==============================
// Main Application Component
// ==============================

export default function App() {
  // ==============================
  // State
  // ==============================

  // User input
  const [recordText, setRecordText] = useState("")

  // Generation state
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState(null)
  const [generationStage, setGenerationStage] = useState("")
  const [generationProgress, setGenerationProgress] = useState(0)

  // UI feedback
  const [saveStatus, setSaveStatus] = useState(null)
  const [errorMessage, setErrorMessage] = useState("")

  // Tracks which visit cards are expanded in quick view mode
  const [expandedVisits, setExpandedVisits] = useState({})

  // Preview modal
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Controls whether the generated summary displays as a readable quick view or editable form
  const [isEditingSummary, setIsEditingSummary] = useState(false)

  // Metadata
  const [generatedDate, setGeneratedDate] = useState("")

  // Saved cases
  const [savedCases, setSavedCases] = useState([])
  const [isLoadingCases, setIsLoadingCases] = useState(false)
  const [casesError, setCasesError] = useState("")

  // Saved case dashboard controls
  const [searchTerm, setSearchTerm] = useState("")
  const [sortOption, setSortOption] = useState("newest")
  const [currentPage, setCurrentPage] = useState(1)

  // File upload state for drag-and-drop referral record intake
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  // Guides how the AI should organize multi-visit records in the returned summary
  const [organizationPreference, setOrganizationPreference] = useState("oldest")

  // ==============================
  // Derived Values
  // ==============================

  // Enables summary generation only when enough source text is present
  const canGenerate = useMemo(() => {
    return recordText.trim().length > 30 && !isLoading
  }, [recordText, isLoading])

  // ==============================
  // Text Extraction Helpers
  // ==============================

  // Infers species from AI-generated signalment text
  function inferSpeciesFromSignalment(signalment) {
    if (!signalment) return "Unknown"

    const s = signalment.toLowerCase()

    const canineTerms = [
      "canine",
      "dog",
      "golden retriever",
      "labrador",
      "lab",
      "german shepherd",
      "bulldog",
      "poodle",
      "terrier",
      "beagle",
      "boxer",
      "dachshund",
      "husky",
      "rottweiler",
      "chihuahua",
      "corgi",
      "shih tzu",
      "mastiff",
      "doberman",
    ]

    const felineTerms = [
      "feline",
      "cat",
      "dsh",
      "dlh",
      "dmh",
      "domestic shorthair",
      "domestic longhair",
      "domestic medium hair",
      "siamese",
      "maine coon",
      "persian",
      "ragdoll",
      "bengal",
      "sphynx",
    ]

    const equineTerms = ["equine", "horse", "pony", "mare", "stallion", "gelding"]

    if (canineTerms.some((term) => s.includes(term))) return "Canine"
    if (felineTerms.some((term) => s.includes(term))) return "Feline"
    if (equineTerms.some((term) => s.includes(term))) return "Equine"

    return "Unknown"
  }

  // Extracts labeled fields from messy raw source text
  // Supports patterns like:
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

    return match[1].replace(/^["'\s]+|["'\s]+$/g, "").trim()
  }

  // Normalizes Mammoth DOCX output by restoring line breaks between flattened labels
  function normalizeDocxText(rawText) {
    if (!rawText) return ""

    return rawText
      .replace(/\r\n/g, "\n")
      .replace(
        /(?<!\n)(Client|Owner|Patient|Pet|Species|Breed|Sex|DOB|MRN|Age|Weight|Reason|Assessment|Plan|Diagnostics|Treatments|History|Presenting Complaint)\s*:/gi,
        "\n$1:"
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  // Cleans a possible patient name captured from signalment or raw text
  function cleanPatientNameCandidate(value) {
    if (!value) return ""

    const cleaned = value
      .split(
        /(?=\b(?:client|owner|patient|species|breed|sex|dob|mrn|age|weight|visit|reason)\b\s*[:=\-])/i
      )[0]
      .split(/[\n\r,;()]/)[0]
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .trim()

    if (!cleaned) return ""

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

    if (cleaned.length > 40) {
      return ""
    }

    return cleaned
  }

  // Prefer signalment-based extraction first, then fall back to raw record text
  function inferPatientNameFromSignalment(signalment) {
    if (!signalment) return ""

    const patterns = [
      /^([A-Z][A-Za-z0-9' .-]{0,39})\s*[-–—,]/,
      /\bname\s*[:=]\s*([A-Za-z0-9' .-]{1,40})/i,
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
  function inferPatientName(text) {
    if (!text) return ""

    const directMatch = extractLabeledField(text, [
      "patient",
      "patient name",
      "pet",
      "pet name",
      "pt",
    ])

    return cleanPatientNameCandidate(directMatch)
  }

  // Extracts client or owner name from messy raw text, including flattened DOCX exports
  function extractClientName(sourceText) {
    if (!sourceText) return ""

    const match = sourceText.match(
      /(?:client|owner)\s*[:=\-]\s*(.+?)(?=(?:patient|pet|species|breed|sex|dob|mrn|age|weight|visit|reason|owner|client)\s*[:=\-]|$)/is
    )

    if (!match) return ""

    return match[1].trim()
  }

  // Cleans a possible client or owner name captured from raw text
  function cleanClientNameCandidate(value) {
    if (!value) return ""

    const cleaned = value
      .split(
        /(?=(?:client|owner|patient|pet|name|species|breed|sex|dob|mrn|age|weight|visit|reason)\s*[:=\-])/i
      )[0]
      .split(/[\n\r,;()]/)[0]
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .trim()

    if (!cleaned) return ""

    const invalidValues = new Set(["client", "owner", "unknown", "patient"])

    if (invalidValues.has(cleaned.toLowerCase())) {
      return ""
    }

    if (cleaned.length > 60) {
      return ""
    }

    return cleaned
  }

  // Attempts to extract client or owner name from raw input text
  function inferClientName(sourceText) {
    if (!sourceText) return ""

    const directMatch = extractClientName(sourceText)
    return cleanClientNameCandidate(directMatch)
  }

  // Updates a top-level summary field such as Signalment or CaseOverview
  function updateSummaryField(field, value) {
    setSummary((prev) => {
      if (!prev) return prev

      return {
        ...prev,
        [field]: value,
      }
    })
  }

  // Updates a visit-level field inside the structured summary
  function updateVisitField(visitIndex, field, value) {
    setSummary((prev) => {
      if (!prev || !Array.isArray(prev.Visits)) return prev

      const updatedVisits = prev.Visits.map((visit, index) => {
        if (index !== visitIndex) return visit

        return {
          ...visit,
          [field]: value,
        }
      })

      return {
        ...prev,
        Visits: updatedVisits,
      }
    })
  }

  // Toggles a visit card open or closed in quick view mode
  function toggleVisitExpanded(index) {
    setExpandedVisits((prev) => ({
      ...prev,
      [index]: !prev[index],
    }))
  }

  // ==============================
  // Derived Display Values
  // ==============================

  // Prefer signalment-based extraction first, then fall back to raw record text
  const patientName =
    inferPatientNameFromSignalment(summary?.Signalment) ||
    inferPatientName(recordText) ||
    "Unknown Patient"

  const clientName = inferClientName(recordText) || "Unknown Client"
  const species = inferSpeciesFromSignalment(summary?.Signalment) || "Unknown"

  // Reorders visit summaries to match the selected timeline preference
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
  const totalPages = Math.max(
    1,
    Math.ceil(filteredAndSortedCases.length / casesPerPage)
  )

  const paginatedCases = filteredAndSortedCases.slice(
    (currentPage - 1) * casesPerPage,
    currentPage * casesPerPage
  )

  // ==============================
  // Saved Case Helpers
  // ==============================

  function getSavedCasePatientName(savedCase) {
    if (savedCase.patientName && savedCase.patientName !== "Unknown Patient") {
      return savedCase.patientName
    }

    const signalmentName = inferPatientNameFromSignalment(
      savedCase.summary?.Signalment || ""
    )

    if (signalmentName) {
      return signalmentName
    }

    const sourceText = savedCase.originalRecordText || savedCase.recordText || ""

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

    const sourceText = savedCase.originalRecordText || savedCase.recordText || ""

    return inferClientName(sourceText) || "Unknown Client"
  }

  // Restores a saved case into the workspace for review, preview, or export
  function handleLoadSavedCase(savedCase) {
    setSummary(savedCase.summary || null)
    setRecordText(savedCase.originalRecordText || savedCase.recordText || "")
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
    setIsEditingSummary(false)
    setExpandedVisits({})

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  // ==============================
  // Date Utilities
  // ==============================

  // Normalizes backend dates into JavaScript Date objects
  function normalizeCaseDate(value) {
    if (!value) return null

    if (value?.seconds) {
      return new Date(value.seconds * 1000)
    }

    if (typeof value === "string") {
      return new Date(value)
    }

    if (value instanceof Date) {
      return value
    }

    return null
  }

  // Formats compact dates for the Saved Cases table
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

  // Formats full timestamps for preview documents and PDF export
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

  // ==============================
  // File Upload Handlers
  // ==============================

  // Reads supported uploaded files and merges their extracted text into the record input
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

          // TXT / MD
          if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
            text = await file.text()
          }

          // PDF
          else if (lowerName.endsWith(".pdf")) {
            const arrayBuffer = await file.arrayBuffer()
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

              const pageText = content.items
                .map((item) => ("str" in item ? item.str : ""))
                .join(" ")
                .trim()

              pdfText += `${pageText}\n\n`
            }

            text = pdfText.trim()
          }

          // DOCX
          else if (lowerName.endsWith(".docx")) {
            const arrayBuffer = await file.arrayBuffer()
            const result = await mammoth.extractRawText({ arrayBuffer })

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

  // ==============================
  // Effects
  // ==============================

  // Load saved cases when the app first mounts
  useEffect(() => {
    fetchSavedCases()
  }, [])

  // Reset pagination when search or sort changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sortOption])

  // ==============================
  // Core Actions
  // ==============================

  // Updates the loading UI so the bar and status text stay in sync
  function setGenerationStageState(stageKey) {
    const stage = GENERATION_STAGE_CONFIG[stageKey]

    if (!stage) return

    setGenerationStage(stage.label)
    setGenerationProgress(stage.progress)
  }
  
  // Sends the source record text to the backend and stores the structured result
  async function handleGenerate() {
    try {
      setIsLoading(true)
      setSummary(null)
      setSaveStatus(null)
      setErrorMessage("")
      setGenerationStageState("preparing")
      setIsEditingSummary(false)
      setExpandedVisits({})

      // Briefly show the request preparation step before the API call begins
      await new Promise((resolve) => setTimeout(resolve, 250))

      setGenerationStageState("sending")

      const res = await fetch(`${API_BASE}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordText,
          organizationPreference,
        }),
      })

      setGenerationStageState("structuring")

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate summary.")
      }

      if (data.summary) {
        console.log("Generated summary response:", data.summary)

        // Reflect the final UI update stage before rendering the completed summary
        setGenerationStageState("finalizing")
        await new Promise((resolve) => setTimeout(resolve, 250))

        setSummary(data.summary)
        setGeneratedDate(new Date().toLocaleString())
        return
      }

      if (data.summaryText) {
        throw new Error(
          "The server returned text instead of the expected structured summary."
        )
      }

      throw new Error("Unexpected response received from the server.")
    } catch (err) {
      console.error(err)
      setErrorMessage(
        err.message || "Something went wrong while generating the summary."
      )
    } finally {
      setIsLoading(false)
      setGenerationStage("")
      setGenerationProgress(0)
    }
  }

  // Clears the current workspace and resets the input state
  function handleClear() {
    setRecordText("")
    setSummary(null)
    setSaveStatus(null)
    setErrorMessage("")
    setIsPreviewOpen(false)
    setGeneratedDate("")
    setUploadedFiles([])
    setOrganizationPreference("oldest")
    setGenerationStage("")
    setGenerationProgress(0)
    setIsEditingSummary(false)
    setExpandedVisits({})
  }

  // Saves the current summary, source text, and metadata to Firestore
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

  // Fetches recently saved cases for the dashboard
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

  // Builds a printable report view and opens the browser print dialog
  function handleExportPdf() {
    if (!summary) return

    setErrorMessage("")

    const printableSections = `
  <section class="report-section">
    <h2 class="section-title">Signalment</h2>
    <p>${summary.Signalment || "—"}</p>
  </section>

  <section class="report-section">
    <h2 class="section-title">Case Overview</h2>
    <p>${summary.CaseOverview || "—"}</p>
  </section>

  ${sortedSummaryVisits
    .map(
      (visit, index) => `
    <section class="visit-block">
      <div class="visit-header">
        <h2 class="visit-title">${visit.VisitLabel || `Visit ${index + 1}`}</h2>
        <div class="visit-meta">
          <div><strong>Date:</strong> ${visit.VisitDate || "Not provided"}</div>
          <div><strong>Source:</strong> ${visit.Source || "Not provided"}</div>
        </div>
      </div>

      <div class="visit-sections">
        ${VISIT_SECTION_ORDER.map(
          (section) => `
          <section class="report-section visit-section">
            <h3>${section}</h3>
            <p>${visit[section] || "—"}</p>
          </section>
        `
        ).join("")}
      </div>
    </section>
  `
    )
    .join("")}
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
              <div class="meta-full"><strong>Referring Clinic:</strong> ${
                sortedSummaryVisits?.[0]?.Source || "Not Provided"
              }</div>
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

  // ==============================
  // Render
  // ==============================

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-neutral-950/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Pawthenticate</h1>
              <p className="mt-1 text-sm text-white/60">
                AI-assisted veterinary documentation for rapid history review and
                referral export.
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

        {/* Demo Environment Notice */}
        <section className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
          <div className="text-sm font-semibold text-amber-100">
            Demo Environment Notice
          </div>

          <p className="mt-1 text-sm leading-relaxed text-amber-100/80">
            This application is a proof-of-concept demonstration. Use only mock or
            de-identified records. Do not enter real patient, client, or clinic-sensitive data.
          </p>
        </section>

        {/* Main Layout - Input (left) and Output (right) panels */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Panel */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Medical Record Input</h2>
                <p className="mt-1 text-sm text-white/60">
                  Paste patient history notes or upload referral files to generate a
                  structured clinical summary.
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

            {/* Drag-and-drop intake reflects how referral records may arrive as separate files */}
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
                    Sort Order
                  </label>

                  <div className="relative mt-1">
                    <select
                      value={organizationPreference}
                      onChange={(e) => setOrganizationPreference(e.target.value)}
                      className="appearance-none w-full rounded-xl border border-white/10 bg-neutral-950/60 py-2 pl-4 pr-12 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                    >
                      <option value="oldest">Oldest First</option>
                      <option value="newest">Newest First</option>
                    </select>

                    <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-white/40">
                      <span className="text-xs">▼</span>
                    </div>
                  </div>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="text-xs text-white/50">
                    {uploadedFiles.length} file
                    {uploadedFiles.length === 1 ? "" : "s"} added
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
                <div className="text-sm font-medium text-white/80">
                  Generating Clinical summary
                </div>

                <div className="mt-2 text-xs text-white/60">
                  {generationStage || "Preparing request..."}
                </div>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full animate-pulse rounded-full bg-indigo-500/80 transition-all duration-500 ease-out"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>

                <div className="mt-2 text-right text-[11px] text-white/40">
                  {generationProgress}%
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {errorMessage}
              </div>
            )}
          </section>

          {/* Output Panel */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Structured Summary</h2>
                <p className="mt-1 text-sm text-white/60">
                  Output organized into clinical sections for faster review and
                  documentation. Fields can be edited before saving or exporting.
                </p>
              </div>

              <div className="flex items-center gap-2">
                
                <button
                  onClick={() => setIsEditingSummary((prev) => !prev)}
                  disabled={!summary || isLoading}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                >
                  {isEditingSummary ? "Quick View" : "Edit Summary"}
                </button>
                
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
                No summary yet. Paste a record and click{" "}
                <span className="text-white/80">Generate Summary</span>.
              </div>
            )}

            {summary && (
              <div
                className="mt-5 max-h-[520px] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950/40 p-5"
              >
                <div className="mb-4 rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
                  {isEditingSummary
                    ? "Edit Mode: Update fields before saving or exporting."
                    : "Quick View Mode: Review the generated clinical summary."}
                </div>

                <div className="space-y-6">
                  {isEditingSummary ? (
                    <>
                      <SummarySection
                        title="Signalment"
                        body={summary.Signalment}
                        onChange={(value) => updateSummaryField("Signalment", value)}
                      />

                      <SummarySection
                        title="Case Overview"
                        body={summary.CaseOverview}
                        onChange={(value) => updateSummaryField("CaseOverview", value)}
                        isLast={!summary.Visits || summary.Visits.length === 0}
                      />

                      {sortedSummaryVisits.map((visit, index) => (
                        <div
                          key={`visit-edit-${index}`}
                          className="rounded-xl border border-indigo-400/20 bg-white/5 p-4 shadow-lg shadow-black/10"
                        >
                          <div className="mb-4 border-b border-white/10 pb-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                                  Visit {index + 1}
                                </div>
                                <div className="mt-1 text-sm text-white/60">
                                  Edit visit metadata and clinical section details.
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                              <div>
                                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                                  Visit Label
                                </label>
                                <input
                                  type="text"
                                  value={visit.VisitLabel || ""}
                                  onChange={(e) =>
                                    updateVisitField(index, "VisitLabel", e.target.value)
                                  }
                                  className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/60 p-3 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                                  placeholder={`Visit ${index + 1}`}
                                />
                              </div>

                              <div>
                                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                                  Visit Date
                                </label>
                                <input
                                  type="text"
                                  value={visit.VisitDate || ""}
                                  onChange={(e) =>
                                    updateVisitField(index, "VisitDate", e.target.value)
                                  }
                                  className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/60 p-3 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                                  placeholder="Enter visit date..."
                                />
                              </div>

                              <div>
                                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                                  Source
                                </label>
                                <input
                                  type="text"
                                  value={visit.Source || ""}
                                  onChange={(e) =>
                                    updateVisitField(index, "Source", e.target.value)
                                  }
                                  className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/60 p-3 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                                  placeholder="Enter source clinic..."
                                />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            {VISIT_SECTION_ORDER.map((section, sectionIndex) => (
                              <SummarySection
                                key={`visit-edit-${index}-${section}`}
                                title={section}
                                body={visit[section]}
                                onChange={(value) => updateVisitField(index, section, value)}
                                isLast={sectionIndex === VISIT_SECTION_ORDER.length - 1}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <ReadOnlySummarySection title="Signalment" body={summary.Signalment} />

                      <ReadOnlySummarySection
                        title="Case Overview"
                        body={summary.CaseOverview}
                        isLast={!summary.Visits || summary.Visits.length === 0}
                      />

                      {sortedSummaryVisits.map((visit, index) => {
                        const isExpanded = expandedVisits[index] ?? false

                        return (
                          <div
                            key={`visit-readonly-${index}`}
                            className="rounded-2xl border border-indigo-400/20 bg-white/5 shadow-lg shadow-black/10"
                          >
                            <button
                              type="button"
                              onClick={() => toggleVisitExpanded(index)}
                              className="w-full p-5 text-left hover:bg-white/[0.03]"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                                    Visit {index + 1}
                                  </div>

                                  <h3 className="mt-2 text-lg font-semibold leading-snug text-white">
                                    {visit.VisitLabel || `Visit ${index + 1}`}
                                  </h3>

                                  <div className="mt-3 text-xs leading-relaxed text-white/45">
                                    <div>{visit.VisitDate || "Date not provided"}</div>
                                    <div>{visit.Source || "Source not provided"}</div>
                                  </div>
                                </div>

                                <span className="mt-1 shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60">
                                  {isExpanded ? "Collapse ▲" : "Expand ▼"}
                                </span>
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="space-y-4 border-t border-white/10 px-5 pb-5 pt-4">
                                {VISIT_SECTION_ORDER.map((section, sectionIndex) => (
                                  <ReadOnlySummarySection
                                    key={`visit-readonly-${index}-${section}`}
                                    title={section}
                                    body={visit[section]}
                                    isLast={sectionIndex === VISIT_SECTION_ORDER.length - 1}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Saved Cases */}
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
            <div className="mt-4 text-sm text-white/60">Loading saved cases...</div>
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
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
                  className="appearance-none rounded-xl border border-white/10 bg-neutral-950/60 py-2 pl-4 pr-12 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="name">Patient Name</option>
                </select>

                <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-white/40">
                  <span className="text-xs">▼</span>
                </div>
              </div>
            </div>

            {!isLoadingCases &&
              !casesError &&
              savedCases.length > 0 &&
              filteredAndSortedCases.length === 0 && (
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
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                >
                  Previous
                </button>

                <button
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
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
          Current proof of concept demonstrates the core summary generation and
          case-saving workflow.
        </div>

        {/* Preview Modal */}
        {isPreviewOpen && summary && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setIsPreviewOpen(false)}
          >
            <div
              className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-8 text-black shadow-2xl"
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
                <p className="mt-1 text-sm text-gray-500">
                  Generated by Pawthenticate
                </p>

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
                    <span className="font-semibold">Generated:</span>{" "}
                    {formatDocumentDateTime(generatedDate)}
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
                  <div
                    key={`${visit.VisitDate}-${index}`}
                    className="border-t border-gray-200 pt-4"
                  >
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