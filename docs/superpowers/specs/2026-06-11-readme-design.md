# README Design

## Goal

Create a project README that works for both first-time users and contributors, with English as the default reading path and clickable navigation for Chinese and Bahasa Indonesia.

The README should explain what the bot does, how to run it, how to configure it, and what major subsystems exist. It should end with the provided star-history image.

## Scope

In scope:

- add a new root `README.md`
- make English the first language shown in the file
- add top-of-file language navigation links for `English`, `中文`, and `Bahasa Indonesia`
- provide the same core sections in all three languages
- document setup, configuration, dashboard usage, testing, and project structure
- include a `Star History` section at the end
- commit the README work to git

Out of scope:

- generating badges from CI or package registries
- adding screenshots other than the requested star-history image
- creating separate per-language README files
- changing application code or config behavior to match README wording

## Constraints

- keep everything in a single `README.md`
- English should be the default top section
- language switching should use anchor links, not tabs or JS
- the README should match the current implementation rather than aspirational features
- the image at the end should be the provided star-history chart, or an equivalent repo-specific star-history image if the attached file is not present in the workspace

## Recommended Approach

Write one structured README with a short English-first landing section, then repeat the same documentation structure in Chinese and Bahasa Indonesia.

This is the most GitHub-compatible approach, keeps all content in one place, and satisfies the requirement for clickable language switching without introducing fragile HTML tricks.

## Content Structure

The README should use this order:

1. Title
2. One-sentence description
3. Language navigation links
4. English section
5. Chinese section
6. Bahasa Indonesia section
7. Star History section

Each language section should keep the same major headings so readers can switch languages without losing their place.

## English Section

The English section should contain:

- `Overview`
- `Features`
- `Architecture`
- `Requirements`
- `Quick Start`
- `Configuration`
- `Dashboard`
- `Testing`
- `Contributing`
- `License`
- `Contact`
- `Project Structure`

Content guidance:

- `Overview` explains the bot as a Lark on-call assistant powered by OpenCode
- `Features` lists event listening, context fetching, OpenCode session orchestration, dashboard controls, knowledge base support, and style distillation
- `Architecture` summarizes the flow from Lark event to context, intent routing, OpenCode execution, and reply sending
- `Quick Start` includes install, config, and run commands based on `package.json`
- `Configuration` references `oncall-bot.config.json` and describes the most important top-level blocks
- `Dashboard` explains the local dashboard and what it can control
- `Testing` documents `npm test`
- `Contributing` documents the expected git workflow: start from `master`, create a feature branch from it, make changes, push the branch, and open a PR back to `master`
- `License` states that the project is released under the MIT License
- `Contact` lists the maintainer contact details provided by the user
- `Project Structure` highlights the main entrypoints and directories

The contact block should include:

- `yixiang.wang@traveloka.com`
- `943161618@qq.com`
- `+86 18856978931`

## Chinese Section

The Chinese section should mirror the English structure but read naturally in Chinese rather than line-by-line translation.

Terminology should stay consistent with the codebase where useful, for example:

- `Lark on-call bot`
- `OpenCode`
- `dashboard`
- `knowledge base`
- `trigger modes`

The Chinese section should also include the same `Contributing` guidance and make the branching rule explicit: contributors should sync `master`, branch from `master`, then create a PR back into `master`.

The Chinese section should also include matching `License` and `Contact` sections with the same MIT and contact details.

## Bahasa Indonesia Section

The Bahasa Indonesia section should also mirror the English structure and keep a practical documentation tone.

The translation should stay concise and operational, optimized for setup and contribution rather than marketing copy.

The Bahasa Indonesia section should include the same contribution workflow and state clearly that contributors create a new branch from `master` before opening a PR to `master`.

The Bahasa Indonesia section should also include matching `License` and `Contact` sections with the same MIT and contact details.

## Star History Image

The README should end with a dedicated `Star History` heading.

Preferred behavior:

- embed the provided image if it is available as a workspace file

Fallback behavior:

- embed the matching Star History chart from `star-history.com` using the repository's actual GitHub slug if the attached file is not available locally

This keeps the README complete even when the chat attachment itself is not exposed as a normal file in the repository.

## Files Expected To Change

- `README.md`
- `LICENSE`
- optionally an image asset path if the provided image is added to the repository as a local file

## Verification

Verification should cover:

- the README renders with working anchor links for all three languages
- commands match the current `package.json`
- configuration examples match the current config file shape
- the documented features exist in the current codebase
- the README includes MIT license wording and the provided contact details
- a root `LICENSE` file exists with MIT text
- the final star-history section renders an image

## Commit Strategy

Use two commits in sequence:

1. commit the design spec
2. commit the README implementation

Only stage the files created or changed for this task so unrelated worktree changes are not included.
