/**
 * <cmgo-conveyor> — the garment conveyor, as the showroom's front room.
 *
 * A steel conveyor carries every garment family in the range, grouped. Pick a
 * colour (or click a garment on the belt) and the belt runs the nearest match
 * to the loading point, stops, and the garment swings in front of the camera.
 * From there the customer recolours it, and "Customise print" hands the piece
 * to the existing <cmgo-showroom> configurator in that colour.
 *
 * Presentation only, like the showroom: it owns no artwork and no millimetres.
 * It talks to the rest of the page through two things —
 *   - window.__CMGO_PRODUCTS / <cmgo-showroom>.select(id) for the hand-off
 *   - a `conveyor:select` event (bubbles, composed) for the host page
 *
 * Assets (published next to the page):
 *   conveyor-catalogue.json   groups, colours, conveyor path, layout
 *   conveyor-scene.glb.wasm   the conveyor + one mesh per garment cut (Draco)
 *   draco/                    decoder
 * The .glb is named .wasm for the same reason the showroom's models are: it is
 * a type the host will serve. Its bytes are an ordinary GLB.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Which showroom configurator each garment cut opens. The regular tank has none yet. */
const PRODUCT_FOR = (cut) =>
  cut.startsWith('tank_crop') ? 'tank-crop' : cut.startsWith('tank_reg') ? 'tank-reg'
  : cut === 'tee_staple_md' ? 'tee-staple-5001'      // the Marvelous 5001: printed on its real pattern
  : cut.startsWith('cap_') ? 'cap-sixpanel' : cut.startsWith('tee_') ? 'tee-classic' : cut.startsWith('hood_') ? 'hoodie-heavy' : null;

/** Styles with their own pattern customiser, by AS Colour code. Several styles share one belt
 *  mesh (the 5146 rides on the 5161's hoodie), so the cut alone cannot say which pattern to open. */
const PRODUCT_BY_REF = { '5001': 'tee-staple-5001', '5146': 'hoodie-5146' };
const productFor = (it) => PRODUCT_BY_REF[String(it.ref ?? '')] ?? PRODUCT_FOR(it.cut);

const HANGER = { wood: 'Wood hanger', black: 'Black hanger', hook: 'Black hook' };
const FABRIC = { jersey: 'Jersey', stonewash: 'Stonewash jersey', marle: 'Marle', fleece: 'Fleece', rib: 'Faded rib', canvas: 'Canvas', twill: 'Cotton twill' };

const CSS = `
:host{
  --stage:#7f8083;
  /* Frosted glass, the same material as the showroom's customise card, a little
     clearer so the belt reads through it. */
  --glass:rgba(16,16,20,.34); --glass-edge:rgba(255,255,255,.16); --panel-2:rgba(255,255,255,.07);
  --ink:#f4f2ef; --muted:#c3beb8; --line:rgba(255,255,255,.12); --accent:#e6ded5; --hot:#f0ae86;
  display:block; container-type:inline-size;
  font:14px/1.5 Archivo, ui-sans-serif, system-ui, -apple-system, sans-serif; color:var(--ink);
}
*{box-sizing:border-box}
[hidden]{display:none!important}
.room{position:relative;border-radius:14px;overflow:hidden;isolation:isolate;background:var(--stage);
  height:clamp(540px,74vh,780px)}
.stage{position:absolute;inset:0}
.stage canvas{display:block;width:100%;height:100%;touch-action:pan-y}
.stage canvas.hot{cursor:grab}
.stage canvas.grabbing{cursor:grabbing}
/* four fixed camera views: the only way the camera moves */
.views{position:absolute;z-index:3;left:14px;top:14px;display:flex;gap:2px;padding:3px;border-radius:10px;
  background:rgba(16,16,20,.34);-webkit-backdrop-filter:blur(18px) saturate(1.35);backdrop-filter:blur(18px) saturate(1.35);
  border:1px solid rgba(255,255,255,.16);box-shadow:0 16px 40px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.14)}
.views button{display:flex;align-items:center;gap:5px;padding:5px 8px;border-radius:7px;cursor:pointer;
  font:500 11px Archivo,ui-sans-serif,system-ui,sans-serif;color:#f4f2ef;background:transparent;border:1px solid transparent;
  text-shadow:0 1px 2px rgba(0,0,0,.35);white-space:nowrap}
.views button:hover{background:rgba(255,255,255,.08)}
.views button[aria-pressed=true]{background:#f4f2ef;color:#17181b;text-shadow:none}
.views kbd{font:500 9px 'IBM Plex Mono',ui-monospace,monospace;opacity:.55}
.loading{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:var(--stage);
  font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;color:#f4f4f2}
.loading b{display:block;font-weight:500;color:#ffd7c2;margin-bottom:4px}

.panel{position:absolute;z-index:3;top:16px;right:16px;bottom:16px;width:min(330px,calc(100% - 32px));
  display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:14px;overflow:hidden;color:var(--ink);
  background:var(--glass);-webkit-backdrop-filter:blur(18px) saturate(1.35);backdrop-filter:blur(18px) saturate(1.35);
  border:1px solid var(--glass-edge);
  box-shadow:0 24px 60px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.14);
  text-shadow:0 1px 2px rgba(0,0,0,.35);
  color-scheme:dark;transition:width .25s ease}
/* minimised: a small glass pill with the name, the belt status and the button */
.panel.min{top:auto;width:auto;max-width:calc(100% - 32px);padding:10px 12px;gap:0}
.panel.min [data-browse],.panel.min [data-detail]{display:none!important}
.panel.min .top .kicker{display:none}
.panel.min .head{grid-template-columns:auto auto;align-items:center;gap:12px}
.panel.min .status{white-space:nowrap}
.minbtn{flex:none;width:28px;height:28px;display:grid;place-items:center;padding:0;cursor:pointer;border-radius:50%;
  background:rgba(255,255,255,.1);border:1px solid var(--line);color:var(--ink)}
.minbtn:hover{border-color:var(--ink)}
.minbtn svg{width:12px;height:12px;transition:transform .2s;transform:rotate(180deg)}
.panel.min .minbtn svg{transform:none}
.head{display:grid;gap:6px}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.top .right{display:flex;align-items:center;gap:10px}
.mark{font-size:13px;font-weight:600;letter-spacing:-.01em}
.kicker{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.status{display:flex;align-items:center;gap:8px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.status i{width:7px;height:7px;border-radius:50%;background:#7fd19f;flex:none}
.status[data-state=fetch] i{background:var(--hot);animation:blink .9s steps(2) infinite}
.status[data-state=hold] i{background:var(--hot)}
@keyframes blink{50%{opacity:.25}}

.list{overflow-y:auto;margin:0 -16px;padding:0 16px 4px;scrollbar-width:thin}
.fam{display:grid;gap:7px;padding:12px 0;border-top:1px solid var(--line)}
.fam:first-child{border-top:0;padding-top:4px}
.famtop{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.fam h3{margin:0;font-size:13px;font-weight:600}
.tag{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.tag.print{color:var(--accent)}
.note{margin:0;font-size:11.5px;color:var(--muted)}
.style{display:grid;gap:5px}
.sname{font-size:12px;color:var(--ink);display:flex;align-items:baseline;gap:8px}
.sname em{font-style:normal;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.note.soon{font-style:italic}
.sname .ref{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10.5px;color:var(--hot);font-variant-numeric:tabular-nums}
.sws{display:flex;flex-wrap:wrap;gap:7px}
.sw{width:24px;height:24px;border-radius:50%;padding:0;cursor:pointer;background:var(--c);
  border:1px solid rgba(255,255,255,.3);box-shadow:inset 0 0 0 2px rgba(16,16,20,.55);transition:transform .15s}
.sw:hover{transform:scale(1.1)}
.sw[aria-pressed=true]{box-shadow:inset 0 0 0 2px rgba(16,16,20,.6),0 0 0 2px var(--ink)}

.detail{display:flex;flex-direction:column;gap:12px;min-height:0;overflow-y:auto}
.detail h2{margin:0;font-size:19px;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
.ticket{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;padding:11px 13px;border-radius:9px;background:var(--panel-2);font-size:12.5px}
.ticket dt{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);align-self:center}
.ticket dd{margin:0}
.ticket .slot{font-family:'IBM Plex Mono',ui-monospace,monospace;color:var(--hot);font-variant-numeric:tabular-nums}
.row{display:flex;align-items:center;gap:10px}
.row label{font-size:11.5px;color:var(--muted)}
input[type=color]{width:38px;height:26px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(255,255,255,.08);cursor:pointer}
.actions{display:grid;gap:8px;margin-top:auto}
.btn{font:600 13px Archivo,ui-sans-serif,system-ui,sans-serif;padding:10px 14px;border-radius:9px;cursor:pointer;
  border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:var(--ink);text-shadow:none}
.btn:hover{border-color:var(--ink)}
.btn.primary{background:var(--ink);color:#17181b;border-color:var(--ink)}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.hint{font-size:11px;color:var(--muted);margin:0}
:focus-visible{outline:2px solid #8ab4ff;outline-offset:2px}

@container (max-width:760px){
  .views{top:10px;right:10px;left:10px;bottom:auto;justify-content:space-between}
  .views button{padding:7px 8px;font-size:11px;flex:1;justify-content:center}
  .views kbd{display:none}
  .room{height:auto;display:grid;grid-template-rows:min(62vh,440px) auto}
  .stage{position:relative;inset:auto}
  .panel{position:relative;inset:auto;width:auto;margin:0;border-radius:0;border:0;border-top:1px solid var(--glass-edge);max-height:none;box-shadow:none;
    background:rgba(20,20,24,.82)}
  .panel.min{width:auto;max-width:none}
  .minbtn svg{transform:none}
  .panel.min .minbtn svg{transform:rotate(180deg)}
  .list{max-height:340px}
}
@media (prefers-reduced-motion:reduce){.status[data-state=fetch] i{animation:none}.sw{transition:none}}
`;

