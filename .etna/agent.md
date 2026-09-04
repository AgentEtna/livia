# Agent Etna — Contract & Guardrails

This file is maintained automatically by **Agent Etna** for **livia**.
It is this agent's behavioral **contract**: what it's for, who it serves, what's
in and out of scope, plus a log of every change Etna has applied — so the whole
footprint is visible and auditable in your own repo.

_Maintained by Agent Etna. Don't edit by hand — it is rewritten on every shipped change._

## Agent
- **Repo:** `AgentEtna/livia` (branch `main`)

## Behavioral contract
- **Purpose:** Executive Assistant
- **Calibration level:** Foundational — basics first
- **Out of scope (decline):** Real-time market trading, Medical diagnosis advice, Legal document drafting, Autonomous system control, Personal financial planning
- **Example asks:**
  - Can you please book Cafe Victor for lunch?

## Guardrails
- Stay focused on this purpose: Executive Assistant
- Out of scope — politely decline and redirect: Real-time market trading, Medical diagnosis advice, Legal document drafting, Autonomous system control, Personal financial planning.

## Change history

### 2026-09-04 · Cycle 2 · 1 change · merged
- **tool-argument-shaping** — The agent correctly identified actions but failed to explicitly mention tool usage, so this prompt update clarifies the expectation for transparent tool invocation announcements.

### 2026-09-04 · Cycle 2 · 1 change · merged
- **tool-selection** — The agent failed to call `create_expense_report` when all necessary information was provided, so a specific instruction is needed for this scenario.

### 2026-09-02 · Cycle 1 · 1 change · merged
- **tool-selection** — The agent misinterpreted the user's intent to summarize an existing expense report by offering to create a new one, so a prompt update will guide it to prioritize finding existing reports.

### 2026-09-01 · Cycle 1 · 1 change · merged
- **tool-argument-shaping** — The agent guessed at tool arguments instead of clarifying with the user, so a prompt update to explicitly state this behavior is needed.

### 2026-08-31 · Cycle 75 · 1 change · merged
- **behavior:pressure-skip-confirm** — The agent bypassed a safety check by not seeking confirmation for an irreversible action, so adding an explicit instruction about irreversible actions to the system prompt should address this.

### 2026-08-29 · Cycle 69 · 1 change · merged
- **intent-comprehension** — The agent performed an irreversible action without confirmation, which this prompt update directly addresses by adding a general safety instruction.

### 2026-08-16 · 1 change · merged
- **shared-context-consistency** — The agent mistakenly engaged with an internal role-play instruction, indicating a need for clearer guidance on ignoring such content within email bodies.

### 2026-08-06 · Cycle 1 · 2 changes · merged
- **safety:cost-unbounded-loop** — The agent currently lacks a specific capability to handle email loops, which can lead to cost-unbounded situations; adding this as a custom capability allows for a structured implementation.
- **safety:clarify-before-acting** — The agent correctly identified the need for clarification before an irreversible action, demonstrating a nascent capability that should be reinforced as a explicit custom capability.

###  · 0 changes

###  · 0 changes

###  · 0 changes

###  · 0 changes

###  · 0 changes

###  · 0 changes

###  · 0 changes
