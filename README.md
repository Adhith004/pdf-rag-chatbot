# PDF Q&A Chatbot

A simple Retrieval-Augmented Generation (RAG) chatbot that answers questions about an
uploaded PDF. Built with Python, Flask, LangChain, and Google Gemini, with a plain
HTML/CSS/JavaScript frontend, deployed as Vercel serverless functions. No Git/GitHub
required to deploy.

## How it works

The app is fully stateless: the browser keeps the PDF in memory and re-sends it with
each question inside a `multipart/form-data` POST to `/api/answer`. The serverless
function then runs the RAG pipeline on the fly:

1. Parse the PDF text with `pypdf` (via LangChain's `PyPDFLoader`).
2. Split it into overlapping chunks (`RecursiveCharacterTextSplitter`).
3. Embed the chunks with Gemini embeddings (`gemini-embedding-001`) into an
   in-memory vector store.
4. Retrieve the top K chunks most relevant to the question.
5. Ask Gemini (`gemini-3.6-flash`, temperature 0) to answer using only that context.
   The prompt instructs it to reply `This information is not available in the document.` when the answer is not in the PDF.

Because Vercel functions are stateless and read-only (except `/tmp`), there is no
database, blob storage, or persistent index. This keeps the project tiny and easy to
understand. It is intentionally scoped to small/medium PDFs.

## Project structure

```
.
├── vercel.json          # Function config (60s max duration for the RAG call)
├── requirements.txt     # Python dependencies (auto-installed by Vercel)
├── .env.example         # Template for the Gemini API key (copy to .env locally)
├── .gitignore           # Keeps the real .env out of any future git repo
├── api/
│   └── index.py         # Flask app: POST /api/answer + local static file serving
├── rag.py               # RAG pipeline (load, split, embed, retrieve, generate)
└── public/              # Static frontend served by Vercel at /
    ├── index.html       # Chat UI
    ├── styles.css       # Styling
    └── app.js           # Keeps the PDF in browser memory, calls /api/answer
```

## Stack

- Python backend as a Vercel serverless function (WSGI, Flask). No FastAPI, no Streamlit.
- LangChain (`langchain-google-genai`, `langchain-community`, `langchain-core`,
  `langchain-text-splitters`).
- Google Gemini for embeddings (`gemini-embedding-001`) and generation (`gemini-3.6-flash`).
- Vanilla HTML/CSS/JavaScript frontend - no build step.

## API contract

**Endpoint:** `POST /api/answer` (locally also `/answer`; both are registered).

**Request:** `multipart/form-data` (the PDF is binary, so multipart is used instead of
JSON) with two fields:

| Field | Type | Description |
|---|---|---|
| `file` | binary | The PDF to analyze (max ~3.5 MB). |
| `question` | text | The question to answer about the PDF. |

**Response (success):** `200`

```json
{ "answer": "The retrieved context's answer." }
```

**Response (error):** non-2xx, always `{ "code": "...", "error": "friendly message" }`:

| code | HTTP | Meaning |
|---|---|---|
| `MISSING_PDF` | 400 | No `file` field in the request. |
| `INVALID_PDF` | 400 | Not a `.pdf` filename or the bytes do not start with `%PDF-`. |
| `EMPTY_QUESTION` | 400 | No question text. |
| `QUESTION_TOO_LONG` | 400 | Question exceeds 2000 characters. |
| `PDF_TOO_LARGE` | 413 | File exceeds ~3.5 MB. |
| `NO_READABLE_TEXT` | 422 | The PDF has no extractable text. |
| `RATE_LIMITED` | 429 | Gemini quota/rate limit reached. |
| `MISSING_API_KEY` | 500 | `GOOGLE_API_KEY` is not set (or credentials invalid). |
| `GEMINI_API_ERROR` | 502 | Gemini rejected/failed the request. |
| `SERVER_ERROR` | 500 | Any unexpected backend failure. |

The frontend maps these codes to user-friendly messages; it never logs or displays the
API key (the key only ever exists as a server-side environment variable).

## Local development

Prerequisites: Python 3.10+ and a Google AI Studio API key
(https://aistudio.google.com/apikey).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # then paste your real key into .env
# The key is read as GOOGLE_API_KEY by langchain-google-genai.

python -m flask --app api/index.py:app run --port 5000
```

Open http://localhost:5000, upload a PDF (max ~3.5 MB), and ask a question.

## Deploying to Vercel (no Git required)

1. Install the Vercel CLI: `npm i -g vercel` (or use `npx vercel`).
2. Log in: `vercel login`.
3. Add the secret so it is never in code:
   `vercel env add GOOGLE_API_KEY` (choose Production, then paste the key), or add it
   in the Dashboard under Project Settings -> Environment Variables.
4. Deploy from this directory:
   `vercel --prod`.
5. Open the printed URL. Redeploy any time with `vercel --prod`.

The CLI uploads the local folder directly - no git repository needed. Vercel
auto-detects the Python runtime from `api/` + `requirements.txt`, installs the
dependencies, and serves `public/` as static files.

## Security

- **API key**: read only from the server-side `GOOGLE_API_KEY` environment variable
  (set via `vercel env add` / the dashboard). It never appears in HTML, CSS, JS, or source
  code. `.env.*` files are excluded from deployment with `.vercelignore` (important since
  this project does not use git). If a key is ever exposed in a file, revoke it in Google AI
  Studio and generate a new one.
- **Uploads**: validated as PDFs (filename + `%PDF-` magic bytes), read into memory with a
  hard byte cap (never fully into a large buffer), stored only in a temporary file under
  `/tmp` that is deleted after processing, and never served back.
- **Inputs**: question length capped server- and client-side; all dynamic content is
  rendered with `textContent` (no `innerHTML`), so message text cannot inject HTML/JS.
- **Prompt injection**: PDF-derived context is explicitly treated as untrusted data in the
  prompt, and instruction-override attempts in either content or questions are instructed
  to be ignored. (This is a mitigation, not a guarantee - LLM prompt hardening is never
  absolute.)
- **Errors**: responses are sanitized; Gemini exception details are logged server-side only
  and never echoed to the client. No internal paths, credentials, or stack traces leak.
- **Headers**: Content-Security-Policy, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and `Referrer-Policy` are applied via `vercel.json`, a Flask
  `after_request` hook, and a CSP `<meta>` tag for local dev.
- **Rate limiting**: there is no per-user auth. Public deployments rely on the platform and
  Gemini quota limits. For a production deployment, add authentication and request
  rate-limiting.

## Vercel limitations this design works around

- **~4.5 MB request body limit** -> the PDF must stay small; the backend and frontend
  both reject files over ~3.5 MB.
- **Read-only filesystem except `/tmp`** -> the PDF is decoded from bytes into a temp
  file; nothing persisted.
- **Stateless, cold-start invocations** -> the RAG pipeline rebuilds on each request and
  the browser re-sends the PDF per question. First call after idle may be slow.
- **Function duration limits** -> `vercel.json` sets `maxDuration` to 60 s to fit
  embedding + LLM calls. Very large documents or traffic-heavy use may hit limits.
- **Gemini API quotas** -> re-embedding per question consumes quota; the free tier has
  per-minute/per-day caps.

## Anti-hallucination behavior

The answer is generated from retrieved context only: the prompt forbids outside
knowledge and requires an exact `I don't know` response when the context lacks the
answer. Retrieval only surfaces text actually present in the PDF, and embedding +
generation run at temperature 0.