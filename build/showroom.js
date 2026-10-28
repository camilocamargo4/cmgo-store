/**
 * <cmgo-showroom> — the store front the configurator lives inside.
 *
 * A quiet room. Garments float in it. Pick one and the room recedes; the
 * chosen piece becomes the whole stage with the customise controls beside it.
 *
 * This is presentation only. It owns no artwork, no millimetres, no validation
 * — it mounts <cmgo-configurator> and lets the `design:submit` event bubble
 * straight past it to the host page. Swapping this shell out later changes
 * nothing about how an order is produced.
 *
 * Items come from window.__CMGO_SHOWROOM:
 *   [{ id: 'tee-classic', name: 'Classic Tee', note: 'From $38' },
 *    { id: 'cap-sixpanel', name: 'Cap', peg: true, orientation: '0deg 60deg 0deg' },
 *    { name: 'Hoodie', soon: true }]
 * An entry with `soon` renders as a placeholder — no model, no WebGL context.
 * An entry with `peg` hangs from a peg rather than a hanger: a cap on a coat
 * hanger reads as a mistake, and the rack is the first thing a customer sees.
 * `orientation` poses it on the rail only — a cap hangs off a peg by its back
 * with the brim dangling, but in the customiser it stands upright, because
 * that is how you look at something you are putting a print on.
 */

import { Pendulum, attachCloth } from './cloth.js';

