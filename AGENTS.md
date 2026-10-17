# Repository Guidelines

## Project Status

This directory currently has no source code, dependency manifests, tests, or Git metadata. Treat the conventions below as starting recommendations; update this guide when the project's language, framework, and tooling are established.

## Project Structure & Module Organization

Keep the repository root focused on project documentation and configuration. When adding the initial implementation, consider these directories where appropriate:

- `src/`: application or library code, grouped by feature or responsibility.
- `tests/`: automated tests, with a structure that mirrors the source modules.
- `assets/`: static resources required by the project.
- `docs/`: setup instructions, architecture notes, and longer explanations.

Create directories only when they contain useful project files.

## Build, Test, and Development Commands

No build, test, or local development commands are configured yet. When introducing tooling, document the exact installation, development, build, and test commands in `README.md`. Prefer commands defined by the project's manifest or task runner, and verify them from a clean checkout. Do not assume commands such as `npm test` or `make build` exist.

## Coding Style & Naming Conventions

Follow the idiomatic style of the chosen language. Establish indentation, formatting, and linting rules in checked-in configuration alongside the first implementation. Use descriptive names and consistent file naming within each module. Avoid unrelated formatting changes.

## Testing Guidelines

No testing framework or coverage threshold has been established. Add tests for new behavior and bug fixes once a framework is selected. Use descriptive test names that state the behavior under test, and document how to run both individual tests and the full suite.

## Commit & Pull Request Guidelines

There is no Git history from which to infer commit conventions. If Git is initialized, use concise, imperative commit subjects, such as `Add initial project setup`. Keep changes focused. Pull requests should explain their purpose, summarize validation, link relevant issues, and include screenshots for visible UI changes.

## Security & Configuration

Keep credentials and local configuration out of version control. Provide placeholder configuration examples and ignore generated artifacts when introducing the relevant tooling.
