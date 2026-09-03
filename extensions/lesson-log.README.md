# Clean Obsidian learning architecture

The learning system separates human-facing Markdown from machine-facing adaptive state.

## Visible vault

```text
<subject>/
├── plan/
│   ├── <track>.md
│   └── <track>-project.md
├── source/
│   └── <source-id>/   # copied original, index, inspected excerpts/page images
├── topic/
│   └── <concept>.md
└── quiz/
    ├── <track>-diagnostic.md
    └── <concept>-lesson.md
```

These files should read like a polished course. They do **not** contain visible status/date/confidence/quiz-score frontmatter.

Topic notes create headings only when useful content exists. There is no prefilled empty template.

Plans stay compact: title/deck, Goal, Starting point, Dependency map, Path, and a link to the mini-project. The project specification is generated with the plan, visible immediately, and shows prerequisites for each requirement. Project work is optional.

Quiz files contain `learning-quiz` and `learning-code` render blocks. The Pi Learning Obsidian plugin turns those blocks into the interactive UI.

## Hidden state

```text
<subject>/.learning/
├── state.json
├── sources/          # manifests with exact source IDs and inspected units
├── assessments/
├── submissions/
└── results/
```

This stores lifecycle state, graph relationships, misconceptions, assessment keys/results, mastery evidence, and coding requirements.

The hidden state is deliberately separate from the notes the learner reads.

## Main tools

`lesson_source`
: Imports learner-selected images/screenshots, PDFs, or UTF-8 notes/code. Returns actual text/image content and durable line/page references. Reads at most 200 lines or three PDF pages per call. Pasted images after `/learn` are also saved and referenced automatically.

`lesson_start`
: Starts the overall track and routes the diagnostic assessment.

`lesson_plan`
: Writes the roadmap and requires a scoped `miniProject` on first creation. Omit it on normal updates to preserve the spec/review. Projects cover all plan concepts using only mapped plan topics or evidenced prior knowledge; prose still needs the teacher's semantic scope check. Source-based plans use `sourceIds` plus per-step `sources`; material added beyond the source requires an explicit `supplementalReason`.

`lesson_project_review`
: Records inspected learner work and criterion/edge-case evidence, merges partial requirement reviews, and requires design/integration evidence for completion. It never writes learner code or awards lesson mastery.

`lesson_note`
: Activates/creates a clean concept note and records hidden graph state.

`lesson_write`
: Creates or replaces a useful human-readable section. Headings are freeform and are only created when content exists.

`lesson_obsidian_quiz`
: Creates a conceptual quiz rendered by the Obsidian plugin. Correct-answer data remains hidden.

`lesson_code_exercise`
: Creates an editable coding exercise rendered by the Obsidian plugin.

`lesson_code_result`
: Records Pi's verified grade/feedback for submitted code.

`lesson_misconception`
: Tracks a genuine misconception in hidden state.

`lesson_quality`
: Checks whether the visible lesson is substantive and whether hidden mastery requirements are satisfied.

`lesson_progress`
: Marks a concept learning/blocked/complete. Completion is gated on note quality and assessment evidence.

`lesson_finish`
: Finishes the track when its hidden path has no unfinished nodes, reporting optional project completion separately.

Project specifications and reviews are stored per track in hidden `state.json` under `projects`. Existing state remains readable; the next plan update adds a missing project without resetting lessons. Readiness follows mastery, not roadmap labels. See `skills/lesson-notes/references/mini-projects.md` for generation, scope, coaching, and review rules.

## Required order

For lesson-phase concepts:

```text
lesson_note
  ↓
lesson_write (actual lesson in Obsidian)
  ↓
learner reads topic note
  ↓
lesson_obsidian_quiz OR lesson_code_exercise
  ↓
learner submits in Obsidian
  ↓
Pi adapts / grades / reteaches
```

The assessment bridge blocks terminal `quiz` calls while the Obsidian learning workflow is active and blocks lesson-phase assessments until the topic note has substantive content.

## Obsidian plugin

Plugin source is under:

```text
obsidian/pi-learning/
```

Install it into the vault with:

```bash
bash .pi/scripts/install-obsidian-plugin.sh
```

Then enable **Pi Learning** in Obsidian → Settings → Community plugins.

## Project regression checks

With Node 22.18+ (native TypeScript stripping) and `@sinclair/typebox` installed, run from this repository:

```bash
node --test tests/*.test.mjs
```

These exercise actual extension tools with a temporary vault: initial generation, legacy migration, scope rejection, mastery-based readiness, failed assessments, partial/final review, resume, and adaptive-plan preservation. Obsidian desktop and live model behavior still need a manual course run.

## Learn from a file or screenshot

After `/learn <subject>`, paste an image into Pi or reference a local file and say:

```text
Teach me from this material using our Obsidian course workflow.
Inspect it first, diagnose my understanding, and build the plan and mini-project.
Keep references to the source and label anything added beyond it.
```

Images require a vision-capable model. PDFs additionally require Poppler (`brew install poppler` on macOS). No Obsidian plugin reinstall is needed. Supported inputs are PNG/JPEG/WebP/GIF, PDF, and UTF-8 text/code; export other document formats to PDF or text first. Scanned PDF pages are read through rendered images, not guessed text extraction.

Source tests also exercise real PDF extraction/rendering when Poppler is installed, native pasted-image handling, unread-page rejection, bounded text reads, binary-file rejection, and source preservation. Full visual comprehension and teaching quality require a live model run.
