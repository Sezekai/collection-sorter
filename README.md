# Collection Sorter

Review-first sorter for a large art, photo and video collection. It reads every file in your source folders, tags it with a local AI model, learns from your example folders and your corrections, and suggests where each file belongs. Nothing moves until you approve it, and every move can be undone.

## For users

1. Download `CollectionSorter-v<version>-win-x64.zip` from the latest release and unzip it into, for example, `E:\Pictures`. The program is `E:\Pictures\Collection Sorter\App\Collection Sorter.exe`. No install needed.
2. On **Setup**: add your source folders, set the destination folder, download the models once (about 1.8 GB), and add **Scan & analyse** to the queue.
3. Review on the Review screens. **Approve** (A) moves a file at once; **Reject** (R) keeps it where it is. Ctrl+Z undoes the last move, and **Undo** puts back anything. Press **K** for every shortcut.

`READ ME FIRST.txt` in the zip has the same steps, plus where everything is stored.

## The screens

- **Side menu:** Setup, the Review screens (Review, Real, Tags, Duplicates, Sets), Examples, What it knows, Rules, Undo; then Look, Settings, Keys and Log at the bottom. Drag its edge to resize it, or collapse it to icons.
- **Title bar:** the screen name, and pills for anything running. A pill shows its full text when there's room; when it's cut short, click it for everything.
- **Status bar:** what's running (bar, %, time taken, time left), the GPU load, Pause and Stop, and **Finished: …** with the next step when a job ends. Jobs queue: adding one while another runs puts it in line.
- **Review views:** Grid, Masonry, Cards and List (sortable columns). The viewer has no overlays: the panel on the right holds the details, folder, rating and Approve/Reject.
- **Look:** themes (save, rename, duplicate, export, import), background and accent colours, fonts (bundled, system or your own), text size, corners, density, buttons and outlines.
- **Settings:** every option, **Storage** (each location with its size: open, move, clear), **GPU** (Auto, GPU, CPU), **Diagnose and repair**, and resets.
- **Log (L):** opens a drawer with the live log; it opens itself on an error.

## Where things are stored

| What | Where | Change it in |
|---|---|---|
| Settings, learned data, history, appearance, small thumbnails, logs | `%LOCALAPPDATA%\Collection Sorter` | Settings → Storage |
| AI models | `<folder above App>\Models` | Settings → Storage |
| Cache (contact sheets) | `<folder above App>\Cache` | Settings → Storage |

Updating means unzipping the new version over the old `App` folder; nothing else is touched.

## For developers

- `npm install`, then `npm start` (Electron) or `npm run engine` (engine only, http://127.0.0.1:…).
- `npm test` runs the Node unit tests. The end-to-end tests are Python + Playwright against the engine: `python3 tests/e2e17.py` (see each file's header).
- `npm run dist` builds `dist/CollectionSorter-v<version>-win-x64.zip` on Windows or Linux.
- Self-test: `CS_SELFTEST=<dir>` makes the app open every screen, save screenshots and `selftest.log`, and exit non-zero on a problem. `CS_DATA` and `CS_ROOT` point the data and root folders somewhere else.
- **Releases:** every push to `main` builds on `windows-latest`, runs the tests and the self-test, and publishes `v<version>` from `package.json` as a GitHub release with the zip. Bump the version for a new release.

Design and engineering rules: [DESIGN.md](DESIGN.md) and [STANDARDS.md](STANDARDS.md) (copies of Sezekai/app-standards, with this app's own choices at the end). Product context: [PRODUCT.md](PRODUCT.md).
