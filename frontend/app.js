const state = {
  history: [],
  busy: false
};

const hero = document.getElementById("hero");
const messages = document.getElementById("messages");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const modelStatus = document.getElementById("modelStatus");
const connectionText = document.getElementById("connectionText");
const historyTitle = document.getElementById("historyTitle");
const toast = document.getElementById("toast");
const sidebar = document.getElementById("sidebar");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function scrollToBottom() {
  const area = document.getElementById("chatArea");

  requestAnimationFrame(() => {
    area.scrollTop = area.scrollHeight;
  });
}

function addMessage(role, text) {
  hero.classList.add("hidden");

  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "YU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  row.appendChild(avatar);
  row.appendChild(bubble);
  messages.appendChild(row);
  scrollToBottom();

  return { row, bubble };
}

function addTyping() {
  hero.classList.add("hidden");

  const row = document.createElement("div");
  row.className = "message-row assistant";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `
    <span class="typing">
      <span></span><span></span><span></span>
    </span>
  `;

  row.appendChild(avatar);
  row.appendChild(bubble);
  messages.appendChild(row);
  scrollToBottom();

  return row;
}

function updateComposerState() {
  sendBtn.disabled = state.busy || !input.value.trim();
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    if (data.ollama && data.model_available) {
      modelStatus.textContent = "Local AI · Qwen3 8B ready";
      connectionText.textContent = "Running locally";
    } else if (data.ollama) {
      modelStatus.textContent = "Ollama ready · model missing";
      connectionText.textContent = "Model not installed";
    } else {
      modelStatus.textContent = "Ollama offline";
      connectionText.textContent = "Start Ollama";
    }
  } catch {
    modelStatus.textContent = "Backend offline";
    connectionText.textContent = "Start FastAPI";
  }
}

async function sendMessage(prefilled = null) {
  if (state.busy) return;

  const text = (prefilled ?? input.value).trim();
  if (!text) return;

  if (!prefilled) input.value = "";
  input.style.height = "auto";
  updateComposerState();

  addMessage("user", text);
  state.history.push({ role: "user", content: text });

  const title = text.length > 31 ? `${text.slice(0, 31)}…` : text;
  historyTitle.textContent = title;

  const typingRow = addTyping();
  state.busy = true;
  updateComposerState();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: text,
        history: state.history
      })
    });

    const data = await response.json();

    typingRow.remove();

    if (!data.ok) {
      addMessage("assistant", `⚠ ${data.error}`);
      showToast(data.error);
      return;
    }

    addMessage("assistant", data.response);
    state.history.push({
      role: "assistant",
      content: data.response
    });
  } catch (error) {
    typingRow.remove();
    const message = "Could not reach the local backend. Is FastAPI running?";
    addMessage("assistant", `⚠ ${message}`);
    showToast(message);
  } finally {
    state.busy = false;
    updateComposerState();
    input.focus();
    scrollToBottom();
  }
}

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});

document.getElementById("newChatBtn").addEventListener("click", () => {
  state.history = [];
  messages.innerHTML = "";
  hero.classList.remove("hidden");
  historyTitle.textContent = "New conversation";
  input.value = "";
  input.style.height = "auto";
  updateComposerState();
  input.focus();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  state.history = [];
  messages.innerHTML = "";
  hero.classList.remove("hidden");
  historyTitle.textContent = "New conversation";
  showToast("Conversation cleared.");
  input.focus();
});

document.getElementById("focusBtn").addEventListener("click", () => {
  input.focus();
});

document.getElementById("systemBtn").addEventListener("click", () => {
  checkHealth();
  showToast("Checked local AI status.");
});

document.getElementById("menuBtn").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  updateComposerState();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

setInterval(checkHealth, 10000);

updateComposerState();
checkHealth();
input.focus();
