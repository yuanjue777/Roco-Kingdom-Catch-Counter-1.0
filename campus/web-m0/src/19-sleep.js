/*
 * 19-sleep.js —— 睡眠与安全睡点（主文档 3.4）
 *
 * 安全睡点三个条件缺一不可：
 *   1. 所在房间的所有 Portal 处于 Closed 或 Blocked
 *   2. 房间内及**相邻节点**没有丧尸
 *   3. 有床或睡袋
 * 睡眠期间时间加速，饥饿口渴正常累积；
 * 有 margin > 15 的声音到达就惊醒，且**不获得当次睡眠的任何 buff**。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const Sleep = {
    active: false, startHour: 0, endHour: 0, interrupted: false, wokeReason: '',

    /** 逐条给出判定结果，UI 直接照着显示，玩家不用猜为什么睡不了 */
    check(player, level, zombies) {
      const g = level.graph;
      const node = g.getNode(player.nodeId);
      if (!node) return { ok: false, reasons: ['位置异常'] };
      const reasons = [];

      const openPortal = node.portals
        .map(id => g.getPortal(id))
        .find(p => g.isPassable(p));
      if (openPortal) reasons.push('还有门窗没关上');

      const near = new Set([node.id]);
      for (const id of node.portals) { const p = g.getPortal(id); near.add(g.other(p, node.id)); }
      if (zombies.some(z => z.alive && near.has(z.nodeId))) reasons.push('这间房或隔壁有丧尸');

      const bed = Sleep.findBed(player, level);
      if (!bed) reasons.push('附近没有床');

      return { ok: reasons.length === 0, reasons, node };
    },

    findBed(player, level) {
      const r = C.Config.sleep.bedRange;
      for (const s of level.solids) {
        if (s.tag !== 'bed') continue;
        const b = s.box;
        const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        if (Math.abs(b.max.y - player.pos.y) > 1.2) continue;
        if (C.V.distXZ({ x: cx, y: 0, z: cz }, player.pos) <= r + (b.max.z - b.min.z) / 2) return s;
      }
      return null;
    },

    begin(player, time, hours) {
      const S = C.Config.sleep;
      this.active = true;
      this.interrupted = false;
      this.wokeReason = '';
      this.startHour = time.hour;
      this.slept = 0;
      this.target = Math.min(S.maxHours, hours || S.defaultHours);
      time.timeScale = S.timeScale;
    },

    /** @returns 'sleeping' | 'done' | 'interrupted' */
    update(dtHours, time) {
      if (!this.active) return 'sleeping';
      this.slept += dtHours;
      if (this.slept >= this.target) { this.end(time); return 'done'; }
      return 'sleeping';
    },

    interrupt(time, reason) {
      if (!this.active) return;
      this.interrupted = true;
      this.wokeReason = reason || '被声音惊醒';
      this.end(time);
    },

    end(time) {
      this.active = false;
      time.timeScale = 1;
    },

    /** 精力充沛：22:00 前入睡且连续睡足 6 小时未被中断 */
    grantsRested() {
      const N = C.Config.needs;
      if (this.interrupted) return false;
      const h = this.startHour;
      const beforeCutoff = (h >= 12 && h < N.restedBeforeHour) || h < 6;
      return beforeCutoff && this.slept >= N.restedMinHours;
    },

    reset() { this.active = false; this.interrupted = false; this.slept = 0; }
  };

  C.Sleep = Sleep;
})(typeof globalThis !== 'undefined' ? globalThis : this);
