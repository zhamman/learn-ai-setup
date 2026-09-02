# lesson-log

This extension keeps clean topic notes and quiz history separate for Obsidian.

## Subject layout

After:

```text
/learn ai-engineering
```

Pi uses:

```text
ai-engineering/
├── topic/
└── quiz/
```

Example:

```text
ai-engineering/
├── topic/
│   ├── context-window.md
│   ├── tool-calling.md
│   └── agent-harness.md
└── quiz/
    ├── context-engineering-diagnostic.md
    ├── context-window-lesson.md
    ├── tool-calling-lesson.md
    └── agent-harness-lesson.md
```

`topic/` contains durable knowledge only. `quiz/` contains diagnostic and lesson quiz history only.

## Normal teaching flow

1. Start Pi from the learning workspace root.
2. Set the subject directory once with `/learn <subject>`.
3. Start the `lesson-notes` and `teach` skills.
4. Before the opening knowledge check, Pi calls `lesson_quiz_context` with `phase: "diagnostic"`.
5. Diagnostic questions/results are captured in `quiz/<overall-topic>-diagnostic.md`.
6. Before teaching a concept, Pi calls `lesson_note`.
7. `lesson_note` activates `topic/<concept>.md` and automatically routes subsequent quizzes to `quiz/<concept>-lesson.md`.
8. Pi saves durable explanations with `lesson_write`.
9. Quiz questions/results are captured automatically in the separate quiz file.

## Model tools

### `lesson_quiz_context`

Use this before the opening pre-instruction assessment:

```text
lesson_quiz_context({
  topic: "context-engineering",
  phase: "diagnostic"
})
```

The diagnostic is stored in:

```text
quiz/context-engineering-diagnostic.md
```

Ordinary quizzes during teaching do not normally need this tool.

### `lesson_note`

```text
lesson_note({ topic: "context-window" })
```

This activates:

```text
topic/context-window.md
```

and automatically sets the lesson quiz target to:

```text
quiz/context-window-lesson.md
```

### `lesson_write`

```text
lesson_write({
  content: "A context window is the model's current working input..."
})
```

Only that curated Markdown is appended to the active topic note.

Ordinary assistant messages are not automatically written.

## Quiz files

Each completed quiz question is appended with its result in chronological order:

```text
# Context Window — Lesson Quiz

## Quiz 1
<question>
<result>

## Quiz 2
<question>
<result>
```

Diagnostic files include a note that they were taken before instruction.

## Commands

- `/learn <dir>` — set/change the subject directory and create `topic/` + `quiz/`.
- `/lesson <slug>` — manually start/switch a concept note; normal teaching uses `lesson_note` automatically.
- `/lesson-stop` — stop topic-note writing and quiz capture.
- `/lesson-status` — show the current subject, topic note, and quiz target.

## What is intentionally omitted

Neither topic nor quiz files should contain ordinary chat, bash/read/write/edit chatter, researcher/subagent output, or orchestration noise.
