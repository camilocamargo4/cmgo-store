// Soft garment contact. Each garment is a thin box (plan-view rectangle) hanging from its hook.
// Neighbours that overlap on a bend nudge each other aside by turning (yaw) and tilting (swing) about the hook.
// State persists from frame to frame, the push is gentle and rate-limited, and a garment that is no longer
// touched eases back on a slightly under-damped spring, so nothing snaps. Overlap a pair already has on a
// straight stretch of belt is left alone: only the extra a bend adds is removed.
const DEFAULT_FP = { W: 0.6, D: 0.15, zc: 0, top: -0.07, bot: -0.8 };
const HS = [0.12, 0.40, 0.68, 0.96];             // depths below the hook at which each garment is checked
const NS = HS.length;
const MAXY = 28 * Math.PI / 180, MAXT = 4 * Math.PI / 180;      // neighbours turn aside on a bend; they barely lean (was 14°)
const MAX_DY = 0.035, MAX_DT = 0.01;                              // most a push may move a garment in one 60 Hz frame (rad)
const MAXV_Y = 1.1, MAXV_T = 0.9;                                 // peak angular speed (rad/s)
const CORR = 0.5;                                                 // fraction of an overlap resolved per 60 Hz frame
const SPRING_K = 26, SPRING_C = 8.5;                              // return to rest: slightly under-damped, so it settles like cloth
const HOLD = 0.14;                                                // seconds a garment stays "held" after it last touched a neighbour
export function makeSeparator(G, M, sample, K, footprints = {}, opt = {}) {
  const n = G.length, REST_S = 2.0, CK = Math.cos(K), SK = Math.sin(K), OFF = !!opt.off;
  const W = new Float64Array(n), D = new Float64Array(n), ZC = new Float64Array(n), RAD = new Float64Array(n);
  const VALID = new Uint8Array(n * NS);
  G.forEach((g, i) => {
    const f = footprints[g.cut] || DEFAULT_FP;
    W[i] = f.W; D[i] = f.D; ZC[i] = f.zc; RAD[i] = Math.hypot(f.W / 2, f.D / 2) + Math.abs(f.zc) + 0.2;
    let any = 0;
    for (let k = 0; k < NS; k++) { const ok = HS[k] >= -f.top - 0.03 && HS[k] <= -f.bot + 0.03; VALID[i * NS + k] = ok ? 1 : 0; any += ok ? 1 : 0; }
    if (!any) VALID[i * NS] = 1;
  });
  const hk = new Float64Array(n * 2), base = new Float64Array(n * 4);
  const yaw = new Float64Array(n), tilt = new Float64Array(n), vy = new Float64Array(n), vt = new Float64Array(n), hold = new Float64Array(n);
  const R = new Float64Array(n * NS * 8), dirty = new Uint8Array(n), touched = new Uint8Array(n);
  const out = { x: 0, z: 0, tx: 0, tz: 0 };
  function load(i, A) {
    sample(A, out); hk[2 * i] = out.x; hk[2 * i + 1] = out.z;
    const ix = out.tx * CK + out.tz * SK, iz = -out.tx * SK + out.tz * CK, zx = -ix, zz = -iz;
    base[4 * i] = zz; base[4 * i + 1] = -zx; base[4 * i + 2] = zx; base[4 * i + 3] = zz;
  }
  function build(i) {
    const c = Math.cos(yaw[i]), s = Math.sin(yaw[i]), xx = base[4 * i], xz = base[4 * i + 1], zx = base[4 * i + 2], zz = base[4 * i + 3];
    const x2 = c * xx - s * zx, x2z = c * xz - s * zz, z2 = s * xx + c * zx, z2z = s * xz + c * zz, st = Math.sin(tilt[i]);
    for (let k = 0; k < NS; k++) {
      const o = (i * NS + k) * 8, sh = ZC[i] - HS[k] * st;
      R[o] = hk[2 * i] + sh * z2; R[o + 1] = hk[2 * i + 1] + sh * z2z; R[o + 2] = x2; R[o + 3] = x2z; R[o + 4] = z2; R[o + 5] = z2z; R[o + 6] = W[i] / 2; R[o + 7] = D[i] / 2;
    }
    dirty[i] = 0;
  }
  let ax = 0, az = 0;
  function sat(a, b) {
    let best = 1e9; const dx = R[b] - R[a], dz = R[b + 1] - R[a + 1];
    for (let q = 0; q < 4; q++) {
      const r = q < 2 ? a : b, o = r + 2 + (q & 1) * 2, ux = R[o], uz = R[o + 1];
      const c1 = R[a] * ux + R[a + 1] * uz, e1 = R[a + 6] * Math.abs(R[a + 2] * ux + R[a + 3] * uz) + R[a + 7] * Math.abs(R[a + 4] * ux + R[a + 5] * uz);
      const c2 = R[b] * ux + R[b + 1] * uz, e2 = R[b + 6] * Math.abs(R[b + 2] * ux + R[b + 3] * uz) + R[b + 7] * Math.abs(R[b + 4] * ux + R[b + 5] * uz);
      const ov = Math.min(c1 + e1, c2 + e2) - Math.max(c1 - e1, c2 - e2); if (ov <= 0) return 0;
      if (ov < best) { best = ov; const sg = (dx * ux + dz * uz) >= 0 ? 1 : -1; ax = ux * sg; az = uz * sg; }
    }
    return best;
  }
  const NB = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = ((G[j].sHome - G[i].sHome + M / 2) % M + M) % M - M / 2; if (Math.abs(d) < 1.3) NB.push([i, j, d]); }
  const ALLOW = new Float64Array(NB.length);
  function worstSlice(i, j) {      // largest overlap over the heights both garments have
    let w = 0, wk = -1, wx = 0, wz = 0;
    for (let k = 0; k < NS; k++) {
      if (!VALID[i * NS + k] || !VALID[j * NS + k]) continue;
      const d = sat((i * NS + k) * 8, (j * NS + k) * 8); if (d > w) { w = d; wk = k; wx = ax; wz = az; }
    }
    return { w, wk, wx, wz };
  }
  NB.forEach(([i, j, d], p) => { yaw[i] = yaw[j] = tilt[i] = tilt[j] = 0; load(i, REST_S); build(i); load(j, REST_S + d); build(j); ALLOW[p] = worstSlice(i, j).w + 0.004; });
  yaw.fill(0); tilt.fill(0);
  const clamp = (v, a) => v > a ? a : v < -a ? -a : v;

  /** Advance dt seconds. `belt` is the belt offset; `skip[i]` = 1 for a garment that is off the rail (in hand). */
  function step(dt, belt, skip) {
    dt = Math.min(dt, 1 / 20);
    for (let i = 0; i < n; i++) { load(i, G[i].sHome + belt); dirty[i] = 1; touched[i] = 0; }
    if (!OFF) {
      const frames = dt * 60, corr = 1 - Math.pow(1 - CORR, frames);
      for (let i = 0; i < n; i++) if (dirty[i]) build(i);
      for (let p = 0; p < NB.length; p++) {
        const i = NB[p][0], j = NB[p][1];
        if (skip && (skip[i] || skip[j])) continue;
        const hx = hk[2 * i] - hk[2 * j], hz = hk[2 * i + 1] - hk[2 * j + 1], rr = RAD[i] + RAD[j];
        if (hx * hx + hz * hz > rr * rr) continue;
        if (dirty[i]) build(i); if (dirty[j]) build(j);
        const ws = worstSlice(i, j); if (ws.wk < 0) continue;
        const excess = ws.w - ALLOW[p]; if (excess <= -0.006) continue;       // clear with a margin: nothing to do
        if (excess > 0) {
          const need = (excess + 0.002) * corr, h = HS[ws.wk], oa = (i * NS + ws.wk) * 8, ob = (j * NS + ws.wk) * 8;
          const cx = (R[oa] + R[ob]) / 2, cz = (R[oa + 1] + R[ob + 1]) / 2;
          for (let w = 0; w < 2; w++) {
            const who = w ? j : i, sg = w ? 1 : -1, o = w ? ob : oa, dx = ws.wx * need * sg / 2, dz = ws.wz * need * sg / 2;
            const rx = cx - hk[2 * who], rz = cz - hk[2 * who + 1], tx = rz, tz = -rx, tt = tx * tx + tz * tz;
            if (tt > 1e-6) yaw[who] = clamp(yaw[who] + clamp(.5 * (dx * tx + dz * tz) / tt, MAX_DY * frames), MAXY);
            tilt[who] = clamp(tilt[who] - clamp(.5 * (dx * R[o + 4] + dz * R[o + 5]) / h, MAX_DT * frames), MAXT);
            dirty[who] = 1;
          }
        }
        if (excess > 0) touched[i] = touched[j] = 1;                           // actually pushing: hold, don't spring back
      }
    }
    // dynamics: a touched garment is held and damped; a free one eases home on a slightly under-damped spring
    const decay = Math.exp(-dt / HOLD);
    for (let i = 0; i < n; i++) {
      hold[i] = touched[i] ? 1 : hold[i] * decay;
      const free = 1 - Math.min(1, hold[i] * 1.5);
      const k = SPRING_K * free, c = SPRING_C + 14 * (1 - free);
      vy[i] += (-k * yaw[i] - c * vy[i]) * dt; vt[i] += (-k * tilt[i] - c * vt[i]) * dt;
      vy[i] = clamp(vy[i], MAXV_Y); vt[i] = clamp(vt[i], MAXV_T);
      yaw[i] = clamp(yaw[i] + vy[i] * dt, MAXY); tilt[i] = clamp(tilt[i] + vt[i] * dt, MAXT);
      if (skip && skip[i]) { yaw[i] *= Math.exp(-dt * 9); tilt[i] *= Math.exp(-dt * 9); vy[i] = vt[i] = 0; }   // in hand: ease flat, quickly
    }
  }
  /** For tests: how many pairs overlap by more than 1 cm beyond their straight-line level, and the worst excess. */
  function measure() {
    for (let i = 0; i < n; i++) build(i);
    let over = 0, worst = 0;
    for (let p = 0; p < NB.length; p++) { const e = worstSlice(NB[p][0], NB[p][1]).w - ALLOW[p]; if (e > 0.01) over++; if (e > worst) worst = e; }
    return { over, worst };
  }
  return { step, measure, yaw, tilt, pairs: NB.length };
}
