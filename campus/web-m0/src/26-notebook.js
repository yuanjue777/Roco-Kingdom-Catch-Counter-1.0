/*
 * 26-notebook.js —— 笔记本（主文档 14.3，M2）
 *
 * 四页：地图 · 线索 · 配方 · 观察。**全部是被动记录** ——
 * 玩家不需要按任何键去「记下来」，走过、翻过、看见过、听见过的东西自动进本子。
 * 唯一需要主动操作的是地图上的手动标记（14.3 明确要求「可手动标记」）。
 *
 * 这里是规则层：不认识 DOM，也不认识 canvas，只维护可序列化的数据。
 * 画出来是 27-notebook-ui.js 的事。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const PIN_TYPES = [
    { id: 'base',   label: '据点', color: '#6FD3E8' },
    { id: 'danger', label: '危险', color: '#E4573D' },
    { id: 'loot',   label: '物资', color: '#E5B45C' },
    { id: 'water',  label: '水',   color: '#7FB4C8' }
  ];

  const Notebook = {
    nodes: new Set(),          // 走进过的声图节点 id
    buildings: new Set(),      // 进过的建筑 buildingId
    looted: new Set(),         // 翻过的容器 id
    clues: [],                 // {day, hhmm, text}
    recipes: new Set(),        // 已解锁的配方 id
    obs: new Map(),            // key -> {label, count, firstDay}
    pins: [],                  // {x, z, type}
    pinType: 'base',
    unread: 0,                 // 上次打开之后新增了几条，HUD 上给个小红点

    reset() {
      this.nodes = new Set(); this.buildings = new Set(); this.looted = new Set();
      this.clues = []; this.recipes = new Set(); this.obs = new Map();
      this.pins = []; this.unread = 0;
      return this;
    },

    _stamp(time) {
      return { day: time ? time.day : 1, hhmm: time ? time.format() : '' };
    },

    /* ── 地图页 ─────────────────────────────────────── */

    /** 玩家换了所在节点。每帧都会调，必须便宜。 */
    visitNode(node, level, time) {
      if (!node || this.nodes.has(node.id)) return false;
      this.nodes.add(node.id);
      if (node.buildingId) {
        const b = level && level.buildings
          ? level.buildings.find(x => x.buildingId === node.buildingId) : null;
        if (b && !this.buildings.has(node.buildingId)) {
          this.buildings.add(node.buildingId);
          this.addClue('第一次进入' + b.name, time);
        }
      }
      return true;
    },

    /** 已探明的房间占这栋楼的几成 —— 地图页拿它画进度 */
    exploredRatio(building) {
      let total = 0, seen = 0;
      for (const meta of building.floorsMeta) {
        for (const r of meta.rooms) { total++; if (this.nodes.has(r.id)) seen++; }
        total++; if (this.nodes.has(meta.corridor.id)) seen++;
      }
      return total ? seen / total : 0;
    },

    /* ── 线索页 ─────────────────────────────────────── */

    addClue(text, time) {
      if (this.clues.some(c => c.text === text)) return false;   // 同一条只记一次
      this.clues.unshift(Object.assign(this._stamp(time), { text }));
      if (this.clues.length > 60) this.clues.pop();
      this.unread++;
      return true;
    },

    /** 翻完一个容器。稀有物资本身就是线索：「保安室的柜子里有战术背包」值得记一笔。 */
    lootContainer(box, time) {
      if (!box || this.looted.has(box.id)) return;
      this.looted.add(box.id);
      for (const it of box.grid.items) {
        const def = C.ITEMS[it.id];
        if (def && def.rare) this.addClue(box.roomName + ' 的' + box.name + '里有' + def.name, time);
      }
    },

    /* ── 配方页 ─────────────────────────────────────── */

    /**
     * 捡到书就解锁对应的一批**手艺**配方（10.2「书籍解锁配方」）。
     * `[实测]` **烹饪配方不走书**，走烹饪熟练度（烹饪规格 12.2）——
     * 做饭是练出来的，不是看书看会的。两张表因此是分开的。
     */
    readBook(itemId, time) {
      let n = 0;
      for (const r of C.Config.craftRecipes) {
        if (r.unlock !== itemId || this.recipes.has(r.id)) continue;
        this.recipes.add(r.id); n++;
      }
      if (n) this.addClue('翻了翻' + (C.ITEMS[itemId] || {}).name + '，记下 ' + n + ' 条做法', time);
      return n;
    },

    /* ── 观察页 ─────────────────────────────────────── */

    /**
     * 记一条对丧尸的观察。how 是「怎么知道的」：看见 / 听见。
     * 这一页的价值在于把玩家自己摸出来的规律固化下来，而不是提前告诉他。
     */
    observeZombie(zombie, how, time) {
      const key = zombie.typeName + ':' + how;
      const label = zombie.def.name + '（' + how + '）';
      const e = this.obs.get(key);
      if (e) { e.count++; return false; }
      this.obs.set(key, { label, count: 1, firstDay: time ? time.day : 1 });
      this.unread++;
      return true;
    },

    /** 玩法规律：由玩法事件触发，一条只记一次 */
    note(key, label, time) {
      if (this.obs.has(key)) { this.obs.get(key).count++; return false; }
      this.obs.set(key, { label, count: 1, firstDay: time ? time.day : 1 });
      this.unread++;
      return true;
    },

    /* ── 手动标记（14.3）─────────────────────────────── */

    addPin(x, z, type) {
      this.pins.push({ x, z, type: type || this.pinType });
      return this.pins[this.pins.length - 1];
    },
    /** 离 (x,z) 最近的标记，超过 r 米就当没点中 */
    pinNear(x, z, r) {
      let best = null, bd = r;
      for (const p of this.pins) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= bd) { bd = d; best = p; }
      }
      return best;
    },
    removePin(pin) {
      const i = this.pins.indexOf(pin);
      if (i >= 0) this.pins.splice(i, 1);
    },

    /* ── 存档（硬约束 4：所有运行时状态必须可序列化）──── */

    serialize() {
      return {
        nodes: Array.from(this.nodes), buildings: Array.from(this.buildings),
        looted: Array.from(this.looted), clues: this.clues,
        recipes: Array.from(this.recipes),
        obs: Array.from(this.obs.entries()).map(([k, v]) => [k, v.label, v.count, v.firstDay]),
        pins: this.pins
      };
    },
    deserialize(d) {
      this.reset();
      if (!d) return this;
      this.nodes = new Set(d.nodes || []);
      this.buildings = new Set(d.buildings || []);
      this.looted = new Set(d.looted || []);
      this.clues = d.clues || [];
      this.recipes = new Set(d.recipes || []);
      for (const [k, label, count, firstDay] of (d.obs || [])) this.obs.set(k, { label, count, firstDay });
      this.pins = d.pins || [];
      return this;
    }
  };

  C.PinTypes = PIN_TYPES;
  C.Notebook = Notebook;
})(typeof globalThis !== 'undefined' ? globalThis : this);
