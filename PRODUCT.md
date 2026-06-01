# H5 Game Evaluation Tool

register: product

## Product Purpose

A local desktop-style tool for evaluating large batches of H5 web games. It collects browser evidence, runs AI-assisted classification and copy generation, writes results into Feishu Bitable, and preserves screenshots and reports in one folder per game.

## Users

Game operations, publishing, and content-review teams who need repeatable review records without running command-line scripts manually.

## Core Workflows

- Configure Gemini and Feishu credentials locally.
- Import one or more H5 game URLs.
- Run collection, AI evaluation, report generation, and Feishu write.
- Review evidence, taxonomy suggestions, and write status.
- Maintain taxonomy options through Feishu and sync them back into the tool.

## Product Principles

- Secrets are never displayed after saving.
- Every automated judgment needs evidence and a visible review status.
- The interface should feel like an operational console, not a landing page.
- The first useful screen is the workbench.

