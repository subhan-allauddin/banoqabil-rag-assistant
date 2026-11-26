(() => {
  const URDU_REGEX = /[\u0600-\u06FF]/;

  const els = {
    sidebar: document.getElementById("sidebar"),
    backdrop: document.getElementById("sidebar-backdrop"),
    openSidebarBtn: document.getElementById("open-sidebar-btn"),
    closeSidebarBtn: document.getElementById("close-sidebar-btn"),
    newChatBtn: document.getElementById("new-chat-btn"),
    langPills: document.querySelectorAll(".lang-pill"),
    kbStatusBadge: document.getElementById("kb-status-badge"),
    kbFile: document.getElementById("kb-file"),
    kbCounts: document.getElementById("kb-counts"),
    kbVectors: document.getElementById("kb-vectors"),
    kbModel: document.getElementById("kb-model"),
    headerConnPill: document.getElementById("header-conn-pill"),
    reindexBtn: document.getElementById("reindex-btn"),
    historyList: document.getElementById("history-list"),
    themeToggleBtn: document.getElementById("theme-toggle-btn"),
    chatScroll: document.getElementById("chat-scroll"),
    welcomeView: document.getElementById("welcome-view"),
    messagesList: document.getElementById("messages-list"),
    starterChips: document.querySelectorAll(".starter-chip"),
    chatForm: document.getElementById("chat-form"),
    questionInput: document.getElementById("question-input"),
    sendBtn: document.getElementById("send-btn"),
    stopBtn: document.getElementById("stop-btn"),
    sourceDrawer: document.getElementById("source-drawer"),
    closeDrawerBtn: document.getElementById("close-drawer-btn"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerUrl: document.getElementById("drawer-url"),
    drawerSnippet: document.getElementById("drawer-snippet"),
    reindexModal: document.getElementById("reindex-modal"),
    cancelReindexBtn: document.getElementById("cancel-reindex-btn"),
    confirmReindexBtn: document.getElementById("confirm-reindex-btn"),
  };

  let selectedLanguage = "auto";
  let activeController = null;
  const recentQuestions = [];

  // ---- Theme ----
  function initTheme() {
    const saved = localStorage.getItem("bq_theme");
    if (saved === "light") {
      document.body.classList.remove("dark");
      els.themeToggleBtn.textContent = "🌙";
    } else {
      document.body.classList.add("dark");
      els.themeToggleBtn.textContent = "☀️";
    }
  }

  els.themeToggleBtn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem("bq_theme", isDark ? "dark" : "light");
    els.themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
  });

  // ---- Mobile Sidebar ----
  function toggleSidebar(open) {
    els.sidebar.classList.toggle("open", open);
    els.backdrop.classList.toggle("hidden", !open);
  }

  els.openSidebarBtn.addEventListener("click", () => toggleSidebar(true));
  els.closeSidebarBtn.addEventListener("click", () => toggleSidebar(false));
  els.backdrop.addEventListener("click", () => toggleSidebar(false));

  // ---- Language Selector ----
  els.langPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      els.langPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      selectedLanguage = pill.dataset.lang;
    });
  });

  // ---- KB Status ----
  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      updateStatusUI(data);
      if (!data.ready && !data.error) {
        setTimeout(loadStatus, 2000);
      }
    } catch {
      els.kbStatusBadge.textContent = "Offline";
      els.kbStatusBadge.className = "status-pill err";
      els.headerConnPill.textContent = "Server Offline";
      els.headerConnPill.className = "conn-pill";
    }
  }

  function updateStatusUI(data) {
    els.kbFile.textContent = data.kb_file || "—";
    els.kbCounts.textContent = data.page_count
      ? `${data.page_count} / ${data.chunk_count}`
      : "—";
    els.kbVectors.textContent =
      typeof data.vector_count === "number" && data.vector_count > 0
        ? `${data.vector_count}`
        : "—";
    els.kbModel.textContent = data.llm_model || "—";

    if (data.ready) {
      els.kbStatusBadge.textContent = "Connected";
      els.kbStatusBadge.className = "status-pill ok";
      els.headerConnPill.textContent = `Pinecone Ready (${data.vector_count})`;
      els.headerConnPill.className = "conn-pill ok";
    } else if (data.error) {
      els.kbStatusBadge.textContent = "Error";
      els.kbStatusBadge.className = "status-pill err";
      els.headerConnPill.textContent = data.error;
      els.headerConnPill.className = "conn-pill";
    } else {
      els.kbStatusBadge.textContent = "Initializing…";
      els.kbStatusBadge.className = "status-pill loading";
      els.headerConnPill.textContent = "Connecting…";
      els.headerConnPill.className = "conn-pill";
    }
  }

  // ---- History ----
  function addHistory(question) {
    recentQuestions.unshift(question);
    if (recentQuestions.length > 15) recentQuestions.pop();
    els.historyList.innerHTML = "";
    recentQuestions.forEach((q) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "history-item";
      btn.textContent = q;
      if (URDU_REGEX.test(q)) btn.dir = "rtl";
      btn.addEventListener("click", () => {
        toggleSidebar(false);
        submitQuestion(q);
      });
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  // ---- Source Drawer ----
  function openSourceDrawer(source) {
    els.drawerTitle.textContent = source.title || "Bano Qabil Page";
    els.drawerUrl.textContent = source.url || "No URL";
    els.drawerUrl.href = source.url || "#";
    els.drawerSnippet.textContent = source.snippet || "";
    if (URDU_REGEX.test(source.snippet || "")) {
      els.drawerSnippet.dir = "rtl";
    } else {
      els.drawerSnippet.dir = "ltr";
    }
    els.sourceDrawer.classList.remove("hidden");
  }

  els.closeDrawerBtn.addEventListener("click", () => {
    els.sourceDrawer.classList.add("hidden");
  });

  // ---- Messages & Markdown ----
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatInline(escapedLine) {
    return escapedLine
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );
  }

  function renderMarkdown(rawText) {
    const safe = escapeHtml(rawText || "");
    const lines = safe.split(/\r?\n/);
    const out = [];
    let listType = null; // "ul" | "ol"

    const closeList = () => {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        closeList();
        const level = headingMatch[1].length;
        out.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
        continue;
      }

      const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
      if (ulMatch) {
        if (listType !== "ul") {
          closeList();
          listType = "ul";
          out.push("<ul>");
        }
        out.push(`<li>${formatInline(ulMatch[1])}</li>`);
        continue;
      }

      const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      if (olMatch) {
        if (listType !== "ol") {
          closeList();
          listType = "ol";
          out.push("<ol>");
        }
        out.push(`<li>${formatInline(olMatch[1])}</li>`);
        continue;
      }

      closeList();
      out.push(`<p>${formatInline(trimmed)}</p>`);
    }

    closeList();
    return out.join("");
  }

  function applyDirection(el, text) {
    el.dir = URDU_REGEX.test(text) ? "rtl" : "ltr";
  }

  function appendMessage(role, text = "") {
    els.welcomeView.classList.add("hidden");
    els.messagesList.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = `msg-row ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = text;
    if (text) applyDirection(bubble, text);
    row.appendChild(bubble);

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    row.appendChild(meta);

    els.messagesList.appendChild(row);
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    return { row, bubble, meta };
  }

  function setStreamingState(isStreaming) {
    els.sendBtn.classList.toggle("hidden", isStreaming);
    els.stopBtn.classList.toggle("hidden", !isStreaming);
    els.questionInput.disabled = isStreaming;
  }

  async function submitQuestion(questionText) {
    const question = questionText.trim();
    if (!question || activeController) return;

    appendMessage("user", question);
    addHistory(question);

    const { bubble, meta } = appendMessage("assistant", "");
    bubble.classList.add("streaming-cursor");

    activeController = new AbortController();
    setStreamingState(true);

    let fullText = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, language: selectedLanguage }),
        signal: activeController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const lines = block.split("\n");
          let eventName = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLine += line.slice(6);
          }
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine);

          if (eventName === "token") {
            fullText += payload.text;
            bubble.innerHTML = renderMarkdown(fullText);
            applyDirection(bubble, fullText);
            els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
          } else if (eventName === "done") {
            if (payload.is_unknown) {
              bubble.classList.add("unknown");
              if (!fullText.trim()) {
                bubble.innerHTML = "<p>I don't know.</p>";
              }
            }
            renderMeta(meta, fullText, payload.sources || []);
          } else if (eventName === "error") {
            bubble.classList.add("unknown");
            bubble.textContent = `Error: ${payload.error}`;
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        bubble.textContent = fullText ? `${fullText}\n\n[stopped]` : "[stopped]";
      } else {
        bubble.classList.add("unknown");
        bubble.textContent = `Connection error: ${err.message}`;
      }
    } finally {
      bubble.classList.remove("streaming-cursor");
      activeController = null;
      setStreamingState(false);
      els.questionInput.focus();
    }
  }

  function renderMeta(metaEl, text, sources) {
    metaEl.innerHTML = "";

    if (text.trim()) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
        } catch {
          copyBtn.textContent = "Failed";
        }
      });
      metaEl.appendChild(copyBtn);
    }

    if (sources.length > 0) {
      const pillsWrap = document.createElement("div");
      pillsWrap.className = "source-pills";
      sources.forEach((src) => {
        const pill = document.createElement("button");
        pill.className = "source-pill";
        pill.textContent = `${src.title || "Source"} ↗`;
        pill.title = src.url || "";
        pill.addEventListener("click", () => openSourceDrawer(src));
        pillsWrap.appendChild(pill);
      });
      metaEl.appendChild(pillsWrap);
    }
  }

  // ---- Composer & Shortcuts ----
  els.questionInput.addEventListener("input", () => {
    els.questionInput.style.height = "auto";
    els.questionInput.style.height = `${Math.min(els.questionInput.scrollHeight, 140)}px`;
  });

  els.questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.chatForm.requestSubmit();
    }
  });

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = els.questionInput.value;
    if (!q.trim()) return;
    els.questionInput.value = "";
    els.questionInput.style.height = "auto";
    submitQuestion(q);
  });

  els.stopBtn.addEventListener("click", () => {
    if (activeController) activeController.abort();
  });

  els.starterChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      submitQuestion(chip.dataset.prompt || "");
    });
  });

  els.newChatBtn.addEventListener("click", () => {
    if (activeController) activeController.abort();
    els.messagesList.innerHTML = "";
    els.messagesList.classList.add("hidden");
    els.welcomeView.classList.remove("hidden");
    els.sourceDrawer.classList.add("hidden");
    toggleSidebar(false);
    els.questionInput.focus();
  });

  // ---- Re-index Modal ----
  els.reindexBtn.addEventListener("click", () => {
    els.reindexModal.classList.remove("hidden");
  });
  els.cancelReindexBtn.addEventListener("click", () => {
    els.reindexModal.classList.add("hidden");
  });
  els.confirmReindexBtn.addEventListener("click", async () => {
    els.reindexModal.classList.add("hidden");
    els.reindexBtn.disabled = true;
    els.reindexBtn.textContent = "Re-indexing…";
    els.kbStatusBadge.textContent = "Indexing…";
    els.kbStatusBadge.className = "status-pill loading";

    try {
      const res = await fetch("/api/reindex", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-index failed");
      updateStatusUI(data);
    } catch (err) {
      els.kbStatusBadge.textContent = "Error";
      els.kbStatusBadge.className = "status-pill err";
      alert(`Re-index failed: ${err.message}`);
    } finally {
      els.reindexBtn.disabled = false;
      els.reindexBtn.textContent = "↻ Re-index Knowledge Base";
    }
  });

  initTheme();
  loadStatus();
})();
