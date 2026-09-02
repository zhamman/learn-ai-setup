const { Plugin, MarkdownRenderChild, MarkdownRenderer, Notice, normalizePath } = require("obsidian");

class ResultWatcher extends MarkdownRenderChild {
  constructor(containerEl, plugin, subjectRoot, assessmentId, onResult) {
    super(containerEl);
    this.plugin = plugin;
    this.subjectRoot = subjectRoot;
    this.assessmentId = assessmentId;
    this.onResult = onResult;
    this.timer = null;
    this.lastFingerprint = null;
  }

  onload() {
    this.timer = window.setInterval(() => void this.check(), 700);
    void this.check();
  }

  onunload() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    const result = await this.plugin.readResult(this.subjectRoot, this.assessmentId);
    if (!result) return;
    const fingerprint = JSON.stringify(result);
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.onResult(result);
  }
}

module.exports = class PiLearningPlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor("learning-quiz", async (source, el, ctx) => {
      await this.renderQuiz(source, el, ctx);
    });

    this.registerMarkdownCodeBlockProcessor("learning-code", async (source, el, ctx) => {
      await this.renderCode(source, el, ctx);
    });

    const refreshClasses = () => this.refreshViewClasses();
    this.registerEvent(this.app.workspace.on("file-open", refreshClasses));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refreshClasses));
    this.registerEvent(this.app.workspace.on("layout-change", refreshClasses));
    window.setTimeout(refreshClasses, 0);
  }

  onunload() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      leaf.view.containerEl.classList.remove(
        "pi-learning-topic-view",
        "pi-learning-plan-view",
        "pi-learning-quiz-view",
      );
    }
  }

  refreshViewClasses() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const container = leaf.view.containerEl;
      container.classList.remove(
        "pi-learning-topic-view",
        "pi-learning-plan-view",
        "pi-learning-quiz-view",
      );
      const filePath = leaf.view.file?.path || "";
      if (filePath.includes("/topic/")) container.classList.add("pi-learning-topic-view");
      if (filePath.includes("/plan/")) container.classList.add("pi-learning-plan-view");
      if (filePath.includes("/quiz/")) container.classList.add("pi-learning-quiz-view");
    }
  }

  parsePayload(source, el) {
    try {
      return JSON.parse(source.trim());
    } catch (error) {
      el.empty();
      const box = el.createDiv({ cls: "pi-learning-error" });
      box.createDiv({ text: "This learning block could not be rendered." });
      console.error("Pi Learning: invalid block payload", error);
      return null;
    }
  }

  normalizeAssessmentMarkdown(value) {
    let text = String(value || "").trim();
    // Repair compact fenced code emitted inside JSON strings, e.g.
    // "Consider: ```python x = 1 ``` What happens?"
    text = text.replace(/```([A-Za-z0-9_+#.-]+)\s+([\s\S]*?)\s+```/g, (_m, lang, code) => {
      return `\n\n\`\`\`${lang}\n${String(code).trim()}\n\`\`\`\n\n`;
    });
    return text;
  }

  async renderMarkdown(markdown, el, sourcePath) {
    await MarkdownRenderer.render(
      this.app,
      this.normalizeAssessmentMarkdown(markdown),
      el,
      sourcePath || "",
      this,
    );
  }

  subjectRootFromSource(sourcePath) {
    const normalized = normalizePath(sourcePath || "");
    for (const marker of ["/quiz/", "/topic/", "/plan/"]) {
      const index = normalized.lastIndexOf(marker);
      if (index >= 0) return normalized.slice(0, index);
    }
    return "";
  }

  joinSubjectPath(subjectRoot, suffix) {
    return normalizePath(subjectRoot ? `${subjectRoot}/${suffix}` : suffix);
  }

  async ensureFolder(folderPath) {
    const adapter = this.app.vault.adapter;
    const normalized = normalizePath(folderPath);
    if (await adapter.exists(normalized)) return;
    const pieces = normalized.split("/").filter(Boolean);
    let current = "";
    for (const piece of pieces) {
      current = current ? `${current}/${piece}` : piece;
      if (!(await adapter.exists(current))) {
        try {
          await adapter.mkdir(current);
        } catch (_) {}
      }
    }
  }

  async writeSubmission(subjectRoot, payload) {
    const folder = this.joinSubjectPath(subjectRoot, ".learning/submissions");
    await this.ensureFolder(folder);
    const safeId = String(payload.assessmentId || "assessment").replace(/[^a-zA-Z0-9_-]/g, "-");
    const filename = `${safeId}-${Date.now()}.json`;
    await this.app.vault.adapter.write(
      normalizePath(`${folder}/${filename}`),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  }

  async readResult(subjectRoot, assessmentId) {
    const target = this.joinSubjectPath(subjectRoot, `.learning/results/${assessmentId}.json`);
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(target))) return null;
    try {
      return JSON.parse(await adapter.read(target));
    } catch (_) {
      return null;
    }
  }

  createAssessmentShell(el, payload) {
    el.empty();
    const shell = el.createDiv({ cls: "pi-learning-assessment" });
    const header = shell.createDiv({ cls: "pi-learning-assessment-header" });
    header.createDiv({ cls: "pi-learning-kicker", text: payload.label || "Check" });
    return shell;
  }

  createResultArea(shell) {
    return shell.createDiv({ cls: "pi-learning-result" });
  }

  async renderResult(resultEl, result, kind, sourcePath) {
    resultEl.empty();
    resultEl.addClass("is-visible");
    const title = result.correct ? "Correct" : kind === "code" ? "Needs revision" : "Review this";
    resultEl.createDiv({ cls: "pi-learning-result-title", text: title });
    if (result.feedback) {
      const copy = resultEl.createDiv({ cls: "pi-learning-result-copy markdown-rendered" });
      await this.renderMarkdown(result.feedback, copy, sourcePath);
    }
    if (result.testEvidence) {
      const evidence = resultEl.createDiv({ cls: "pi-learning-test-evidence" });
      evidence.createDiv({ cls: "pi-learning-test-label", text: "Test evidence" });
      const pre = evidence.createEl("pre");
      pre.createEl("code", { text: result.testEvidence });
    }
  }

  async renderQuiz(source, el, ctx) {
    const payload = this.parsePayload(source, el);
    if (!payload) return;

    const subjectRoot = this.subjectRootFromSource(ctx.sourcePath);
    const shell = this.createAssessmentShell(el, payload);
    const question = shell.createDiv({ cls: "pi-learning-question markdown-rendered" });
    await this.renderMarkdown(payload.question || "Question", question, ctx.sourcePath);

    const options = shell.createDiv({ cls: "pi-learning-options" });
    const optionButtons = [];
    let selectedIndex = null;
    let completed = false;

    (payload.options || []).forEach((option, index) => {
      const button = options.createEl("button", {
        cls: "pi-learning-option",
        attr: { type: "button", "aria-pressed": "false" },
      });
      const badge = button.createSpan({ cls: "pi-learning-option-index", text: String.fromCharCode(65 + index) });
      badge.setAttribute("aria-hidden", "true");
      const content = button.createDiv({ cls: "pi-learning-option-text markdown-rendered" });
      void this.renderMarkdown(String(option), content, ctx.sourcePath);
      optionButtons.push(button);
    });

    const submitRow = shell.createDiv({ cls: "pi-learning-submit-row" });
    submitRow.createDiv({ cls: "pi-learning-helper", text: "Choose one answer." });
    const submit = submitRow.createEl("button", {
      cls: "pi-learning-submit",
      text: "Submit answer",
      attr: { type: "button", disabled: "true" },
    });
    const resultEl = this.createResultArea(shell);

    const paintSelection = (index) => {
      selectedIndex = index;
      optionButtons.forEach((button, buttonIndex) => {
        const selected = buttonIndex + 1 === index;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    };

    optionButtons.forEach((button, index) => {
      button.addEventListener("click", () => {
        if (completed) return;
        paintSelection(index + 1);
        submit.removeAttribute("disabled");
      });
    });

    submit.addEventListener("click", async () => {
      if (!selectedIndex || completed) return;
      submit.setAttribute("disabled", "true");
      submit.textContent = "Submitting…";
      try {
        await this.writeSubmission(subjectRoot, {
          assessmentId: payload.id,
          type: "quiz",
          selectedIndex,
          submittedAt: new Date().toISOString(),
        });
        submit.textContent = "Submitted";
      } catch (error) {
        console.error("Pi Learning: quiz submission failed", error);
        submit.removeAttribute("disabled");
        submit.textContent = "Submit answer";
        new Notice("Pi Learning could not submit this answer.");
      }
    });

    const applyResult = async (result) => {
      if (Number.isInteger(result.selectedIndex)) paintSelection(Number(result.selectedIndex));
      completed = true;
      submit.setAttribute("disabled", "true");
      submit.textContent = "Submitted";
      optionButtons.forEach((button) => button.setAttribute("disabled", "true"));
      await this.renderResult(resultEl, result, "quiz", ctx.sourcePath);
    };

    const existing = await this.readResult(subjectRoot, payload.id);
    if (existing) await applyResult(existing);
    ctx.addChild(new ResultWatcher(el, this, subjectRoot, payload.id, (result) => void applyResult(result)));
  }

  async renderCode(source, el, ctx) {
    const payload = this.parsePayload(source, el);
    if (!payload) return;

    const subjectRoot = this.subjectRootFromSource(ctx.sourcePath);
    const shell = this.createAssessmentShell(el, payload);
    const question = shell.createDiv({ cls: "pi-learning-question markdown-rendered" });
    await this.renderMarkdown(payload.prompt || "Coding exercise", question, ctx.sourcePath);

    const criteria = Array.isArray(payload.criteria) ? payload.criteria : [];
    if (criteria.length) {
      const criteriaWrap = shell.createDiv({ cls: "pi-learning-criteria-wrap" });
      criteriaWrap.createDiv({ cls: "pi-learning-section-label", text: "Acceptance criteria" });
      const list = criteriaWrap.createEl("ul", { cls: "pi-learning-criteria" });
      criteria.forEach((criterion) => list.createEl("li", { text: String(criterion) }));
    }

    const editorWrap = shell.createDiv({ cls: "pi-learning-code-wrap" });
    const editorLabel = editorWrap.createDiv({ cls: "pi-learning-code-label" });
    editorLabel.createSpan({ text: payload.language || "code" });
    const editor = editorWrap.createEl("textarea", {
      cls: "pi-learning-code-editor",
      attr: {
        spellcheck: "false",
        "aria-label": `${payload.language || "code"} submission`,
      },
    });
    editor.value = payload.starterCode || "";

    const submitRow = shell.createDiv({ cls: "pi-learning-submit-row" });
    submitRow.createDiv({ cls: "pi-learning-helper", text: "Write your solution here." });
    const submit = submitRow.createEl("button", {
      cls: "pi-learning-submit",
      text: "Submit code",
      attr: { type: "button" },
    });
    const resultEl = this.createResultArea(shell);
    let awaiting = false;
    let passed = false;

    submit.addEventListener("click", async () => {
      const code = editor.value;
      if (!code.trim() || awaiting || passed) return;
      awaiting = true;
      submit.setAttribute("disabled", "true");
      submit.textContent = "Submitting…";
      resultEl.removeClass("is-visible");
      try {
        await this.writeSubmission(subjectRoot, {
          assessmentId: payload.id,
          type: "code",
          code,
          submittedAt: new Date().toISOString(),
        });
        submit.textContent = "Submitted";
      } catch (error) {
        console.error("Pi Learning: code submission failed", error);
        awaiting = false;
        submit.removeAttribute("disabled");
        submit.textContent = "Submit code";
        new Notice("Pi Learning could not submit this code.");
      }
    });

    const applyResult = async (result) => {
      awaiting = false;
      passed = result.correct === true;
      if (typeof result.submission === "string" && result.submission.length) editor.value = result.submission;
      await this.renderResult(resultEl, result, "code", ctx.sourcePath);
      if (passed) {
        editor.setAttribute("disabled", "true");
        submit.setAttribute("disabled", "true");
        submit.textContent = "Completed";
      } else {
        editor.removeAttribute("disabled");
        submit.removeAttribute("disabled");
        submit.textContent = "Submit revision";
      }
    };

    const existing = await this.readResult(subjectRoot, payload.id);
    if (existing) await applyResult(existing);
    ctx.addChild(new ResultWatcher(el, this, subjectRoot, payload.id, (result) => void applyResult(result)));
  }
};
