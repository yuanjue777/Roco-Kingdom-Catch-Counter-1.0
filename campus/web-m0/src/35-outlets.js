/*
 * 35-outlets.js —— 墙上的插座：把「电」这个系统接进世界
 *
 * `[实测]` **在这个文件出现之前，整栋楼一个插座都没有。**
 * 供电系统（29）有回路、有链路、有功率上限、有跳闸，
 * 烹饪系统（30）有灶台、有锅、有 32 个配方 ——
 * 但玩家没有任何办法把一台电水壶接到墙上。
 * 教学的第三个目标「有水壶，烧点开水吧」在游戏里根本做不到。
 *
 * 这一层就是那个缺掉的入口。它做的事只有一件：
 * **把「玩家手里的一台设备」和「墙上的一个插座」连起来。**
 *
 * 第 4 层（交互层）：向下用 Power（2 层）与 Cooking（4 层），不被任何层依赖。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /** 这件物品能插电吗 → 返回它在供电系统里的设备 key，插不了返回 null */
  function deviceKeyOf(itemId) {
    const P = C.Config.power.devices;
    if (P[itemId] !== undefined) return itemId;
    return null;
  }

  const Outlets = {
    /** outletId → { link, deviceId, itemId, station } */
    plugged: {},

    reset() { this.plugged = {}; return this; },

    /** 这个插座上插着什么（没插返回 null） */
    at(outlet) { return this.plugged[outlet.id] || null; },

    /**
     * 插座的电从哪来：它所属回路上的市电。
     * **一个回路共用一个 grid 电源**，所以同一栋楼的插座功率是互相抢的 ——
     * 这正是「电磁炉 + 电水壶必跳闸」成立的原因。
     */
    _sourceFor(outlet) {
      let src = C.Power.sources.find(s => s.kind === 'grid' && s.circuitId === outlet.circuitId);
      if (!src) src = C.Power.addSource('grid', { circuitId: outlet.circuitId, pos: outlet.pos });
      return src;
    },

    /**
     * 对着插座按 F。
     * @returns {ok, msg}
     */
    use(outlet, player) {
      const cur = this.at(outlet);
      if (cur) return this.unplug(outlet, player);

      // 手上（快取位 + 背包）有没有能插的东西
      const found = this._findDevice(player);
      if (!found) return { ok: false, msg: '身上没有能插电的东西' };
      return this.plug(outlet, player, found.item);
    },

    _findDevice(player) {
      for (const it of player.hotbar) if (it && deviceKeyOf(it.id)) return { item: it };
      if (player.bag) for (const it of player.bag.items) if (deviceKeyOf(it.id)) return { item: it };
      return null;
    },

    plug(outlet, player, item) {
      const key = deviceKeyOf(item.id);
      if (!key) return { ok: false, msg: C.ITEMS[item.id].name + '不用插电' };
      const watt = C.Config.power.devices[key];
      const src = this._sourceFor(outlet);
      const link = C.Power.createLink(src);
      /* 墙插自带「零米线」：设备就挂在插座上。
         玩家想把设备放远一点，才需要真的去找电线（15.4）。 */
      link.cables = [];
      link.wall = true;
      const deviceId = 'dev-' + outlet.id;
      const label = C.ITEMS[item.id].name;
      link.devices.push({ id: deviceId, watt, on: false, label });

      const rec = { link, deviceId, itemId: item.id, outletId: outlet.id, station: null };
      /* 加热设备插上就地变成一个灶台 —— 否则玩家插上电水壶之后
         还得再找一个「台面」才能烧水，中间那一步在现实里并不存在。 */
      if (C.Config.cooking.heaters[key]) {
        rec.station = C.Cooking.addStation({
          pos: C.V.copy(outlet.pos), surface: 'outlet', slots: 1,
          heater: key, link, deviceId
        });
      }
      this.plugged[outlet.id] = rec;
      player._removeItem(item);

      const r = C.Power.setDevice(link, deviceId, true);
      C.EventBus.publish('DevicePluggedEvent', { outlet, itemId: item.id, ok: r.ok });
      /* **闸没推的时候照样插得上，只是没反应。**
         那句「插上了，没反应」是教学目标 3 的全部内容 —— 不能在这里拦住他。 */
      if (!r.ok) return { ok: true, msg: label + '插上了 —— ' + r.msg };
      return { ok: true, msg: label + '插上了，通电了' };
    },

    unplug(outlet, player) {
      const rec = this.plugged[outlet.id];
      if (!rec) return { ok: false, msg: '这个插座上没东西' };
      const name = C.ITEMS[rec.itemId].name;
      /* 正在做饭的时候拔电 = 那锅东西废了。
         **拔插头和跳闸是同一件事**，不该有一个更温柔的版本。 */
      if (rec.station && rec.station.session) C.Cooking.stop(rec.station);
      if (rec.station) {
        const i = C.Cooking.stations.indexOf(rec.station);
        if (i >= 0) C.Cooking.stations.splice(i, 1);
      }
      const li = C.Power.links.indexOf(rec.link);
      if (li >= 0) C.Power.links.splice(li, 1);
      delete this.plugged[outlet.id];

      const back = C.makeItem(rec.itemId, 1);
      const r = player.acquire(back);
      // 背包满了就掉在脚边 —— **不能凭空销毁**
      if (!r.ok) player.dropItem(back);
      C.EventBus.publish('DeviceUnpluggedEvent', { outlet, itemId: rec.itemId });
      return { ok: true, msg: '拔下 ' + name + (r.ok ? '' : '（背包满了，放在脚边）') };
    },

    /** 这个插座此刻有没有电（界面上要能直接看出来） */
    powered(outlet) {
      const c = C.Power.circuits.get(outlet.circuitId);
      return !!(c && c.canDeliver(C.Power.gridUp));
    },

    label(outlet) {
      const rec = this.at(outlet);
      if (rec) return '[F] 拔下 ' + C.ITEMS[rec.itemId].name;
      return '[F] ' + outlet.name + (this.powered(outlet) ? '' : '（没电）');
    },

    serialize() {
      return Object.keys(this.plugged).map(id => {
        const r = this.plugged[id];
        return { outletId: id, itemId: r.itemId,
                 linkId: r.link ? r.link.id : null,
                 stationId: r.station ? r.station.id : null };
      });
    },

    /**
     * 读档。
     *
     * **优先「认领」已经被还原出来的链路和灶台，而不是重新插一遍。**
     * `[实测]` 供电和烹饪各自的 `deserialize` 已经把链路和灶台造回来了；
     * 这里再 `plug()` 一次会得到**两条链路、两个灶台**，
     * 玩家看到的是同一个插座上插着两台电水壶，功率也翻倍。
     *
     * 找不到（比如单独读插座、或者存档是老版本）才退回重新插一遍。
     */
    deserialize(list, level) {
      this.plugged = {};
      if (!list || !level || !level.outlets) return this;
      for (const rec of list) {
        const o = level.outlets.find(x => x.id === rec.outletId);
        if (!o || !C.ITEMS[rec.itemId]) continue;
        const link = rec.linkId !== null && rec.linkId !== undefined
          ? C.Power.links.find(l => l.id === rec.linkId) : null;
        if (link) {
          let station = rec.stationId !== null && rec.stationId !== undefined
            ? (C.Cooking.stations.find(st => st.id === rec.stationId) || null) : null;
          /* 链路还在、灶台却没了（比如烹饪那半边被重置过）：**把灶台补回来**。
             不补的话，插座上明明插着电水壶，走过去却烧不了水。 */
          if (!station && C.Config.cooking.heaters[rec.itemId]) {
            station = C.Cooking.addStation({ pos: C.V.copy(o.pos), surface: 'outlet', slots: 1,
                                             heater: rec.itemId, link, deviceId: 'dev-' + o.id });
          }
          this.plugged[o.id] = {
            link, deviceId: 'dev-' + o.id, itemId: rec.itemId, outletId: o.id, station
          };
        } else {
          this.plug(o, { hotbar: [], bag: null, _removeItem() {} }, C.makeItem(rec.itemId, 1));
        }
      }
      return this;
    }
  };

  C.Outlets = Outlets;
})(typeof globalThis !== 'undefined' ? globalThis : this);
