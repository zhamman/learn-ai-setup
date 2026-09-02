# Clean Obsidian learning architecture

The learning system separates human-facing Markdown from machine-facing adaptive state.

## Visible vault

```text
<subject>/
├── plan/
│   └── <track>.md
├── topic/
│   └── <concept>.md
└── quiz/
    ├── <track>-diagnostic.md
    └── <concept>-lesson.md
```

These files should read like a polished course. They do **not** contain visible status/date/confidence/quiz-score frontmatter.

Topic notes create headings only when useful content exists. There is no prefilled empty template.

Plans stay compact: title/deck, Goal, Starting point, Dependency map, and Path.

Quiz files contain `learning-quiz` and `learning-code` render blocks. The Pi Learning Obsidian plugin turns those blocks into the interactive UI.

## Hidden state

```text
<subject>/.learning/
├── state.json
├── assessments/
├── submissions/
└── results/
```

This stores lifecycle state, graph relationships, misconceptions, assessment keys/results, mastery evidence, and coding requirements.

The hidden state is deliberately separate from the notes the learner reads.

## Main tools

`lesson_start`
: Starts the overall track and routes the diagnostic assessment.

`lesson_plan`
: Rewrites the current clean learning roadmap from structured adaptive steps.

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
: Finishes the track when its hidden path has no unfinished nodes.

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
