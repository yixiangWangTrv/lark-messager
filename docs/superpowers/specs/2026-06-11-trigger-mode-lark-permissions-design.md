# Trigger Mode Lark Permissions Design

## Goal

Show the Lark permissions required by each trigger mode in the dashboard `Settings` panel so the user can see what capabilities each mode depends on before enabling it.

The dashboard should distinguish between required and optional permissions for each mode.

## Problem

Today the `Trigger Modes` card in `dashboard/index.html` shows three mode toggles:

- `@Bot Mention`
- `@Owner Mention`
- `All Messages`

Each card explains what the mode does, but it does not tell the user which Lark permissions are needed for that mode to work.

This leaves the user guessing whether a mode will function correctly after it is enabled, especially when configuring or troubleshooting bot access.

## Scope

In scope:

- add permission hints to each trigger mode card in the dashboard settings UI
- separate permissions into `Required` and `Optional` groups
- keep the existing trigger mode toggles and save flow unchanged
- keep the dashboard implementation in plain HTML plus vanilla JavaScript

Out of scope:

- checking whether the current Lark app actually has those permissions
- blocking save when permissions are missing
- changing trigger mode backend behavior
- adding new trigger modes
- sourcing permission metadata from the backend API

## Recommended Approach

Keep the permission metadata in a single frontend mapping and render it into the existing trigger mode cards.

This is the smallest correct change for the requested behavior:

- it keeps the current `/api/trigger-modes` API unchanged
- it avoids duplicating static permission text across the HTML template
- it makes later permission-text updates straightforward because the mapping lives in one place

The backend does not currently expose trigger mode metadata, and the user asked only for UI hints, not runtime permission validation. Adding an API layer now would increase scope without solving an immediate problem.

## Approaches Considered

### Approach 1: Inline Static HTML Text

Add `Required` and `Optional` permission lines directly under each trigger mode description in the HTML.

Pros:

- smallest possible visible change

Cons:

- repeats permission text in multiple places
- harder to maintain if permission names change
- makes future localization or UI reuse more awkward

### Approach 2: Frontend Metadata Mapping

Define a single JavaScript mapping from trigger mode keys to permission metadata, then render those hints into the card descriptions.

Pros:

- still minimal
- keeps permission definitions centralized
- easy to extend later

Cons:

- metadata remains frontend-owned rather than API-driven

### Approach 3: Backend-Driven Metadata

Extend `/api/trigger-modes` or add a new endpoint so the server returns both mode state and permission requirements.

Pros:

- clearer long-term separation between data and presentation
- better base for future missing-permission validation

Cons:

- larger change than the current need requires
- introduces unnecessary API work for a display-only hint

Recommendation: Approach 2.

## UI Design

Each trigger mode card should continue to show:

- the mode title
- the current descriptive sentence
- the existing badge when present
- the existing toggle control

Under the mode description, add a compact permissions hint block with two lines when data exists:

- `Required: ...`
- `Optional: ...`

If a mode has no optional permissions, omit the optional line rather than showing an empty label.

The permissions block should be visually secondary to the mode description, using the existing muted-note styling or a closely aligned variant.

## Data Model

Add a frontend constant keyed by trigger mode id:

```js
const TRIGGER_MODE_PERMISSION_HINTS = {
  mention_bot: {
    required: ["..."],
    optional: ["..."]
  },
  mention_owner: {
    required: ["..."],
    optional: ["..."]
  },
  all_messages: {
    required: ["..."],
    optional: ["..."]
  }
};
```

Notes:

- the exact permission strings should match the Lark permission names the user expects to configure
- the mapping should live in script code, not duplicated in HTML
- required and optional arrays should default to empty arrays when absent

## Rendering Flow

The trigger mode cards already have stable mode keys in code via:

- `mention_bot`
- `mention_owner`
- `all_messages`

Render flow:

1. define or identify a stable DOM target inside each card for permission hints
2. read the permission metadata mapping for that mode
3. render `Required` and `Optional` lines into the target
4. preserve the current toggle-card active-state behavior

This rendering should be independent from the current `loadTriggerModes()` flow so that:

- permission hints appear regardless of whether API loading succeeds
- the checkbox state logic remains focused on mode enablement only

## Localization

Permission names should stay as literal Lark permission identifiers and should not be translated.

Only the grouping labels need localization support:

- `Required`
- `Optional`

Because the dashboard already contains language dictionaries in `dashboard/index.html`, add localized entries for those two labels and reuse them when rendering the hint block.

This keeps the UI readable across languages while preserving exact permission names for copy-paste and operational reference.

## Error Handling

If a mode has no configured permission metadata:

- do not break the settings panel
- omit the permissions block for that mode
- do not affect trigger mode save behavior

If the localization entry is missing, falling back to English labels is acceptable.

## Testing

This change is primarily a dashboard rendering update.

Verification should cover:

- each trigger mode card shows its permission hints
- `Required` and `Optional` labels render correctly
- permission identifiers remain unchanged across language switches
- existing trigger mode toggle and save behavior still works
- missing optional permissions do not render empty placeholder lines

Automated coverage can stay targeted to the dashboard HTML rendering behavior if existing test structure makes that practical. If not, manual verification is acceptable for this UI-only change.

## Impact Summary

This change improves the usability of the `Settings` panel by making trigger-mode prerequisites visible where the user configures them.

It does not change runtime trigger logic, config persistence, or the trigger mode API shape.
