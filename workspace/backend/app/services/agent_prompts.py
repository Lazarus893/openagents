# -*- coding: utf-8 -*-
"""
Agent prompt augmentations that should ride along with every agent
system prompt regardless of configuration. Currently:

- Artifact emission preamble: teaches the agent to wrap significant,
  self-contained outputs (>15 lines / code / diagrams / structured docs)
  in `<artifact>` tags so they become first-class artifacts.

The `compose_system_prompt()` helper merges the user-configured prompt
with these augmentations.
"""

ARTIFACT_PREAMBLE = """\
## Artifacts

When you produce a result that is significant and self-contained — \
roughly any output longer than ~15 lines, OR any code, diagram, \
SVG/HTML/JSON document, or structured deliverable the user is likely \
to read, edit, share or reuse — wrap it in an `<artifact>` tag instead \
of pasting it inline.

Format:

```
<artifact kind="markdown" title="Q1 Plan" id="q1-plan-2026" summary="3 goals, 5 milestones">
## Goals
- ...
</artifact>
```

Required attributes:
- `kind`: one of `markdown` | `code` | `html` | `svg` | `mermaid` | `json` | `image`
- `title`: short human-readable label (will appear on the artifact card)

Optional:
- `id`: a stable slug. When you re-emit an artifact with the same `id`, \
the system creates a new version with the previous as parent. Use this \
when iterating on a deliverable.
- `summary`: 1-2 sentence preview shown on cards
- `language`: programming language for `kind="code"` (e.g. "python", "typescript")

Rules:
- Never wrap small confirmations or short replies in `<artifact>`.
- Never include surrounding markdown code fences inside the artifact body \
(the renderer handles formatting based on `kind`).
- For `kind="code"`, paste the raw source — no triple-backticks.
- For `kind="mermaid"`, paste raw mermaid syntax (e.g. `graph TD`).
- For `kind="svg"`, paste a complete `<svg>...</svg>` element.
- You may emit multiple artifacts in one message; each one becomes its own card.

Conversational text outside the tag stays in the chat. The artifact tag's \
content does NOT appear in the chat body — it gets a card the user can open.
"""


def compose_system_prompt(user_prompt: str | None) -> str | None:
    """Return the user's configured prompt with the artifact preamble appended.

    If the user's prompt is empty/None, returns just the artifact preamble.
    """
    if not user_prompt or not user_prompt.strip():
        return ARTIFACT_PREAMBLE
    return f"{user_prompt.rstrip()}\n\n{ARTIFACT_PREAMBLE}"