const CSS = `
:host{
  --wall-top:#2b2b2e; --wall:#565059; --wall-2:#6d6670;
  --floor:#8d8781; --floor-2:#6a655f;
  --rail:#131316;
  --ink:#f2f0ee; --muted:#a49e98; --line:#3a3740;
  --card:#ffffff; --accent:#c9c2bb;
  display:block; container-type:inline-size;
  font:14px/1.5 Archivo, ui-sans-serif, system-ui, -apple-system, sans-serif;
  color:var(--ink);
}
*{box-sizing:border-box}

/* --- the room ------------------------------------------------------------
   The room is a photograph, not a drawing. It used to be gradients doing an
   impression of one — a passable likeness that stopped being worth defending
   the moment there was a real picture to use. The rail is cut out of the same
   shoot, and the cut is made so that the CENTRE OF THE BAR is the image's own
   bottom edge: the garments hang off the bottom of the rig, with no offset
   for anyone to get wrong later. */
.room{
  /* The rail is IN the photograph now, so these are measurements of the
     photograph, not of a cut-out: the bar's centre line sits 28.6% down the
     image and the frame spans about two thirds of its width, both read off the
     pixels rather than guessed. */
  --room-ar:1.806;
  --rail-y:28.6%;
  --rig-w:67cqw;
  position:relative;
  border-radius:14px;
  overflow:hidden;
  isolation:isolate;
  /* Never let the room be WIDER than the photograph's own aspect. background
     cover crops whichever axis overflows: crop the sides and the rail stays
     28.6% down; crop the top and bottom and it slides, and every garment comes
     off its hook. So the height is floored at the photograph's aspect and the
     cropping is always horizontal. */
  min-height:max(min(84vh,780px), calc(100cqw / var(--room-ar)));
  background:#0c1114 center/cover no-repeat;
  padding:clamp(18px,3cqw,34px);
}
/* The ceiling in the photograph is a lightbox, and white type on a lightbox is
   not type. A short scrim across the top, nothing more. */
.room::before{
  content:'';position:absolute;left:0;right:0;top:0;height:26%;z-index:2;
  background:linear-gradient(rgba(10,14,17,.62),transparent);
  pointer-events:none;
}
:host([scene="clear"]) .room{background:transparent}
.head{position:relative;z-index:3}

@container (max-width: 760px){
  .room{
    --rig-w:80cqw; --piece-w:clamp(150px,60cqw,250px);
    min-height:max(min(72vh,600px), calc(100cqw / var(--room-ar)));
  }
}

.head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
.mark{font-size:13px;font-weight:600;letter-spacing:-.01em}
.kicker{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}

/* --- the rack ------------------------------------------------------------
   An absolutely positioned strip that starts exactly on the bar. A margin in
   percent would have resolved against the room's WIDTH, which is not where
   the rail is. */
/* --- garments on the rail ----------------------------------------------- */
.rack{
  /* Bound to the rig, not to the room: a garment hanging past the end of the
     frame it is supposed to be hanging from is the sort of thing you only
     notice on a phone, where the frame is narrow. */
  position:absolute; top:var(--rail-y); z-index:2;
  left:50%; width:var(--rig-w); transform:translateX(-50%);
  display:flex; align-items:start;
  padding-inline:clamp(8px,2cqw,26px);
  gap:clamp(8px,2cqw,30px);
  overflow-x:auto; overscroll-behavior-x:contain;
  scroll-snap-type:x proximity; scrollbar-width:thin;
  padding-bottom:18px;
}
.rack::-webkit-scrollbar{height:6px}
.rack::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:99px}

.piece{
  flex:0 0 var(--piece-w,clamp(180px,19cqw,240px));
  scroll-snap-align:center;
  display:grid; justify-items:center; gap:0;
  background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;
  transition:transform .5s cubic-bezier(.2,.7,.3,1);
}
.piece[disabled]{cursor:default}
.piece:hover:not([disabled]){transform:translateY(-4px)}
.piece.dead .sway{transform:none !important}

/* The garment and its hanger swing together about the hook; the label stays
   put, because a label nailed to the wall does not sway. The pivot is a few
   pixels above the piece's top edge — that is where the hook actually rests
   on the bar. */
.sway{
  /* width:100% matters: .piece centres its children rather than stretching
     them, so without it this wrapper shrinks to the hanger and takes the
     garment down with it. */
  width:100%;
  display:grid; justify-items:center;
  transform-origin:50% -9px;
  will-change:transform;
}
@media (prefers-reduced-motion:reduce){ .sway{transform:none !important} }

/* the hanger hooks over the bar; its hook tip sits exactly on --rail-y */
.hanger{display:block;width:56%;max-width:140px;margin-top:-6px;color:#15181c}
img.hanger{height:auto;filter:drop-shadow(0 7px 11px rgba(0,0,0,.5))}
.hanger svg{display:block;width:100%;height:auto;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
/* A peg for things that don't hang from shoulders. Same box as the hanger,
   so every piece on the rail still starts at the same height. */
.hanger.peg svg{filter:drop-shadow(0 5px 9px rgba(0,0,0,.45))}
/* A cap hangs off its peg by the back, so its silhouette fills more of the
   square viewer box than an upright one did and it needs far less pulling up.
   The matching negative margin underneath keeps its label on the same line as
   the rest of the rail. */
/* A cap sits closer to its peg than a garment does to its hanger. */
.piece.pegged .plinth{--lift:23%}

.plinth{
  /* True relative size on the rail: --scale is the piece's real posed height
     against the tallest piece's. The button keeps its full width, so a small
     piece stays just as easy to hit as a big one. */
  width:calc(100% * var(--scale, 1)); aspect-ratio:1/1;
  /* A WebGL canvas keeps colour in its fully-transparent pixels, and at
     fractional display scaling — 125%, 150%, the usual Windows settings — the
     browser resamples the layer edge and that colour leaks out as a bright
     hairline across the bottom of every garment. It is not the photograph and
     it is not the shadow: it is the canvas boundary. So the canvas is grown a
     few pixels past its box and the box clips the edge away. */
  overflow:hidden;

  /* --lift pulls the garment up under its hanger far enough that the SHOULDERS
     REST ON IT. model-viewer frames a model with padding, so the garment's
     shoulders sit some way below the top of its box; without this the hanger
     floats above the piece and the two read as unrelated objects.
     It is a fraction, not pixels, so it holds at any size — and it scales with
     the piece, because the padding it is cancelling scales too.
     Percentage margins resolve against the container's WIDTH, which is exactly
     what the square plinth's height is derived from. */
  margin-top:calc(-1 * var(--lift, 16%) * var(--scale, 1));
  /* Give back what the lift and the scaling took, so every label on the rail
     stays on one line whatever size its piece is. */
  margin-bottom:calc((1 - var(--scale, 1)) * 100% + var(--lift, 16%) * var(--scale, 1) - 16%);
  display:grid; place-items:start center; position:relative;
}
.plinth model-viewer{
  width:calc(100% + 8px); height:calc(100% + 8px); margin:-4px;
  background:transparent;--poster-color:transparent;pointer-events:none;
}
/* If a garment cannot load, say so where the garment should have been. */
.failed{
  position:absolute;inset:12% 6% 18%;display:grid;place-content:center;gap:6px;
  text-align:center;border:1px dashed rgba(255,255,255,.28);border-radius:10px;
  color:#e7c9b0;font-size:11px;line-height:1.5;padding:12px;
  font-family:'IBM Plex Mono',ui-monospace,monospace;
}
.failed b{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#f0a882}

/* The reveal: the rail is there first, the garment arrives. The resting state
   is VISIBLE — the animation only replays the arrival. An opacity:0 default
   turns any load failure into an empty rack with nothing to diagnose. */
.room.dressing .plinth model-viewer{opacity:0;transform:translateY(-10px)}
.room.dressed .plinth model-viewer{
  animation:settle .9s cubic-bezier(.2,.8,.3,1) both;
}
.room.dressed .piece:nth-child(2) .plinth model-viewer{animation-delay:.12s}
.room.dressed .piece:nth-child(3) .plinth model-viewer{animation-delay:.24s}
.room.dressed .piece:nth-child(4) .plinth model-viewer{animation-delay:.36s}
@keyframes settle{ to{opacity:1;transform:none} }
@media (prefers-reduced-motion:reduce){
  .plinth model-viewer{opacity:1;transform:none}
  .room.dressed .plinth model-viewer{animation:none}
}

.label{display:grid;gap:3px;justify-items:center;text-align:center;margin-top:10px}
.label .n{font-size:13px;font-weight:500}
.label .s{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.piece:hover:not([disabled]) .label .n{text-decoration:underline;text-underline-offset:3px}
.piece[disabled] .label .n{color:var(--muted)}

/* --- the customiser comes up over the room ------------------------------ */
.overlay{
  position:fixed; inset:0; z-index:2147483000;
  display:grid; place-items:center; padding:clamp(8px,2vw,26px);
  background:rgba(8,11,14,.66); backdrop-filter:blur(7px);
  animation:fade .22s ease both;
}
.overlay[hidden]{display:none}
.card{
  width:min(1180px,100%); max-height:min(100%,960px);
  display:grid; grid-template-rows:auto 1fr; overflow:hidden;
  background:#fff; color:#17181b; border-radius:16px;
  box-shadow:0 40px 90px rgba(0,0,0,.55);
  animation:rise .34s cubic-bezier(.2,.8,.3,1) both;
}
.card:focus{outline:none}
.cardtop{
  display:flex; align-items:center; gap:14px;
  padding:14px clamp(14px,2cqw,22px); border-bottom:1px solid #ebebee;
}
.title{font-size:clamp(16px,2.2cqw,21px);font-weight:600;letter-spacing:-.02em;margin:0}
.crumb{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.14em;
       text-transform:uppercase;color:#9a9aa1}
.close{
  margin-left:auto;display:grid;place-items:center;width:34px;height:34px;flex:none;
  background:none;border:1px solid #e4e4e8;border-radius:50%;cursor:pointer;color:#17181b;
}
.close:hover{border-color:#17181b}
.close svg{width:14px;height:14px}
.sheet{overflow:auto;padding:clamp(12px,1.8cqw,20px);-webkit-overflow-scrolling:touch}
cmgo-configurator{--cmgo-stage:#f7f7f9;--big-h:min(58vh,540px)}

@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes rise{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .overlay,.card{animation:none}
}

:focus-visible{outline:2px solid #8ab4ff;outline-offset:3px;border-radius:6px}
`;

