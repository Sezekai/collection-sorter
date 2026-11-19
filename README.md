# Collection Sorter

Review-first sorter for a large art, photo and video collection. It reads every file in your source folders, tags it with a local AI model, learns from your example folders and your corrections, and suggests where each file belongs. Nothing moves until you approve it, and every move can be undone.

## For users

1. Download `CollectionSorter-v<version>-win-x64.zip` from the latest release and unzip it into, for example, `E:\Pictures`. The program is `E:\Pictures\Collection Sorter\App\Collection Sorter.exe`. No install needed.
2. On **Setup** (its sections are listed on the left): add your source folders, set the destination folder, download the models once (about 1.8 GB), and add **Scan & tag files** to the queue.
3. Review on the Review screens. **Approve** (A) moves a file at once; **Reject** (R) keeps it where it is. Ctrl+Z undoes the last move, and **Undo** puts back anything. Press **K** for every shortcut.

`READ ME FIRST.txt` in the zip has the same steps, plus where everything is stored.

## The screens

- **Side menu:** Setup, the Review screens (Review, Real, Tags, Duplicates, Sets), Examples, What it knows, Rules, Undo; then Look, Settings, Keys and Log at the bottom. Drag its edge to resize it, or collapse it to icons.
- **Title bar:** the screen name, and pills for anything running. A pill shows its full text when there's room; when it's cut short, click it for everything.
- **Status bar:** what's running (bar, %, time taken, time left), the GPU load, Pause and Stop, and **Finished: …** with the next step when a job ends. Jobs queue: adding one while another runs puts it in line.
- **Review views:** Grid, Masonry, Cards and List (sortable columns). The viewer has no overlays: the panel on the right holds the details, folder, rating and Approve/Reject.
- **Look:** **Sizes** (a preset, an overall size, and separate sizes for the text, screen titles, menu text and icons, the logo, other icons, buttons and fields, and rows; Ctrl + = / − / 0 anywhere), themes (save, rename, duplicate, export, import), background and accent colours, fonts (bundled, system or your own), corners, buttons and outlines. Sizes stay the same whichever theme you pick.
- **Settings:** every option, **Storage** (each location with its size: open, move, clear), **GPU** (Auto, GPU, CPU), **Diagnose and repair**, and resets.
- **Log (L):** opens a drawer with the live log; it opens itself on an error.

## Changing folders (for example from test files to the real ones)

Setup → Destination → **Change folders…** picks the new destination and the folders to sort, then shows what carries over before anything changes. The app keeps everything it knows about a destination folder under the folder's name, so a destination with the same layout carries straight on: the rules and priority order, which examples teach which folder, what it knows about each folder, the series assignments, the examples-folder mappings and what it learned about NSFW, Very and art or real. Names that differ only in capitals are matched automatically; for a folder the new destination doesn't have, you choose what it became, forget it, or keep it (it's made when first needed).

It can also forget the old setup: the old files' records, thumbnails, previews, duplicates, sets, suggestions and move history (nothing on disk is touched; those moves can't be undone from the app afterwards). Your approvals in the old destination can be kept as learned examples, so what they taught the app isn't lost.

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
