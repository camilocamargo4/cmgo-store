# Cmgo store files (CDN)

Everything the browser downloads for the store. Upload this folder as-is to any static
HTTPS host (GitHub + jsDelivr, or Cloudflare Pages). No orders or customer files live here.

| File | What it is |
|---|---|
| `cmgo-store.js` | The store as one tag, `<cmgo-store>`: conveyor + customiser + three.js (about 175 KB gzipped) |
| `store.json` | Products (colours, sizes, print areas, model file) and showroom entries. **Add a garment here.** |
| `model-viewer.min.js` | 3D viewer for the customiser, loaded only when it opens |
| `*.glb` | Garment models and the conveyor scene |
| `conveyor-catalogue.json` | What hangs on the belt |
| `draco/` | Decoder for the compressed conveyor scene |
| `assets/` | Hanger and room images |

All paths are relative to `cmgo-store.js`, so the folder works from any address.
Optional attributes: `assets-url` (files somewhere else), `brand`.

Rebuild: `cd build && npm i && npm run build` (writes `../cmgo-store.js`). `build/` holds the component sources, copied from the Cmgo Showroom artifact.

Belt garments draped in Marvelous Designer are one GLB each (listed under `extraGlbs` in `conveyor-catalogue.json`).
