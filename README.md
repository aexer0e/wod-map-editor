# WoD Map Editor

A modern, browser-based map editor for War of Dots 3. No build step, no backend — open `index.html` and go.

## Run

Open `index.html` in any modern browser. For full functionality (file drag & drop, no CORS gotchas), serve the folder over HTTP, e.g.:

```powershell
cd "WoD Map Editor"
python -m http.server 8080
# then open http://localhost:8080
```

## Features

- **Maps menu** — see all your saved maps with thumbnails. Edit, download, rename, or delete each one.
- **Editor** — drop a background image (auto-scaled to 960×540), then place infantry, tanks, cities, capitals, and bridges per team.
- **Modes** — 1v1, 2v2, 3v3, FFA. Switching modes resizes the team list (existing units kept).
- **Import / Export** — round-trips the game's gzipped JSON `.txt` format. Files downloaded here drop straight into your `map_editor/` folder.
- **Autosave** — to IndexedDB, locally on your machine. Use Download to get the `.txt`.

## Controls

- Left-click: place with selected tool
- Right-click: erase what's under the cursor
- Eraser tool: same as right-click
- Capital tool: click a city to toggle its capital flag; click empty space to add a capital city
- Bridge tool: click two points to draw a bridge segment

## File format

Each map is a gzip-compressed JSON file with this shape:

```json
{
  "map_surface": "<base64 PNG, 960x540>",
  "mode": "1v1",
  "infantry": [ [[x,y], ...], ... ],   // per team
  "tanks":    [ [[x,y], ...], ... ],   // per team
  "cities":   [ [x,y], ... ],
  "capitals": [ 0, 6 ],                 // indices into cities
  "bridges":  [ [x1,y1,x2,y2], ... ]
}
```
