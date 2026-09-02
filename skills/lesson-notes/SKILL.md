---
name: lesson-notes
description: Keep teaching output as clean topic notes with separate quiz history in Obsidian. Use whenever the teach skill is active and the lesson-log extension is available.
---

# Lesson Notes

Use the `lesson-log` extension to keep durable topic knowledge separate from quiz history.

## Core structure

The learner chooses one subject directory with `/learn`.

That subject contains exactly two learning-data directories:

```text
<subject>/
├── topic/
└── quiz/
```

For example:

```text
ai-engineering/
├── topic/
│   ├── context-window.md
│   └── tool-calling.md
└── quiz/
    ├── context-engineering-diagnostic.md
    ├── context-window-lesson.md
    └── tool-calling-lesson.md
```

`topic/` is the clean knowledge base. `quiz/` is the learner's testing history.

Ordinary chat is not copied into either directory.

## At the start of a learning session

The learner controls the subject directory. If none has been configured, ask them to run:

```text
/learn <subject-directory>
```

Examples:

```text
/learn ai-engineering
/learn python/oop
/learn databases/postgres
```

Do not silently invent or change the learner's subject directory.

## Opening diagnostic quiz

When `teach` begins by probing the learner's existing understanding with a quiz, preserve that quiz separately before instruction starts.

Before the FIRST diagnostic/probe quiz, call:

```text
lesson_quiz_context({
  topic: "<overall-requested-lesson-slug>",
  phase: "diagnostic"
})
```

Example for a user who asked to learn context engineering:

```text
lesson_quiz_context({
  topic: "context-engineering",
  phase: "diagnostic"
})
```

The diagnostic quiz is then captured in:

```text
quiz/context-engineering-diagnostic.md
```

Use the overall lesson being assessed, not the first dependency concept, for the diagnostic filename.

All questions used to gauge the learner BEFORE teaching begins should remain in that diagnostic file.

## Automatic topic switching

Before the first substantive explanation of each distinct concept/node, call:

```text
lesson_note({ topic: "<stable-concept-slug>" })
```

Examples:

```text
lesson_note({ topic: "context-window" })
lesson_note({ topic: "tool-calling" })
lesson_note({ topic: "agent-harness" })
```

This does two things automatically:

1. activates `topic/<concept>.md`
2. routes subsequent quizzes to `quiz/<concept>-lesson.md`

So after:

```text
lesson_note({ topic: "context-window" })
```

Pi writes durable knowledge to:

```text
topic/context-window.md
```

and lesson quizzes to:

```text
quiz/context-window-lesson.md
```

Do not call `lesson_quiz_context` for ordinary concept quizzes unless there is a specific reason to override routing. `lesson_note` already handles it.

Reuse the exact same concept slug when revisiting a concept. Do not create `topic-2`, `part-2`, or date-based duplicates.

Do not switch topic notes merely because:
- the learner asked a clarification
- a quiz occurred
- a researcher was consulted
- the teaching style changed
- another example is being given
- the same concept is being revisited

## Durable topic writing

After teaching something worth preserving, call:

```text
lesson_write({
  content: "<clean standalone Markdown>"
})
```

`lesson_write` writes only to the active file under `topic/`.

Good durable content includes:
- the core explanation
- a useful mental model
- an important distinction
- concise code examples
- Mermaid diagrams
- worked examples worth revisiting

Do not write:
- greetings or praise
- conversational filler
- process commentary
- researcher/subagent chatter
- tool-call descriptions
- quiz questions or quiz results

Quiz content belongs only under `quiz/` and is captured automatically.

## Quiz behavior

Every completed quiz question is stored with its result in the current quiz file.

Diagnostic quizzes go to:

```text
quiz/<overall-topic>-diagnostic.md
```

Quizzes during instruction go to:

```text
quiz/<current-concept>-lesson.md
```

Each file preserves quiz chronology as:

```text
## Quiz 1
Question
Result

## Quiz 2
Question
Result
```

Do not duplicate quiz content with `lesson_write`.

## Teaching integration

When using `teach`:

1. Determine the overall lesson/topic the learner requested.
2. Before any opening assessment quiz, call `lesson_quiz_context` with that overall slug and `phase: "diagnostic"`.
3. Probe the learner's existing understanding. The diagnostic is stored under `quiz/`.
4. Build and present the dependency map.
5. Wait for approval before teaching.
6. Before the first concept, call `lesson_note` for that concept.
7. Teach conversationally.
8. Call `lesson_write` with the distilled durable version.
9. Quiz the concept. The quiz is automatically stored in `quiz/<concept>-lesson.md`.
10. If clarification materially improves the durable note, save only the new useful material with `lesson_write`.
11. When moving to the next concept, call `lesson_note` first; both the topic-note target and lesson-quiz target switch automatically.

The topic boundary follows the knowledge dependency graph, not arbitrary chat turns.
