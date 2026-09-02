# lesson-log

This extension writes clean, topic-based learning notes for Obsidian instead of mirroring the full Pi chat.

## Commands

- `/learn <dir>` — set the subject directory relative to the Pi working directory.
- `/lesson <slug>` — start/switch to `<subject>/<slug>.md`.
- `/lesson-stop` — stop topic-note logging.
- `/lesson-status` — show the current subject and note.

Example:

```text
/learn python/oop
/lesson inheritance
```

writes to `python/oop/inheritance.md`.

The extension logs assistant lesson prose and quiz Q&A only. It omits ordinary user chat and tool noise.

The companion `lesson-notes` skill tells the teacher how to choose semantic topic boundaries. A model-callable topic-switching tool is planned in this branch before merge.
