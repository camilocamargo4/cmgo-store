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

Rebuild: `npx esbuild build/store.js --bundle --format=iife --minify --target=es2022 --outfile=dist/cmgo-store.js`
