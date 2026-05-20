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

## Deploy to GitHub Pages

This app is now configured for GitHub Pages as a Vite React site.

1. Push the repository to GitHub.
2. Make sure your default branch is `main`.
3. In GitHub, open `Settings > Pages`.
4. Set `Source` to `GitHub Actions`.
5. Push to `main`, or run the `Deploy to GitHub Pages` workflow manually from the `Actions` tab.

The workflow builds the app and publishes the `dist/` folder to Pages automatically.

Why this changed from the old static setup:

- The original root `index.html` model worked because everything lived at fixed relative paths.
- Vite fingerprints JS and CSS into `dist/assets/...`, so GitHub Pages needs the built `dist` output, not the source tree.
- The Vite `base` setting is now `./`, which keeps asset URLs relative so the app works under a GitHub Pages project path instead of only at the site root.

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