class CmgoShowroom extends HTMLElement {
  #items = [];
  #built = new Map(); // productId -> configurator element
  #onKey = null;
  #stopSwing = null;
  #scrollLock = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  disconnectedCallback() {
    this.#stopSwing?.();
    if (this.#onKey) document.removeEventListener('keydown', this.#onKey);
    document.body.style.overflow = this.#scrollLock ?? '';
  }

  connectedCallback() {
    this.#items = globalThis.__CMGO_SHOWROOM ?? [];
    if (!this.hasAttribute('mode')) this.setAttribute('mode', 'browse');
    this.#render();
  }

  #render() {
    const brand = this.getAttribute('brand') || 'Cmgo Design';
    const asset = (name) => globalThis.__CMGO_ROOM?.[name]
      ?? `${(this.getAttribute('assets-url') || 'assets/').replace(/\/?$/, '/')}${name}`;
    // A short peg: the same hook over the same bar, then a stem and a ball for
    // a cap to sit on. Drawn at the hanger's scale so both read as one fitting.
    const peg = `<span class="hanger peg"><svg viewBox="0 0 120 44" aria-hidden="true"><path d="M60 3c-4 0-7 2.6-7 6.2 0 2.7 1.7 4.2 3.4 5.2L60 16.4l3.6-2c1.7-1 3.4-2.5 3.4-5.2C67 5.6 64 3 60 3Z" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="57.8" y="15" width="4.4" height="16" rx="2.2" fill="currentColor"/><circle cx="60" cy="35.5" r="7.5" fill="currentColor"/></svg></span>`;
    // The hanger is the real model, rendered once to a transparent PNG by
    // tools/render_prop.mjs. It never changes colour, never carries artwork and
    // is never seen from another angle, so a second WebGL context per garment
    // would buy nothing on a page already running one each.
    const hanger = `<img class="hanger" src="${asset('hanger.png')}" alt="">`;


    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="room" style="background-image:url('${asset('room.jpg')}')">
        <div class="head">
          <span class="mark">${brand}</span>
          <span class="kicker">Select a piece to customise</span>
        </div>

