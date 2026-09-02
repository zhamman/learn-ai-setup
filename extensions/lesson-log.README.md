# lesson-log

`lesson-log` turns a Pi teaching session into a structured Obsidian learning system rather than a transcript.

## Layout

After:

```text
/learn ai-engineering
```

Pi maintains:

```text
ai-engineering/
├── plan/
├── topic/
└── quiz/
```

Example:

```text
ai-engineering/
├── plan/
│   └── agent-orchestration.md
├── topic/
│   ├── agent-loop.md
│   └── supervisor-pattern.md
└── quiz/
    ├── agent-orchestration-diagnostic.md
    ├── agent-loop-lesson.md
    └── supervisor-pattern-lesson.md
```

## What changed

The extension now supports seven higher-level learning features:

1. standardized YAML frontmatter and fixed note sections
2. an explicit start → diagnostic → plan → teach → quiz → finish lifecycle
3. durable misconception tracking with resolved/unresolved state
4. quiz-driven mastery gating and adaptive-plan behavior
5. concept prerequisites, related links, and backlinks
6. a mechanical note-quality audit before completion
7. section-aware topic updates instead of blind append-only prose

## Standard topic note

New topic notes use standardized metadata and headings:

```markdown
---
type: "topic"
subject: "ai-engineering"
topic: "supervisor-pattern"
status: "learning"
confidence: 1
updated: "2026-09-02"
prerequisites:
  - "agent-loop"
related:
  - "handoffs"
quiz_correct: 0
quiz_total: 0
quiz_score: 0
last_quiz_correct: false
---

# Supervisor Pattern

## Core Idea
## Why It Exists
## Mental Model
## How It Works
## Example
## Common Mistakes
## Misconceptions
## Related Concepts
## Notes
```

Existing legacy topic/plan/quiz files are preserved and normalized when the extension next touches them; the extension does not intentionally discard their existing Markdown bodies.

## Main tools

### `lesson_start`

Starts one overall learning track and routes the initial probe to its diagnostic quiz file:

```text
lesson_start({ topic: "agent-orchestration" })
```

### `lesson_plan`

Writes the fixed plan sections in place. The diagnostic should determine Starting Point and initial sequence; later quiz evidence can change the graph.

### `lesson_note`

Activates a concept and its relationships:

```text
lesson_note({
  topic: "supervisor-pattern",
  prerequisites: ["agent-loop"],
  related: ["handoffs"]
})
```

It also routes subsequent quizzes to `quiz/supervisor-pattern-lesson.md` and adds explicit relationships/backlinks when target notes exist.

### `lesson_write`

Updates one stable topic section:

```text
lesson_write({
  section: "mental-model",
  content: "Think of the supervisor as the routing/control layer...",
  mode: "replace"
})
```

`replace` is the default. `append` is reserved for genuinely additive examples/notes.

### `lesson_misconception`

Records an unresolved misconception as a checkbox item; calling it later with the same wording and `resolved: true` marks it resolved. During diagnostics, `topic` can explicitly target the concept even though no lesson note is active yet.

### `lesson_quality`

Performs a mechanical audit of the active topic note: required sections, thin content, unresolved misconceptions, standardized metadata, and quiz evidence. Semantic accuracy and redundancy still require model review.

### `lesson_progress`

Tracks concept state (`learning`, `blocked`, `complete`). Completion is blocked if required note quality is not met, unresolved misconceptions remain, there is no lesson quiz evidence, or the latest lesson quiz was not correct.

### `lesson_finish`

Marks the overall plan complete. By default it refuses while unchecked Learning Sequence items remain.

## Quiz behavior

Questions are buffered until the quiz result arrives, then the question/result pair is appended as one chronological unit. Diagnostic and lesson quizzes stay in separate files.

Lesson quiz results also update the active topic's cumulative quiz statistics and confidence metadata. A miss returns the topic to `learning`; it cannot be marked complete until remediation and a subsequent correct quiz.

## Commands

- `/learn <dir>` — set/change the subject and ensure `plan/`, `topic/`, `quiz/` exist.
- `/lesson <slug>` — manual concept activation escape hatch; normal teaching uses `lesson_note`.
- `/lesson-stop` — stop active note/quiz capture without completing the overall track.
- `/lesson-status` — show subject, lifecycle phase, current track, plan, topic note, and quiz target.

## Intentionally omitted

Ordinary user chat, ordinary assistant chat, tool chatter, researcher/subagent process output, and orchestration noise are not copied into the learning artifacts.
