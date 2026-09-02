/*
 * 05-soundsystem.js —— 声音传播（声音规格 第 3 节）
 *
 * 到达响度 = 源响度 − k×路径长度 − Σ(路径上所有 Portal 的 attenuation)
 * 路径长度是绕行距离，不是直线距离。图上跑 Dijkstra，代价 = 累计衰减量。
 *
 * 本文件不知道玩家、丧尸、UI 的存在，只认 HearingComponent。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { V, M } = C;

  const SoundCategory = {
    Footstep: 'Footstep', Impact: 'Impact', Voice: 'Voice',
    Gunshot: 'Gunshot', Ambient: 'Ambient', Door: 'Door'
  };

  // ── 最小二叉堆 ──────────────────────────────────────
  function Heap() { this.a = []; }
  Heap.prototype.push = function (item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    const a = this.a;
    if (a.length === 0) return null;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].cost < a[s].cost) s = l;
        if (r < a.length && a[r].cost < a[s].cost) s = r;
        if (s === i) break;
        const t = a[s]; a[s] = a[i]; a[i] = t; i = s;
      }
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', { get() { return this.a.length; } });

  const SoundSystem = {
    graph: null,
    time: null,
    listeners: [],
    _seq: 0,
    // 调试统计
    stats: { lastMs: 0, lastExpanded: 0, eventsThisSecond: 0, peakPerSecond: 0, _bucket: 0, _acc: 0 },
    log: [],
    lastEvent: null,
    lastResult: null,

    /* 室外遮挡判定由外部注入（声音规格 4.3）。
       声音系统属于规则层，不能反过来依赖碰撞世界；注入一个纯函数即可保持分层单向。 */
    occlusionTest: null,

    init(graph, time, occlusionTest) {
      this.graph = graph; this.time = time;
      this.occlusionTest = occlusionTest || null;
      return this;
    },

    registerListener(hc) { if (this.listeners.indexOf(hc) < 0) this.listeners.push(hc); },
    unregisterListener(hc) {
      const i = this.listeners.indexOf(hc);
      if (i >= 0) this.listeners.splice(i, 1);
    },

    /** 当前的距离衰减系数（夜晚全局 ×nightFactor，声音规格 3.1） */
    kFor(node) {
      const base = node && node.isOutdoor ? C.Config.sound.kOutdoor : C.Config.sound.kIndoor;
      const nf = this.time ? this.time.getNightFactor() : 1.0;
      return base * nf;
    },

    /**
     * 发出一次声音。调用方不需要知道图、节点、Portal 的任何事情（声音规格 7.1）。
     * @param {object} def {worldPosition, loudness, category, emitterId, chainDepth?, nodeIdHint?}
     */
    emit(def) {
      const node = this.graph.getNodeAt(def.worldPosition, def.nodeIdHint);
      const evt = {
        id: this._seq++,
        worldPosition: V.copy(def.worldPosition),
        nodeId: node ? node.id : -1,
        loudness: def.loudness,
        category: def.category || SoundCategory.Impact,
        emitterId: def.emitterId === undefined ? -1 : def.emitterId,
        chainDepth: def.chainDepth === undefined ? 0 : def.chainDepth,
        timestamp: this.time ? this.time.totalGameSeconds : 0,
        label: def.label || ''
      };
      if (evt.nodeId < 0 || evt.loudness <= 0) return evt;

      const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
      const result = this.propagate(evt);
      const t1 = (typeof performance !== 'undefined') ? performance.now() : 0;
      this.stats.lastMs = t1 - t0;
      this.stats.lastExpanded = result.size;
      this.stats._acc++;

      this.lastEvent = evt;
      this.lastResult = result;

      // 推送给所有听者（听者是被动接收方，不主动查询）
      for (const hc of this.listeners) {
        if (!hc.active) continue;
        if (hc.selfEmitterId === evt.emitterId) continue;      // 过滤自己的声音（声音规格 4.5）
        const r = this.resolveAt(result, hc.position, hc.nodeId);
        if (!r) continue;
        hc.deliver(evt, r);
      }

      this.log.push({ t: evt.timestamp, cat: evt.category, loud: evt.loudness, node: evt.nodeId, label: evt.label, emitter: evt.emitterId });
      if (this.log.length > C.Config.debug.logMaxEntries) this.log.shift();

      C.EventBus.publish(C.Events.SoundEmitted, evt);
      return evt;
    },

    /**
     * Dijkstra：代价 = 累计衰减量。
     * @returns Map nodeId -> {arrival, entryPos, entryPortalId, pathLen}
     */
    propagate(evt) {
      const g = this.graph;
      const minT = C.Config.sound.globalMinThreshold;
      const out = new Map();
      const startNode = g.getNode(evt.nodeId);
      if (!startNode) return out;

      // 起始节点的入口点 = 声源位置本身，累计衰减 = 0
      out.set(startNode.id, { arrival: evt.loudness, entryPos: V.copy(evt.worldPosition), entryPortalId: -1, pathLen: 0 });

      const heap = new Heap();
      heap.push({ cost: 0, nodeId: startNode.id });
      const settled = new Set();
      let guard = C.Config.sound.maxExpandedNodes;

      while (heap.size > 0 && guard-- > 0) {
        const cur = heap.pop();
        if (settled.has(cur.nodeId)) continue;
        settled.add(cur.nodeId);

        const node = g.getNode(cur.nodeId);
        const rec = out.get(cur.nodeId);
        const k = this.kFor(node);

        for (const pid of node.portals) {
          const portal = g.getPortal(pid);
          const otherId = g.other(portal, node.id);
          if (settled.has(otherId)) continue;

          const segLen = V.dist(rec.entryPos, portal.position);
          const newCost = cur.cost + k * segLen + g.getAttenuation(portal);
          const arrival = evt.loudness - newCost;

          // 剪枝：低于全场最低阈值的传播没有意义（声音规格 3.2 第 4 步）
          if (arrival < minT) continue;

          const prev = out.get(otherId);
          if (!prev || arrival > prev.arrival) {
            out.set(otherId, {
              arrival,
              entryPos: V.copy(portal.position),
              entryPortalId: portal.id,
              pathLen: rec.pathLen + segLen
            });
            heap.push({ cost: newCost, nodeId: otherId });
          }
        }
      }
      return out;
    },

    /**
     * 听者结算（声音规格 3.3）：加上节点内的最后一段距离。
     * 同一房间内贴脸和隔十米不再等价。
     */
    resolveAt(result, pos, nodeId) {
      const rec = result.get(nodeId);
      if (!rec) return null;
      const node = this.graph.getNode(nodeId);
      const k = this.kFor(node);
      const segLen = V.dist(rec.entryPos, pos);
      let arrival = rec.arrival - k * segLen;
      /* 室外没有天然的房间边界：同一个室外节点内，若入口点与听者之间隔着建筑体，
         额外扣一次固定遮挡值（声音规格 4.3）。只对室外、只在同节点内做，
         数量极少，开销可忽略。 */
      if (node.isOutdoor && this.occlusionTest && segLen > 0.5 &&
          !this.occlusionTest(rec.entryPos, pos)) {
        arrival -= C.Config.sound.outdoorOcclusion;
      }
      if (arrival <= 0) return null;
      // 方向 = 声音传来的路径入口方向，不是声源真实方向（声音规格 5.4）
      const dir = V.norm(V.sub(rec.entryPos, pos));
      return {
        arrival,
        dir,
        entryPortalId: rec.entryPortalId,
        entryPos: rec.entryPos,
        pathLen: rec.pathLen + segLen,
        sameNode: rec.entryPortalId === -1
      };
    },

    tickStats(dtReal) {
      this.stats._bucket += dtReal;
      if (this.stats._bucket >= 1) {
        this.stats.eventsThisSecond = this.stats._acc;
        this.stats.peakPerSecond = Math.max(this.stats.peakPerSecond, this.stats._acc);
        this.stats._acc = 0; this.stats._bucket = 0;
      }
    },

    reset() {
      this.listeners.length = 0; this.log.length = 0;
      this.lastEvent = null; this.lastResult = null; this._seq = 0;
      this.stats.peakPerSecond = 0;
    }
  };

  C.SoundCategory = SoundCategory;
  C.SoundSystem = SoundSystem;
})(typeof globalThis !== 'undefined' ? globalThis : this);
