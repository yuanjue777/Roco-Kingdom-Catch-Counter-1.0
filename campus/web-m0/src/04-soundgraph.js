/*
 * 04-soundgraph.js —— 声音连通图（声音规格 2.2 / 2.3，主文档 9.5 / 9.6）
 * 纯数据。始终全量常驻，不随场景加载卸载。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { AABB, V } = C;

  const PortalType = {
    Doorway: 'Doorway', WoodDoor: 'WoodDoor', SteelDoor: 'SteelDoor',
    Window: 'Window', Stairwell: 'Stairwell', Vent: 'Vent',
    OpenAir: 'OpenAir', Curtain: 'Curtain'
  };
  const PortalState = { Open: 'Open', Closed: 'Closed', Broken: 'Broken', Blocked: 'Blocked' };

  function SoundGraph() {
    this.nodes = [];
    this.portals = [];
    this._nodeById = new Map();
    this._portalById = new Map();
    this._nextNodeId = 0;
    this._nextPortalId = 0;
  }

  SoundGraph.prototype.addNode = function (def) {
    const node = {
      id: this._nextNodeId++,
      name: def.name || ('node' + this._nextNodeId),
      bounds: def.bounds,
      isOutdoor: !!def.isOutdoor,
      buildingId: def.buildingId === undefined ? 0 : def.buildingId,
      floor: def.floor === undefined ? 0 : def.floor,
      kind: def.kind || 'room',       // room / corridor / stair / outdoor
      portals: []
    };
    this.nodes.push(node);
    this._nodeById.set(node.id, node);
    return node;
  };

  SoundGraph.prototype.addPortal = function (def) {
    const p = {
      id: this._nextPortalId++,
      nodeA: def.nodeA, nodeB: def.nodeB,
      position: def.position,
      type: def.type,
      state: def.state || PortalState.Open,
      // 渲染层可以把门板挂在这里，规则层不关心
      view: null
    };
    this.portals.push(p);
    this._portalById.set(p.id, p);
    this._nodeById.get(def.nodeA).portals.push(p.id);
    this._nodeById.get(def.nodeB).portals.push(p.id);
    return p;
  };

  SoundGraph.prototype.getNode = function (id) { return this._nodeById.get(id); };
  SoundGraph.prototype.getPortal = function (id) { return this._portalById.get(id); };

  /* 节点归属判定：y 上界必须是开区间。
     楼层节点的 y 范围是 [f·H, (f+1)·H]，相邻两层共用一个平面 —— 用闭区间的话，
     一个正好站在 4 楼地板上(y=9.6)的点会先匹配到 3 楼节点(它的 max.y 也是 9.6)。
     后果很隐蔽：丧尸低吼、石头落地这类在地板高度发出的声音会被算成从楼下发出，
     寻路也会因此把目标定到楼下去。x/z 保持闭区间，方便站在门框上时仍能命中。 */
  const NODE_Y_EPS = 1e-4;   // 楼层高度是浮点累加出来的（3×3.2 = 9.600000000000001），
                             // 不给容差的话差一个 ULP 就会把声源判到楼下去
  function containsNode(b, p) {
    return p.x >= b.min.x && p.x <= b.max.x &&
           p.z >= b.min.z && p.z <= b.max.z &&
           p.y >= b.min.y - NODE_Y_EPS && p.y < b.max.y - NODE_Y_EPS;
  }

  /** 坐标 → 节点。找不到严格包含的节点时退化为最近节点，避免玩家站在门框上时查询失败。 */
  SoundGraph.prototype.getNodeAt = function (pos, hintNodeId) {
    if (hintNodeId !== undefined && hintNodeId !== null) {
      const h = this._nodeById.get(hintNodeId);
      if (h && containsNode(h.bounds, pos)) return h;
    }
    for (const n of this.nodes) if (containsNode(n.bounds, pos)) return n;
    // 退化：同层里中心最近的
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      const c = AABB.center(n.bounds);
      const inY = pos.y >= n.bounds.min.y - 0.5 && pos.y <= n.bounds.max.y + 0.5;
      const d = V.distXZ(c, pos) + (inY ? 0 : 100);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  };

  /** 当前状态下的衰减值（声音规格 6.2）。状态不适用时回退到 Open 值。 */
  SoundGraph.prototype.getAttenuation = function (portal) {
    const row = C.Config.portalAttenuation[portal.type];
    if (!row) { console.warn('[SoundGraph] 未知 Portal 类型 ' + portal.type); return 0; }
    const v = row[portal.state];
    if (v === null || v === undefined) return row.Open;
    return v;
  };

  SoundGraph.prototype.isPassable = function (portal) {
    return !!C.Config.portalPassable[portal.state];
  };

  SoundGraph.prototype.setPortalState = function (portal, state) {
    if (portal.state === state) return;
    const prev = portal.state;
    portal.state = state;
    // 状态变化必须通知，让传播缓存失效（声音规格 2.3）
    C.EventBus.publish(C.Events.PortalStateChanged, { portalId: portal.id, prev, state });
  };

  SoundGraph.prototype.other = function (portal, nodeId) {
    return portal.nodeA === nodeId ? portal.nodeB : portal.nodeA;
  };

  C.PortalType = PortalType;
  C.PortalState = PortalState;
  C.SoundGraph = SoundGraph;
})(typeof globalThis !== 'undefined' ? globalThis : this);
