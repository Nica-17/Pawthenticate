# Pawthenticate – PP4 Proof of Concept

AI-assisted veterinary documentation platform designed to transform unstructured medical records into structured, referral-ready summaries.

---

## Project Overview

Pawthenticate is a full-stack proof of concept demonstrating:

- React frontend (Vite)
- Express.js backend
- OpenAI API integration
- Firebase Firestore database storage
- Full-stack API communication
- Git version control & GitHub deployment

The goal of this proof of concept is to validate that AI-assisted structured documentation can be generated, saved, and managed within a veterinary workflow.

---

## Core Features Implemented

- Paste unstructured veterinary notes
- Generate structured SOAP-style summaries via OpenAI
- Save cases to Firebase Firestore
- View confirmation of saved cases
- Secure environment variable management
- Full GitHub repository setup

---

## Tech Stack

**Frontend**
- React
- Vite
- TailwindCSS

**Backend**
- Node.js
- Express.js

**AI**
- OpenAI API

**Database**
- Firebase Firestore

**Version Control**
- Git + GitHub

---

## Project Structure

```
pawthenticate-pp4/
│
├── pawthenticate-client/   # React frontend
├── pawthenticate-server/   # Express backend + API
└── README.md
```

---

## Security Notes

Sensitive files are excluded using `.gitignore`:

- `.env`
- Firebase service account JSON
- `node_modules`

No API keys or credentials are stored in this repository.

---

## Purpose of This Proof of Concept

This project serves as the foundational build for Project & Portfolio IV, demonstrating:

- AI integration within a medical workflow
- Full-stack communication
- Database persistence
- Professional development workflow

Future versions will include:
- PDF export formatting
- Case history dashboard
- User authentication
- Deployment to cloud hosting

---

## Developer

Veronica Johnson  
Full Sail University – Computer Science  
PP4 Project Development