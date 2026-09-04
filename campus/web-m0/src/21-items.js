/*
 * 21-items.js —— 物品定义与格子容器（主文档 10.1）
 *
 * 格子背包：每件物品占 w×h 个格子，可 90° 旋转。容器（背包、抽屉、衣柜）
 * 全部是同一个 Grid 类 —— 玩家背包和地上的书包在规则上没有区别。
 *
 * 「放不下」分两种，必须分开告诉玩家：
 *   背包已满   —— 空格总数就不够，得先扔东西
 *   请整理背包 —— 空格够但拼不出连续区域，挪一挪就能塞下
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /* 物品表。size 是 [宽, 高] 格；weight 千克。
     kind: food 食物 / drink 饮水 / med 医疗 / tool 工具 / weapon 武器
           / material 材料 / container 容器 / throwable 投掷物 / junk 杂物 */
  const ITEMS = {
    water:      { name: '瓶装水 500ml', size: [1, 2], weight: 0.52, kind: 'drink', use: { thirst: -25 } },
    boiled:     { name: '煮沸的水',     size: [1, 2], weight: 0.52, kind: 'drink', use: { thirst: -22 } },
    dirtyWater: { name: '来路不明的水', size: [1, 2], weight: 0.52, kind: 'drink', use: { thirst: -25, diarrheaChance: 0.4 } },
    emptyBottle:{ name: '空水瓶',       size: [1, 2], weight: 0.06, kind: 'tool' },
    biscuit:    { name: '饼干',         size: [1, 1], weight: 0.18, kind: 'food', use: { hunger: -12, thirst: 3 } },
    noodle:     { name: '方便面',       size: [2, 2], weight: 0.12, kind: 'food', use: { hunger: -15, thirst: 5 } },
    sausage:    { name: '火腿肠',       size: [1, 1], weight: 0.09, kind: 'food', use: { hunger: -8 } },
    canned:     { name: '午餐肉罐头',   size: [1, 1], weight: 0.34, kind: 'food', use: { hunger: -20, thirst: 2 } },
    chocolate:  { name: '巧克力',       size: [1, 1], weight: 0.10, kind: 'food', use: { hunger: -10, thirst: 2 } },
    flashlight: { name: '手电筒',       size: [1, 2], weight: 0.28, kind: 'tool' },
    battery:    { name: '电池',         size: [1, 1], weight: 0.05, kind: 'tool', stack: 4 },
    bandage:    { name: '绷带',         size: [1, 1], weight: 0.08, kind: 'med', stack: 3 },
    alcohol:    { name: '医用酒精',     size: [1, 1], weight: 0.30, kind: 'med' },
    antibiotic: { name: '抗生素',       size: [1, 1], weight: 0.04, kind: 'med', rare: true },
    cloth:      { name: '布',           size: [1, 1], weight: 0.10, kind: 'material', stack: 5 },
    lighter:    { name: '打火机',       size: [1, 1], weight: 0.03, kind: 'tool' },
    clockPart:  { name: '闹钟零件',     size: [1, 1], weight: 0.12, kind: 'material', stack: 3 },
    tarp:       { name: '塑料布',       size: [2, 1], weight: 0.45, kind: 'material' },
    stone:      { name: '石头',         size: [1, 1], weight: 0.25, kind: 'throwable', stack: 8 },
    glassBottle:{ name: '玻璃瓶',       size: [1, 2], weight: 0.38, kind: 'throwable' },
    mop:        { name: '拖把杆',       size: [1, 4], weight: 1.10, kind: 'weapon' },
    textbook:   { name: '课本',         size: [2, 2], weight: 0.70, kind: 'junk' },
    key:        { name: '钥匙',         size: [1, 1], weight: 0.02, kind: 'tool' },
    smallBag:   { name: '小书包',       size: [2, 2], weight: 0.40, kind: 'container', grid: [5, 4] },
    schoolBag:  { name: '学生书包',     size: [2, 3], weight: 0.55, kind: 'container', grid: [5, 4] },
    tacticalBag:{ name: '战术背包',     size: [3, 3], weight: 0.90, kind: 'container', grid: [6, 5], rare: true }
  };

  let nextUid = 1;

  /** 造一个物品实例。count 只对可堆叠的有意义。 */
  function makeItem(id, count) {
    const def = ITEMS[id];
    if (!def) throw new Error('未知物品 ' + id);
    return { uid: nextUid++, id, count: Math.max(1, count || 1), rot: 0, x: -1, y: -1 };
  }
  function itemSize(item) {
    const s = ITEMS[item.id].size;
    return item.rot ? [s[1], s[0]] : [s[0], s[1]];
  }

  function Grid(w, h, label) {
    this.w = w; this.h = h; this.label = label || '';
    this.items = [];
  }
  Grid.prototype.cellCount = function () { return this.w * this.h; };
  Grid.prototype.usedCells = function () {
    let n = 0;
    for (const it of this.items) { const s = itemSize(it); n += s[0] * s[1]; }
    return n;
  };
  Grid.prototype.freeCells = function () { return this.cellCount() - this.usedCells(); };
  Grid.prototype.weight = function () {
    let kg = 0;
    for (const it of this.items) kg += ITEMS[it.id].weight * it.count;
    return kg;
  };

  Grid.prototype.occupied = function () {
    const map = new Array(this.w * this.h).fill(null);
    for (const it of this.items) {
      const s = itemSize(it);
      for (let dy = 0; dy < s[1]; dy++) for (let dx = 0; dx < s[0]; dx++) map[(it.y + dy) * this.w + it.x + dx] = it;
    }
    return map;
  };

  Grid.prototype.fits = function (w, h, x, y, map, ignore) {
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const cell = map[(y + dy) * this.w + x + dx];
      if (cell && cell !== ignore) return false;
    }
    return true;
  };

  /** 找第一个能放下的位置（行优先，先原朝向再转 90°） */
  Grid.prototype.findSpot = function (item) {
    const map = this.occupied();
    const base = ITEMS[item.id].size;
    for (const rot of [0, 1]) {
      const w = rot ? base[1] : base[0], h = rot ? base[0] : base[1];
      if (rot && w === h) continue;                    // 方的转了也一样
      for (let y = 0; y <= this.h - h; y++) for (let x = 0; x <= this.w - w; x++) {
        if (this.fits(w, h, x, y, map, item)) return { x, y, rot };
      }
    }
    return null;
  };

  /**
   * 自动放入。先尝试并进已有的同类堆叠，再找空位。
   * @returns {ok:true, item} 或 {ok:false, reason:'full'|'fragmented', need, free}
   */
  Grid.prototype.autoAdd = function (item) {
    const def = ITEMS[item.id];
    if (def.stack) {
      for (const it of this.items) {
        if (it.id !== item.id || it.count >= def.stack) continue;
        const room = def.stack - it.count;
        const move = Math.min(room, item.count);
        it.count += move; item.count -= move;
        if (item.count <= 0) return { ok: true, item: it, stacked: true };
      }
    }
    const spot = this.findSpot(item);
    if (!spot) {
      const need = def.size[0] * def.size[1], free = this.freeCells();
      // 空格总数都不够 → 已满；够但拼不出连续区域 → 该整理了
      return { ok: false, reason: free < need ? 'full' : 'fragmented', need, free };
    }
    item.x = spot.x; item.y = spot.y; item.rot = spot.rot;
    this.items.push(item);
    return { ok: true, item };
  };

  Grid.prototype.placeAt = function (item, x, y, rot) {
    const base = ITEMS[item.id].size;
    const w = rot ? base[1] : base[0], h = rot ? base[0] : base[1];
    if (!this.fits(w, h, x, y, this.occupied(), item)) return false;
    item.x = x; item.y = y; item.rot = rot ? 1 : 0;
    if (this.items.indexOf(item) < 0) this.items.push(item);
    return true;
  };

  Grid.prototype.remove = function (item) {
    const i = this.items.indexOf(item);
    if (i >= 0) { this.items.splice(i, 1); return true; }
    return false;
  };
  Grid.prototype.find = function (id) { return this.items.find(it => it.id === id) || null; };
  Grid.prototype.count = function (id) {
    return this.items.filter(it => it.id === id).reduce((n, it) => n + it.count, 0);
  };

  /** 整理：按体积从大到小重排，把碎片挤掉 */
  Grid.prototype.tidy = function () {
    const all = this.items.slice().sort((a, b) => {
      const sa = ITEMS[a.id].size, sb = ITEMS[b.id].size;
      return (sb[0] * sb[1]) - (sa[0] * sa[1]);
    });
    this.items = [];
    const failed = [];
    for (const it of all) {
      it.x = -1; it.y = -1; it.rot = 0;
      const spot = this.findSpot(it);
      if (spot) { it.x = spot.x; it.y = spot.y; it.rot = spot.rot; this.items.push(it); }
      else failed.push(it);
    }
    return failed;      // 理论上不会有，除非容器被换小了
  };

  Grid.prototype.serialize = function () {
    return { w: this.w, h: this.h, label: this.label,
             items: this.items.map(i => ({ id: i.id, count: i.count, x: i.x, y: i.y, rot: i.rot })) };
  };
  Grid.deserialize = function (d) {
    const g = new Grid(d.w, d.h, d.label);
    g.items = (d.items || []).map(r => Object.assign(makeItem(r.id, r.count), { x: r.x, y: r.y, rot: r.rot }));
    return g;
  };

  C.ITEMS = ITEMS;
  C.makeItem = makeItem;
  C.itemSize = itemSize;
  C.Grid = Grid;
})(typeof globalThis !== 'undefined' ? globalThis : this);
