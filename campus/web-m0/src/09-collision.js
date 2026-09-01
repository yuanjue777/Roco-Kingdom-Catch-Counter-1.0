/*
 * 09-collision.js —— 碰撞与视线（实体层的支撑设施，不含任何玩法规则）
 * 全部是轴对齐盒。关闭的门/窗既挡人也挡视线，开着的就不挡 —— 与声音图共享同一份 Portal 状态。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { AABB, V, M } = C;
  const CELL = 6;

  function World(level) {
    this.level = level;
    this.graph = level.graph;
    this.staticSolids = level.solids;
    this.doorBoxes = new Map();           // portalId -> box
    for (const d of level.doors) this.doorBoxes.set(d.portalId, d.box);
    this._grid = new Map();
    for (const s of this.staticSolids) this._insert(s.box, s);
    this._dynamic = level.doors.map(d => ({ tag: d.kind, box: d.box, portalId: d.portalId }));
  }

  World.prototype._key = function (cx, cz) { return cx + ',' + cz; };
  World.prototype._insert = function (box, item) {
    const x0 = Math.floor(box.min.x / CELL), x1 = Math.floor(box.max.x / CELL);
    const z0 = Math.floor(box.min.z / CELL), z1 = Math.floor(box.max.z / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, z);
      if (!this._grid.has(k)) this._grid.set(k, []);
      this._grid.get(k).push(item);
    }
  };

  /** 收集与给定 XZ 范围相交的所有实体（含当前不可通行的门窗） */
  World.prototype.query = function (minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const seen = new Set();
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const list = this._grid.get(this._key(x, z));
      if (!list) continue;
      for (const it of list) { if (!seen.has(it)) { seen.add(it); out.push(it); } }
    }
    for (const d of this._dynamic) {
      const p = this.graph.getPortal(d.portalId);
      if (this.graph.isPassable(p)) continue;             // 开着/破了的门窗不挡
      if (d.box.max.x < minX || d.box.min.x > maxX || d.box.max.z < minZ || d.box.min.z > maxZ) continue;
      out.push(d);
    }
    return out;
  };

  const _tmp = [];

  /** 角色水平移动 + 逐轴推出 + 台阶吸附。返回是否着地。 */
  World.prototype.moveCharacter = function (pos, dx, dz, radius, height, stepHeight) {
    const solve = (axis, amount) => {
      if (amount === 0) return;
      pos[axis] += amount;
      const lo = pos.y + stepHeight, hi = pos.y + height;
      this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, _tmp);
      for (const s of _tmp) {
        const b = s.box;
        if (b.max.y <= lo || b.min.y >= hi) continue;
        if (pos.x + radius <= b.min.x || pos.x - radius >= b.max.x) continue;
        if (pos.z + radius <= b.min.z || pos.z - radius >= b.max.z) continue;
        /* 推出到最近的一侧，而不是按移动方向推。
           按移动方向推的话，一旦角色因为任何原因陷进一个大盒子里（例如顶到楼板），
           就会被瞬间弹到盒子的另一端 —— 表现为「丧尸突然瞬移到半张地图外」。 */
        const sideLo = (axis === 'x' ? b.min.x : b.min.z) - radius;
        const sideHi = (axis === 'x' ? b.max.x : b.max.z) + radius;
        const cur = pos[axis];
        pos[axis] = (Math.abs(cur - sideLo) <= Math.abs(cur - sideHi)) ? sideLo : sideHi;
      }
    };
    solve('x', dx);
    solve('z', dz);
    return this.snapToGround(pos, radius, stepHeight);
  };

  World.prototype.snapToGround = function (pos, radius, stepHeight) {
    const top = this.groundY(pos, pos.y + stepHeight, radius);
    if (top === null) { pos.y = Math.max(0, pos.y - 0.35); return false; }   // 简易重力
    pos.y = top;
    return true;
  };

  /** 脚下能站的最高面（不高于 maxY） */
  World.prototype.groundY = function (pos, maxY, radius) {
    this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, _tmp);
    let best = null;
    for (const s of _tmp) {
      const b = s.box;
      if (b.max.y > maxY + 0.001) continue;
      if (pos.x < b.min.x - radius * 0.5 || pos.x > b.max.x + radius * 0.5) continue;
      if (pos.z < b.min.z - radius * 0.5 || pos.z > b.max.z + radius * 0.5) continue;
      if (best === null || b.max.y > best) best = b.max.y;
    }
    return best;
  };

  /** 视线：两点之间是否无遮挡（主文档 4.5：有遮挡则完全看不见） */
  World.prototype.lineOfSight = function (p0, p1) {
    const minX = Math.min(p0.x, p1.x), maxX = Math.max(p0.x, p1.x);
    const minZ = Math.min(p0.z, p1.z), maxZ = Math.max(p0.z, p1.z);
    this.query(minX, minZ, maxX, maxZ, _tmp);
    for (const s of _tmp) {
      if (s.tag === 'ground') continue;
      if (AABB.segmentIntersects(s.box, p0, p1)) return false;
    }
    return true;
  };

  /** 探测最近的墙面（贴墙用）。返回 {normal, dist} 或 null */
  World.prototype.probeWall = function (pos, height, maxDist) {
    const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    let best = null;
    const y = pos.y + height * 0.5;
    for (const d of dirs) {
      const p1 = { x: pos.x + d.x * maxDist, y, z: pos.z + d.z * maxDist };
      const p0 = { x: pos.x, y, z: pos.z };
      this.query(Math.min(p0.x, p1.x), Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), Math.max(p0.z, p1.z), _tmp);
      for (const s of _tmp) {
        if (s.tag === 'ground' || s.tag === 'floor' || s.tag === 'stair') continue;
        if (s.box.max.y < pos.y + 0.8) continue;
        if (!AABB.segmentIntersects(s.box, p0, p1)) continue;
        const dist = Math.max(0, (d.x !== 0)
          ? (d.x > 0 ? s.box.min.x - pos.x : pos.x - s.box.max.x)
          : (d.z > 0 ? s.box.min.z - pos.z : pos.z - s.box.max.z));
        if (!best || dist < best.dist) best = { normal: { x: -d.x, y: 0, z: -d.z }, dist };
      }
    }
    return best;
  };

  C.World = World;
})(typeof globalThis !== 'undefined' ? globalThis : this);
