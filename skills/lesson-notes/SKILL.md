---
name: lesson-notes
description: Keep teaching output as clean topic-based Obsidian notes instead of chat transcripts. Use whenever the teach skill is active and the lesson-log extension is available.
---

# Lesson Notes

Use the `lesson-log` extension to keep durable learning notes organized by concept.

## Core rule

Pi chat is the working conversation. Obsidian notes are the clean knowledge artifact.

Do not mirror ordinary user chatter, orchestration, researcher chatter, or tool noise into the notes. The extension already filters those. Your job is to switch the active note at the right semantic boundary.

## At the start of a learning session

The learner controls the subject directory. If none has been configured, ask them to run:

```text
/learn <subject-directory>
```

Examples:

```text
/learn python/oop
/learn ai-engineering
/learn databases/postgres
```

Do not silently invent or change the learner's subject directory.

## Automatic topic switching

Once `/learn` is configured, YOU switch notes automatically with the `lesson_note` tool.

Before the first substantive explanation of a distinct concept/node, call:

```text
lesson_note({ topic: "<stable-concept-slug>" })
```

Examples:

```text
lesson_note({ topic: "classes" })
lesson_note({ topic: "self" })
lesson_note({ topic: "inheritance" })
lesson_note({ topic: "composition" })
```

The learner should not need to run `/lesson` during a normal teaching session. `/lesson` exists only as a manual escape hatch.

A new note is appropriate when the lesson dependency graph moves to a concept that could stand alone as a useful future reference.

Do NOT switch notes merely because:
- the learner asked a clarification about the current concept
- a quiz occurred
- a researcher was consulted
- the teaching style changed
- an additional example is being given
- the same concept is being revisited

If the concept is revisited later, reuse the exact same slug so the same Markdown note is enriched rather than creating `topic-2.md`, `topic-part-2.md`, or a date-based duplicate.

## What belongs in the note

The active note should receive:
- lesson prose that teaches the concept
- concise examples that are part of the lesson
- useful Mermaid or visual embeds
- quiz questions
- quiz answers and explanations

The active note should NOT become a transcript. Avoid conversational filler such as:
- "Great question"
- "Let's continue"
- process commentary about subagents/tools
- explanations of what you are about to do rather than the lesson itself

Write lesson prose so it reads well later without the chat around it.

## Teaching integration

When using the `teach` skill:

1. Probe and plan normally.
2. Present the dependency map before teaching.
3. Wait for the learner to approve the plan.
4. Identify the first concept/node.
5. Call `lesson_note` for that concept BEFORE teaching it.
6. Teach and quiz the concept.
7. When the graph moves to the next distinct concept, call `lesson_note` first.
8. Keep clarifications, retries, and quizzes in the current concept note.
9. At the end, leave the last lesson active unless the learner asks to stop logging.

The topic boundary follows the knowledge graph, not arbitrary chat turns.
