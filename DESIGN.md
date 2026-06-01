# H5 Game Evaluation Tool Design Notes

## Register

Product UI. Design serves repeated operational work: configuration, queue management, review, and Feishu write checks.

## Reference Direction

Primary reference: `E:\design-md-brands\design-airtable.md`.

Use the Airtable-like qualities that suit this product:

- White canvas and near-black ink.
- Dense but calm tables and panels.
- Clear primary actions in near-black.
- Thin dividers, restrained borders, and compact controls.
- Small signature surfaces in coral, forest, peach, and mint for status emphasis.

## Tone

Calm, exact, and work-focused. The UI should make a non-technical user feel that the setup steps are finite and visible.

## Components

- Top bar for current status and refresh.
- Left rail for configuration groups and task groups.
- Inline configuration forms, not modal-first flows.
- Data table for games and queue state.
- Evidence strip for screenshots.
- Job console for command output and completion state.

## Constraints

- Do not reveal stored API keys or App Secret.
- Favor compact Chinese labels with English field names where export fields are English.
- Avoid decorative gradients and oversized marketing sections.
- Keep border radius at 8px or less for tool surfaces.

