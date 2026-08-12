# Repository Guidelines

## Project Structure & Module Organization

Actuar Classifique is a static, browser-first application with no production bundler. `index.html` contains the application shell, views, routing, and legacy inline behavior. Reusable domain and UI logic lives in `js/`, including performance, manager, priority rotation, and pieces workflows. Design System styles are centralized in `styles/actuar-design-system.css`; fonts, logos, and icons are under `assets/actuar/`. Node-based checks live in `scripts/`, automated tests in `tests/`, platform documentation in `docs/`, and Supabase migrations, functions, and database tests in `supabase/`.

## Build, Test, and Development Commands

- `python3 -m http.server 8000 --bind 127.0.0.1`: serve the app at `http://127.0.0.1:8000`.
- `npm run lint`: validate JavaScript syntax and inline scripts.
- `npm run typecheck`: verify data contracts and RPC expectations.
- `npm test`: run all Node test files in `tests/*.test.cjs`.
- `npm run build`: validate the static production structure.

Run all four npm checks before handing off a change.

## Coding Style & Naming Conventions

Use four-space indentation in CSS and JavaScript, semicolons in JavaScript, and concise DOM-oriented functions. Follow existing naming patterns: camelCase for functions and variables, PascalCase only for constructors/types, kebab-case for CSS classes, and `*.test.cjs` for tests. Reuse existing Design System tokens (`--actuar-*`), components, and Flaticon icons. Keep Open Sans for interface text and Geist for numeric values. Avoid duplicated business rules, inline hex colors, decorative gradients, and new framework dependencies unless explicitly approved.

## Testing Guidelines

Tests use Node's built-in `node:test` runner and `node:assert`. Add or update tests for business rules, permissions, state transitions, persistence, and regression-prone navigation. Keep tests deterministic and independent of external services. Name tests by module, for example `tests/pieces-operations.test.cjs`.

## Commit & Pull Request Guidelines

Recent history is brief; prefer descriptive Conventional Commit messages such as `feat: add logistics handoff` or `fix: preserve ranking filters`. Keep commits scoped and exclude `.DS_Store`, secrets, and generated temporary files. Pull requests should include a concise summary, affected flows, test results, and screenshots for visual changes in both themes and relevant viewport sizes.

## Security & Configuration

Never expose Supabase service-role keys in frontend code. Keep only public placeholders in `.env.example`; store real credentials outside Git. Preserve existing user changes, avoid destructive migrations, and do not deploy or push without explicit authorization.