        <div class="rack">
          ${this.#items.map((it) => `
            <button class="piece${it.peg ? ' pegged' : ''}" data-id="${it.id ?? ''}" ${it.soon ? 'disabled' : ''}
                    ${it.scale && it.scale !== 1 ? `style="--scale:${it.scale}"` : ''}
                    aria-label="${it.soon ? `${it.name} — coming soon` : `Customise the ${it.name}`}">
              <span class="sway">
              ${it.peg ? peg : hanger}
              <span class="plinth">
                ${it.soon ? '' : `<model-viewer rotation-per-second="20deg"
                     ${it.orientation ? `orientation="${it.orientation}"` : ''}
                     auto-rotate-delay="0" interaction-prompt="none" disable-zoom
                     camera-orbit="${it.peg ? '0deg 74deg 100%' : '0deg 86deg 104%'}" field-of-view="26deg"
                     shadow-intensity="0" exposure="0.98"
                     environment-image="neutral" loading="eager"></model-viewer>`}
              </span>
              </span>
              <span class="label">
                <span class="n">${it.name}</span>
                <span class="s">${it.soon ? 'Coming soon' : (it.note ?? 'Customise')}</span>
              </span>
            </button>`).join('')}
        </div>
      </div>

      <div class="overlay" hidden>
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="cmgo-title" tabindex="-1">
          <div class="cardtop">
            <span class="crumb">Customise</span>
            <h2 class="title" id="cmgo-title"></h2>
            <button class="close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
          <div class="sheet"></div>
        </div>
      </div>
    `;

    const room = this.shadowRoot.querySelector('.room');

    // The rail stands empty first, then the garments arrive on it. Waiting for
    // the model to actually load means the reveal is the garment appearing,
    // not an empty box fading in and filling later.
    // hand each viewer its candidate sources, in preference order
    const withModel = this.#items.filter((it) => !it.soon);
    [...this.shadowRoot.querySelectorAll('.plinth model-viewer')].forEach((mv, i) => {
      const src = withModel[i]?.model;
      mv.__sources = Array.isArray(src) ? src : [src];
    });

    const models = [...this.shadowRoot.querySelectorAll('.plinth model-viewer')];
    if (models.length) {
      room.classList.add('dressing');
      let left = models.length;
      const dress = () => {
        this.#trueToSize(models);
        room.classList.remove('dressing');
        room.classList.add('dressed');
      };
      const done = () => { if (--left <= 0) setTimeout(dress, 200); };

      const fail = (mv, why) => {
        const plinth = mv.parentElement;
        if (plinth.querySelector('.failed')) return;
        // A piece that failed to load stops swinging: a diagnostic panel
        // swaying on a hanger is a joke at the reader's expense.
        mv.closest('.piece')?.classList.add('dead');
        mv.style.display = 'none';
        plinth.insertAdjacentHTML('beforeend',
          `<span class="failed"><b>Not loaded</b>${why}</span>`);
        done();
      };

      // A product may offer several ways to reach the same model — a published
      // file, an inlined data URI, a blob. Which of them a host page's content
      // policy permits is not knowable from here, so try each in turn and take
      // the first that loads rather than betting the whole rack on one.
      models.forEach((mv) => {
        const sources = (mv.__sources ?? []).slice();
        let settled = false;

        const attempt = () => {
          if (settled) return;
          const next = sources.shift();
          if (next === undefined) return fail(mv, 'no source loaded');
          mv.src = typeof next === 'function' ? next() : next;
        };

        mv.addEventListener('load', () => { settled = true; done(); }, { once: true });
        mv.addEventListener('error', () => attempt());
        // A source that neither loads nor errors is the worst case: nothing to
        // see and nothing in the console. Give each one a deadline.
        const tick = setInterval(() => {
          if (settled) return clearInterval(tick);
          if (!mv.loaded) attempt();
        }, 9000);
        setTimeout(() => clearInterval(tick), 60000);

        attempt();
      });
      setTimeout(dress, 6000);
    } else {
      room.classList.add('dressed');
    }

    this.shadowRoot.querySelectorAll('.piece:not([disabled])').forEach((b) => {
      b.addEventListener('click', () => this.select(b.dataset.id));
      const mv = b.querySelector('model-viewer');
      if (!mv) return;
      const spin = (on) => on ? mv.setAttribute('auto-rotate', '') : mv.removeAttribute('auto-rotate');
      b.addEventListener('pointerenter', () => spin(true));
      b.addEventListener('pointerleave', () => { spin(false); mv.resetTurntableRotation?.(); });
      b.addEventListener('focus', () => spin(true));
      b.addEventListener('blur', () => { spin(false); mv.resetTurntableRotation?.(); });
    });

    this.#swing();

    const overlay = this.shadowRoot.querySelector('.overlay');
    this.shadowRoot.querySelector('.close').addEventListener('click', () => this.browse());
    // Click the scrim, not the card. Escape closes it too — a modal that traps
    // you is worse than no modal.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.browse(); });
    this.#onKey = (e) => { if (e.key === 'Escape' && !overlay.hidden) this.browse(); };
    document.addEventListener('keydown', this.#onKey);
  }

  /**
   * Make the rail honest about size.
   *
   * model-viewer frames every model to fill its own box, so a tee and a hoodie
   * of exactly the same real height come out different sizes on screen: the
   * hoodie's sleeves make its bounding sphere bigger, so it gets pushed further
   * away and renders smaller. The cap, being tiny, was rendering as large as
   * either of them.
   *
   * The framing distance model-viewer settles on IS a measure of how big the
   * model is, so sizing each box in proportion to that distance cancels the
   * framing exactly: on-screen height goes back to being proportional to real
   * height, for any model, with nothing measured by hand.
   *
   * Read at reveal time, while the rack is still hidden, so the correction is
   * never seen being applied. The build ships an estimate as the starting
   * value, so a browser that will not tell us the orbit still looks right.
   */
  #trueToSize(models) {
    const radii = models.map((mv) => {
      try { return mv.getCameraOrbit?.().radius || 0; } catch { return 0; }
    });
    const biggest = Math.max(...radii);
    if (!(biggest > 0)) return;
    models.forEach((mv, i) => {
      if (!radii[i]) return;
      mv.closest('.piece')?.style.setProperty('--scale', (radii[i] / biggest).toFixed(4));
    });
  }

