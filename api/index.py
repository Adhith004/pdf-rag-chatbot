import os #index.py is the Flask backend server that receives PDF uploads and questions,
#calls the RAG logic in rag.py, and returns AI-generated answers to the user.
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask, jsonify, request, send_from_directory

from langchain_google_genai._common import GoogleGenerativeAIError

from google.api_core.exceptions import GoogleAPIError, ResourceExhausted
from google.auth.exceptions import DefaultCredentialsError

from rag import answer_question


def _is_quota_error(exc):
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, ResourceExhausted):
            return True
        exc = getattr(exc, "__cause__", None)
    return False

app = Flask(__name__)

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
MAX_PDF_BYTES = 3_500_000
MAX_QUESTION_CHARS = 2000
MAX_CONTENT_LENGTH = 5_000_000
PDF_MAGIC = b"%PDF-"

app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def _error(code, message, status):
    return jsonify({"code": code, "error": message}), status


@app.errorhandler(413)
def too_large(exc):
    return _error(
        "PDF_TOO_LARGE", "The upload is too large; max PDF size is 3.5 MB.", 413
    )


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


@app.route("/")
def frontend():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(PUBLIC_DIR, filename)


@app.route("/answer", methods=["POST"])
@app.route("/api/answer", methods=["POST"])
def answer():
    pdf = request.files.get("file")
    question = (request.form.get("question") or "").strip()

    if pdf is None:
        return _error("MISSING_PDF", "No PDF file was uploaded.", 400)
    if pdf.filename is None or not pdf.filename.lower().endswith(".pdf"):
        return _error("INVALID_PDF", "Only PDF files are supported.", 400)
    if not question:
        return _error("EMPTY_QUESTION", "Please provide a question.", 400)
    if len(question) > MAX_QUESTION_CHARS:
        return _error(
            "QUESTION_TOO_LONG",
            f"Question is too long (max {MAX_QUESTION_CHARS} characters).",
            400,
        )

    pdf_bytes = pdf.read(MAX_PDF_BYTES + 1)
    if not pdf_bytes.startswith(PDF_MAGIC):
        return _error("INVALID_PDF", "The uploaded file is not a valid PDF.", 400)
    if len(pdf_bytes) > MAX_PDF_BYTES:
        return _error("PDF_TOO_LARGE", "The PDF is too large; max size is 3.5 MB.", 413)
    if not os.environ.get("GOOGLE_API_KEY"):
        return _error(
            "MISSING_API_KEY",
            "The Gemini API key is not configured on the server.",
            500,
        )

    request_started = time.perf_counter()

    try:
        answer_text = answer_question(pdf_bytes, question)
        app.logger.info(
            "Backend total: %.2f seconds", time.perf_counter() - request_started
        )
    except ValueError as exc:
        app.logger.exception("ValueError during answer_question")
        return _error("NO_READABLE_TEXT", str(exc), 422)
    except ResourceExhausted:
        app.logger.exception("Gemini rate limited")
        return _error(
            "RATE_LIMITED",
            "Gemini is rate-limiting requests right now. Wait a moment and try again.",
            429,
        )
    except DefaultCredentialsError:
        app.logger.exception("Google credentials error")
        return _error(
            "MISSING_API_KEY",
            "The Gemini API key is missing or invalid on the server.",
            500,
        )
    except GoogleGenerativeAIError as exc:
        app.logger.exception("Gemini (langchain) API error: %s", exc)
        if _is_quota_error(exc):
            return _error(
                "RATE_LIMITED",
                "Gemini is rate-limiting requests right now. Wait a moment and try again.",
                429,
            )
        return _error(
            "GEMINI_API_ERROR",
            "Gemini could not answer the question. Please try again.",
            502,
        )
    except GoogleAPIError as exc:
        app.logger.exception("Gemini API error: %s", exc)
        return _error(
            "GEMINI_API_ERROR",
            "Gemini could not answer the question. Please try again.",
            502,
        )
    except Exception:
        app.logger.exception("Unexpected error during answer_question")
        return _error(
            "SERVER_ERROR", "Something went wrong on the server. Please try again.", 500
        )

    return jsonify({"answer": answer_text})
