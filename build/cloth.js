/**
 * cloth.js — the garments move like cloth.
 *
 * Why not a physics engine
 * ------------------------
 * The obvious answer to "make it move like fabric" is Ammo (Bullet) soft
 * bodies. It was the right thing to reject here, for three reasons that are
 * specific to this project rather than general:
 *
 *   1. The print areas are SEPARATE MESHES floating 1.6 mm above the fabric —
 *      that is how artwork stopped bleeding into the collar. Simulate the
 *      garment and not the decal and the customer's design detaches and hangs
 *      in mid air. Skinning the decal to a cloth solve is possible, but then
 *      the millimetre guarantee becomes a rest-pose guarantee decided by a
 *      solver instead of by construction.
 *   2. The garment meshes are single Tripo shells — ~20k triangles, no clean
 *      quad topology, nothing pinned. Cloth solvers want a low-poly simulation
 *      mesh with anchored vertices. That is modelling work, not an import.
 *   3. About a megabyte of unmaintained WebAssembly, on a store front, over
 *      mobile data, for decoration.
 *
 * What this does instead
 * ----------------------
 * One line of vertex displacement, weighted so the shoulders are pinned and
 * the hem moves most. The body's swing comes from a damped pendulum; the cloth
 * TRAILS that swing, because a hem is late to arrive and late to leave. That
 * lag is the whole illusion. It is perhaps a tenth of the code of a solver and
 * about eighty per cent of the look.
 *
 * Every term is multiplied by the angle or the angular velocity, so when the
 * pendulum is at rest the displacement is EXACTLY zero and the garment sits in
 * its true rest pose. That matters more here than it looks: the customer is
 * judging a print position in millimetres, and a preview that never quite
 * settles is a preview that quietly lies about where their design is.
 *
 * Normals are not recomputed. At these amplitudes — 25 mm of travel on a
 * 700 mm garment — the lighting error is invisible, and recomputing them per
 * frame would cost more than the effect is worth.
 *
 * Reaching the material
 * ---------------------
 * model-viewer does not expose its three.js scene: this uses the private
 * `scene` symbol, which the maintainers warn can break without notice, and
 * say they intend to make public. So every path here fails SOFT — no scene, no
 * meshes, no symbol, and you get a controller that does nothing while the rest
 * of the page carries on. A decoration must never be load-bearing.
 */

const DECL = `
uniform float uTop;    // object-space Y of the shoulders
uniform float uSpan;   // object-space height of the garment
uniform float uAngle;  // body swing, radians
uniform float uVel;    // angular velocity, radians/second
uniform float uTime;
uniform float uBody;   // 1 = rotate the body here too (no CSS pendulum around us)
`;

const DISPLACE = `
  float clothH = clamp((uTop - position.y) / max(uSpan, 1e-4), 0.0, 1.0);
  float clothW = clothH * clothH;             // squared: the shoulders barely move

  if (uBody > 0.5) {
    // Swing the whole garment about its shoulder line. In the showroom the
    // hanger and the garment are rotated together in CSS, so this is off; in
    // the customiser there is no hanger to rotate, so it is on.
    float ca = cos(uAngle), sa = sin(uAngle);
    float py = transformed.y - uTop;
    float nx = transformed.x * ca - py * sa;
    float ny = transformed.x * sa + py * ca;
    transformed.x = nx;
    transformed.y = ny + uTop;
  }

  // The hem is late. Most of the lag is inertia, which is velocity, plus a
  // little from the angle itself.
  float trail = uAngle * 0.18 + uVel * 0.030;
  transformed.x -= trail * uSpan * clothW;

  // A shallow travelling fold, alive only while the garment is moving.
  float amp = min(abs(uVel) * 0.018 + abs(uAngle) * 0.04, 0.010);
  transformed.z += sin(uTime * 6.5 + position.y * 26.0) * amp * clothW;
`;

/**
 * A damped pendulum. theta'' = -(g/L)·sin(theta) - c·theta'.
 *
 * `advance` integrates in FIXED steps rather than one step per frame, which is
 * not fussiness: feed a variable frame time straight into the integrator and a
 * device rendering at fifteen frames a second runs the physics at a quarter
 * speed, so the garment keeps wobbling for half a minute. The swing has to
 * take the same real time on a laptop and on a cheap phone.
 */
export class Pendulum {
  static FIXED = 1 / 120;

