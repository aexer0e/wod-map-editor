# WoD Map Editor

This prototype has been rebuilt as a React + TypeScript app with a Vite toolchain.

The new editor keeps terrain interaction on a dedicated canvas render path so paint input feels faster, uses typed IndexedDB persistence and typed import/export helpers, and locks the editor workspace to the viewport so the mouse wheel can adjust brush size instead of scrolling the page.

## Run

```powershell
cd "WoD Map Editor"
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Build

```powershell
npm run build
```

## What changed

- React UI with a typed data model and Vite-based build.
- Faster editor loop with canvas drawing kept outside React re-render hotspots.
- Fixed editor workspace with page scrolling disabled while editing.
- Mouse wheel brush resizing on the map canvas.
- Cleaner map library with inline create, rename, delete, import, and export flows.
- Retained compatibility with the original gzipped `.txt` map format.

## Core controls

- Left click places units, cities, capitals, and bridges.
- Right click removes the nearest placed object.
- Terrain tools paint directly on the map canvas.
- Mouse wheel over the map changes terrain brush size.
- `Ctrl+Z` and `Ctrl+Y` undo and redo.

## File format

Each exported map is still a gzip-compressed JSON payload with this shape:

```json
{
  "map_surface": "<base64 PNG, 960x540>",
  "mode": "1v1",
  "infantry": [[[x, y]], [[x, y]]],
  "tanks": [[[x, y]], [[x, y]]],
  "cities": [[x, y]],
  "capitals": [0, 6],
  "bridges": [[[x1, y1], [x2, y2]]]
}
```
