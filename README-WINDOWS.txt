COLLECTION SORTER (portable)

1. Unzip into the folder you want it in, for example E:\Pictures. You get:
     E:\Pictures\Collection Sorter\App\Collection Sorter.exe   <- the program
   The AI models (Models\) and the cache (Cache\) are made beside App\ the first time they're needed.
2. Double-click "Collection Sorter.exe" (in App\).
   If Windows SmartScreen warns about an unknown app, choose "More info" -> "Run anyway" (the app is not code-signed).
3. On the Setup screen:
   - add the folder(s) you want sorted (sources),
   - set the destination folder (test: E:\Pictures\Sorting Test),
   - download the models once (about 1.3 GB with the default Haruka tagger; PixAI, Camie and the WD taggers can be
     downloaded too, and Tag again re-tags with any of them, keeping every tagger's tags),
   - set the Look Up and Find Higher Quality folders (E:\Pictures\IMGs\Sort\Look Up and ...\Find Higher Quality),
   - add "Scan & tag files" to the queue. You can add more jobs while one runs; they wait their turn.
   Moving from test folders to your real ones later: Setup > Destination > "Change folders...". It keeps the rules, the
   priority order, the examples and what the app knows about each folder, and can forget the test files and their history.
4. Review on the Review screens. Approving a picture (A) MOVES IT AT ONCE; Ctrl+Z puts the last one back, and the
   Undo screen puts anything back. Press K anywhere for the keyboard shortcuts.

WHERE THINGS ARE
- Settings, learned data, move history and appearance: %LOCALAPPDATA%\Collection Sorter (small thumbnails too).
- AI models: E:\Pictures\Collection Sorter\Models.  Cache (contact sheets): E:\Pictures\Collection Sorter\Cache.
- Settings > Storage shows every location with its size, and can open, move or clear each one.
- Look (in the side menu) changes the sizes (Ctrl + plus / minus / 0 too), theme, colours, fonts and corners; themes can be exported and imported.

UPDATING
Unzip the new version over the old one (replace App\). Settings, models and everything you've taught it stay.

IF SOMETHING GOES WRONG
- Press Ctrl+L for the log, or open Settings > "Diagnose and repair": it checks the models, folders and graphics card,
  explains what it found and can repair most of it.
- Log files (and crash reports) are in %LOCALAPPDATA%\Collection Sorter\logs. The last 5 runs are kept.
- If the app crashes twice in a row it starts in safe mode (no graphics card); Settings says so and has a button to leave it.
- The app uses your graphics card through DirectML (any DirectX 12 GPU) and falls back to the processor automatically.
