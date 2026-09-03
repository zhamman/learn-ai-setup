# Pi Learning — Obsidian plugin

A small desktop Obsidian plugin for the Pi learning workflow.

It renders:

- `learning-quiz` blocks as single-select assessments with a real **Submit answer** button
- `learning-code` blocks as editable coding exercises with a real **Submit code** button
- neutral inline result/feedback states
- cohesive reading styles for `topic/`, `plan/`, and `quiz/` files

It does not put correct answers, scores, lifecycle state, dates, or mastery metadata into visible Markdown.

## Install into the learning vault

From `~/code/learning`:

```bash
bash .pi/scripts/install-obsidian-plugin.sh
```

Then open Obsidian:

1. Settings → Community plugins
2. Enable **Pi Learning**

If the plugin was already enabled and you pulled an update, run the installer again and reload Obsidian (or toggle the plugin off/on).

## Data flow

```text
Pi extension
  ↓
quiz/<concept>-lesson.md
  contains learning-quiz / learning-code render block
  ↓
Pi Learning plugin renders UI
  ↓
learner submits
  ↓
<subject>/.learning/submissions/*.json
  ↓
Pi watcher sees submission
  ↓
grades/adapts
  ↓
<subject>/.learning/results/<assessment>.json
  ↓
plugin displays feedback
```

`.learning/` is machine state. The learner-facing notes remain clean Markdown.
