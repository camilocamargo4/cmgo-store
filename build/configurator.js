/**
 * <cmgo-configurator> — the customer-facing garment configurator.
 *
 * Implements CONTRACT.md v1. Attributes in, one `design:submit` event out.
 * Knows nothing about Wix, Shopify, storage or checkout — the host page wires
 * those up by listening for the event.
 *
 *   <cmgo-configurator product-id="tee-classic"></cmgo-configurator>
 *
 * Dependency-free apart from <model-viewer>, which the host page loads. That
 * keeps the same file droppable into a Velo custom element today and a Shopify
 * Liquid section later.
 */

import { Pendulum, attachCloth } from './cloth.js';

const MM_PER_INCH = 25.4;
const MAX_TEXTURE_PX = 2048;
const HANDLE_PX = 11;

// --- helpers ----------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** glTF base colour factors are linear; CSS hex is sRGB. */
function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  return srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

/**
 * model-viewer's createTexture() builds a THREE.Texture from a URL, which takes
 * three.js's default flipY = true. Textures inside the GLB get flipY = false,
 * because glTF already puts the UV origin at top-left. Pre-flip so the two
 * conventions cancel. See CONTRACT.md §7.
 */
function flipVertically(src) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext('2d');
  g.translate(0, out.height);
  g.scale(1, -1);
  g.drawImage(src, 0, 0);
  return out;
}

/** Axis-aligned bounds of a rotated rectangle, centred on the origin. */
function rotatedExtent(w, h, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}

const CSS = `
:host {
  display:block; container-type:inline-size;
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif; color:#1b1c1e;
}
/* :host{display:block} outranks the browser's own [hidden] rule, so without this
   a hidden configurator stays on screen: the showroom keeps one per garment and
   hides the others, and the first garment kept showing over the next. */
:host([hidden]){display:none}
*{box-sizing:border-box}

/* One layout, two slots. The big slot is the surface you work on; the mini
   slot is the other one, parked beside it. Which is which is a state, not a
   structure — clicking the mini swaps them.

   The editor starts big on purpose. A customer spends almost all of their
   time dragging artwork on the flat panel and a few seconds admiring the
   result, and for a long time this had it the other way round: a 790px 3D
   preview nobody can drag anything onto, next to a 219px editing surface. */
.wrap{
  display:grid; gap:14px; align-items:stretch;
  grid-template-columns:1fr minmax(292px,352px);
  grid-template-rows:auto 1fr;
  grid-template-areas:"big mini" "big side";
}
/* min-height, not height: the big surface spans both rows, so letting it
   stretch makes the two columns end level. A fixed height left ~520px of white
   nothing under it whenever the controls ran longer, which they always do. */
.big{grid-area:big;min-height:var(--big-h,min(64vh,600px))}
.mini{grid-area:mini;height:var(--mini-h,186px);cursor:pointer}
.panel{grid-area:side;display:grid;gap:16px;align-content:start}

:host([layout="stage"]) .wrap{--big-h:min(72vh,660px)}

/* Phone: one column, the working surface first. The 3D follows it rather
   than pushing it down the page. */
@container (max-width: 760px){
  /* Listed twice on purpose: the stage rule above is an attribute selector and
     would otherwise outrank a bare .wrap here, leaving the phone with a 660px
     editor. */
  .wrap, :host([layout="stage"]) .wrap{
    grid-template-columns:1fr; grid-template-areas:"big" "mini" "side";
    --big-h:min(52vh,420px); --mini-h:148px;
  }
}

/* --- the two surfaces ---------------------------------------------------- */
.viewer,.editor{min-width:0;border-radius:12px;position:relative;overflow:hidden}
.viewer{background:var(--cmgo-stage,#f4f4f5)}
model-viewer{width:100%;height:100%;background:transparent;--poster-color:transparent}
.editor{display:grid;place-items:center;background:#eeeef1;border:1px solid #e7e7ea}
.editor canvas{display:block;touch-action:none;cursor:grab;box-shadow:0 2px 14px rgba(0,0,0,.11)}
.editor canvas.dragging{cursor:grabbing}
.editor.big.sheet{place-items:start center;padding-top:12px}
.empty{
  position:absolute;inset:0;display:grid;place-content:center;text-align:center;
  color:#6f6f76;font-size:13px;pointer-events:none;padding:20px;
  background:rgba(250,250,250,.84);backdrop-filter:blur(1px);
}

/* The parked surface is a button, not a workspace: no dragging, no orbiting,
   one job — come to the front. */
.mini{border:1px solid #e7e7ea}
.mini canvas,.mini model-viewer{pointer-events:none}
.mini .empty{font-size:11px}
.swap{
  position:absolute;inset:auto 0 0 0;display:flex;align-items:center;gap:6px;
  padding:7px 10px;border:0;width:100%;text-align:left;font:inherit;font-size:11px;
  letter-spacing:.05em;text-transform:uppercase;color:#fff;cursor:pointer;
  background:linear-gradient(transparent,rgba(12,12,14,.72) 46%);
}
.swap svg{width:12px;height:12px;flex:none}
.mini:hover .swap{background:linear-gradient(transparent,rgba(12,12,14,.86) 40%)}
.big .swap{display:none}

/* --- controls ------------------------------------------------------------ */
h4{
  margin:0 0 9px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;
  color:#77777e;font-weight:600;display:flex;align-items:center;gap:7px;
}
/* Numbers instead of five equal headings. The order was always there; it was
   just never said out loud, so nothing told a first-timer that the artwork
   lands on the panel they picked two headings ago. */
h4 i{
  font-style:normal;display:grid;place-items:center;flex:none;
  width:16px;height:16px;border-radius:50%;background:#1b1c1e;color:#fff;
  font-size:9px;font-weight:700;letter-spacing:0;
}
h4 small{margin-left:auto;text-transform:none;letter-spacing:0;font-size:11px;
         color:#a0a0a7;font-weight:400}

.swatches{display:flex;gap:8px;flex-wrap:wrap}
.sw{width:30px;height:30px;border-radius:50%;border:1px solid #d4d4d8;cursor:pointer;padding:0}
.sw[aria-pressed="true"]{outline:2px solid #1b1c1e;outline-offset:2px}

/* The pattern sheet: every print area at once, at TRUE relative scale.
   A sleeve print really is a fifth the size of a chest print, and showing them
   the same size would flatter the layout while misleading the customer. */
.pattern{display:flex;align-items:flex-end;gap:6px;flex-wrap:wrap}
.area{
  display:grid;justify-items:center;gap:5px;
  min-width:46px;padding:7px 5px 6px;
  border:1px solid #e4e4e7;border-radius:8px;background:#fff;
  cursor:pointer;font:inherit;color:inherit;
}
.area:hover{border-color:#b6b6bd}
.area[aria-pressed="true"]{border-color:#1b1c1e;box-shadow:inset 0 0 0 1px #1b1c1e}
.area canvas{display:block;border-radius:2px}
.area .nm{font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:#8a8a90;line-height:1}
.area[aria-pressed="true"] .nm{color:#1b1c1e;font-weight:600}
.area .mm{font-size:8px;color:#a3a3a9;font-variant-numeric:tabular-nums;line-height:1}

.btn{width:100%;padding:10px;border:1px solid #d4d4d8;border-radius:7px;background:#fff;cursor:pointer;font:inherit;font-size:13px}
.btn:hover:not(:disabled){border-color:#1b1c1e}
.btn:disabled{opacity:.45;cursor:default}
.btn.primary{background:#1b1c1e;color:#fff;border-color:#1b1c1e;padding:12px}
.btn.danger{color:#b4232a;border-color:#f0d0d2}
.btnrow{display:flex;gap:6px}
.btnrow .btn.danger{width:auto;flex:none;padding-inline:14px}

/* Sizes flow instead of sitting in a fixed four-wide grid: seven sizes left an
   orphan row of three, and a one-size cap left a single lonely box. */
.sizes{display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:6px}
.sizes label{display:grid;gap:3px;font-size:11px;color:#77777e;text-align:center}
.sizes input{width:100%;padding:6px 4px;border:1px solid #e4e4e7;border-radius:5px;font:inherit;text-align:center}
.sizes input:not(:placeholder-shown){border-color:#1b1c1e;font-weight:600;color:#1b1c1e}
.details{display:grid;gap:6px}
.details label{display:grid;gap:3px;font-size:11px;color:#77777e}
.details input{width:100%;padding:8px;border:1px solid #e4e4e7;border-radius:7px;font:inherit;font-size:13px;color:#1b1c1e}
.details input[aria-invalid="true"]{border-color:#c0392b}
.details .row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.details small{font-size:11px;color:#9a9aa0}
textarea{width:100%;min-height:58px;padding:8px;border:1px solid #e4e4e7;border-radius:7px;font:inherit;font-size:13px;resize:vertical}

.meta{font-size:11.5px;color:#77777e;line-height:1.7}
.meta b{color:#1b1c1e;font-weight:600}
.meta dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}
.meta dt{color:#a0a0a7}
.meta dd{margin:0;color:#1b1c1e;font-variant-numeric:tabular-nums}

/* Resolution decides whether the order can be printed at all, so it stops
   being one grey line among several and says so. */
.alert{
  display:flex;gap:8px;align-items:flex-start;margin-top:8px;
  padding:8px 10px;border-radius:7px;font-size:11.5px;line-height:1.5;
}
.alert b{font-weight:600}
.alert.bad{background:#fdf1f1;border:1px solid #f3d3d5;color:#8f1d24}
.alert.warn{background:#fdf7ec;border:1px solid #f0e0c4;color:#7a5410}
.alert.ok{background:#f2f8f3;border:1px solid #d6e8da;color:#2f5d3c}
.alert svg{width:13px;height:13px;flex:none;margin-top:1px}
input[type=file]{display:none}
`;

