/*
 * 38-placement.js —— 把东西从背包里拿出来，放到世界上
 *
 * 这是待决策 #18 的答案：**在这之前，灶台只能由代码创建。**
 * 玩家背着一台电磁炉走了三十天，永远没办法把它放到桌子上。
 *
 * 一条完整的链子，每一步都是玩家亲手做的：
 *
 *   背包右键 → 放置 → 找个台面按左键放下
 *        ↓
 *   对准它按 F → 插电 → **手里多了一根线** → 走到插座前按 F
 *        ↓
 *   对准它按 F → 加水（用掉一瓶水）
 *        ↓
 *   对准它按 F → 烧水 → 咕嘟咕嘟…… → **哨响**
 *
 * **每一步都有独立的失败方式，而且都能听见。**
 * 线不够长、这层的闸没推、壶里没水 —— 三种「插上了没反应」是三件不同的事。
 *
 * 第 4 层。规则在这里，界面在 39-device-ui。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const V = C.V;

  /** 能被放到地上/台面上的东西：所有电器 + 锅具 */
  function placeableKind(itemId) {
    if (C.Config.power.devices[itemId] !== undefined) return 'device';
    if (C.Config.cooking.cookware[itemId]) return 'cookware';
    return null;
  }

  const Placement = {
    list: [],            // 已经放在世界上的东西
    ghost: null,         // 正在放置：{ itemId, uid, pos, ok, why }
    cable: null,         // 正在拉线：{ placed }
    _next: 1,
    game: null,          // 装配层注入，用来拿 world / player

    reset() {
      this.list = []; this.ghost = null; this.cable = null; this._next = 1;
      return this;
    },

    at(id) { return this.list.find(p => p.id === id) || null; },
    placeable(itemId) { return placeableKind(itemId) !== null; },

    /* ── 放置 ────────────────────────────────────────── */

    /** 从背包里选中一件东西，进入放置模式。**这时候还没有从背包里拿走。** */
    begin(item) {
      if (!item) return { ok: false, msg: '没有这件东西' };
      if (!this.placeable(item.id)) return { ok: false, msg: C.ITEMS[item.id].name + '不能放置' };
      this.ghost = { itemId: item.id, uid: item.uid, pos: null, ok: false, why: '' };
      C.EventBus.publish('PlacementBeganEvent', { itemId: item.id });
      return { ok: true, msg: '找个台面，左键放下（Esc 取消）' };
    },
    cancel() {
      if (!this.ghost) return;
      this.ghost = null;
      C.EventBus.publish('PlacementEndedEvent', {});
    },

    /**
     * 每帧算一次「如果现在放下，会放在哪」。
     *
     * 从眼睛往前逐段采样，取**最后一个**站得住的落点：
     * 有台面接着、上方有净空、离玩家不太远。
     * `[实测]` 取「第一个」的话，视线扫过桌沿时预览会跳回脚下 ——
     * 取最后一个，预览才跟着准星平滑地滑过桌面。
     */
    update(player, world) {
      if (!this.ghost) return;
      const eye = player.eyePos();
      const cp = Math.cos(player.pitch);
      const dir = { x: -Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
      let found = null;
      for (let d = 0.5; d <= 3.0; d += 0.15) {
        const p = { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d };
        const g = world.groundY(p, p.y + 0.05, 0.22);
        if (g === null) continue;
        if (p.y - g > 0.55) continue;                    // 悬空太多，说明还没落到台面上
        if (!world.isClear(p.x, p.z, g, 0.45, 0.22)) continue;
        found = { x: p.x, y: g + 0.01, z: p.z };
      }
      if (!found) { this.ghost.pos = null; this.ghost.ok = false; this.ghost.why = '这里放不下'; return; }
      // 不许和已经放好的东西叠在一起
      const clash = this.list.find(o => V.distXZ(o.pos, found) < 0.35 && Math.abs(o.pos.y - found.y) < 0.4);
      this.ghost.pos = found;
      this.ghost.ok = !clash;
      this.ghost.why = clash ? '那里已经有' + C.ITEMS[clash.itemId].name + '了' : '';
    },

    /** 确认放下。**这一刻才从背包里扣掉。** */
    confirm(player) {
      const gh = this.ghost;
      if (!gh) return { ok: false, msg: '没有在放置' };
      if (!gh.pos || !gh.ok) return { ok: false, msg: gh.why || '这里放不下' };
      const item = this._findItem(player, gh.uid) || { id: gh.itemId, count: 1 };
      const kind = placeableKind(gh.itemId);
      const placed = {
        id: 'pl' + (this._next++), itemId: gh.itemId, kind,
        pos: V.copy(gh.pos), yaw: player.yaw,
        station: null, outletId: null
      };
      /* 加热设备落地就是一个灶台 —— 和插座那边同一条规矩（见 35-outlets）。
         区别是这里没有电：它得等玩家把线拉过去。 */
      if (C.Config.cooking.heaters[gh.itemId]) {
        placed.station = C.Cooking.addStation({
          pos: V.copy(gh.pos), surface: 'placed', slots: 1, heater: gh.itemId
        });
        // 自带水箱的（电水壶/电饭煲/电炖锅）要单独加水，不吃背包里的水
        placed.station.water = C.Config.cooking.heaters[gh.itemId].needsCookware ? null : 0;
        placed.station.placedId = placed.id;
      }
      if (kind === 'cookware') {
        // 锅具：放到最近的灶台上，没有灶台就单独摆着
        const st = this._nearestStation(gh.pos, 0.9);
        if (st) { st.cookware = gh.itemId; placed.station = st; }
      }
      this.list.push(placed);
      if (item.uid !== undefined) player._removeItem(item);
      this.ghost = null;

      const L = C.Config.loudness;
      C.SoundSystem.emit({
        worldPosition: placed.pos, loudness: L.dropItem + 4, category: C.SoundCategory.Impact,
        emitterId: player.id, label: '放下' + C.ITEMS[gh.itemId].name
      });
      C.EventBus.publish('ItemPlacedEvent', { placed });
      return { ok: true, msg: '放好了 ' + C.ITEMS[gh.itemId].name, placed };
    },

    _findItem(player, uid) {
      for (const it of player.hotbar) if (it && it.uid === uid) return it;
      if (player.bag) { const it = player.bag.items.find(x => x.uid === uid); if (it) return it; }
      return null;
    },
    _nearestStation(pos, r) {
      let best = null, bd = r;
      for (const st of C.Cooking.stations) {
        if (!st.pos) continue;
        const d = V.dist(st.pos, pos);
        if (d < bd) { bd = d; best = st; }
      }
      return best;
    },

    /** 收起来：拔线、拆灶台、回到背包 */
    takeBack(placed, player) {
      if (placed.station && placed.station.session) {
        return { ok: false, msg: '还在做东西，先关火' };
      }
      this.unplug(placed);
      if (placed.station && placed.kind === 'device') {
        const i = C.Cooking.stations.indexOf(placed.station);
        if (i >= 0) C.Cooking.stations.splice(i, 1);
      } else if (placed.kind === 'cookware' && placed.station) {
        placed.station.cookware = null;
      }
      const i2 = this.list.indexOf(placed);
      if (i2 >= 0) this.list.splice(i2, 1);
      const back = C.makeItem(placed.itemId, 1);
      const r = player.acquire(back);
      if (!r.ok) player.dropItem(back);      // 背包满了就掉在脚边，**不能凭空销毁**
      C.EventBus.publish('ItemUnplacedEvent', { placed });
      return { ok: true, msg: '收起 ' + C.ITEMS[placed.itemId].name + (r.ok ? '' : '（背包满了，放在脚边）') };
    },

    /* ── 拉线 ────────────────────────────────────────── */

    cordMetres(placed) { return C.Config.power.cordMetres; },

    /** 「插电」：手里拿起这台设备自带的那根线 */
    takeCable(placed) {
      if (placed.kind !== 'device') return { ok: false, msg: C.ITEMS[placed.itemId].name + '不用电' };
      if (placed.outletId) return this.unplug(placed);
      this.cable = { placed };
      C.EventBus.publish('CableTakenEvent', { placed });
      return { ok: true, msg: '拿起了' + C.ITEMS[placed.itemId].name + '的电线 —— 去找个插座（线长 ' +
                             this.cordMetres(placed).toFixed(1) + ' 米）' };
    },
    dropCable() {
      if (!this.cable) return;
      this.cable = null;
      C.EventBus.publish('CableDroppedEvent', {});
    },

    /**
     * 把手里这根线插进插座。
     *
     * **线的长度是这一步唯一的、也是全部的约束。**
     * 它把「灶台放哪」从一个随手的决定，变成一个要看着插座位置做的决定。
     */
    plugCableInto(outlet) {
      const c = this.cable;
      if (!c) return { ok: false, msg: '手上没有线' };
      const placed = c.placed;
      const dist = V.dist(placed.pos, outlet.pos);
      const len = this.cordMetres(placed);
      if (dist > len) {
        return { ok: false, msg: '线不够长 —— 还差 ' + (dist - len).toFixed(1) + ' 米。把' +
                                C.ITEMS[placed.itemId].name + '挪近点，或者接一根电线' };
      }
      if (C.Outlets.at(outlet)) return { ok: false, msg: '这个插座上已经插着东西了' };

      const src = C.Outlets._sourceFor(outlet);
      const link = C.Power.createLink(src);
      link.cables = []; link.wall = true;
      const deviceId = 'dev-' + outlet.id;
      link.devices.push({ id: deviceId, watt: C.Config.power.devices[placed.itemId],
                          on: false, label: C.ITEMS[placed.itemId].name });
      C.Outlets.plugged[outlet.id] = {
        link, deviceId, itemId: placed.itemId, outletId: outlet.id,
        station: placed.station, placedId: placed.id
      };
      placed.outletId = outlet.id;
      if (placed.station) { placed.station.link = link; placed.station.deviceId = deviceId; }
      this.cable = null;

      const r = C.Power.setDevice(link, deviceId, true);
      C.EventBus.publish('CablePluggedEvent', { placed, outlet, ok: r.ok });
      /* 闸没推照样插得上，只是没反应 —— 和 35-outlets 同一条规矩，
         那句「插上了，什么也没发生」是教学目标 3 的全部内容。 */
      return { ok: true, msg: r.ok ? '通电了' : '插上了 —— ' + r.msg };
    },

    unplug(placed) {
      if (!placed.outletId) return { ok: false, msg: '本来就没插' };
      const rec = C.Outlets.plugged[placed.outletId];
      if (rec) {
        if (placed.station && placed.station.session) C.Cooking.stop(placed.station);
        const li = C.Power.links.indexOf(rec.link);
        if (li >= 0) C.Power.links.splice(li, 1);
        delete C.Outlets.plugged[placed.outletId];
      }
      placed.outletId = null;
      if (placed.station) { placed.station.link = null; placed.station.deviceId = null; }
      return { ok: true, msg: '拔了' };
    },
    powered(placed) {
      const st = placed.station;
      if (!st || !st.link) return false;
      return st.link.source.available(C.Power.env()) > 0 && !st.link.tripped;
    },

    /* ── 加水 ────────────────────────────────────────── */

    /**
     * 往自带水箱的设备里倒水。
     *
     * **通电了还不会自己烧** —— 空烧一壶是这个流程里最后一个「以为坏了」的坑，
     * 所以界面上必须永远写着现在缺的是哪一样。
     */
    addWater(placed, player) {
      const st = placed.station;
      if (!st || st.water === null || st.water === undefined) {
        return { ok: false, msg: C.ITEMS[placed.itemId].name + '不用单独加水' };
      }
      if (st.water >= 1) return { ok: false, msg: '已经是满的' };
      const src = this._findWater(player);
      if (!src) return { ok: false, msg: '身上没有水' };
      st.water = 1;
      src.count--;
      if (src.count <= 0) player._removeItem(src);
      C.SoundSystem.emit({
        worldPosition: placed.pos, loudness: 10, category: C.SoundCategory.Ambient,
        emitterId: player.id, label: '倒水'
      });
      C.EventBus.publish('WaterAddedEvent', { placed });
      return { ok: true, msg: '倒进去了' };
    },
    _findWater(player) {
      const isWater = (id) => id === 'water' || id === 'boiled' || id === 'dirtyWater';
      for (const it of player.hotbar) if (it && isWater(it.id)) return it;
      if (player.bag) { const it = player.bag.items.find(x => isWater(x.id)); if (it) return it; }
      return null;
    },

    /** 现在还差什么 —— 界面直接显示这句话 */
    blocker(placed) {
      if (placed.kind !== 'device') return null;
      if (!placed.outletId) return '没插电';
      if (!this.powered(placed)) return '插着，但这条回路没电';
      const st = placed.station;
      if (st && st.water !== null && st.water !== undefined && st.water < 1) return '壶里没水';
      return null;
    },

    serialize() {
      return this.list.map(p => ({
        id: p.id, itemId: p.itemId, kind: p.kind, pos: V.copy(p.pos), yaw: p.yaw,
        outletId: p.outletId, stationId: p.station ? p.station.id : null,
        water: p.station && p.station.water !== undefined ? p.station.water : null
      }));
    },
    deserialize(list) {
      this.list = []; this.ghost = null; this.cable = null;
      for (const r of list || []) {
        if (!C.ITEMS[r.itemId]) continue;
        const st = r.stationId !== null && r.stationId !== undefined
          ? (C.Cooking.stations.find(s => s.id === r.stationId) || null) : null;
        if (st && r.water !== null) st.water = r.water;
        this.list.push({ id: r.id, itemId: r.itemId, kind: r.kind, pos: V.copy(r.pos),
                         yaw: r.yaw, station: st, outletId: r.outletId || null });
      }
      this._next = this.list.reduce((n, p) => Math.max(n, parseInt(p.id.slice(2), 10) + 1), 1);
      return this;
    }
  };

  C.Placement = Placement;
})(typeof globalThis !== 'undefined' ? globalThis : this);
