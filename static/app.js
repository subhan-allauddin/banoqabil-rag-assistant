(() => {
  const URDU_REGEX = /[\u0600-\u06FF]/;

  const els = {
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebar-backdrop"),
    drawerBackdrop: document.getElementById("drawer-backdrop"),
    openSidebarBtn: document.getElementById("open-sidebar-btn"),
    closeSidebarBtn: document.getElementById("close-sidebar-btn"),
    collapseSidebarBtn: document.getElementById("collapse-sidebar-btn"),
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
    drawerUrlText: document.getElementById("drawer-url-text"),
    drawerSnippet: document.getElementById("drawer-snippet"),
    copySourceBtn: document.getElementById("copy-source-btn"),
    reindexModal: document.getElementById("reindex-modal"),
    cancelReindexBtn: document.getElementById("cancel-reindex-btn"),
    confirmReindexBtn: document.getElementById("confirm-reindex-btn"),
  };

  let selectedLanguage = "auto";
  let activeController = null;
  let activeSourceSnippet = "";
  const recentQuestions = [];

  // =========================================================================
  // Theme (Dark default, Light toggle, localStorage persisted)
  // =========================================================================
  function initTheme() {
    const saved = localStorage.getItem("bq_theme");
    const isLight = saved === "light";
    document.body.classList.toggle("dark", !isLight);
    els.themeToggleBtn.textContent = isLight ? "🌙" : "☀️";
    els.themeToggleBtn.title = isLight ? "Switch to dark mode" : "Switch to light mode";
  }

  els.themeToggleBtn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem("bq_theme", isDark ? "dark" : "light");
    els.themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
    els.themeToggleBtn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  });

  // =========================================================================
  // Sidebar (Desktop collapse + Mobile drawer)
  // =========================================================================
  function toggleMobileSidebar(open) {
    els.sidebar.classList.toggle("open", open);
    els.sidebarBackdrop.classList.toggle("hidden", !open);
  }

  els.openSidebarBtn.addEventListener("click", () => toggleMobileSidebar(true));
  els.closeSidebarBtn.addEventListener("click", () => toggleMobileSidebar(false));
  els.sidebarBackdrop.addEventListener("click", () => toggleMobileSidebar(false));

  if (els.collapseSidebarBtn) {
    els.collapseSidebarBtn.addEventListener("click", () => {
      const collapsed = els.sidebar.classList.toggle("collapsed");
      els.collapseSidebarBtn.setAttribute("aria-expanded", String(!collapsed));
      els.collapseSidebarBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    });
  }

  // =========================================================================
  // Language Selector
  // =========================================================================
  els.langPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      els.langPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      selectedLanguage = pill.dataset.lang;
    });
  });

  // =========================================================================
  // Knowledge Base Status Polling
  // =========================================================================
  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      updateStatusUI(data);
      if (!data.ready && !data.error) {
        setTimeout(loadStatus, 2000);
      }
    } catch {
      setStatusBadge(els.kbStatusBadge, "err", "Offline");
      setConnPill("err", "Server Offline");
    }
  }

  function setStatusBadge(el, state, text) {
    el.className = `status-badge ${state}`;
    el.querySelector(".status-text").textContent = text;
  }

  function setConnPill(state, text) {
    els.headerConnPill.className = `conn-pill ${state}`;
    els.headerConnPill.querySelector(".conn-text").textContent = text;
  }

  function updateStatusUI(data) {
    els.kbFile.textContent = data.kb_file || "—";
    els.kbFile.title = data.kb_file || "";
    els.kbCounts.textContent = data.page_count
      ? `${data.page_count} / ${data.chunk_count}`
      : "—";
    els.kbVectors.textContent =
      typeof data.vector_count === "number" && data.vector_count > 0
        ? `${data.vector_count}`
        : "—";
    els.kbModel.textContent = data.llm_model || "—";
    els.kbModel.title = data.llm_model || "";

    if (data.ready) {
      setStatusBadge(els.kbStatusBadge, "ok", "Connected");
      setConnPill("ok", `KB Ready (${data.vector_count})`);
    } else if (data.error) {
      setStatusBadge(els.kbStatusBadge, "err", "Error");
      setConnPill("err", "KB Error");
    } else {
      setStatusBadge(els.kbStatusBadge, "loading", "Initializing…");
      setConnPill("loading", "Connecting…");
    }
  }

  // =========================================================================
  // Recent Questions
  // =========================================================================
  function addHistory(question) {
    const existingIdx = recentQuestions.indexOf(question);
    if (existingIdx !== -1) recentQuestions.splice(existingIdx, 1);
    recentQuestions.unshift(question);
    if (recentQuestions.length > 15) recentQuestions.pop();

    els.historyList.innerHTML = "";
    recentQuestions.forEach((q) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-item";
      btn.textContent = q;
      btn.title = q;
      if (URDU_REGEX.test(q)) btn.dir = "rtl";
      btn.addEventListener("click", () => {
        toggleMobileSidebar(false);
        submitQuestion(q);
      });
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  // =========================================================================
  // Source Inspector Drawer / Mobile Sheet
  // =========================================================================
  function openSourceDrawer(source) {
    const title = source.title || "Bano Qabil Page";
    const url = source.url || "";
    const snippet = source.snippet || "";

    els.drawerTitle.textContent = title;
    els.drawerUrl.href = url || "#";
    els.drawerUrl.classList.toggle("hidden", !url);
    els.drawerUrlText.textContent = url;
    els.drawerSnippet.textContent = snippet;
    els.drawerSnippet.dir = URDU_REGEX.test(snippet) ? "rtl" : "ltr";
    activeSourceSnippet = snippet;

    els.sourceDrawer.classList.remove("hidden");
    if (window.innerWidth <= 1180) {
      els.drawerBackdrop.classList.remove("hidden");
      els.sourceDrawer.setAttribute("aria-modal", "true");
    } else {
      els.drawerBackdrop.classList.add("hidden");
      els.sourceDrawer.setAttribute("aria-modal", "false");
    }
  }

  function closeSourceDrawer() {
    els.sourceDrawer.classList.add("hidden");
    els.drawerBackdrop.classList.add("hidden");
  }

  els.closeDrawerBtn.addEventListener("click", closeSourceDrawer);
  els.drawerBackdrop.addEventListener("click", closeSourceDrawer);

  els.copySourceBtn.addEventListener("click", async () => {
    if (!activeSourceSnippet) return;
    try {
      await navigator.clipboard.writeText(activeSourceSnippet);
      els.copySourceBtn.textContent = "Copied ✓";
      setTimeout(() => (els.copySourceBtn.textContent = "Copy Source Text"), 1500);
    } catch {
      els.copySourceBtn.textContent = "Copy failed";
    }
  });

  // =========================================================================
  // XSS-Safe Markdown Renderer (Headings, Lists, Nested Lists, Code, Tables)
  // =========================================================================
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
      .replace(/\*([^*\s][^*]*?)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );
  }

  function isTableSeparator(line) {
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
  }

  function parseTableRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => formatInline(cell.trim()));
  }

  function renderMarkdown(rawText) {
    const safe = escapeHtml(rawText || "");
    const lines = safe.split(/\r?\n/);
    const out = [];

    let inCodeBlock = false;
    let codeLines = [];
    const listStack = []; // [{ type: "ul"|"ol", indent: number }]

    const closeListsTo = (targetIndent) => {
      while (listStack.length > 0 && listStack[listStack.length - 1].indent >= targetIndent) {
        const popped = listStack.pop();
        out.push(`</${popped.type}>`);
      }
    };

    const closeAllLists = () => closeListsTo(-1);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced code blocks
      if (trimmed.startsWith("```")) {
        closeAllLists();
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLines = [];
        } else {
          out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
          inCodeBlock = false;
        }
        continue;
      }
      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (!trimmed) {
        closeAllLists();
        continue;
      }

      // Markdown table
      if (
        trimmed.includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) {
        closeAllLists();
        const headers = parseTableRow(trimmed);
        i++; // skip separator
        const rows = [];
        while (i + 1 < lines.length && lines[i + 1].trim().includes("|")) {
          i++;
          rows.push(parseTableRow(lines[i]));
        }
        out.push('<div class="table-wrap"><table><thead><tr>');
        headers.forEach((h) => out.push(`<th>${h}</th>`));
        out.push("</tr></thead><tbody>");
        rows.forEach((r) => {
          out.push("<tr>");
          r.forEach((cell) => out.push(`<td>${cell}</td>`));
          out.push("</tr>");
        });
        out.push("</tbody></table></div>");
        continue;
      }

      // Headings
      const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        closeAllLists();
        const level = headingMatch[1].length;
        out.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
        continue;
      }

      // Blockquote
      const quoteMatch = trimmed.match(/^&gt;\s?(.*)$/);
      if (quoteMatch) {
        closeAllLists();
        out.push(`<blockquote><p>${formatInline(quoteMatch[1])}</p></blockquote>`);
        continue;
      }

      // Lists (with nesting by leading spaces)
      const listMatch = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        const indent = listMatch[1].length;
        const type = /^\d+\./.test(listMatch[2]) ? "ol" : "ul";
        const content = formatInline(listMatch[3].trim());

        while (
          listStack.length > 0 &&
          listStack[listStack.length - 1].indent > indent
        ) {
          const popped = listStack.pop();
          out.push(`</${popped.type}>`);
        }

        const top = listStack[listStack.length - 1];
        if (!top || indent > top.indent) {
          listStack.push({ type, indent });
          out.push(`<${type}>`);
        } else if (top.type !== type) {
          listStack.pop();
          out.push(`</${top.type}>`);
          listStack.push({ type, indent });
          out.push(`<${type}>`);
        }

        out.push(`<li>${content}</li>`);
        continue;
      }

      // Normal paragraph
      closeAllLists();
      out.push(`<p>${formatInline(trimmed)}</p>`);
    }

    if (inCodeBlock) {
      out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
    }
    closeAllLists();
    return out.join("");
  }

  // =========================================================================
  // Chat & Streaming UX
  // =========================================================================
  function isNearBottom() {
    const el = els.chatScroll;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function scrollToBottomIfAppropriate(force = false) {
    if (force || isNearBottom()) {
      els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    }
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
    bubble.className = role === "assistant" ? "msg-bubble md-content" : "msg-bubble";
    if (role === "user") {
      bubble.textContent = text;
    } else if (text) {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.innerHTML =
        '<div class="streaming-dots" aria-label="Generating answer"><span></span><span></span><span></span></div>';
    }
    if (text) applyDirection(bubble, text);
    row.appendChild(bubble);

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    row.appendChild(meta);

    els.messagesList.appendChild(row);
    scrollToBottomIfAppropriate(true);
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
    activeController = new AbortController();
    setStreamingState(true);

    let fullText = "";
    let renderScheduled = false;

    const flushMarkdown = () => {
      renderScheduled = false;
      if (!fullText) return;
      bubble.innerHTML = renderMarkdown(fullText);
      applyDirection(bubble, fullText);
      scrollToBottomIfAppropriate(false);
    };

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
            if (!renderScheduled) {
              renderScheduled = true;
              requestAnimationFrame(flushMarkdown);
            }
          } else if (eventName === "done") {
            flushMarkdown();
            if (payload.is_unknown) {
              bubble.classList.add("unknown");
              if (!fullText.trim()) {
                bubble.innerHTML = "<p>I don't know.</p>";
              }
            }
            renderMeta(meta, question, fullText, payload.sources || []);
            scrollToBottomIfAppropriate(false);
          } else if (eventName === "error") {
            bubble.classList.add("unknown");
            bubble.innerHTML = renderMarkdown(`**Error:** ${payload.error}`);
            renderMeta(meta, question, "", []);
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        bubble.innerHTML = renderMarkdown(
          fullText ? `${fullText}\n\n*[Generation stopped]*` : "*[Generation stopped]*"
        );
        renderMeta(meta, question, fullText, []);
      } else {
        bubble.classList.add("unknown");
        bubble.innerHTML = renderMarkdown(`**Connection error:** ${err.message}`);
        renderMeta(meta, question, "", []);
      }
    } finally {
      activeController = null;
      setStreamingState(false);
      els.questionInput.focus();
    }
  }

  function renderMeta(metaEl, question, text, sources) {
    metaEl.innerHTML = "";

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    if (text.trim()) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "action-btn";
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
      actions.appendChild(copyBtn);
    }

    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "action-btn";
    regenBtn.textContent = "↻ Regenerate";
    regenBtn.addEventListener("click", () => submitQuestion(question));
    actions.appendChild(regenBtn);

    if (sources.length > 0) {
      const viewSourcesBtn = document.createElement("button");
      viewSourcesBtn.type = "button";
      viewSourcesBtn.className = "action-btn";
      viewSourcesBtn.textContent = `View Sources (${sources.length})`;
      viewSourcesBtn.addEventListener("click", () => openSourceDrawer(sources[0]));
      actions.appendChild(viewSourcesBtn);
    }

    metaEl.appendChild(actions);

    if (sources.length > 0) {
      const pillsWrap = document.createElement("div");
      pillsWrap.className = "source-pills";
      sources.forEach((src) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "source-pill";
        pill.textContent = `${src.title || "Source"} ↗`;
        pill.title = src.url || src.title || "";
        pill.addEventListener("click", () => openSourceDrawer(src));
        pillsWrap.appendChild(pill);
      });
      metaEl.appendChild(pillsWrap);
    }
  }

  // =========================================================================
  // Composer, Starter Chips, New Chat & Keyboard Shortcuts
  // =========================================================================
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
    closeSourceDrawer();
    toggleMobileSidebar(false);
    els.questionInput.focus();
  });

  // Escape key closes modals/drawers
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.reindexModal.classList.contains("hidden")) {
      els.reindexModal.classList.add("hidden");
    } else if (!els.sourceDrawer.classList.contains("hidden")) {
      closeSourceDrawer();
    } else if (els.sidebar.classList.contains("open")) {
      toggleMobileSidebar(false);
    }
  });

  // =========================================================================
  // Re-index Modal
  // =========================================================================
  els.reindexBtn.addEventListener("click", () => {
    els.reindexModal.classList.remove("hidden");
  });
  els.cancelReindexBtn.addEventListener("click", () => {
    els.reindexModal.classList.add("hidden");
  });
  els.confirmReindexBtn.addEventListener("click", async () => {
    els.reindexModal.classList.add("hidden");
    els.reindexBtn.disabled = true;
    setStatusBadge(els.kbStatusBadge, "loading", "Indexing…");
    setConnPill("loading", "Re-indexing…");

    try {
      const res = await fetch("/api/reindex", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-index failed");
      updateStatusUI(data);
    } catch (err) {
      setStatusBadge(els.kbStatusBadge, "err", "Error");
      setConnPill("err", "Re-index failed");
      alert(`Re-index failed: ${err.message}`);
    } finally {
      els.reindexBtn.disabled = false;
    }
  });

  initTheme();
  loadStatus();
})();
