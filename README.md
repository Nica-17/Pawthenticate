# Pawthenticate – AI-Assisted Veterinary Documentation Platform

AI-powered application designed to transform unstructured veterinary medical records into structured, referral-ready clinical summaries.

---

## Project Overview

Pawthenticate is a full-stack application developed as part of Project & Portfolio IV, demonstrating how artificial intelligence can be integrated into veterinary workflows to reduce time spent reviewing and organizing complex medical records.

The application allows users to input raw medical records (via text or file upload), generate structured clinical summaries, review/edit the results, and export professional documentation suitable for referral or internal use.

---

## Core Features

### Clinical Summary Generation
- Paste or upload veterinary medical records (.txt, .md, .pdf, .docx)
- AI converts unstructured notes into structured clinical summaries
- Output organized into:
  - Signalment
  - Case Overview
  - Visit-based clinical sections (SOAP-style)

### Multi-Visit Case Organization
- Automatically detects and separates multiple visits
- Supports chronological organization (oldest → newest or reverse)

### Editable & Review Modes
- Quick View mode for fast clinical review
- Edit mode for refining generated summaries before saving/export

### Case Management System
- Save structured cases to Firebase Firestore
- Search, sort, and paginate saved cases
- Reload previous cases into the workspace

### Document Preview & Export
- Preview formatted clinical reports in-app
- Export clean, professional PDF summaries for referral use

### File Intake Support
- Drag-and-drop or browse file uploads
- Supports PDF and DOCX parsing for real-world workflow simulation

---

## Tech Stack

**Frontend**
- React (Vite)
- TailwindCSS

**Backend**
- Node.js
- Express.js

**AI Integration**
- OpenAI API (structured JSON output)

**Database**
- Firebase Firestore

**Other Libraries**
- PDF.js (PDF parsing)
- Mammoth (DOCX parsing)

**Version Control**
- Git + GitHub

---

## Project Structure

```
pawthenticate-pp4/
│
├── pawthenticate-client/   # React frontend (UI + user interaction)
├── pawthenticate-server/   # Express backend (API + AI + database)
└── README.md
```

---

## Application Workflow

1. Input veterinary medical records (paste or upload files)
2. Generate structured clinical summary using AI
3. Review or edit the generated output
4. Save the case to the database
5. Search, load, and manage saved cases
6. Preview and export professional PDF reports

---

## Security & Data Handling

- Environment variables are used for all sensitive configuration
- `.env` files and Firebase service credentials are excluded via `.gitignore`
- No API keys or credentials are stored in the repository

### Demo Environment Notice
This application is a proof-of-concept demonstration.  
Only mock or de-identified records should be used.  
No real patient, client, or clinic-sensitive data should be entered.

---

## Current Scope (Milestone 4)

Pawthenticate is complete as a proof-of-concept application, with all core features implemented and functioning end-to-end. The application demonstrates a fully working workflow from raw record input to structured summary generation and export.

---

## Future Enhancements

Planned improvements for production readiness include:

- Clinic-level account system (admin + staff roles)
- User authentication and secure access control
- Role-based permissions and data isolation
- Cloud deployment and hosting
- Audit logging and compliance considerations
- OCR/handwritten record support
- Integration with veterinary PIMS systems

---

## Developer

Veronica Johnson  
Full Sail University – Bachelor of Science in Computer Science  
Project & Portfolio IV