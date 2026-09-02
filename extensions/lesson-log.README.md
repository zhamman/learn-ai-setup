# lesson-log

This extension writes clean, topic-based learning notes for Obsidian instead of mirroring the full Pi chat.

## Normal workflow

1. Start Pi from the learning workspace root.
2. Set the subject directory once:

```text
/learn python/oop
```

3. Start the `teach` skill.
4. As teaching moves through distinct concepts, Pi calls the `lesson_note` tool automatically.

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

The active topic note receives:

- assistant lesson prose
- quiz questions
- quiz answers
- quiz explanations

It intentionally omits:

- ordinary user chat
- bash/read/write/edit tool chatter
- researcher/subagent tool results
- orchestration noise

## Commands

- `/learn <dir>` — set/change the subject directory relative to the Pi working directory.
- `/lesson <slug>` — manually start/switch a lesson note; normally unnecessary because Pi uses `lesson_note` automatically.
- `/lesson-stop` — stop topic-note logging.
- `/lesson-status` — show the current subject and active note.

## Model tool

`lesson_note({ topic, title? })` is available to Pi. The companion `lesson-notes` skill and the tool's prompt guidance tell the teacher to call it before the first substantive explanation of each distinct concept in the teaching dependency graph.

Example:

```text
/learn python/oop
```

Then Pi can call:

```text
lesson_note({ topic: "inheritance" })
```

which activates `python/oop/inheritance.md`.
