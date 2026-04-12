import { useMemo, useState } from "react"

const API_BASE = "http://localhost:3001";

const SECTION_ORDER = [
  "Signalment",
  "Presenting Complaint",
  "History",
  "Diagnostics",
  "Treatments",
  "Assessment",
  "Plan",
]

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

export default function App() {
  const [recordText, setRecordText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null)
  const [errorMessage, setErrorMessage] = useState("")

  const canGenerate = useMemo(() => {
    return recordText.trim().length > 30 && !isLoading},
    [recordText, isLoading])

  function inferSpeciesFromSignalment(signalment) {
  if (!signalment) return "";
  const s = signalment.toLowerCase();
  if (s.includes("feline") || s.includes("cat")) return "Feline";
  if (s.includes("canine") || s.includes("dog")) return "Canine";
  if (s.includes("equine") || s.includes("horse")) return "Equine";
  return "";
}

function inferPatientName(text) {
  // quick PoC heuristic: look for "Patient: NAME" or "Name: NAME"
  const match =
    text.match(/patient\s*:\s*([^\n\r]+)/i) ||
    text.match(/name\s*:\s*([^\n\r]+)/i);
  return match ? match[1].trim().slice(0, 60) : "";
}

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

  function handleClear() {
    setRecordText("")
    setSummary(null)
    setSaveStatus(null)
    setErrorMessage("")
  }

  async function handleSaveCase() {
  if (!summary) return

  try {
    setSaveStatus(null)
      setErrorMessage("")

      const patientName = inferPatientName(recordText) || "Unknown Patient"
      const species = inferSpeciesFromSignalment(summary.Signalment) || "Unknown"

      const res = await fetch(`${API_BASE}/api/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          species,
          summary,
        }),
      })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.error || "Failed to save case.")
    }

    setSaveStatus(`Case saved successfully${data.id ? ` (ID: ${data.id})` : ""}.`)

    setTimeout(() => {
      setSaveStatus(null)
    }, 3000)

  } catch (err) {
    console.error(err)
    setSaveStatus("Failed to save case.")
  }
}

  function handleExportPdf() {
    setErrorMessage("")
    alert("Export PDF is the next feature to wire up.")
  }

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
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Panel */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Medical Record Input</h2>
                <p className="mt-1 text-sm text-white/60">
                  Paste unstructured patient history notes to generate a structured clinical summary.
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

          {/* Output Panel */}
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

        {/* Footer note */}
        <div className="mt-8 text-xs text-white/40">
          Current proof of concept demonstrates the core summary generation and case-saving workflow.
        </div>
      </main>
    </div>
  )
}