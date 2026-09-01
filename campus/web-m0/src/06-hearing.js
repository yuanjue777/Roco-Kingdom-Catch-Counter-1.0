/*
 * 06-hearing.js —— 听觉组件（声音规格 2.4 / 5）
 * 丧尸和玩家共用同一个组件。这是本系统最重要的架构决策：
 * 避免两套并行的听觉逻辑产生不一致。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { M } = C;

  function HearingComponent(def) {
    this.ownerId = def.ownerId;
    this.selfEmitterId = def.selfEmitterId === undefined ? def.ownerId : def.selfEmitterId;
    this.baseThreshold = def.baseThreshold;
    this.baseLocalization = def.baseLocalization === undefined ? 0 : def.baseLocalization;
    this.position = def.position || { x: 0, y: 0, z: 0 };  // 由拥有者每帧更新
    this.nodeId = -1;                                       // 由拥有者每帧更新
    this.active = true;
    this.onHeard = def.onHeard || function () {};
  }

  // 阈值与精度都不写死，每次使用前向修正管线查询（声音规格 2.4）
  HearingComponent.prototype.finalThreshold = function () {
    return C.ModifierPipeline.query('hearing.threshold', this.baseThreshold, this.ownerId);
  };
  HearingComponent.prototype.finalLocalization = function () {
    return M.clamp(C.ModifierPipeline.query('hearing.localization', this.baseLocalization, this.ownerId), 0, 1);
  };

  HearingComponent.prototype.deliver = function (evt, r) {
    const threshold = this.finalThreshold();
    const margin = r.arrival - threshold;
    if (margin <= 0) return;   // margin ≤ 0：完全无感，直接丢弃
    this.onHeard({
      evt,
      arrival: r.arrival,
      margin,
      threshold,
      dir: r.dir,
      entryPortalId: r.entryPortalId,
      entryPos: r.entryPos,
      pathLen: r.pathLen,
      sameNode: r.sameNode,
      localization: this.finalLocalization()
    });
  };

  /* 余量 → 反应速度与定位精度（声音规格 5.2，主文档 5.3）。
     连续变化，不分档。近处的丧尸几乎立刻扑向准确位置，远处的迟疑几秒后走向模糊方位。 */
  C.Reaction = {
    delay(margin) {
      const c = C.Config.zombieReaction;
      return M.clamp(c.delayBase - margin * c.delayPerMargin, c.delayMin, c.delayMax);
    },
    localizationError(margin) {
      const c = C.Config.zombieReaction;
      return M.clamp(c.errorBase - margin * c.errorPerMargin, c.errorMin, c.errorMax);
    },
    /** 声纹的距离模糊分级（声音规格 5.4：不给精确米数） */
    distanceBand(margin) {
      const b = C.Config.hearing.distanceBands;
      if (margin >= b.near) return '很近';
      if (margin >= b.mid) return '中等';
      return '很远';
    }
  };

  C.HearingComponent = HearingComponent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
