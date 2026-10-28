// <cmgo-store>: the whole store as one tag (conveyor + customiser), for Wix or any page.
// Source of the components: the Cmgo Showroom artifact (conveyor.js, configurator.js, showroom.js, cloth.js).
// Rebuild from this folder:  npm i three@0.169.0 esbuild && npx esbuild store.js --bundle --format=iife --minify --target=es2022 --outfile=../cmgo-store.js
import './conveyor.js';
import './configurator.js';
import './showroom.js';

const HERE = (() => {
  const src = document.currentScript?.src || [...document.scripts].map((s) => s.src).find((s) => /cmgo-store(\.min)?\.js/.test(s));
  try { return src ? new URL('.', src).href : ''; } catch { return ''; }
})();
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
let viewer = null;
function loadViewer(base) {
  if (customElements.get('model-viewer')) return Promise.resolve();
  viewer ??= import(`${base}model-viewer.min.js`).catch((e) => { viewer = null; throw e; });
  return viewer;
}
function loadFonts() {
  if (document.querySelector('link[data-cmgo-fonts]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONTS; l.setAttribute('data-cmgo-fonts', ''); document.head.append(l);
}
const stores = new Map();
function loadStore(base) {
  if (!stores.has(base)) stores.set(base, fetch(`${base}store.json`).then((r) => { if (!r.ok) throw new Error(`store.json ${r.status}`); return r.json(); })
    .catch((e) => { stores.delete(base); throw e; }));
  return stores.get(base);
}
class CmgoStore extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    if (!this.style.display) this.style.display = 'block';
    this._boot();
  }
  async _boot() {
    const base = (this.getAttribute('assets-url') || HERE).replace(/([^/])$/, '$1/');
    const brand = this.getAttribute('brand') || 'Cmgo Design';
    loadFonts();
    try {
      const [store] = await Promise.all([loadStore(base), loadViewer(base)]);
      const products = structuredClone(store.products);
      for (const p of Object.values(products)) p.model = (Array.isArray(p.model) ? p.model : [p.model]).map((m) => new URL(m, base).href);
      globalThis.__CMGO_PRODUCTS = products;
      globalThis.__CMGO_SHOWROOM = store.showroom || [];
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      this.innerHTML = `<cmgo-conveyor brand="${esc(brand)}" assets-url="${esc(base)}"></cmgo-conveyor><cmgo-showroom brand="${esc(brand)}" assets-url="${esc(base)}assets/"></cmgo-showroom>`;
      await customElements.whenDefined('cmgo-showroom');
      const sr = this.querySelector('cmgo-showroom')?.shadowRoot;
      if (sr && !sr.querySelector('style[data-no-rail]')) {   // the conveyor is the store front: hide the showroom's own rail
        const st = document.createElement('style'); st.setAttribute('data-no-rail', ''); st.textContent = '.room{display:none!important}'; sr.append(st);
      }
      this.dispatchEvent(new CustomEvent('cmgo:ready', { bubbles: true, composed: true }));
    } catch (e) {
      console.error('[cmgo] store failed to load', e);
      this.innerHTML = `<p style="font:15px/1.5 system-ui,sans-serif;padding:24px;text-align:center;color:#555">
        The garment designer couldn't load. Please refresh, or contact us and we'll take your order directly.</p>`;
    }
  }
}
if (!customElements.get('cmgo-store')) customElements.define('cmgo-store', CmgoStore);