  /**
   * Things hanging from a rail should behave like things hanging from a rail.
   *
   * Each piece is a damped pendulum pivoting on its hook. The cursor sweeping
   * past pushes it in the direction the cursor is travelling and by how fast
   * it is travelling; gravity pulls it back; friction settles it. That is the
   * whole model — theta'' = -(g/L)·sin(theta) - c·theta' — integrated once per
   * frame for every piece at once.
   *
   * Length, not weight, sets the rhythm: a long hoodie swings slowly, a cap on
   * a peg twitches. They are given different lengths so the rack never moves
   * in lockstep, which is the thing that makes a rack of clothes read as cloth
   * rather than as a row of images being animated.
   *
   * The loop stops when everything is still and starts again on the next
   * push, so an idle rack costs nothing.
   */
  #swing() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rack = this.shadowRoot.querySelector('.rack');
    if (!rack) return;

    const MAX_ANGLE = 0.2;        // ~11 degrees; past that it stops being cloth
    const MAX_SPIN  = 2.4;
    const PUSH      = 0.36;       // radians/s per pixel/ms of cursor travel

    const parts = [...this.shadowRoot.querySelectorAll('.piece')].map((el, i) => {
      const sway = el.querySelector('.sway');
      // a cap on a peg is short; a hoodie is long; a tee sits between them
      const len = el.classList.contains('pegged') ? 0.42 : (i % 2 ? 1.15 : 1);
      // The body's swing is the CSS rotation of the whole piece — hanger
      // included — so the shader here adds only the cloth trailing behind it.
      // A cap is not cloth: it gets the swing and none of the flapping.
      const mv = el.querySelector('model-viewer');
      const part = { el, sway, p: new Pendulum({ length: len, max: MAX_ANGLE }), cloth: null };
      if (mv && !el.classList.contains('pegged')) {
        mv.addEventListener('load',
          () => { part.cloth = attachCloth(mv, { body: false }); }, { once: true });
      }
      return part;
    }).filter((p) => p.sway);
    if (!parts.length) return;