  constructor({ length = 1, damp = null, max = 0.2 } = {}) {
    this.a = 0;
    this.v = 0;
    this.acc = 0;
    this.w2 = 23 / length;                    // g/L — short things swing faster
    this.damp = damp ?? (0.95 + 0.4 * length);
    this.max = max;
  }

  push(force, cap = 2.4) {
    this.v = Math.max(-cap, Math.min(cap, this.v + force));
  }

  step(dt) {
    this.v += (-this.w2 * Math.sin(this.a) - this.damp * this.v) * dt;
    this.a += this.v * dt;
    if (this.a > this.max) { this.a = this.max; this.v = Math.min(this.v, 0); }
    if (this.a < -this.max) { this.a = -this.max; this.v = Math.max(this.v, 0); }
  }

  /** Integrate `dt` seconds of real time, however many frames that took. */
  advance(dt) {
    this.acc += Math.min(dt, 0.25);          // a tab coming back from the background
    while (this.acc >= Pendulum.FIXED) {
      this.step(Pendulum.FIXED);
      this.acc -= Pendulum.FIXED;
    }
  }

  get alive() {
    return Math.abs(this.a) > 8e-4 || Math.abs(this.v) > 4e-3;
  }

  rest() { this.a = 0; this.v = 0; this.acc = 0; }
}

const NOOP = { ok: false, set() {}, dispose() {} };
let warned = false;

/**
 * Give every material in a <model-viewer> the cloth displacement.
 * Returns { ok, set(angle, vel, time), dispose() }.
 */
export function attachCloth(mv, { body = false } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return NOOP;

  const sym = Object.getOwnPropertySymbols(mv)
    .find((s) => s.description === 'scene');
  if (!sym) {
    if (!warned) {
      warned = true;
      console.info('[cmgo] model-viewer internals moved; cloth movement is off.');
    }
    return NOOP;
  }
  const scene = mv[sym];
  if (!scene?.traverse) return NOOP;

  const u = {
    uTop:   { value: 0 },
    uSpan:  { value: 1 },
    uAngle: { value: 0 },
    uVel:   { value: 0 },
    uTime:  { value: 0 },
    uBody:  { value: body ? 1 : 0 },
  };

  const touched = [];
  let lo = Infinity, hi = -Infinity;

  // model-viewer parks its shadow rig in the same scene: two unnamed meshes
  // under an orthographic camera, spanning y -0.5 to 0.5. Measure the garment
  // against those and its height comes out nearly double, so the whole
  // displacement is scaled wrong — and the blur pass gets a vertex shader
  // injected into it for no reason. glTF only ever produces standard
  // materials, which is the cleanest thing to sort on.
  const ours = (o) => {
    if (!o.isMesh || !o.geometry || !o.material) return false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((m) => m?.isMeshStandardMaterial)) return false;
    for (let n = o; n; n = n.parent) if (n.isCamera) return false;
    return true;
  };

  scene.traverse((o) => {
    if (!ours(o)) return;
    o.geometry.computeBoundingBox?.();
    const bb = o.geometry.boundingBox;
    if (bb) { lo = Math.min(lo, bb.min.y); hi = Math.max(hi, bb.max.y); }

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.__cmgoCloth) continue;
      m.__cmgoCloth = true;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer);
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${DECL}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${DISPLACE}`);
      };
      // Without its own cache key three.js may hand this material a program
      // compiled for an untouched one, and the displacement silently vanishes.
      m.customProgramCacheKey = () => 'cmgo-cloth';
      m.needsUpdate = true;
      touched.push(m);
    }
  });

  if (!touched.length) return NOOP;

  u.uTop.value = hi;
  u.uSpan.value = Math.max(hi - lo, 1e-4);

  const api = {
    ok: true,
    set(angle, vel, time) {
      u.uAngle.value = angle;
      u.uVel.value = vel;
      u.uTime.value = time;
      scene.queueRender?.();
    },
    // For debugging and tests only.
    state() {
      return { angle: u.uAngle.value, vel: u.uVel.value, top: u.uTop.value, span: u.uSpan.value };
    },
    dispose() {
      for (const m of touched) {
        m.onBeforeCompile = () => {};
        m.customProgramCacheKey = () => '';
        m.__cmgoCloth = false;
        m.needsUpdate = true;
      }
      delete mv.__cloth;
    },
  };

  // A handle for debugging and for tests: set an angle by hand and watch the
  // garment move. Nothing in the page reads it.
  mv.__cloth = api;
  return api;
}
