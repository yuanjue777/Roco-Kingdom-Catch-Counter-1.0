/*
 * 03-math.js —— 引擎无关的最小数学库
 * 规则层与实体层只用这里的 {x,y,z} 普通对象，不碰 THREE.*，
 * 这样第 1–3 层可以脱离渲染在 node 里跑单元测试。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const V = {
    make: (x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 }),
    copy: (a) => ({ x: a.x, y: a.y, z: a.z }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    len: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
    dist: (a, b) => {
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
    distXZ: (a, b) => {
      const dx = a.x - b.x, dz = a.z - b.z;
      return Math.sqrt(dx * dx + dz * dz);
    },
    norm: (a) => { const l = V.len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
  };

  const M = {
    clamp: (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v)),
    lerp: (a, b, t) => a + (b - a) * t,
    smoothstep: (t) => { t = M.clamp(t, 0, 1); return t * t * (3 - 2 * t); },
    deg2rad: Math.PI / 180,
    rad2deg: 180 / Math.PI,
    // 归一化到 [-PI, PI]
    wrapAngle: (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  };

  // 确定性随机数（支柱三：玩家应该能在脑内推演，随机必须可复现）
  function Rng(seed) {
    this._s = (seed >>> 0) || 1;
  }
  Rng.prototype.next = function () {
    // xorshift32
    let x = this._s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this._s = x;
    return x / 4294967296;
  };
  Rng.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };
  Rng.prototype.int = function (lo, hi) { return Math.floor(this.range(lo, hi + 1)); };
  Rng.prototype.pick = function (arr) { return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]; };

  // 轴对齐包围盒
  const AABB = {
    make: (minX, minY, minZ, maxX, maxY, maxZ) => ({
      min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ }
    }),
    fromCenterSize: (cx, cy, cz, sx, sy, sz) => AABB.make(
      cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2),
    contains: (b, p) => p.x >= b.min.x && p.x <= b.max.x &&
                        p.y >= b.min.y && p.y <= b.max.y &&
                        p.z >= b.min.z && p.z <= b.max.z,
    containsXZ: (b, p) => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z,
    center: (b) => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 }),
    // 线段与 AABB 相交（slab 法），用于视线遮挡判定
    segmentIntersects(b, p0, p1) {
      let tmin = 0, tmax = 1;
      const d = V.sub(p1, p0);
      for (const ax of ['x', 'y', 'z']) {
        if (Math.abs(d[ax]) < 1e-8) {
          if (p0[ax] < b.min[ax] || p0[ax] > b.max[ax]) return false;
        } else {
          const inv = 1 / d[ax];
          let t1 = (b.min[ax] - p0[ax]) * inv;
          let t2 = (b.max[ax] - p0[ax]) * inv;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) return false;
        }
      }
      return true;
    }
  };

  C.V = V; C.M = M; C.AABB = AABB; C.Rng = Rng;
})(typeof globalThis !== 'undefined' ? globalThis : this);
