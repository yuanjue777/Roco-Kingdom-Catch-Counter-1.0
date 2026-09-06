/*
 * 25-streaming.js —— 分区加载（主文档 13.4，M2）
 *
 * 文档的三条硬规则，这里逐条对应：
 *   1. 室外校园是一个常驻场景               → 地面/围墙/露天构筑物永不卸载
 *   2. 每栋建筑按距离异步加载、离开后卸载   → 按占地矩形的距离进出，带迟滞
 *   3. **声音连通图始终全量常驻**           → 这个文件根本不碰 graph
 *   4. 未加载建筑内的丧尸以简化形式继续模拟 → simplified 标记，见 11-zombie
 *
 * 「加载」在灰盒阶段只等于「这批盒子出不出现在渲染场景里」。碰撞世界是一张
 * 空间哈希，全量常驻反而更省事 —— 卸载它换不来性能，只会换来「走进没加载的楼里穿墙」。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /** 点到轴对齐矩形的水平距离（在矩形内为 0） */
  function rectDist(f, x, z) {
    const dx = Math.max(f.x0 - x, 0, x - f.x1);
    const dz = Math.max(f.z0 - z, 0, z - f.z1);
    return Math.hypot(dx, dz);
  }

  const Streaming = {
    level: null,
    loaded: new Set(),          // 当前已加载的 buildingId
    placeName: '',          // 玩家所在的声图节点名（房间号 / 走廊 / 室外分区）
    buildingName: '',
    onChange: null,             // (loadedSet) => void，渲染层挂上来
    _dirty: false,

    reset(level) {
      this.level = level;
      this.loaded = new Set();
      this.placeName = '';
      this.buildingName = '';
      this._dirty = false;
      // 单栋楼的 M0/M1 关卡没有分区，整张图始终加载
      if (!level || !level.buildings) {
        this.enabled = false;
        return this;
      }
      this.enabled = true;
      return this;
    },

    cfg() { return C.Config.campus.streaming; },

    /** 玩家所在的建筑（不在任何楼里时返回 null） */
    buildingAt(pos) {
      if (!this.enabled) return null;
      for (const b of this.level.buildings) {
        const f = b.footprint;
        if (pos.x >= f.x0 && pos.x <= f.x1 && pos.z >= f.z0 && pos.z <= f.z1) return b;
      }
      return null;
    },

    /**
     * 按玩家位置重算加载集合。
     * 进出用两个不同的半径（60 / 78）—— 只用一个的话，在边界上来回走两步
     * 就会反复加载卸载，帧率每隔一秒抖一下。
     */
    update(pos) {
      if (!this.enabled) return;
      const s = this.cfg();
      const inside = this.buildingAt(pos);
      let changed = false;
      for (const b of this.level.buildings) {
        const d = rectDist(b.footprint, pos.x, pos.z);
        const has = this.loaded.has(b.buildingId);
        // 人在楼里就必须加载，不管半径怎么算
        const want = (b === inside) || (has ? d <= s.unloadRadius : d <= s.loadRadius);
        if (want && !has) { this.loaded.add(b.buildingId); changed = true; }
        else if (!want && has) { this.loaded.delete(b.buildingId); changed = true; }
      }
      this.buildingName = inside ? inside.name : '';
      const zn = this.level.graph.getNodeAt(pos);
      this.placeName = zn ? zn.name : '';
      if (changed && this.onChange) this.onChange(this.loaded);
    },

    isLoaded(bid) { return !this.enabled || this.loaded.has(bid); },

    /** 离玩家多远之后转简化模拟。丧尸自己不认识这个模块，由管理器代查。 */
    simplifyDistance() { return this.enabled ? this.cfg().simplifyRadius : Infinity; },

    stats() {
      return { enabled: this.enabled, loaded: this.loaded.size,
               total: this.enabled ? this.level.buildings.length : 0,
               place: this.placeName, building: this.buildingName };
    }
  };

  C.rectDist = rectDist;
  C.Streaming = Streaming;
})(typeof globalThis !== 'undefined' ? globalThis : this);
