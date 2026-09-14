# Copilot Instructions for DeFi Recipes on Arc

## Project overview
This repository is a monorepo for a DeFi application built on Arc, with these main areas:

- `web/`: Next.js frontend application
- `keeper/`: backend/worker service and orchestration layer
- `contracts/`: Solidity smart contracts managed with Foundry
- `docs-site/`: documentation site built with Fumadocs/Next.js
- `docs/`: project documentation and design references

The goal is to keep the application coherent across frontend, backend, and smart contracts while preserving a clear developer experience and high-quality documentation.

## Core principles
- Prefer small, targeted changes over broad refactors.
- Follow existing patterns already used in the repo before introducing new abstractions.
- Keep code readable, typed, and maintainable.
- Avoid unnecessary dependencies or package churn.
- Preserve behavior and compatibility unless the task explicitly requires a breaking change.
- Before implementing, inspect the relevant feature area and match the existing architecture and conventions.

## Stack expectations
- Frontend: Next.js, TypeScript, Tailwind, React
- Backend: TypeScript / Node.js in `keeper/`
- Contracts: Solidity, Foundry
- Docs: MDX / Next.js for `docs-site/` and Markdown for `docs/`

## Code and style guidance
### Frontend / UI
- Use TypeScript and keep props, hooks, and state explicit.
- Prefer existing component patterns and shared utilities over creating duplicate implementations.
- UI text must be in English for all labels, buttons, placeholders, status messages, and user-visible copy.
- Never introduce untranslated Vietnamese strings in frontend UI.
- For select/date controls, always set explicit text and background colors for both the select itself and the option states.
- For year/month dropdowns, include the styling in the same base block as the main select styling; do not split styling across partial selectors.
- Ensure high-contrast values on Windows/browser themes by setting both `color` and `-webkit-text-fill-color` for select elements.
- Keep accessibility in mind: meaningful labels, keyboard focus styles, and good contrast.

### Documentation
- Documentation under `docs/` and related project docs should be written in Vietnamese with proper diacritics.
- Keep technical docs clear, structured, and practical.
- Avoid mixing Vietnamese and English in the same documentation section unless the English term is the canonical product or library name.

### Backend and contracts
- Keep backend services organized by domain and responsibility.
- Reuse existing config patterns instead of hardcoding env values.
- Smart contract changes should be minimal, auditable, and aligned with existing Foundry tests.
- Update or add tests when the behavior changes.

## Validation workflow
Before concluding a task:
1. Run the smallest relevant validation command for the affected area.
2. Prefer targeted checks over full-repo builds when a focused check is sufficient.
3. If a change affects the frontend, validate the relevant UI behavior and build output.
4. If a change affects backend logic, run the relevant service-level tests or build.
5. If a change affects Solidity contracts, use Foundry test coverage appropriate to the modified behavior.

Examples:
- `cd web && pnpm build`
- `cd keeper && npm run build`
- `cd contracts && forge test`

## Repository-specific constraints
- Do not modify lockfiles unless the task specifically requires dependency updates.
- Do not make unrelated cleanup changes in the same PR or patch.
- Respect the boundaries between `web`, `keeper`, `contracts`, and `docs`.
- Keep commit-level scope focused on the user request.
- If the task requires a new feature, prefer leveraging existing architecture before creating a new pattern.

## Response behavior for this repo
- When generating code, default to the project’s existing conventions and naming style.
- When writing user-facing strings, prefer English in the app and Vietnamese in repo documentation.
- When uncertain, inspect the closest existing implementation before adding new code.
- Prefer correctness and maintainability over cleverness or over-engineering.

## Summary
Treat this repo as a collaborative monorepo with a strong product-first focus: good user experience for the frontend, robust orchestration for the backend, secure and testable contracts, and clear Vietnamese documentation for internal project knowledge.