    let raf = 0, last = 0, tail = 0;

    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      let alive = false;

      const t = now / 1000;
      for (const part of parts) {
        const q = part.p;
        q.advance(dt);
        if (!q.alive) { q.rest(); part.sway.style.transform = ''; }
        else { part.sway.style.transform = `rotate(${(q.a * 57.29578).toFixed(3)}deg)`; }
        part.cloth?.set(q.a, q.v, t);
        if (q.alive) alive = true;
      }

      // The tail matters: stop in the same tick that sets zero and the zero
      // frame never gets drawn, leaving every garment parked a fraction of a
      // pixel off true rest.
      if (alive) { tail = 3; raf = requestAnimationFrame(step); }
      else if (tail-- > 0) { raf = requestAnimationFrame(step); }
      else { raf = 0; }
    };

    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };

    const nudge = (part, force) => { part.p.push(force, MAX_SPIN); start(); };

    // Measure once, not on every pointer event. Reading a rect mid-animation
    // forces the browser to lay out again, and doing that four times per mouse
    // move is how a sixty-frame effect turns into a thirty-frame one. The
    // pieces themselves never move — only the .sway inside them — so the
    // measurements stay true until the rack scrolls or the window resizes.
    let boxes = [];
    const measure = () => {
      boxes = parts.map((p) => {
        const b = p.el.getBoundingClientRect();
        return { cx: b.left + b.width / 2, reach: b.width * 0.75, top: b.top, bottom: b.bottom };
      });
    };
    measure();
    new ResizeObserver(measure).observe(rack);

    let px = null, pt = 0;
    rack.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (px !== null && now > pt) {
        const vx = (e.clientX - px) / (now - pt);        // pixels per millisecond
        if (Math.abs(vx) > 0.02) {
          parts.forEach((p, i) => {
            const b = boxes[i];
            if (!b) return;
            const d = Math.abs(e.clientX - b.cx);
            if (d > b.reach || e.clientY < b.top - 20 || e.clientY > b.bottom + 20) return;
            nudge(p, vx * PUSH * (1 - d / b.reach));
          });
        }
      }
      px = e.clientX; pt = now;
    }, { passive: true });
    rack.addEventListener('pointerleave', () => { px = null; });

    // Flicking the rail sideways sets the whole row going — the only version
    // of this a phone can offer, since a finger has no hover.
    let sx = rack.scrollLeft;
    rack.addEventListener('scroll', () => {
      const d = rack.scrollLeft - sx;
      sx = rack.scrollLeft;
      measure();
      if (Math.abs(d) < 0.5) return;
      for (const p of parts) nudge(p, -d * 0.016);
    }, { passive: true });

    this.#stopSwing = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  }

  /** Show one product's configurator. Built on first use, kept afterwards so
   *  a customer who goes back and forth doesn't lose their placement. */
  select(id) {
    const item = this.#items.find((i) => i.id === id);
    if (!item) return;

    const sheet = this.shadowRoot.querySelector('.sheet');
    this.shadowRoot.querySelector('.title').textContent = item.name;

    let cfg = this.#built.get(id);
    if (!cfg) {
      cfg = document.createElement('cmgo-configurator');
      cfg.setAttribute('product-id', id);
      cfg.setAttribute('layout', 'stage');
      if (this.hasAttribute('catalogue-url')) {
        cfg.setAttribute('catalogue-url', this.getAttribute('catalogue-url'));
      }
      this.#built.set(id, cfg);
    }
    for (const el of this.#built.values()) el.hidden = el !== cfg;
    if (cfg.parentNode !== sheet) sheet.append(cfg);

    const overlay = this.shadowRoot.querySelector('.overlay');
    overlay.hidden = false;
    this.setAttribute('mode', 'detail');
    // The page behind a full-screen scrim should not scroll away underneath it.
    this.#scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.shadowRoot.querySelector('.card').focus({ preventScroll: true });

    this.dispatchEvent(new CustomEvent('showroom:select', {
      detail: { productId: id }, bubbles: true, composed: true,
    }));
  }

  browse() {
    const overlay = this.shadowRoot.querySelector('.overlay');
    if (overlay) overlay.hidden = true;
    this.setAttribute('mode', 'browse');
    document.body.style.overflow = this.#scrollLock ?? '';
    this.dispatchEvent(new CustomEvent('showroom:browse', { bubbles: true, composed: true }));
  }
}

customElements.define('cmgo-showroom', CmgoShowroom);
export { CmgoShowroom };