class CmgoConveyor extends HTMLElement {
  #r = null;          // three.js runtime, built once
  #ro = null; #io = null;
  #visible = true; #paused = false;

  constructor() { super(); this.attachShadow({ mode: 'open' }); }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="room">
        <div class="stage" aria-label="3D garment conveyor. Click a garment to bring it forward."></div>
        <nav class="views" aria-label="Camera views">
          <button type="button" data-view="full" aria-pressed="true"><kbd>1</kbd>Full belt</button>
          <button type="button" data-view="storage" aria-pressed="false"><kbd>2</kbd>Storage run</button>
          <button type="button" data-view="bay" aria-pressed="false"><kbd>3</kbd>Loading bay</button>
          <button type="button" data-view="close" aria-pressed="false"><kbd>4</kbd>Loading point</button>
        </nav>
        <div class="loading"><div><b>Loading the conveyor</b>garments, belt and hangers</div></div>
        <aside class="panel" aria-live="polite">
          <div class="head">
            <div class="top"><span class="mark">${this.getAttribute('brand') || 'Cmgo Design'} · Conveyor</span>
              <span class="right"><span class="kicker" data-count>—</span>
                <button class="minbtn" type="button" data-min aria-expanded="true" aria-label="Minimise panel" title="Minimise">
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3"/></svg>
                </button></span></div>
            <div class="status" data-state="idle"><i></i><span data-status>Running</span></div>
          </div>
          <div class="list" data-browse><p class="note">Pick a colour, or grab the belt: drag any garment to run the conveyor by hand. A click brings it to the loading point.</p></div>
          <div class="detail" data-detail hidden>
            <div><span class="kicker" data-crumb>At the loading point</span><h2 data-name></h2><p class="note" data-meta></p></div>
            <dl class="ticket">
              <dt>Slot</dt><dd class="slot" data-slot></dd>
              <dt>Colour</dt><dd data-colour></dd>
              <dt>Fabric</dt><dd data-fabric></dd>
            </dl>
            <div><div class="famtop"><h3>Colourway</h3><span class="tag">live on the garment</span></div>
              <div class="sws" data-way style="margin-top:8px"></div></div>
            <div class="actions">
              <button class="btn primary" type="button" data-print>Customise print</button>
              <p class="hint" data-printnote hidden></p>
              <div class="pair">
                <button class="btn" type="button" data-back>Back to belt</button>
                <button class="btn" type="button" data-next>Next in group</button>
              </div>
            </div>
          </div>
        </aside>
      </div>`;
    this.#boot().catch((err) => {
      const l = this.shadowRoot.querySelector('.loading');
      l.innerHTML = `<div><b>The conveyor did not load</b>${String(err && err.message || err)}</div>`;
      console.error('[cmgo-conveyor]', err);
    });
    // The customiser overlay covers everything: stop drawing underneath it.
    this._onSel = () => { this.#paused = true; };
    this._onBrowse = () => { this.#paused = false; };
    document.addEventListener('showroom:select', this._onSel);
    document.addEventListener('showroom:browse', this._onBrowse);
  }

  disconnectedCallback() {
    document.removeEventListener('showroom:select', this._onSel);
    document.removeEventListener('showroom:browse', this._onBrowse);
    if (this._onKeys) document.removeEventListener('keydown', this._onKeys);
    this.#ro?.disconnect(); this.#io?.disconnect();
    this.#r?.renderer.setAnimationLoop(null);
    this.#r?.renderer.dispose();
  }

  async #boot() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const base = (this.getAttribute('assets-url') || '').replace(/([^/])$/, '$1/');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // no-store: the catalogue is what says which garment file each style uses, so a cached copy
    // keeps showing the old mesh after a new drape is published.
    const cat = await (await fetch(`${base}${this.getAttribute('catalogue') || 'conveyor-catalogue.json'}`, { cache: 'no-store' })).json();

    // ---------------------------------------------------------------- renderer
    const stage = $('.stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.1;
    // Soft shadows: the garments shade each other along the belt and throw a
    // shadow onto the back wall, which is what makes the rig read as a real room.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const grey = new THREE.Color('#7f8083');
    scene.background = grey;
    scene.fog = new THREE.Fog(grey, 45, 110);   // far enough that the side view stays crisp
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    // Studio balance: one strong soft key from above-front, a cool low fill, a
    // warm rim from behind the belt to separate dark garments from the grey room.
    scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x55565b, 0.55));
    const key = new THREE.DirectionalLight(0xfffaf2, 2.4); scene.add(key); scene.add(key.target);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 7; key.shadow.blurSamples = 12;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight(0xe8eeff, 0.5); fill.position.set(10, 3, -8); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xfff1e0, 0.9); rim.position.set(-8, 7, 4); scene.add(rim);
    const cyc = new THREE.MeshStandardMaterial({ color: '#8b8c8f', roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), cyc); floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 14), cyc); wall.position.set(-1.4, 7, -8); wall.rotation.y = Math.PI / 2; scene.add(wall);
    floor.receiveShadow = wall.receiveShadow = true;

    // No free camera: it only ever moves between the four fixed views below.
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 120);
    const camTarget = new THREE.Vector3();

    // ---------------------------------------------------------------- assets
    const draco = new DRACOLoader(); draco.setDecoderPath(`${base}draco/`);
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(`${base}${cat.glb}`);
    // Pieces draped in Marvelous Designer ship in their own files (cat.extraGlbs),
    // in the same frame as the scene's templates: origin at the conveyor hook.
    const extras = await Promise.all((cat.extraGlbs || []).map((f) => loader.loadAsync(`${base}${f}?v=${encodeURIComponent(cat.version ?? '')}`)));
    // Industrial: the big trusses are painted black; track, hangers and hooks keep
    // their own steel and black finishes.
    const FINISH = {
      STEEL: { color: '#161616', metalness: 0.25, roughness: 0.55 },   // black paint on steel
    };
    gltf.scene.traverse((o) => {
      const f = o.isMesh && FINISH[o.material?.name];
      if (!f || o.material.userData.finished) return;
      o.material.color.set(f.color); o.material.metalness = f.metalness; o.material.roughness = f.roughness;
      o.material.userData.finished = true;
    });
    // The track was exported flat-shaded, which polished brass turns into stripes.
    // Smooth it, keeping the channel's real edges sharp.
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material?.name === 'STEEL_TRACK') o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(35));
    });
    const take = (n) => {
      for (const g of [gltf, ...extras]) { const o = g.scene.getObjectByName(n); if (o) { o.removeFromParent(); return o; } }
    };
    cat.conveyor.meshes.forEach((n) => { const o = take(n); if (o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); scene.add(o); } });
    const tpl = {};
    for (const [cut, c] of Object.entries(cat.cuts)) tpl[cut] = { lod0: take(c.meshLOD0), lod1: take(c.meshLOD1) };

    // conveyor path, arc-length parameterised
    const P = cat.conveyor.path.map((p) => new THREE.Vector3(...p)); P.push(P[0].clone());
    const S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + P[i].distanceTo(P[i - 1]));
    const L = S[S.length - 1];
    const UP = new THREE.Vector3(0, 1, 0);

    // Fit the key light's shadow to the belt: it comes from above and in front of the
    // rig, so every garment shades the ones behind it and lands softly on the back wall.
    {
      const bb = new THREE.Box3().setFromPoints(P);
      bb.min.y = 0; bb.min.x = Math.min(bb.min.x, -1.4); bb.expandByScalar(1.2);
      const c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(new THREE.Vector3()).length() / 2;
      const dir = new THREE.Vector3(0.62, 0.74, 0.26).normalize();
      key.target.position.copy(c);
      key.position.copy(c).addScaledVector(dir, r * 1.6);
      const sc = key.shadow.camera;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = r * 3.4;
      sc.updateProjectionMatrix();
    }
    const YAW = THREE.MathUtils.degToRad(cat.conveyor.yawOffsetDeg);
    const mod = (a, n) => ((a % n) + n) % n;
    const sample = (s, oP, oT) => {
      s = mod(s, L);
      let lo = 0, hi = S.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
      const t = (s - S[lo]) / Math.max(1e-9, S[hi] - S[lo]);
      oP.lerpVectors(P[lo], P[hi], t); oT.subVectors(P[hi], P[lo]).setY(0).normalize();
    };

    // fabric materials: shared per colour on the belt, cloned for the piece in hand
    // AS Colour swatches are screen colours, and "Black" is #000000. Dyed cotton never
    // reflects nothing, so the rendered albedo gets a small floor: black reads as black
    // cloth with folds, not as a hole. The swatch hex itself is untouched in the data.
    const FLOOR = new THREE.Color('#1c1c1e');
    const fabricColour = (hex) => {
      const c = new THREE.Color(hex);
      return c.setRGB(Math.max(c.r, FLOOR.r), Math.max(c.g, FLOOR.g), Math.max(c.b, FLOOR.b));
    };
    const cache = new Map();
    // Marvelous exports single-layer cloth: a tote's lining is the back of the same
    // faces, so those cuts render both sides (cat.cuts[cut].doubleSided).
    const fabricMat = (hex, kind, fabric, trim, both = false) => {
      const k = `${hex}|${kind}|${fabric}|${both}`;
      if (cache.has(k)) return cache.get(k);
      const f = cat.fabrics[fabric] || cat.fabrics.jersey;
      const c = fabricColour(hex); if (kind === 'TRIM') c.multiplyScalar(trim);
      const m = new THREE.MeshPhysicalMaterial({ name: kind, color: c, roughness: f.roughness, sheen: f.sheen,
        sheenRoughness: 0.6, sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.3), envMapIntensity: 0.4,
        side: both ? THREE.DoubleSide : THREE.FrontSide });
      cache.set(k, m); return m;
    };
    const dress = (obj, it, unique = false) => obj.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      const nm = m.userData.baseName || m.material.name; m.userData.baseName = nm;
      if (nm === 'FABRIC' || nm === 'TRIM') {
        const b = fabricMat(it.color, nm, it.fabric, it.trimFactor, !!cat.cuts[it.cut]?.doubleSided);
        m.material = unique ? b.clone() : b;
      }
    });
    const tagItem = (obj, i) => obj.traverse((m) => { if (m.isMesh) m.userData.item = i; });

    const items = cat.layout.map((it, i) => {
      const obj = tpl[it.cut].lod1.clone(true); dress(obj, it); tagItem(obj, i); scene.add(obj);
      return { ...it, idx: i, obj, lod: 1, swing: 0, swingV: 0, roll: 0, rollV: 0, yaw: 0, yawV: 0, held: false, keepYaw: false };
    });
    $('[data-count]').textContent = `${items.length} garments · ${new Set(items.map((i) => i.group)).size} groups`;

    // ---------------------------------------------------------------- belt motion
    let offset = 0, vel = 0, mode = 'idle', target = null, goal = 0;
    const IDLE = reduce ? 0 : 0.12, VMAX = 1.6, ACC = 0.9;
    // A fetch takes about the same time however far round the belt the piece is:
    // the belt runs faster for a long trip rather than making the customer wait.
    const FETCH_S = 2.4;
    let fv = VMAX, fa = ACC;
    // The piece in hand slides forward off the belt, clear of its neighbours.
    const PULL = 0.32;
    let pull = 0, pulled = null;
    const tp = new THREE.Vector3(), tt = new THREE.Vector3(), fr = new THREE.Vector3(), lk = new THREE.Vector3();
    const place = (it) => {
      sample(it.sHome + offset, tp, tt);
      fr.copy(tt).applyAxisAngle(UP, YAW);
      it.obj.position.copy(tp);
      it.obj.lookAt(lk.copy(tp).sub(fr));
      if (it === pulled && pull > 0) {              // lifted off the rail and brought forward
        const k = pull * pull * (3 - 2 * pull);
        it.obj.position.addScaledVector(fr, PULL * k);
        it.obj.position.y += 0.03 * k;
      }
      if (it.yaw) it.obj.rotateY(it.yaw);      // turned on its hook
      if (it.swing) it.obj.rotateX(it.swing);  // swinging front-to-back
      if (it.roll) it.obj.rotateZ(it.roll);    // swinging side-to-side
    };
    const travel = (it) => mod(cat.conveyor.loadingTipS - (it.sHome + offset), L);

    // ---------------------------------------------------------------- the chain
    // An overhead conveyor is a chain running inside its track, and the hooks ride
    // on it. The links are placed from the same belt offset as the garments, so
    // the chain and everything hanging from it move as one.
    const CHAIN_Y = 0.035;                                 // just above the hook tops
    const nLinks = Math.max(1, Math.round(L / 0.09)), pitchL = L / nLinks;
    const linkMat = new THREE.MeshStandardMaterial({ color: '#6f7174', metalness: 0.85, roughness: 0.42 });   // plain steel chain
    const pinMat = new THREE.MeshStandardMaterial({ color: '#3a3b3d', metalness: 0.8, roughness: 0.45 });
    const links = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.024, 0.022), linkMat, nLinks);
    const pinGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.032, 10); pinGeo.rotateX(Math.PI / 2);
    const pins = new THREE.InstancedMesh(pinGeo, pinMat, nLinks);
    for (const m of [links, pins]) { m.frustumCulled = false; m.castShadow = true; scene.add(m); }
    const ca = new THREE.Vector3(), cb = new THREE.Vector3(), ctan = new THREE.Vector3(), cdir = new THREE.Vector3();
    const cq = new THREE.Quaternion(), cm = new THREE.Matrix4(), ONE = new THREE.Vector3(1, 1, 1), AX = new THREE.Vector3(1, 0, 0);
    const linkAt = (sAt, out) => {
      sample(sAt - 0.012, ca, ctan); sample(sAt + 0.012, cb, ctan);
      cdir.subVectors(cb, ca); if (cdir.lengthSq() < 1e-10) cdir.set(1, 0, 0); cdir.normalize();
      cq.setFromUnitVectors(AX, cdir);
      sample(sAt, ca, ctan); ca.y += CHAIN_Y;
      cm.compose(ca, cq, ONE); out(cm);
    };
    const moveChain = () => {
      for (let i = 0; i < nLinks; i++) {
        const sAt = i * pitchL + offset;
        linkAt(sAt, (m) => links.setMatrixAt(i, m));
        linkAt(sAt + pitchL / 2, (m) => pins.setMatrixAt(i, m));
      }
      links.instanceMatrix.needsUpdate = true; pins.instanceMatrix.needsUpdate = true;
    };

    // ---------------------------------------------------------------- the four fixed views
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const tip = V(...cat.conveyor.loadingTip);
    const nearX = Math.max(...P.map((p) => p.x));
    const midZ = (Math.min(...P.map((p) => p.z)) + Math.max(...P.map((p) => p.z))) / 2;
    const loadY = cat.conveyor.railHeights.loading, storeY = cat.conveyor.railHeights.storage;
    const fullY = ((loadY - 0.78) + (storeY + 0.42)) / 2;   // lowest hem .. top of the truss
    const run = P.filter((p) => p.y > storeY - 0.01).map((p) => p.z);
    const runZ = (Math.min(...run) + Math.max(...run)) / 2;
    sample(cat.conveyor.loadingTipS, tp, tt);
    const tipFront = tt.clone().applyAxisAngle(UP, YAW);
    const tipSide = new THREE.Vector3().crossVectors(UP, tipFront).normalize();
    const closeT = tip.clone().add(V(0, -0.36, 0));
    const VIEWS = {
      full:    { p: V(nearX + 20, fullY, midZ), t: V(nearX - 0.375, fullY, midZ), hfov: 34 },   // pose recomputed by fullPose()
      storage: { p: V(nearX + 5.2, storeY - 0.35, runZ), t: V(nearX, storeY - 0.45, runZ), hfov: 64 },
      bay:     { p: tip.clone().add(V(5.7, 1.6, 1.5)), t: tip.clone().add(V(0.2, 0.3, -2.9)), hfov: 62 },
      close:   { p: closeT.clone().addScaledVector(tipFront, 2.15).addScaledVector(tipSide, -0.55).add(V(0, 0.1, 0)), t: closeT, hfov: 40 },
    };
    // Full belt is a true side elevation that fills the frame: the camera backs off
    // exactly far enough for the whole belt (and its hanging garments) to fit the
    // free width of the stage, whatever shape the screen is.
    const zs = P.map((p) => p.z);
    const FULL_LEN = Math.max(...zs) - Math.min(...zs) + 0.75;      // belt length plus a garment each end
    const FULL_H = (storeY + 0.42) - (loadY - 0.78);                 // top of truss to lowest hem
    // signed: positive moves the picture right (panel on the left), negative moves it left (panel on the right)
    const freeShift = () => {
      if (getComputedStyle(panel).position !== 'absolute' || panel.classList.contains('min')) return 0;
      const pr = panel.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      return (pr.left - sr.left) < (sr.right - pr.right) ? (pr.right - sr.left) / 2 : -(sr.right - pr.left) / 2;
    };
    const fullPose = () => {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1, aspect = w / h;
      const tanH0 = Math.tan(THREE.MathUtils.degToRad(VIEWS.full.hfov) / 2);
      const tanV = Math.min(Math.tan(THREE.MathUtils.degToRad(75) / 2), tanH0 / aspect);
      const tanH = tanV * aspect;
      const frac = 1;                                        // the whole stage: the glass panel floats over the belt
      const d = Math.max(FULL_LEN / (0.96 * frac * 2 * tanH), FULL_H / (0.86 * 2 * tanV));
      const cx = nearX - 0.375;
      return { p: V(cx + d, fullY, midZ), t: V(cx, fullY, midZ) };
    };
    let view = 'full', lastWide = 'full', hfov = VIEWS.full.hfov;
    let sw = 0;                      // how much of the panel offset applies (0 on Full belt, 1 elsewhere), eased with the camera
    // The scene sits high in the frame on the wide views: the belt reads as overhead
    // and the floor gives it room. The close-up frames its own garment and stays put.
    const LIFT = 0.1;                // fraction of the stage height
    let lf = 0;
    const lfFor = (name) => ({ full: 0.4, storage: 0.6, bay: 1, close: 0 }[name] ?? 0);   // Full belt has the least headroom
    const swFor = (name) => (name === 'full' ? 0 : 1);
    const cam = { from: null, to: null, t: 1 };
    const room = $('.room'), panel = $('.panel');
    const project = () => {
      const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
      const aspect = w / h;
      camera.fov = Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / aspect)));
      camera.aspect = aspect;
      const shift = freeShift() * sw;                           // other views keep their subject clear of the open panel
      const lift = LIFT * h * lf;
      if (shift || lift) camera.setViewOffset(w, h, -shift, lift, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
    // Ambient occlusion darkens the folds, the armpits and where the cloth meets the
    // hanger: the depth cues the flat garments were missing. Skipped on small screens
    // and when the device can't keep up (see the frame-time watch in the render loop).
    let composer = null, gtao = null;
    const aoWanted = !reduce && Math.min(screen.width, screen.height) >= 600;
    if (aoWanted) {
      try {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        gtao = new GTAOPass(scene, camera, 1, 1);
        gtao.updateGtaoMaterial({ radius: 0.18, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 12 });
        gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
        gtao.blendIntensity = 0.85;
        composer.addPass(gtao);
        composer.addPass(new OutputPass());
      } catch (err) { console.warn('[cmgo-conveyor] ambient occlusion off:', err); composer = null; }
    }
    const fit = () => {
      const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false);
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
      if (view === 'full' && cam.t >= 1) { const f = fullPose(); camera.position.copy(f.p); camTarget.copy(f.t); camera.lookAt(camTarget); }
      project();
    };
    const goView = (name, instant = false) => {
      const v = name === 'full' ? { ...VIEWS.full, ...fullPose() } : VIEWS[name]; view = name;
      if (name !== 'close') lastWide = name;
      this.shadowRoot.querySelectorAll('.views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
      cam.from = { p: camera.position.clone(), t: camTarget.clone(), h: hfov, sw, lf };
      cam.to = { p: v.p.clone(), t: v.t.clone(), h: v.hfov, sw: swFor(name), lf: lfFor(name) };
      cam.t = instant || reduce ? 1 : 0;
      if (cam.t === 1) { camera.position.copy(v.p); camTarget.copy(v.t); hfov = v.hfov; sw = swFor(name); lf = lfFor(name); camera.lookAt(camTarget); project(); }
    };
    this.shadowRoot.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => goView(b.dataset.view)));
    const minBtn = $('[data-min]');
    const setMin = (on, remember = true) => {
      panel.classList.toggle('min', on);
      minBtn.setAttribute('aria-expanded', String(!on));
      minBtn.setAttribute('aria-label', on ? 'Show panel' : 'Minimise panel');
      minBtn.title = on ? 'Show panel' : 'Minimise';
      if (remember) { try { localStorage.setItem('cmgo-conveyor-min', on ? '1' : '0'); } catch {} }
      requestAnimationFrame(fit);      // Full belt stays put; other views re-centre beside the panel
    };
    minBtn.addEventListener('click', () => setMin(!panel.classList.contains('min')));
    // 1-4 switch views, unless someone is typing or the customiser is open
    this._onKeys = (e) => {
      if (this.#paused || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.composedPath()[0];
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const name = { 1: 'full', 2: 'storage', 3: 'bay', 4: 'close' }[e.key];
      if (name) goView(name);
    };
    document.addEventListener('keydown', this._onKeys);

    // ---------------------------------------------------------------- panel UI
    const status = (state, text) => { $('.status').dataset.state = state; $('[data-status]').textContent = text; };
    const slotLabel = (it) => String(it.slot + 1).padStart(4, '0');
    const list = $('[data-browse]');
    // A collection lists its styles; each style shows the colours hanging on the belt.
    // Styles without a mesh yet are listed as coming soon.
    const styleOf = (it) => it.style || it.cut;
    // AS Colour style code, shown right after the garment name
    const refTag = (it) => ('ref' in it ? `<span class="ref">${it.ref || 'TBC'}</span>` : '');
    for (const [g, G] of Object.entries(cat.groups)) {
      const onBelt = items.filter((i) => i.group === g);
      const soon = G.soon || [];
      if (!onBelt.length && !soon.length) continue;
      const styles = [...new Set(onBelt.map(styleOf))];
      const first = onBelt[0], product = first && PRODUCT_FOR(first.cut);
      const el = document.createElement('div'); el.className = 'fam';
      el.innerHTML = `<div class="famtop"><h3>${G.label}</h3>
          <span class="tag${product ? ' print' : ''}">${!first ? 'Coming soon' : product ? 'Print customiser' : 'Colour only'}</span></div>
        ${first ? `<p class="note">${styles.length} ${styles.length === 1 ? 'style' : 'styles'} · ${onBelt.length} on belt</p>` : ''}`;
      for (const s of styles) {
        const its = onBelt.filter((i) => styleOf(i) === s);
        const row = document.createElement('div'); row.className = 'style';
        row.innerHTML = `<span class="sname">${s}${refTag(its[0])}${its[0].placeholder ? '<em>preview mesh</em>' : ''}</span><div class="sws"></div>`;
        const sws = row.querySelector('.sws'), seen = new Set();
        for (const it of its) {
          if (seen.has(it.color)) continue; seen.add(it.color);
          const b = document.createElement('button');
          b.className = 'sw'; b.type = 'button'; b.style.setProperty('--c', it.color);
          b.title = `${s} · ${it.colorName}`; b.setAttribute('aria-label', `${s}, ${it.colorName}`);
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => {
            this.shadowRoot.querySelectorAll('.list .sw[aria-pressed=true]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            const pool = items.filter((i) => i.group === g && styleOf(i) === s && i.color === it.color);
            if (pool.length) fetchItem(pool.reduce((a, c) => (travel(a) <= travel(c) ? a : c)));
          });
          sws.appendChild(b);
        }
        el.appendChild(row);
      }
      if (soon.length) {
        const p = document.createElement('p'); p.className = 'note soon';
        p.textContent = `Coming soon: ${soon.map((s) => (typeof s === 'string' ? s : `${s.name}${s.ref ? ` ${s.ref}` : ''}`)).join(', ')}`;
        el.appendChild(p);
      }
      list.appendChild(el);
    }

    const swapLod = (it, lod) => {
      const o = tpl[it.cut][lod ? 'lod1' : 'lod0'].clone(true);
      dress(o, it, lod === 0); tagItem(o, it.idx);
      scene.remove(it.obj); scene.add(o); it.obj = o; it.lod = lod;
    };
    const fetchItem = (it) => {
      if (mode === 'hold') release(false);
      target = it; mode = 'fetch'; goal = offset + travel(it);
      const dist = travel(it);
      fv = Math.max(1.2, dist / (FETCH_S * 0.7));
      fa = Math.max(1.5, fv / (FETCH_S * 0.3));
      status('fetch', `Fetching slot ${slotLabel(it)} · ${travel(it).toFixed(1)} m`);
      if (view === 'close') goView(lastWide);
    };
    // Frame the piece in hand: front-on with a slight turn, sized to the garment
    // itself, so a cropped tank and a long hoodie both fill the free stage.
    const closeFor = (it) => {
      const keep = pull; pull = 1; place(it); it.obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(it.obj);
      pull = keep; place(it);
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const HF = 34, w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      const tanH = Math.tan(THREE.MathUtils.degToRad(HF) / 2);
      const tanV = Math.min(Math.tan(THREE.MathUtils.degToRad(75) / 2), tanH / (w / h));
      let frac = 1;
      if (getComputedStyle(panel).position === 'absolute' && !panel.classList.contains('min')) {
        frac = Math.max(0.35, 1 - panel.getBoundingClientRect().width / w);
      }
      const width = Math.hypot(s.x, s.z) * 0.85;
      const d = Math.max((s.y * 0.5) / (0.74 * tanV), (width * 0.5) / (0.72 * tanH * frac));
      const a = 0.2;                                         // about 11 degrees off square
      const dir = tipFront.clone().multiplyScalar(Math.cos(a)).addScaledVector(tipSide, -Math.sin(a)).normalize();
      return { p: c.clone().addScaledVector(dir, d).add(V(0, s.y * 0.1, 0)), t: c, hfov: HF };
    };
    const arrive = () => {
      mode = 'hold'; vel = 0; offset = goal;
      const it = target; swapLod(it, 0);
      it.swingV = reduce ? 0 : 0.3; pulled = it; if (reduce) pull = 1;
      if (panel.classList.contains('min')) setMin(false, false);   // the piece has arrived: show its controls
      VIEWS.close = closeFor(it);
      place(it);
      goView('close');
      status('hold', `At the loading point · slot ${slotLabel(it)}`);
      openDetail(it); fit();
      this.dispatchEvent(new CustomEvent('conveyor:select', { bubbles: true, composed: true,
        detail: { group: it.group, style: it.style, asColourRef: it.ref ?? null, cut: it.cut, colour: { name: it.colorName, hex: it.color }, slot: it.slot + 1, productId: productFor(it) } }));
    };
    const release = (resume = true) => {
      const it = target; if (it && it.lod === 0) swapLod(it, 1);
      if (it) it.keepYaw = false;                 // back on the belt: let it turn home
      target = null;
      if (resume) {
        mode = 'idle'; status('idle', `Running · ${IDLE.toFixed(2)} m/s`);
        $('[data-detail]').hidden = true; $('[data-browse]').hidden = false;
        goView(lastWide);
      }
    };
    const recolour = (it, hex, name) => {
      it.color = hex; it.colorName = name;
      it.obj.traverse((m) => {
        if (!m.isMesh) return;
        if (m.userData.baseName === 'FABRIC') m.material.color.copy(fabricColour(hex));
        if (m.userData.baseName === 'TRIM') m.material.color.copy(fabricColour(hex)).multiplyScalar(it.trimFactor);
      });
      $('[data-colour]').textContent = name;
      this.shadowRoot.querySelectorAll('[data-way] .sw').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hex === hex)));
    };
    const openDetail = (it) => {
      const G = cat.groups[it.group];
      $('[data-browse]').hidden = true; $('[data-detail]').hidden = false;
      $('[data-crumb]').textContent = it.style ? `${G.label} · at the loading point` : 'At the loading point';
      $('[data-name]').textContent = it.style ? `${it.style}${it.ref ? ` ${it.ref}` : ''}`
        : `${G.label}${it.cut.endsWith('boxy') ? ' · Boxy' : it.cut.endsWith('crop') ? ' · Cropped' : ''}`;
      $('[data-meta]').textContent = [HANGER[cat.cuts[it.cut].hanger],
        it.placeholder ? `preview on the ${it.cut.replace('_', ' ')} mesh` : it.cut.replace('_', ' ')].filter(Boolean).join(' · ');
      $('[data-slot]').textContent = slotLabel(it);
      $('[data-fabric]').textContent = FABRIC[it.fabric] || it.fabric;
      const way = $('[data-way]'); way.innerHTML = '';
      const seen = new Set();
      for (const c of G.items) {
        if (it.style && c.style !== it.style) continue;     // only this style's colourways
        if (seen.has(c.color)) continue; seen.add(c.color);
        const b = document.createElement('button');
        b.className = 'sw'; b.type = 'button'; b.style.setProperty('--c', c.color); b.dataset.hex = c.color;
        b.title = c.colorName; b.setAttribute('aria-label', c.colorName);
        b.addEventListener('click', () => recolour(it, c.color, c.colorName));
        way.appendChild(b);
      }
      recolour(it, it.color, it.colorName);
      const product = productFor(it);
      const printBtn = $('[data-print]'), note = $('[data-printnote]');
      printBtn.disabled = !product || !globalThis.__CMGO_PRODUCTS?.[product];
      note.hidden = !printBtn.disabled;
      note.textContent = product ? 'The print customiser for this piece is not on this page.' : 'Print placement for this piece is coming. Colour is saved with the enquiry.';
    };
    $('[data-back]').addEventListener('click', () => release(true));
    $('[data-next]').addEventListener('click', () => {
      if (!target) return;
      const cur = target, same = items.filter((i) => i.group === cur.group && i !== cur);
      release(false);
      fetchItem(same.reduce((a, b) => (mod(b.sHome - cur.sHome, L) < mod(a.sHome - cur.sHome, L) ? b : a)));
    });
    $('[data-print]').addEventListener('click', () => { if (target) this.#handOff(target); });

    // ---------------------------------------------------------------- hands on the belt
    // Press a garment and drag: the whole conveyor follows the hand along its own
    // path, forwards or back, with the garment staying under the pointer. Let go
    // and it coasts on the flick, then eases back to running speed. The garments
    // swing from the belt's acceleration, gently, as hanging cloth does.
    // A press without a drag is a click: it fetches the garment.
    // Sweeping the cursor across the belt nudges garments into a small swing.
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), cvs = renderer.domElement;
    const clampA = (a, m) => Math.max(-m, Math.min(m, a));
    const pick = (e) => {
      const r = cvs.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(items.map((i) => i.obj), true)[0];
      return hit && hit.object.userData.item !== undefined ? items[hit.object.userData.item] : null;
    };
    let grab = null, lastVel = 0;
    cvs.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const it = pick(e);
      grab = it && mode === 'idle'                  // the belt is locked while fetching or holding a piece
        ? { it, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false, id: e.pointerId, v: 0 }
        : (it ? { it, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId, clickOnly: true } : null);
    });
    let hoverQueued = false, lastMove = null, prevMove = null;
    const hover = (e) => {
      if (lastMove) prevMove = { x: lastMove.clientX, y: lastMove.clientY, t: lastMove.timeStamp };
      lastMove = e; if (hoverQueued) return; hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const it = pick(lastMove);
        cvs.classList.toggle('hot', !!it);
        if (!it || !prevMove || reduce) return;
        const dtm = Math.max(8, lastMove.timeStamp - prevMove.t);
        const vx = (lastMove.clientX - prevMove.x) / dtm, vy = (lastMove.clientY - prevMove.y) / dtm;   // px per ms
        if (Math.abs(vx) + Math.abs(vy) < 0.05) return;
        const push = (o, f) => {
          if (o.held) return;
          o.rollV = clampA(o.rollV - vx * 0.32 * f, 0.9);
          o.swingV = clampA(o.swingV + vy * 0.24 * f, 0.9);
          o.yawV = clampA(o.yawV + vx * 0.12 * f, 0.8);
        };
        push(it, 1);
        for (const o of items) {                     // neighbours on the carrier catch a little of it
          if (o === it) continue;
          const ds = Math.abs(mod(o.sHome - it.sHome + L / 2, L) - L / 2);
          if (ds < 0.35) push(o, 0.25 * (1 - ds / 0.35));
        }
      });
    };
    cvs.addEventListener('pointermove', (e) => {
      if (grab && e.pointerId === grab.id && !grab.clickOnly) {
        const dt = Math.max(1, e.timeStamp - grab.t) / 1000;
        const dx = e.clientX - grab.x, dy = e.clientY - grab.y;
        if (!grab.moved && Math.hypot(e.clientX - grab.x0, e.clientY - grab.y0) > 6) {
          grab.moved = true;
          try { cvs.setPointerCapture(e.pointerId); } catch {}
          cvs.classList.add('grabbing');
          status('hold', 'Running the belt by hand');
        }
        if (grab.moved) {
          // Follow the pointer along the belt's direction on screen: project a short
          // step of the path at the held garment and move the belt by the part of the
          // drag that runs along it.
          const a3 = new THREE.Vector3(), b3 = new THREE.Vector3(), t3 = new THREE.Vector3();
          sample(grab.it.sHome + offset, a3, t3);
          b3.copy(a3).addScaledVector(t3, 0.25);
          a3.project(camera); b3.project(camera);
          const r = cvs.getBoundingClientRect();
          const sx = (b3.x - a3.x) * r.width / 2, sy = -(b3.y - a3.y) * r.height / 2;   // pixels per 0.25 m of belt
          const len2 = sx * sx + sy * sy;
          if (len2 > 4) {
            const ds = 0.25 * (dx * sx + dy * sy) / len2;
            offset += ds;
            grab.v = 0.6 * grab.v + 0.4 * (ds / dt);
          }
        }
        grab.x = e.clientX; grab.y = e.clientY; grab.t = e.timeStamp;
        return;
      }
      hover(e);
    });
    const endGrab = (e) => {
      if (!grab || e.pointerId !== grab.id) return;
      const g = grab; grab = null; cvs.classList.remove('grabbing');
      const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
      if (!g.moved && dist <= 6) { if (e.type === 'pointerup' && g.it !== target && mode !== 'fetch') fetchItem(g.it); return; }
      if (g.clickOnly) return;
      vel = clampA(g.v, 1.2);                           // let go: the belt coasts on the flick
      status('idle', `Running · ${IDLE.toFixed(2)} m/s`);
    };
    cvs.addEventListener('pointerup', endGrab);
    cvs.addEventListener('pointercancel', endGrab);

    // ---------------------------------------------------------------- loop
    this.#ro = new ResizeObserver(fit); this.#ro.observe(this); this.#ro.observe(panel);
    try { if (localStorage.getItem('cmgo-conveyor-min') === '1') setMin(true, false); } catch {}
    this.#io = new IntersectionObserver(([e]) => { this.#visible = e.isIntersecting; }, { threshold: 0.02 });
    this.#io.observe(this);
    fit();
    goView('full', true);
    status('idle', `Running · ${IDLE.toFixed(2)} m/s`);
    $('.loading').hidden = true;

    const clock = new THREE.Clock();
    let slow = 0;
    renderer.setAnimationLoop(() => {
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.05);                   // physics steps stay small
      const camDt = Math.min(rawDt, 0.5);                 // camera moves take real time, even on a slow device
      if (!this.#visible || this.#paused) return;
      if (mode === 'idle') {
        if (grab && grab.moved && !grab.clickOnly) {         // the hand drives the belt
          vel = grab.v; grab.v *= Math.pow(0.02, dt);          // stop moving the pointer and the belt stops
        } else {
          vel += Math.sign(IDLE - vel) * Math.min(Math.abs(IDLE - vel), ACC * 0.6 * dt);
          offset += vel * dt;
        }
      } else if (mode === 'fetch') {
        const rem = goal - offset;
        const want = Math.min(fv, Math.sqrt(2 * fa * Math.max(rem, 0)));
        vel += Math.sign(want - vel) * Math.min(Math.abs(want - vel), fa * 1.6 * dt);
        offset += Math.max(vel, 0.02) * dt;
        status('fetch', `Fetching slot ${slotLabel(target)} · ${Math.max(rem, 0).toFixed(1)} m`);
        if (rem <= 0.003 || reduce) arrive();
      }
      if (pulled) {
        const want = mode === 'hold' && target === pulled ? 1 : 0;
        pull += Math.sign(want - pull) * Math.min(Math.abs(want - pull), dt / 0.45);
        if (!want && pull <= 0) { pull = 0; pulled = null; }
      }
      const beltAcc = clampA((vel - lastVel) / Math.max(dt, 1e-3), 8); lastVel = vel;
      const kick = reduce ? 0 : -beltAcc * dt * 0.3;       // hanging cloth lags behind the belt
      for (const it of items) {
        if (kick) { it.swingV += kick * 0.47; it.rollV += kick * 0.88; }
        if (!it.held) {
          if (it.swingV || it.swing) {          // damped pendulum, front-to-back
            it.swingV += (-it.swing * 26 - it.swingV * 2.4) * dt;
            it.swing += it.swingV * dt;
            if (Math.abs(it.swing) < 1e-4 && Math.abs(it.swingV) < 1e-3) { it.swing = 0; it.swingV = 0; }
          }
          if (it.rollV || it.roll) {            // side-to-side, a little quicker
            it.rollV += (-it.roll * 30 - it.rollV * 2.6) * dt;
            it.roll += it.rollV * dt;
            if (Math.abs(it.roll) < 1e-4 && Math.abs(it.rollV) < 1e-3) { it.roll = 0; it.rollV = 0; }
          }
          if (it.yawV || it.yaw) {              // turns home on its hook, unless it is the piece in hand
            const k = it.keepYaw ? 0 : 7, c = it.keepYaw ? 4.5 : 3.8;
            it.yawV += (-it.yaw * k - it.yawV * c) * dt;
            it.yaw += it.yawV * dt;
            if (Math.abs(it.yawV) < 1e-3 && (it.keepYaw || Math.abs(it.yaw) < 1e-3)) { it.yawV = 0; if (!it.keepYaw) it.yaw = 0; }
          }
        }
        place(it);
      }
      if (cam.t < 1) {
        cam.t = Math.min(1, cam.t + camDt / 0.85);
        const k = cam.t < 0.5 ? 4 * cam.t ** 3 : 1 - (-2 * cam.t + 2) ** 3 / 2;
        camera.position.lerpVectors(cam.from.p, cam.to.p, k);
        camTarget.lerpVectors(cam.from.t, cam.to.t, k);
        hfov = cam.from.h + (cam.to.h - cam.from.h) * k;
        sw = cam.from.sw + (cam.to.sw - cam.from.sw) * k;
        lf = cam.from.lf + (cam.to.lf - cam.from.lf) * k;
        project();
      }
      moveChain();
      camera.lookAt(camTarget);
      if (composer) {
        composer.render(dt);
        // If ambient occlusion pushes the frame past ~28 ms for two seconds, drop it.
        if (rawDt < 0.25) slow = rawDt > 0.028 ? slow + rawDt : Math.max(0, slow - rawDt * 0.5);   // ignore tab switches
        if (slow > 2) { composer.dispose(); composer = null; console.info('[cmgo-conveyor] ambient occlusion off: device too slow'); }
      } else {
        renderer.render(scene, camera);
      }
    });
    this.#r = { renderer, scene, camera };
  }

  /**
   * Open the showroom's configurator for this garment, in this colour.
   * The configurator starts on the product's first colour, so the chosen one is
   * moved (or added) to the front of that product's list before it loads; one
   * that is already open is told to reload, keeping its artwork placements.
   */
  #handOff(it) {
    const id = productFor(it);
    const P = globalThis.__CMGO_PRODUCTS?.[id];
    const show = document.querySelector('cmgo-showroom');
    if (!P || !show?.select) return;
    const hex = it.color.toUpperCase();
    const found = P.colours.find((c) => c.hex.toUpperCase() === hex);
    const chosen = found || { name: it.colorName, hex };
    P.colours = [chosen, ...P.colours.filter((c) => c !== chosen)];
    const open = show.shadowRoot?.querySelector(`cmgo-configurator[product-id="${id}"]`);
    if (open) open.setAttribute('product-id', id);
    show.select(id);
  }
}

customElements.define('cmgo-conveyor', CmgoConveyor);
export { CmgoConveyor };
