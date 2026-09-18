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

clearButton.addEventListener("click", () => chat.replaceChildren());

pdfInput.addEventListener("change", () => {
  const file = pdfInput.files[0];
  if (!file) {
    pdfFile = null;
    fileStatus.textContent = "No PDF selected";
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    pdfFile = null;
    fileStatus.textContent = "Please choose a PDF file.";
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    pdfFile = null;
    fileStatus.textContent = `This file is too large (max ${MAX_PDF_BYTES / 1_000_000} MB).`;
    return;
  }
  pdfFile = file;
  fileStatus.textContent = `Loaded: ${file.name}`;
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
      return "Too many requests right now. Wait a minute and try again.";
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
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = text;
  chat.appendChild(el);
  scrollToBottom();
}

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