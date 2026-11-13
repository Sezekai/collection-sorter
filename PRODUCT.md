# Product

## Platform

Windows desktop app (Electron with a local Node engine), shipped as a portable zip built by GitHub Actions and published as a GitHub release. The design language is desktop Windows, following the suite guideline in DESIGN.md.

## Users

The owner, on their own Windows laptop (RTX 3060 Laptop GPU, mostly on a 27" 1440p monitor), sorting a large personal collection of art, photos and videos.

## Product Purpose

Collection Sorter suggests a destination folder for every file in the source folders, using a local tag model, the owner's example folders and their past corrections. The owner reviews the suggestions and approves or rejects them; approved files move at once. Success means a big backlog gets sorted quickly with very few wrong moves, and every move can be undone.

## Operating Context

- The owner adds source folders and one destination folder with its subfolders, and teaches the app with example folders.
- Jobs (scan, read, learn, find duplicates, find sets, choose folders, download models) run in a queue with one status bar.
- Review screens: everything, real photos, by tag, duplicates, sets. Approve (A) moves the file now; Reject (R) leaves it. Ctrl+Z and the Undo screen put moves back.
- If destination folders are renamed, merged or deleted outside the app, it notices on the next scan and offers to map the old names to the new ones.
- No live folder watching: a scan picks up changes.

## Capabilities and Constraints

- **AI:** ONNX tag models (EVA02-Large by default, SwinV2 smaller) on the GPU through DirectML, CPU fallback. Models download once into `Models\` beside the program.
- **Progress:** every download and task shows a bar, a percentage, the time elapsed and the time left (the owner's standing rule).
- **Safety:** nothing is deleted; moves are copy-verify-delete and recorded so they can be undone. Two crashes in a row start safe mode (CPU, no hardware acceleration).
- **Appearance:** fully customisable (themes, colours, gradients, fonts, corners, density), with themes shareable between the owner's apps as theme files.
- **Storage:** settings and learned data in `%LOCALAPPDATA%\Collection Sorter`; models and cache beside the program; small thumbnails on C:. Every location can be moved from Settings → Storage.

## Brand Commitments

App name: Collection Sorter. The owner chose: Obsidian background, Blue → Cyan accent, a side menu, Approve/Reject in accent and plain, compact density. Every option stays changeable on the Look screen.

## Evidence on Hand

None needed. Tests and screenshots use generated placeholder images, not the owner's collection.

## Product Principles

- Nothing moves without approval, and every move can be undone.
- The owner can always see what is running, how far along it is and how long is left.
- The app learns from corrections instead of asking for rules.
- One look across all of the owner's apps, and every part of it can be changed.
