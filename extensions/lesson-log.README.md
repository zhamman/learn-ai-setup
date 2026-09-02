# lesson-log

This extension keeps clean, topic-based learning notes for Obsidian without mirroring the Pi chat.

## Normal workflow

1. Start Pi from the learning workspace root.
2. Set the subject directory once:

```text
/learn python/oop
```

3. Start the `lesson-notes` and `teach` skills.
4. As teaching moves through distinct concepts, Pi calls `lesson_note` automatically.
5. Pi saves only durable knowledge by explicitly calling `lesson_write`.
6. Quiz questions/results are logged automatically.

For example, one OOP lesson can produce:

```text
python/oop/
├── classes.md
├── self.md
├── inheritance.md
└── composition.md
```

The same topic slug is reused when a concept is revisited, so the same note is enriched rather than creating transcript-style duplicates.

## What gets logged

The active topic note receives only:

- curated lesson material explicitly saved with `lesson_write`
- quiz questions
- quiz answers
- quiz explanations

It intentionally omits:

- ordinary user chat
- ordinary assistant chat
- bash/read/write/edit tool chatter
- researcher/subagent tool results
- orchestration noise

## Commands

- `/learn <dir>` — set/change the subject directory relative to the Pi working directory.
- `/lesson <slug>` — manually start/switch a lesson note; normally unnecessary because Pi uses `lesson_note` automatically.
- `/lesson-stop` — stop topic-note logging.
- `/lesson-status` — show the current subject and active note.

## Model tools

### `lesson_note`

```text
lesson_note({ topic: "inheritance" })
```

Creates or activates `python/oop/inheritance.md` when `/learn python/oop` is active.

### `lesson_write`

```text
lesson_write({
  content: "Inheritance lets a class derive behavior from a parent class..."
})
```

Appends only that curated Markdown to the active topic note.

Ordinary assistant responses are not automatically written. This lets Pi be conversational in the terminal while Obsidian remains a durable knowledge base rather than a filtered transcript.

Quiz content does not need to be sent through `lesson_write`; the extension captures quiz questions and results automatically while a lesson note is active.
