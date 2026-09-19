const MAX_PDF_BYTES = 3_500_000;
const MAX_QUESTION_CHARS = 2000;

const pdfInput = document.getElementById("pdf-input");
const uploadButton = document.getElementById("upload-button");
const fileStatus = document.getElementById("file-status");
const chat = document.getElementById("chat");
const form = document.getElementById("question-form");
const questionInput = document.getElementById("question-input");
const sendButton = document.getElementById("send-button");
const clearButton = document.getElementById("clear-button");

let pdfFile = null;

uploadButton.addEventListener("click", () => pdfInput.click());

clearButton.addEventListener("click", () => {
  chat.replaceChildren();
  renderEmptyState();
});

pdfInput.addEventListener("change", () => {
  const file = pdfInput.files[0];
  if (!file) {
    pdfFile = null;
    fileStatus.textContent = "No PDF selected";
    fileStatus.classList.remove("is-loaded");
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    pdfFile = null;
    fileStatus.textContent = "Please choose a PDF file.";
    fileStatus.classList.remove("is-loaded");
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    pdfFile = null;
    fileStatus.textContent = `This file is too large (max ${MAX_PDF_BYTES / 1_000_000} MB).`;
    fileStatus.classList.remove("is-loaded");
    return;
  }
  pdfFile = file;
  fileStatus.textContent = `\u2713 ${file.name}`;
  fileStatus.classList.add("is-loaded");
  addMessage("system", `Ready to answer questions about "${file.name}".`);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();
  if (!question) return;
  if (question.length > MAX_QUESTION_CHARS) {
    addMessage(
      "system",
      `Please keep questions under ${MAX_QUESTION_CHARS} characters.`
    );
    return;
  }

  if (!pdfFile) {
    addMessage("system", "Please upload a PDF first, then ask your question.");
    return;
  }

  addMessage("user", question);
  questionInput.value = "";
  setBusy(true);
  const typing = addTypingIndicator();

  const body = new FormData();
  body.append("file", pdfFile, pdfFile.name);
  body.append("question", question);

  try {
    const response = await fetch("/api/answer", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    removeTypingIndicator(typing);
    if (!response.ok) {
      addMessage("system", friendlyError(response.status, data));
    } else {
      addMessage("bot", data.answer);
    }
  } catch (err) {
    removeTypingIndicator(typing);
    addMessage(
      "system",
      "Could not reach the server. Check your connection and try again."
    );
  } finally {
    setBusy(false);
  }
});

function friendlyError(status, data) {
  const code = data && data.code;
  const message = (data && data.error) || "";
  switch (code) {
    case "MISSING_PDF":
      return "Please upload a PDF first, then ask your question.";
    case "INVALID_PDF":
      return message || "The selected file is not a valid PDF.";
    case "EMPTY_QUESTION":
      return message || "Please type a question.";
    case "PDF_TOO_LARGE":
      return "The PDF is too large to upload. Please choose a smaller file (max ~3.5 MB).";
    case "RATE_LIMITED":
      return "Gemini API daily limit reached. Please try again after the quota resets.";
    case "MISSING_API_KEY":
      return "The server is not configured with a Gemini API key yet.";
    case "GEMINI_API_ERROR":
      return "Gemini had trouble answering. Please try again.";
    default:
      if (status === 413) {
        return "The PDF is too large to upload. Please choose a smaller file (max ~3.5 MB).";
      }
      return message || "Something went wrong on the server. Please try again.";
  }
}

function addMessage(role, text) {
  const empty = chat.querySelector(".empty-state");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = text;
  chat.appendChild(el);
  scrollToBottom();
}

function renderEmptyState() {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.innerHTML =
    '<svg viewBox="0 0 48 48" width="52" height="52" aria-hidden="true">' +
    '<rect x="11" y="5" width="26" height="34" rx="3.5" fill="#ffffff" stroke="#2f63c4" stroke-width="2.5"/>' +
    '<path d="M31 5l6 6h-6V5z" fill="#d9e6fa"/>' +
    '<line x1="17" y1="19" x2="31" y2="19" stroke="#9db9e8" stroke-width="2.5" stroke-linecap="round"/>' +
    '<line x1="17" y1="25" x2="31" y2="25" stroke="#9db9e8" stroke-width="2.5" stroke-linecap="round"/>' +
    '<line x1="17" y1="31" x2="26" y2="31" stroke="#c3d5f2" stroke-width="2.5" stroke-linecap="round"/>' +
    '<circle cx="35" cy="12" r="3.5" fill="#e8934a"/>' +
    "</svg>" +
    "<strong>Ask anything about your document</strong>" +
    "<span>Upload a PDF and ask a question to get started.</span>";
  chat.appendChild(el);
}

renderEmptyState();

function addTypingIndicator() {
  const el = document.createElement("div");
  el.className = "message bot typing";

  const spinner = document.createElement("span");
  spinner.className = "spinner";

  const label = document.createElement("span");
  label.textContent = "Thinking...";

  el.append(spinner, label);
  chat.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTypingIndicator(el) {
  el.remove();
}

function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function setBusy(busy) {
  sendButton.disabled = busy;
  questionInput.disabled = busy;
  sendButton.textContent = busy ? "Processing..." : "Send";
}