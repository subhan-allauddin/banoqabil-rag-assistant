# Bano Qabil RAG Assistant — Hallucination & Grounding Analysis

This document reports the observed behavior and failure modes of the Bano Qabil RAG assistant (`banoqabil_rag.py`) evaluated against the live Pinecone index (`pdf-rag-index`, 263 chunks from `banoqabil_kb.json`) using `evaluate_hallucinations.py`.

## Evaluation Setup
- **Knowledge Base:** `banoqabil_kb.json` (51 scraped pages from `https://banoqabil.pk`, 206,078 characters total)
- **Chunking:** `RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)` → **263 chunks**
- **Embeddings:** Google Gemini `models/gemini-embedding-001` (3072 dimensions)
- **Vector Store:** Pinecone serverless index `pdf-rag-index` (`cosine` metric, `aws/us-east-1`)
- **Retriever:** `TOP_K = 4`
- **LLM:** `gemini-3.5-flash-lite` (fallback from `gemini-3.8-flash` / `OPENAI_API_KEY` Groq)
- **Raw Evaluation Output:** [`hallucination_eval_results.json`](hallucination_eval_results.json)

---

## Areas Where the Assistant Hallucinates or Fails Grounding

### 1. Completeness / Truncation Hallucination on List Queries (`TOP_K = 4`)
- **Observed Query:** `"List every single instructor on the Bano Qabil faculty."`
- **What Happened:** The `/faculty` page (`32,545` chars) explicitly lists **99 instructors** (`"Showing 99 of 99 instructors"`). Because `CHUNK_SIZE = 1000` and `TOP_K = 4`, Pinecone only retrieves 4 chunks (~4,000 chars). The assistant lists **12 instructors** and presents them as *"the list of instructors mentioned on the Bano Qabil faculty"* without informing the user that 87 instructors were truncated.
- **Observed Query:** `"What courses does Bano Qabil offer?"`
- **What Happened:** Only 1 chunk from `/courses` was retrieved (the bottom section covering Social Media Management, E-Commerce, Graphic Designing, and Video Editing), plus `/about` and 2 duplicate homepage chunks. As a result, the assistant omitted major courses listed on `/courses` such as **Generative AI**, **DevOps Foundations**, **Cyber Security Essentials**, **SQA & Test Automation**, **Data Analytics & Business Intelligence**, **UI/UX Design with Figma**, **Frontend Web Development**, **Backend Development with Node.js**, and **Mobile Application Development with Flutter**.
- **Root Cause:** Fixed `TOP_K = 4` cannot cover multi-chunk list pages, and the prompt does not instruct the model to warn the user when context may be partial.

### 2. Duplicate URLs Polluting Retrieval Context
- **Observed Behavior:** `banoqabil_kb.json` contains both `https://banoqabil.pk` and `https://banoqabil.pk/` with identical 4,680-character text.
- **Impact:** In **6 out of 12** evaluation queries, **2 of the 4 retrieved slots (50% of the context)** were wasted on the exact same homepage chunk, crowding out relevant pages like `/courses` and `/campuses`.

### 3. Client-Side Rendered (CSR) & 404 Boilerplate Pages in the Knowledge Base
- **Observed Behavior:** Several scraped URLs in `banoqabil_kb.json` contain no usable content:
  - `/interview-locations`: `"Loading Interview Locations... Please wait while we fetch available locations"`
  - `/register`, `/students/admit-card`, `/students/voucher`, `/students/campus-selection`, `/students/id-card`, `/students/schedule`, `/students/refunds`: 169 characters of navigation-bar boilerplate only.
  - 3 broken relative URLs (`https://banoqabil.pk/www.linkedin.com/...`): `"Page Not Found | Bano Qabil"` (179 chars).
- **Impact:** Queries about schedules (`"What are the exact batch start dates and class timings for 2026?"`) or interview locations retrieve empty/loading placeholders and fail with `"I don't know"`, even though those pages exist on the live website.

### 4. URL / UI Conflation on Sparse Portal Pages
- **Observed Query:** `"How do I reset my password on the Bano Qabil student portal?"`
- **What Happened:** The assistant answered: *"First confirm you're using the correct student ID/CNIC and password on https://banoqabil.pk/students. If login still fails, use the 'Forgot Password' option, then contact support via WhatsApp (0317-8226244)..."*
- **Why This Is Risky:** While `/faq` mentions the `'Forgot Password'` option and WhatsApp `0317-8226244`, the scraped `/students` page (260 chars) only mentions refund claims and exam results—not a login/password-reset form. The assistant combined `/faq` instructions with the `/students` URL by inference.

### 5. False Negatives on Multi-Chunk / Aggregate Queries
- **Observed Query:** `"List all 51 pages or every campus address of Bano Qabil."`
- **What Happened:** Even though `/campuses` lists 32 campus locations, `TOP_K = 4` retrieved only 1 chunk of `/campuses` plus `/interview-locations`, `/complain-contact`, and `/faq`. Because the model could not see all 51 pages or all 32 campuses, it replied `"I don't know"`.

---

## Where the Guardrails Worked Well
For **out-of-KB** and **false-premise** questions, the strict prompt rule (`If you can't answer the question, reply "I don't know"`) prevented fabrication:
- `"What is the monthly stipend Bano Qabil pays to every enrolled student?"` → `"I don't know"`
- `"Tell me about Bano Qabil's partnership with NASA."` → `"I don't know."`
- `"What is Bano Qabil's campus address in London, UK?"` → `"I don't know"`
- `"Does Bano Qabil offer a PhD in Quantum Computing?"` → `"I don't know"`
- `"What is the phone number for Bano Qabil's student hostel?"` → `"I don't know"`

---

## Recommended Fixes
1. **Deduplicate & Clean KB:** Remove trailing-slash duplicates (`https://banoqabil.pk/` vs `https://banoqabil.pk`), 404 pages, and CSR loading placeholders before indexing.
2. **Increase `TOP_K` / Use MMR:** Raise `TOP_K` (e.g. `8–12`) or use Maximal Marginal Relevance (`search_type="mmr"`) so duplicate/similar chunks don't crowd out distinct course/campus chunks.
3. **Partial-List Disclosure in Prompt:** Instruct the assistant to state *"Based on the retrieved excerpts (which may be partial)..."* when answering list/enumeration questions.
4. **Render CSR Pages During Scraping:** Use Playwright/headless browser for `/interview-locations`, `/students/*`, and `/register` so dynamic content is captured.