// --- component --------------------------------------------------------------

class CmgoConfigurator extends HTMLElement {
  static observedAttributes = ['product-id', 'initial-colour', 'initial-area', 'catalogue-url', 'model-url'];

  #product = null;
  #colour = null;
  #areaId = null;
  #placements = new Map(); // areaId -> { img, file, xMm, yMm, widthMm, heightMm, rotationDeg }
  #sizes = {};
  // Kept outside the panel's DOM: the panel is repainted on every area change.
  #customer = { name: '', email: '', phone: '' };
  #notes = '';
  #urls = [];
  #drag = null;
  #ready = false;
  #cloth = null;
  #clothStop = null;
  #patternTicket = 0;    // newest pattern texture wins; slower older ones are dropped

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.#render();
    this.#load();
  }

  disconnectedCallback() {
    this.#clothStop?.();
    this.#urls.forEach(URL.revokeObjectURL);
    this.#urls = [];
  }

  attributeChangedCallback(name) {
    if (name === 'product-id' && this.#ready) this.#load();
  }

  // -- data ------------------------------------------------------------------

  get #catalogue() {
    return this.getAttribute('catalogue-url') || 'https://cdn.cmgo.design/products/';
  }

  async #load() {
    const id = this.getAttribute('product-id');
    if (!id) return this.#fail('No product-id set.');

    // A host page may supply the catalogue inline. The hosted demo does that,
    // because it has no server to fetch from.
    const inline = globalThis.__CMGO_PRODUCTS?.[id];
    if (inline) {
      this.#product = inline;
    } else {
      try {
        const base = this.#catalogue.endsWith('/') ? this.#catalogue : this.#catalogue + '/';
        const res = await fetch(`${base}${id}.json`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        this.#product = await res.json();
      } catch (err) {
        return this.#fail(`Could not load product "${id}": ${err.message}`);
      }
    }

    const p = this.#product;
    const wanted = this.getAttribute('initial-colour');
    this.#colour = p.colours.find((c) => c.hex.toLowerCase() === (wanted || '').toLowerCase()) || p.colours[0];

    const area = this.getAttribute('initial-area');
    this.#areaId = p.printAreas.some((a) => a.id === area) ? area : p.printAreas[0].id;

    this.#sizes = {};
    this.#ready = true;

    this.#paintPanel();
    const mv = this.shadowRoot.querySelector('model-viewer');
    // model-url lets the dev harness point at a local file without editing
    // the product JSON, which keeps its production CDN URL.
    // The catalogue may list several routes to the same model; the first that
    // loads wins. See showroom.js for why a single source is a bet.
    const candidates = this.getAttribute('model-url')
      ? [this.getAttribute('model-url')]
      : (Array.isArray(p.model) ? p.model.slice() : [p.model]);
    const tryNext = () => {
      const next = candidates.shift();
      if (next === undefined) return;
      mv.src = typeof next === 'function' ? next() : next;
    };
    mv.addEventListener('error', tryNext);
    tryNext();
    mv.addEventListener('load', () => { this.#applyAll(); this.#dressCloth(mv); }, { once: true });
    this.#layoutEditor();
  }

  /**
   * Cloth movement on the 3D preview.
   *
   * There is no hanger here to rotate, so the shader swings the garment about
   * its own shoulder line as well as trailing the hem — that is what `body`
   * switches on. Moving the cursor across the preview disturbs it; gravity and
   * friction bring it back to EXACTLY zero, which matters because this is the
   * view a customer reads a print position off. A preview that never quite
   * settles is a preview that quietly lies about where their design sits.
   *
   * Hovering sways it, dragging orbits the camera. Pushing on a held pointer
   * would fight model-viewer's own controls for the same gesture.
   */
  #dressCloth(mv) {
    this.#clothStop?.();
    this.#cloth = null;

    if (this.#product?.cloth === false) return;      // a cap is not cloth
    const cloth = attachCloth(mv, { body: true });
    if (!cloth.ok) return;
    this.#cloth = cloth;

    const mm = this.#product?.modelReference?.heightMm ?? 700;
    const pend = new Pendulum({ length: Math.max(mm / 700, 0.25), max: 0.14 });

    let raf = 0, last = 0, px = null, pt = 0, tail = 0;
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      pend.advance(dt);
      // Snap to exact zero the moment the motion is below notice, then keep
      // asking for frames a little longer. Stopping the loop in the same tick
      // that sets zero means the zero frame is never drawn, and the garment
      // parks about half a pixel off true rest — which is a promise broken in
      // the one view where the customer is reading millimetres.
      if (!pend.alive) pend.rest();
      cloth.set(pend.a, pend.v, now / 1000);
      if (pend.alive) { tail = 3; raf = requestAnimationFrame(step); }
      else if (tail-- > 0) { raf = requestAnimationFrame(step); }
      else { raf = 0; }
    };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); } };

    const onMove = (e) => {
      if (e.buttons) { px = null; return; }          // they are orbiting, not brushing past
      const now = performance.now();
      if (px !== null && now > pt) {
        const vx = (e.clientX - px) / (now - pt);
        if (Math.abs(vx) > 0.02) { pend.push(vx * 0.22, 1.6); start(); }
      }
      px = e.clientX; pt = now;
    };
    const onLeave = () => { px = null; };

    mv.addEventListener('pointermove', onMove, { passive: true });
    mv.addEventListener('pointerleave', onLeave, { passive: true });

    this.#clothStop = () => {
      if (raf) cancelAnimationFrame(raf);
      mv.removeEventListener('pointermove', onMove);
      mv.removeEventListener('pointerleave', onLeave);
      cloth.dispose();
    };
  }

  #fail(msg) {
    this.shadowRoot.querySelector('.panel').innerHTML = `<p class="bad">${msg}</p>`;
  }

  get #area() {
    return this.#product?.printAreas.find((a) => a.id === this.#areaId);
  }

  // -- rendering -------------------------------------------------------------

  #render() {
    const swap = (label) => `
      <button class="swap" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 8h13l-3-3m3 3-3 3M20 16H7l3-3m-3 3 3 3"/>
        </svg>${label}</button>`;

    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="wrap">
        <div class="editor big">
          <canvas></canvas>
          <div class="empty">Choose a print area, then add your artwork</div>
          ${swap('Design')}
        </div>
        <div class="viewer mini">
          <model-viewer camera-controls touch-action="pan-y" shadow-intensity="0.5"
                        exposure="1.05" environment-image="neutral"
                        interaction-prompt="none"></model-viewer>
          ${swap('3D preview')}
        </div>
        <div class="panel"></div>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">
    `;

    const cv = this.shadowRoot.querySelector('.editor canvas');
    cv.addEventListener('pointerdown', (e) => this.#onDown(e));
    cv.addEventListener('pointermove', (e) => this.#onMove(e));
    cv.addEventListener('pointerup', (e) => this.#onUp(e));
    cv.addEventListener('pointercancel', (e) => this.#onUp(e));

    // Either parked surface comes to the front when clicked. The whole tile is
    // the target, not just the little button on it — a 186px preview is an
    // awkward thing to hit precisely, and there is nothing else it could mean.
    this.shadowRoot.querySelectorAll('.editor,.viewer').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.classList.contains('mini')) this.#swap();
      });
    });

    this.shadowRoot.querySelector('input[type=file]')
      .addEventListener('change', (e) => this.#onFile(e));

    new ResizeObserver(() => this.#layoutEditor()).observe(this.shadowRoot.querySelector('.editor'));
  }

  /** Trade the two surfaces between the big slot and the parked one. */
  #swap() {
    this.shadowRoot.querySelectorAll('.editor,.viewer').forEach((el) => {
      el.classList.toggle('big');
      el.classList.toggle('mini');
    });
    this.#layoutEditor();
  }

  #paintPanel() {
    const p = this.#product;
    const panel = this.shadowRoot.querySelector('.panel');
    const has = (id) => this.#placements.has(id);
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const c = this.#customer;

    panel.innerHTML = `
      <div>
        <h4><i>1</i>Colour</h4>
        <div class="swatches">${p.colours.map((c) => `
          <button class="sw" data-hex="${c.hex}" title="${c.name}"
                  style="background:${c.hex}" aria-pressed="${c.hex === this.#colour.hex}"></button>`).join('')}</div>
      </div>
      <div>
        <h4><i>2</i>Panel<small>${p.printAreas.length} available</small></h4>
        <div class="pattern">${p.printAreas.map((a) => `
          <button class="area" data-id="${a.id}" aria-pressed="${a.id === this.#areaId}"
                  title="${a.label} — ${a.pressable.widthMm} × ${a.pressable.heightMm} mm">
            <canvas data-panel="${a.id}"></canvas>
            <span class="nm">${a.label.replace(/^(Left|Right) sleeve$/, '$1 slv')}</span>
            <span class="mm">${a.pressable.widthMm}×${a.pressable.heightMm}</span>
          </button>`).join('')}</div>
      </div>
      <div>
        <h4><i>3</i>Artwork<small>${this.#area.label}</small></h4>
        <div class="btnrow">
          <button class="btn" data-act="upload">${has(this.#areaId) ? 'Replace artwork' : 'Add artwork'}</button>
          ${has(this.#areaId) ? `<button class="btn danger" data-act="remove">Remove</button>` : ''}
        </div>
        <div class="meta" data-meta></div>
      </div>
      <div>
        <h4><i>4</i>Quantity<small>per size</small></h4>
        <div class="sizes">${p.sizes.map((s) => `
          <label>${s}<input type="number" min="0" step="1" placeholder="0"
                            data-size="${s}" value="${this.#sizes[s] ?? ''}"></label>`).join('')}</div>
      </div>
      <div>
        <h4><i>5</i>Your details<small>for your quote</small></h4>
        <div class="details">
          <label>Name<input data-cust="name" autocomplete="name" maxlength="80" value="${esc(c.name)}"></label>
          <div class="row">
            <label>Email<input data-cust="email" type="email" autocomplete="email" maxlength="120" value="${esc(c.email)}"></label>
            <label>Phone <small>(optional)</small><input data-cust="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(c.phone)}"></label>
          </div>
        </div>
      </div>
      <div>
        <h4>Notes</h4>
        <textarea placeholder="Anything we should know?" maxlength="2000">${esc(this.#notes)}</textarea>
      </div>
      <button class="btn primary" data-act="submit">Submit for a quote</button>
    `;

    this.#drawPattern();
    panel.querySelectorAll('.sw').forEach((b) => b.onclick = () => this.#setColour(b.dataset.hex));
    panel.querySelectorAll('.area').forEach((b) => b.onclick = () => this.#setArea(b.dataset.id));
    panel.querySelectorAll('input[data-size]').forEach((i) => i.oninput = () => {
      const n = parseInt(i.value, 10);
      if (n > 0) this.#sizes[i.dataset.size] = n; else delete this.#sizes[i.dataset.size];
    });
    panel.querySelectorAll('input[data-cust]').forEach((i) => i.oninput = () => {
      this.#customer[i.dataset.cust] = i.value;
      i.removeAttribute('aria-invalid');
    });
    panel.querySelector('textarea').oninput = (e) => { this.#notes = e.target.value; };
    panel.querySelector('[data-act="upload"]').onclick = () =>
      this.shadowRoot.querySelector('input[type=file]').click();
    panel.querySelector('[data-act="remove"]')?.addEventListener('click', () => this.#remove());
    panel.querySelector('[data-act="submit"]').onclick = () => this.#submit();

    this.#paintMeta();
  }

  /**
   * Draw every print area as a little pattern piece, sized against the largest
   * one so the proportions are truthful, with whatever artwork is on it.
   * The customer sees the whole garment's design without changing mode.
   */
  #drawPattern() {
    const areas = this.#product?.printAreas ?? [];
    if (!areas.length) return;
    const boxes = areas.map((a) => this.#stage(a, true));
    const biggest = Math.max(...boxes.map((b) => Math.max(b.w, b.h)));
    const MAX_PX = 78;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    areas.forEach((a, i) => {
      const cv = this.shadowRoot.querySelector(`canvas[data-panel="${a.id}"]`);
      if (!cv) return;
      const st = boxes[i];
      const k = MAX_PX / biggest;
      const w = Math.max(12, st.w * k);
      const h = Math.max(12, st.h * k);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;

      const g = cv.getContext('2d');
      const s = cv.width / st.w;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.translate(-st.x * s, -st.y * s);

      const out = a.outline;
      if (out && out.length > 3) {
        g.beginPath();
        g.moveTo(out[0][0] * s, out[0][1] * s);
        for (let j = 1; j < out.length; j++) g.lineTo(out[j][0] * s, out[j][1] * s);
        g.closePath();
        g.fillStyle = this.#colour.hex;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,.34)';
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.fillStyle = this.#colour.hex;
        g.fillRect(0, 0, a.pressable.widthMm * s, a.pressable.heightMm * s);
        g.strokeStyle = 'rgba(0,0,0,.30)';
        g.strokeRect(0.5, 0.5, a.pressable.widthMm * s - 1, a.pressable.heightMm * s - 1);
      }

      const pl = this.#placements.get(a.id);
      if (pl) {
        g.save();
        g.translate(pl.xMm * s, pl.yMm * s);
        g.rotate((pl.rotationDeg * Math.PI) / 180);
        g.drawImage(pl.img, (-pl.widthMm / 2) * s, (-pl.heightMm / 2) * s,
                    pl.widthMm * s, pl.heightMm * s);
        g.restore();
      } else if (a.guide) {
        g.strokeStyle = this.#isDark(this.#colour.hex) ? 'rgba(255,255,255,.40)' : 'rgba(0,0,0,.26)';
        g.setLineDash([3, 3]);
        g.lineWidth = 1;
        g.strokeRect((a.pressable.widthMm - a.guide.widthMm) / 2 * s, a.guide.offsetYMm * s,
                     a.guide.widthMm * s, a.guide.heightMm * s);
        g.setLineDash([]);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    });
  }

  #paintMeta() {
    const el = this.shadowRoot.querySelector('[data-meta]');
    if (!el) return;
    const a = this.#area;
    const pl = this.#placements.get(this.#areaId);

    if (!pl) {
      el.innerHTML = `<dl>
        <dt>Printable</dt><dd>${a.pressable.widthMm} × ${a.pressable.heightMm} mm</dd>
        <dt>Method</dt><dd>${a.method}</dd></dl>`;
      return;
    }

    const dpi = pl.img.naturalWidth / (pl.widthMm / MM_PER_INCH);
    const [kind, note] = dpi < a.minDpi
      ? ['bad', `Too low to print — we need ${a.minDpi} DPI at this size. Scale it down, or send a bigger file.`]
      : dpi < a.recommendedDpi
        ? ['warn', `Usable, a little soft. ${a.recommendedDpi} DPI at this size would be crisp.`]
        : ['ok', 'Sharp at this size.'];

    const icon = kind === 'ok'
      ? '<path d="M20 6 9 17l-5-5"/>'
      : '<path d="M12 8v5"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>';

    el.innerHTML = `
      <dl>
        <dt>Size</dt><dd>${pl.widthMm.toFixed(0)} × ${pl.heightMm.toFixed(0)} mm</dd>
        <dt>Centre</dt><dd>${pl.xMm.toFixed(0)}, ${pl.yMm.toFixed(0)} mm${
          pl.rotationDeg ? ` · ${pl.rotationDeg.toFixed(0)}°` : ''}</dd>
      </dl>
      <div class="alert ${kind}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
        <span><b>${dpi.toFixed(0)} DPI.</b> ${note}</span>
      </div>`;
  }

  // -- editor geometry -------------------------------------------------------

  /** Scale between the visible editor canvas and millimetres. */
  /**
   * The visible area, in millimetres of print-area space.
   *
   * The editor used to BE the pressable rectangle: the canvas and the printable
   * area were the same thing. Now the garment's own outline is drawn around it,
   * traced from the model by tools/make_guides.py, so the canvas has to cover
   * whichever is bigger — and the outline is bigger, because a garment is
   * larger than the part of it you may print on.
   *
   * Nothing about the coordinate system changes. The origin is still the
   * top-left of the pressable rectangle, x right, y down, millimetres, exactly
   * as CONTRACT.md §2 says and exactly as every stored placement records it.
   * Only where that origin lands on the canvas has moved.
   */
  #stage(a = this.#area, local = false) {
    // Pattern products: the editor shows the whole flat pattern sheet, expressed in the
    // active area's millimetres (origin still the pressable top-left, CONTRACT.md §2).
    const P = this.#product?.pattern;
    // focus: 'piece' frames ONE pattern piece at a time (its outline is the area's outline),
    // so it falls through to the per-area framing below instead of the whole sheet.
    if (P && a.patternOrigin && !local && P.focus !== 'piece') {
      const [W, H] = P.sheetMm, m = Math.max(W, H) * 0.02;
      return { x: -a.patternOrigin.xMm - m, y: -a.patternOrigin.yMm - m, w: W + 2 * m, h: H + 2 * m };
    }
    const pw = a.pressable.widthMm, ph = a.pressable.heightMm;
    let x0 = 0, y0 = 0, x1 = pw, y1 = ph;
    for (const [x, y] of a.outline ?? []) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const m = Math.max(x1 - x0, y1 - y0) * 0.03;
    // a focused pattern piece gets a strip under the hem for its label
    const foot = P?.focus === 'piece' && !local ? Math.max(x1 - x0, y1 - y0) * 0.06 : 0;
    return { x: x0 - m, y: y0 - m, w: (x1 - x0) + 2 * m, h: (y1 - y0) + 2 * m + foot };
  }

  #view() {
    const a = this.#area;
    const cv = this.shadowRoot.querySelector('.editor canvas');
    const st = this.#stage(a);
    return { cv, s: cv.width / st.w, a, st };
  }

  /**
   * Fit the print area inside the editor box on BOTH axes. A front panel is
   * 306 x 508mm — portrait — so sizing by width alone makes it tower over
   * everything else on the page.
   */
  #layoutEditor() {
    if (!this.#ready) return;
    const a = this.#area;
    const box = this.shadowRoot.querySelector('.editor');
    const cv = this.shadowRoot.querySelector('.editor canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const st = this.#stage(a);
    // A pattern sheet is landscape: keep it in view at the top of a tall editor column.
    const sheet = !!this.#product.pattern && box.classList.contains('big');   // pinned to the top, in view
    box.classList.toggle('sheet', sheet);
    const availW = (box.clientWidth || 440) - 24;
    // A pattern product (sheet or one piece) is kept inside the window: a 750 mm front panel
    // laid out by width alone runs off the bottom of the card.
    const availH = (this.#product.pattern ? Math.min(box.clientHeight || 460, window.innerHeight * 0.72) : (box.clientHeight || 460)) - 24;
    const k = Math.min(availW / st.w, availH / st.h);

    const cssW = Math.max(120, st.w * k);
    const cssH = Math.max(120, st.h * k);

    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;
    this.#drawEditor();
  }

  #toMm(ev) {
    const { cv, s, st } = this.#view();
    const r = cv.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) * (cv.width / r.width)) / s + st.x,
      y: ((ev.clientY - r.top) * (cv.height / r.height)) / s + st.y,
    };
  }

  /** Handle positions in mm for the current placement. */
  #handles(pl) {
    const r = (pl.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const local = (dx, dy) => ({
      x: pl.xMm + dx * cos - dy * sin,
      y: pl.yMm + dx * sin + dy * cos,
    });
    return {
      scale: local(pl.widthMm / 2, pl.heightMm / 2),
      rotate: local(0, -pl.heightMm / 2 - 18),
    };
  }

  // -- drawing ---------------------------------------------------------------

  /** Artwork only, at print resolution. This is what becomes the 3D texture. */
  #artCanvas() {
    const a = this.#area;
    const px = Math.min(MAX_TEXTURE_PX / Math.max(a.pressable.widthMm, a.pressable.heightMm), 6);
    const c = document.createElement('canvas');
    c.width = Math.round(a.pressable.widthMm * px);
    c.height = Math.round(a.pressable.heightMm * px);
    const g = c.getContext('2d');

    // No background fill. The print panel sits above the fabric, so leaving
    // this transparent lets the garment's own colour and shading show through
    // — the print reads as ink on cloth rather than a sticker.
    const pl = this.#placements.get(this.#areaId);
    if (pl) {
      g.save();
      g.translate(pl.xMm * px, pl.yMm * px);
      g.rotate((pl.rotationDeg * Math.PI) / 180);
      g.drawImage(pl.img, (-pl.widthMm / 2) * px, (-pl.heightMm / 2) * px,
                  pl.widthMm * px, pl.heightMm * px);
      g.restore();
    }
    return c;
  }

  /**
   * The visible editor. Artwork is drawn from the same numbers as #artCanvas,
   * then the chrome goes on top — ruler, guide, handles. The chrome lives only
   * here and never reaches the texture or the print file. CONTRACT.md §2.
   */
  #drawEditor() {
    const { cv, s, a, st } = this.#view();
    const g = cv.getContext('2d');
    const pl = this.#placements.get(this.#areaId);
    const pw = a.pressable.widthMm, ph = a.pressable.heightMm;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    // everything below is drawn in print-area millimetres
    g.translate(-st.x * s, -st.y * s);

    const dark = this.#isDark(this.#colour.hex);
    const ink = dark ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.42)';
    const faint = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.10)';

    // --- the garment ------------------------------------------------------
    const outline = a.outline;
    if (this.#product.pattern && a.patternOrigin) {
      this.#drawSheet(g, s, a, dark);
    } else if (outline && outline.length > 3) {
      g.beginPath();
      g.moveTo(outline[0][0] * s, outline[0][1] * s);
      for (let i = 1; i < outline.length; i++) g.lineTo(outline[i][0] * s, outline[i][1] * s);
      g.closePath();
      g.fillStyle = this.#colour.hex;
      g.fill();
      g.strokeStyle = dark ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.30)';
      g.lineWidth = 1.25;
      g.stroke();
    } else {
      g.fillStyle = this.#colour.hex;
      g.fillRect(0, 0, pw * s, ph * s);
    }

    // --- the artwork ------------------------------------------------------
    if (pl) {
      g.save();
      g.translate(pl.xMm * s, pl.yMm * s);
      g.rotate((pl.rotationDeg * Math.PI) / 180);
      g.drawImage(pl.img, (-pl.widthMm / 2) * s, (-pl.heightMm / 2) * s,
                  pl.widthMm * s, pl.heightMm * s);
      g.restore();
    }

    // --- the printable area, and only it ----------------------------------
    g.strokeStyle = faint;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= pw; x += 10) { g.moveTo(x * s, 0); g.lineTo(x * s, ph * s); }
    for (let y = 0; y <= ph; y += 10) { g.moveTo(0, y * s); g.lineTo(pw * s, y * s); }
    g.stroke();

    g.strokeStyle = ink;
    g.globalAlpha = 0.55;
    g.lineWidth = 1;
    g.strokeRect(0, 0, pw * s, ph * s);
    g.globalAlpha = 1;

    g.fillStyle = ink;
    g.font = `${Math.max(9, 11 * (cv.width / 520))}px ui-monospace,monospace`;
    g.textBaseline = 'top';
    g.globalAlpha = 0.7;
    for (let x = 50; x < pw; x += 50) g.fillText(`${x}`, x * s + 3, 3);
    g.globalAlpha = 1;

    if (a.guide) {
      const gw = a.guide.widthMm * s;
      const gh = a.guide.heightMm * s;
      const gx = (pw * s - gw) / 2;
      const gy = a.guide.offsetYMm * s;
      g.strokeStyle = ink;
      g.setLineDash([6, 4]);
      g.lineWidth = 1.5;
      g.strokeRect(gx, gy, gw, gh);
      g.setLineDash([]);
      g.fillText(a.guide.label, gx + 4, gy + 4);
    }

    if (pl) this.#drawHandles(g, pl, s);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * The flat pattern: every piece at true size, side by side, the way the garment is cut.
   * Drawn in sheet millimetres, then shifted so the active area's pressable top-left stays
   * the origin. Other areas show their print box and artwork faintly; click one to edit it.
   */
  #drawSheet(g, s, a, dark) {
    const P = this.#product.pattern, o = a.patternOrigin;
    const focus = P.focus === 'piece';
    g.save();
    g.translate(-o.xMm * s, -o.yMm * s);
    for (const pc of P.pieces) {
      if (focus && pc.id !== a.piece) continue;     // one piece at a time: only the one being printed
      const out = pc.outline;
      g.beginPath();
      g.moveTo(out[0][0] * s, out[0][1] * s);
      for (let i = 1; i < out.length; i++) g.lineTo(out[i][0] * s, out[i][1] * s);
      g.closePath();
      g.fillStyle = this.#colour.hex;
      g.fill();
      g.strokeStyle = dark ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.30)';
      g.lineWidth = 1.25;
      g.stroke();
      let cx = 0, maxY = -Infinity;
      for (const [x, y] of out) { cx += x; if (y > maxY) maxY = y; }
      cx /= out.length;
      if (focus) continue;               // the focused piece is labelled once, below
      g.fillStyle = 'rgba(0,0,0,.42)';   // sits on the editor background, not the cloth
      g.font = `600 ${Math.max(10, 13 * s)}px Archivo, ui-sans-serif, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(pc.label, cx * s, (maxY + 16) * s);
      g.textAlign = 'start';
    }
    for (const b of this.#product.printAreas) {
      if (b.id === a.id || !b.patternOrigin || (focus && b.piece !== a.piece)) continue;
      g.save();
      g.translate(b.patternOrigin.xMm * s, b.patternOrigin.yMm * s);
      g.strokeStyle = dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.16)';
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      g.strokeRect(0, 0, b.pressable.widthMm * s, b.pressable.heightMm * s);
      g.setLineDash([]);
      const pl = this.#placements.get(b.id);
      if (pl) {
        g.globalAlpha = 0.85;
        g.translate(pl.xMm * s, pl.yMm * s);
        g.rotate((pl.rotationDeg * Math.PI) / 180);
        g.drawImage(pl.img, (-pl.widthMm / 2) * s, (-pl.heightMm / 2) * s, pl.widthMm * s, pl.heightMm * s);
      }
      g.restore();
    }
    g.restore();
    if (focus) {
      // Name the piece and its true size in the corner of the board, the way a pattern
      // piece is labelled on the cutting table. Drawn in the area's mm frame.
      const pc = P.pieces.find((q) => q.id === a.piece);
      const st = this.#stage(a);
      if (pc) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y] of pc.outline) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        g.fillStyle = 'rgba(0,0,0,.46)';
        g.font = `600 ${Math.max(11, 12 * (g.canvas.width / 560))}px Archivo, ui-sans-serif, system-ui, sans-serif`;
        g.textBaseline = 'bottom';
        g.textAlign = 'center';
        g.fillText(`${pc.label}  ·  ${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} mm pattern piece`,
                   (st.x + st.w / 2) * s, (st.y + st.h) * s - 6);
        g.textAlign = 'start';
      }
    }
  }

  /** Which print area's piece is under this point (given in the active area's mm)? */
  #areaAt(m) {
    const a = this.#area;
    if (!a?.patternOrigin) return null;
    const sx = m.x + a.patternOrigin.xMm, sy = m.y + a.patternOrigin.yMm;
    for (const b of this.#product.printAreas) {
      if (!b.patternOrigin || !b.outline) continue;
      const x = sx - b.patternOrigin.xMm, y = sy - b.patternOrigin.yMm, poly = b.outline;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return b.id;
    }
    return null;
  }

  #drawHandles(g, pl, s) {
    const h = this.#handles(pl);
    g.save();
    g.translate(pl.xMm * s, pl.yMm * s);
    g.rotate((pl.rotationDeg * Math.PI) / 180);
    g.strokeStyle = '#2563eb';
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.strokeRect((-pl.widthMm / 2) * s, (-pl.heightMm / 2) * s, pl.widthMm * s, pl.heightMm * s);
    g.setLineDash([]);
    g.restore();

    for (const [kind, pt] of Object.entries(h)) {
      g.beginPath();
      g.arc(pt.x * s, pt.y * s, HANDLE_PX / 2, 0, Math.PI * 2);
      g.fillStyle = kind === 'rotate' ? '#fff' : '#2563eb';
      g.strokeStyle = '#2563eb';
      g.lineWidth = 2;
      g.fill();
      g.stroke();
    }
  }

  #isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, gg, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.2126 * r + 0.7152 * gg + 0.0722 * b) < 128;
  }

  // -- interaction -----------------------------------------------------------

  #onDown(ev) {
    const pl = this.#placements.get(this.#areaId);
    if (this.#product?.pattern) {
      const m0 = this.#toMm(ev);
      const hit = this.#areaAt(m0);
      if (hit && hit !== this.#areaId && !(pl && this.#inside(pl, m0))) { this.#setArea(hit); return; }
    }
    if (!pl) return;
    const m = this.#toMm(ev);
    const { s } = this.#view();
    const near = (pt) => Math.hypot(m.x - pt.x, m.y - pt.y) * s < HANDLE_PX;
    const h = this.#handles(pl);

    let mode = null;
    if (near(h.rotate)) mode = 'rotate';
    else if (near(h.scale)) mode = 'scale';
    else if (this.#inside(pl, m)) mode = 'move';
    if (!mode) return;

    ev.target.setPointerCapture(ev.pointerId);
    ev.target.classList.add('dragging');
    this.#drag = {
      mode, m0: m,
      x0: pl.xMm, y0: pl.yMm, w0: pl.widthMm, h0: pl.heightMm, r0: pl.rotationDeg,
      d0: Math.hypot(m.x - pl.xMm, m.y - pl.yMm),
      a0: Math.atan2(m.y - pl.yMm, m.x - pl.xMm),
    };
  }

  #inside(pl, m) {
    const r = (-pl.rotationDeg * Math.PI) / 180;
    const dx = m.x - pl.xMm, dy = m.y - pl.yMm;
    const lx = dx * Math.cos(r) - dy * Math.sin(r);
    const ly = dx * Math.sin(r) + dy * Math.cos(r);
    return Math.abs(lx) <= pl.widthMm / 2 && Math.abs(ly) <= pl.heightMm / 2;
  }

  #onMove(ev) {
    if (!this.#drag) return;
    const pl = this.#placements.get(this.#areaId);
    const d = this.#drag;
    const m = this.#toMm(ev);

    if (d.mode === 'move') {
      pl.xMm = d.x0 + (m.x - d.m0.x);
      pl.yMm = d.y0 + (m.y - d.m0.y);
    } else if (d.mode === 'scale') {
      const k = Math.hypot(m.x - pl.xMm, m.y - pl.yMm) / (d.d0 || 1);
      const ar = d.h0 / d.w0;
      pl.widthMm = clamp(d.w0 * k, 10, this.#area.pressable.widthMm);
      pl.heightMm = pl.widthMm * ar;           // aspect ratio is never broken
    } else {
      const da = Math.atan2(m.y - pl.yMm, m.x - pl.xMm) - d.a0;
      let deg = d.r0 + (da * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      pl.rotationDeg = ((deg % 360) + 360) % 360;
    }

    this.#constrain(pl);
    this.#drawEditor();
    this.#paintMeta();
    this.#drawPattern();
  }

  #onUp(ev) {
    if (!this.#drag) return;
    this.#drag = null;
    ev.target.classList.remove('dragging');
    ev.target.releasePointerCapture?.(ev.pointerId);
    // Deliberately deferred to the end of the gesture. Rebuilding a PNG and
    // re-uploading a WebGL texture on every pointermove makes dragging stutter,
    // badly so on a phone. The 2D editor already gives live feedback.
    this.#pushTexture();
  }

  /** Artwork may not leave the pressable area. CONTRACT.md §3. */
  #constrain(pl) {
    const p = this.#area.pressable;
    const e = rotatedExtent(pl.widthMm, pl.heightMm, pl.rotationDeg);
    if (e.w > p.widthMm || e.h > p.heightMm) {
      const k = Math.min(p.widthMm / e.w, p.heightMm / e.h);
      pl.widthMm *= k;
      pl.heightMm *= k;
    }
    const f = rotatedExtent(pl.widthMm, pl.heightMm, pl.rotationDeg);
    pl.xMm = clamp(pl.xMm, f.w / 2, p.widthMm - f.w / 2);
    pl.yMm = clamp(pl.yMm, f.h / 2, p.heightMm - f.h / 2);
  }

  // -- artwork ---------------------------------------------------------------

  async #onFile(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;

    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!ok.includes(file.type)) return this.#notify('Use a PNG, JPEG, WEBP or SVG.', true);
    // 25 MB is the store's upload ceiling (Wix's Media Manager limit for images).
    if (file.size > 25 * 1024 * 1024) return this.#notify('That file is over 25 MB. Export it smaller, or email it to us.', true);

    const url = URL.createObjectURL(file);
    this.#urls.push(url);
    const img = new Image();

    try {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('could not be decoded'));
        img.src = url;
      });
    } catch (err) {
      return this.#notify(`That image ${err.message}.`, true);
    }

    const a = this.#area;
    const ar = img.naturalHeight / img.naturalWidth;

    // Start at the guide width — the conventional print — then fit if needed.
    let widthMm = Math.min(a.guide?.widthMm ?? a.pressable.widthMm * 0.7, a.pressable.widthMm);
    let heightMm = widthMm * ar;
    if (heightMm > a.pressable.heightMm) {
      heightMm = a.pressable.heightMm;
      widthMm = heightMm / ar;
    }

    const pl = {
      img, file, widthMm, heightMm, rotationDeg: 0,
      xMm: a.pressable.widthMm / 2,
      yMm: (a.guide ? a.guide.offsetYMm + a.guide.heightMm / 2 : a.pressable.heightMm / 2),
    };
    this.#constrain(pl);
    this.#placements.set(this.#areaId, pl);

    if (file.type === 'image/jpeg') {
      this.#notify('JPEGs have no transparency — the print will be a solid rectangle.');
    }

    this.#paintPanel();
    this.#drawEditor();
    this.#pushTexture();
    this.shadowRoot.querySelector('.empty').style.display = 'none';
  }

  #remove() {
    this.#placements.delete(this.#areaId);
    this.#paintPanel();
    this.#drawEditor();
    this.#pushTexture();
    this.shadowRoot.querySelector('.empty').style.display = '';
  }

  #notify(msg, bad = false) {
    const el = this.shadowRoot.querySelector('[data-meta]');
    if (el) el.innerHTML = `<span class="${bad ? 'bad' : 'warn'}">${msg}</span>`;
  }

  // -- 3D --------------------------------------------------------------------

  #setColour(hex) {
    this.#colour = this.#product.colours.find((c) => c.hex === hex);
    this.#paintPanel();
    this.#drawEditor();
    this.#applyAll();
  }

  #setArea(id) {
    this.#areaId = id;
    const mv = this.shadowRoot.querySelector('model-viewer');
    if (this.#area.camera) mv.cameraOrbit = this.#area.camera;
    this.#paintPanel();
    this.#layoutEditor();
    this.shadowRoot.querySelector('.empty').style.display =
      this.#placements.has(id) ? 'none' : '';
  }

  #materialFor(name) {
    return this.shadowRoot.querySelector('model-viewer').model?.materials
      ?.find((m) => m.name === name);
  }

  /** Names of the materials that carry artwork rather than fabric. */
  get #printMaterials() {
    return new Set((this.#product?.printAreas ?? []).map((a) => a.mesh));
  }

  /** Repaint every material — fabric takes the colour, print panels stay clear. */
  async #applyAll() {
    const mv = this.shadowRoot.querySelector('model-viewer');
    if (!mv.model) return;
    const lin = hexToLinear(this.#colour.hex);
    const print = this.#printMaterials;
    for (const m of mv.model.materials) {
      m.pbrMetallicRoughness.baseColorTexture.setTexture(null);
      if (print.has(m.name)) {
        // invisible until artwork arrives
        m.pbrMetallicRoughness.setBaseColorFactor([1, 1, 1, 0]);
        m.setAlphaMode?.('BLEND');
      } else {
        m.pbrMetallicRoughness.setBaseColorFactor([...lin, 1]);
        m.setAlphaMode?.('OPAQUE');
      }
    }
    if (this.#product.pattern) { await this.#pushPattern(); return; }
    const saved = this.#areaId;
    for (const a of this.#product.printAreas) {
      if (!this.#placements.has(a.id)) continue;
      this.#areaId = a.id;
      await this.#pushTexture();
    }
    this.#areaId = saved;
  }

  /** Push the current area's artwork canvas onto its material. */
  async #pushTexture() {
    const mv = this.shadowRoot.querySelector('model-viewer');
    if (this.#product.pattern) return this.#pushPattern();
    const a = this.#area;
    const mat = this.#materialFor(a.mesh);
    if (!mv.model || !mat) return;

    const isPrint = this.#printMaterials.has(a.mesh);

    if (!this.#placements.has(this.#areaId)) {
      mat.pbrMetallicRoughness.baseColorTexture.setTexture(null);
      mat.pbrMetallicRoughness.setBaseColorFactor(
        isPrint ? [1, 1, 1, 0] : [...hexToLinear(this.#colour.hex), 1]);
      mat.setAlphaMode?.(isPrint ? 'BLEND' : 'OPAQUE');
      return;
    }

    // Whether the canvas needs flipping depends on how the GLB was authored,
    // not on a universal truth, so the asset declares it. The DEFAULT is no
    // flip: model-viewer's createTexture() follows the glTF convention, where
    // v = 0 is the top of the image, and make_print_panels.py writes v = 0 at
    // the top of the panel — the two already agree. Only a Blender export,
    // which writes v = 1 - v, needs uvFlipV: true. Getting this backwards
    // prints the whole design upside down, and nothing else goes wrong, which
    // is exactly why it survived a review: the model still loads, the mm are
    // still right, the DPI still checks out.
    const src = this.#product.uvFlipV === true
      ? flipVertically(this.#artCanvas())
      : this.#artCanvas();

    const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    this.#urls.push(url);
    const tex = await mv.createTexture(url);
    mat.pbrMetallicRoughness.setBaseColorFactor([1, 1, 1, 1]);
    mat.pbrMetallicRoughness.baseColorTexture.setTexture(tex);
    mat.setAlphaMode?.(isPrint ? 'BLEND' : 'OPAQUE');
  }

  /**
   * Pattern products: paint the whole flat pattern sheet - garment colour plus every
   * placement at its millimetre position - and put it on the fabric materials, whose UV0 is
   * that same sheet at true scale. The artwork follows the cloth over every curve and fold,
   * the way ink does, instead of floating on a separate panel.
   */
  async #pushPattern() {
    const mv = this.shadowRoot.querySelector('model-viewer');
    const P = this.#product.pattern;
    if (!mv.model) return;
    const ticket = ++this.#patternTicket;
    const mats = P.materials.map((n) => this.#materialFor(n)).filter(Boolean);
    if (!this.#placements.size) {
      for (const m of mats) {
        m.pbrMetallicRoughness.baseColorTexture.setTexture(null);
        m.pbrMetallicRoughness.setBaseColorFactor([...hexToLinear(this.#colour.hex), 1]);
      }
      return;
    }
    const [W, H] = P.sheetMm;
    const px = P.texturePx / Math.max(W, H);
    const c = document.createElement('canvas');
    c.width = Math.round(W * px);
    c.height = Math.round(H * px);
    const g = c.getContext('2d');
    g.fillStyle = this.#colour.hex;
    g.fillRect(0, 0, c.width, c.height);
    for (const a of this.#product.printAreas) {
      const pl = this.#placements.get(a.id);
      if (!pl || !a.patternOrigin) continue;
      g.save();
      g.translate((a.patternOrigin.xMm + pl.xMm) * px, (a.patternOrigin.yMm + pl.yMm) * px);
      g.rotate((pl.rotationDeg * Math.PI) / 180);
      g.drawImage(pl.img, (-pl.widthMm / 2) * px, (-pl.heightMm / 2) * px, pl.widthMm * px, pl.heightMm * px);
      g.restore();
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (ticket !== this.#patternTicket) return;
    const url = URL.createObjectURL(blob);
    this.#urls.push(url);
    const tex = await mv.createTexture(url);
    if (ticket !== this.#patternTicket) return;
    for (const m of mats) {
      m.pbrMetallicRoughness.setBaseColorFactor([1, 1, 1, 1]);
      m.pbrMetallicRoughness.baseColorTexture.setTexture(tex);
      m.setAlphaMode?.('OPAQUE');
    }
  }

  // -- submit ----------------------------------------------------------------

  async #submit() {
    const problems = [];
    if (!this.#placements.size) problems.push('add artwork to at least one area');
    if (!Object.keys(this.#sizes).length) problems.push('enter a quantity for at least one size');
    const cust = {
      name: this.#customer.name.trim(),
      email: this.#customer.email.trim(),
      phone: this.#customer.phone.trim(),
    };
    const bad = [];
    if (!cust.name) bad.push('name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cust.email)) bad.push('email');
    if (cust.phone && !/^[+()\d\s.-]{6,30}$/.test(cust.phone)) bad.push('phone');
    if (bad.length) {
      problems.push(`check your ${bad.join(' and ')}`);
      for (const k of bad) this.shadowRoot.querySelector(`input[data-cust="${k}"]`)?.setAttribute('aria-invalid', 'true');
    }

    for (const [id, pl] of this.#placements) {
      const a = this.#product.printAreas.find((x) => x.id === id);
      const dpi = pl.img.naturalWidth / (pl.widthMm / MM_PER_INCH);
      if (dpi < a.minDpi) problems.push(`${a.label} artwork is only ${dpi.toFixed(0)} DPI`);
    }

    if (problems.length) return this.#notify(`Before submitting: ${problems.join('; ')}.`, true);

    const mv = this.shadowRoot.querySelector('model-viewer');
    let previewDataUrl = '';
    try { previewDataUrl = mv.toDataURL('image/png'); } catch { /* preview is optional */ }

    const payload = {
      contractVersion: 1,
      productId: this.#product.id,
      colour: { name: this.#colour.name, hex: this.#colour.hex },
      sizes: { ...this.#sizes },
      placements: [...this.#placements].map(([id, pl]) => {
        const a = this.#product.printAreas.find((x) => x.id === id);
        return {
          areaId: id,
          method: a.method,
          sizeBasis: a.sizeBasis,
          artwork: pl.file,
          xMm: +pl.xMm.toFixed(2),
          yMm: +pl.yMm.toFixed(2),
          widthMm: +pl.widthMm.toFixed(2),
          heightMm: +pl.heightMm.toFixed(2),
          rotationDeg: +pl.rotationDeg.toFixed(2),
          effectiveDpi: Math.round(pl.img.naturalWidth / (pl.widthMm / MM_PER_INCH)),
        };
      }),
      previewDataUrl,
      customer: cust,
      notes: this.#notes.trim(),
    };

    this.dispatchEvent(new CustomEvent('design:submit', {
      detail: payload, bubbles: true, composed: true,
    }));
  }
}

customElements.define('cmgo-configurator', CmgoConfigurator);
export { CmgoConfigurator };
