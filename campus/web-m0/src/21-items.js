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
           / material 材料 / container 容器 / throwable 投掷物 / junk 杂物

     **格数量的是体积，不是价值。** 这两件事在这张表里是解耦的，而且是故意解耦的：

       校园平面图  2 格 · 全校唯一 · 决定你能不能规划路线
       抗生素      1 格 · 全校仅 4 支 · 决定你会不会死于感染
       米袋        9 格 · 食堂一抓一把 · 但你一次只背得动一袋
       发电机     16 格 · 结局一的前置 · 没有登山包根本装不下
       课本        4 格 · 一文不值 · 纯粹占地方

     所以「腾出五格」这个决策永远不能靠「扔便宜的」来解 ——
     要扔的往往正是那袋米，而那袋米是你今晚的饭。
     反过来，塞满一背包小东西也不等于赚了：负重是另一条独立的线。 */
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
    textbook:   { name: '课本',         size: [2, 2], weight: 0.70, kind: 'junk', book: true },
    key:        { name: '钥匙',         size: [1, 1], weight: 0.02, kind: 'tool' },
    smallBag:   { name: '小书包',       size: [2, 2], weight: 0.40, kind: 'container', grid: [5, 4] },
    schoolBag:  { name: '学生书包',     size: [2, 3], weight: 0.55, kind: 'container', grid: [5, 4] },
    tacticalBag:{ name: '战术背包',     size: [3, 3], weight: 0.90, kind: 'container', grid: [6, 5], rare: true },

    /* ── M2 新增：全校其余地点的产出 ─────────────────────────
       尺寸按「这东西在现实里多占地方」定，与稀有度无关，见表头那段说明。 */

    // 食堂：粮食是最占地方的东西，也是撑过三十天的唯一办法
    rice:       { name: '大米 5kg',     size: [3, 3], weight: 5.00, kind: 'material' },
    flour:      { name: '面粉 2kg',     size: [2, 3], weight: 2.00, kind: 'material' },
    oil:        { name: '食用油',       size: [2, 2], weight: 1.80, kind: 'material' },
    salt:       { name: '盐',           size: [1, 1], weight: 0.40, kind: 'material' },
    pot:        { name: '铁锅',         size: [3, 3], weight: 1.60, kind: 'tool' },
    gasCan:     { name: '燃气罐',       size: [2, 3], weight: 4.50, kind: 'tool' },

    // 小卖部：热量密度高、体积小，第一幕的救命稻草
    soda:       { name: '罐装饮料',     size: [1, 1], weight: 0.33, kind: 'drink', use: { thirst: -18, hunger: -2 } },
    bigWater:   { name: '桶装水 1.5L',  size: [2, 2], weight: 1.55, kind: 'drink', use: { thirst: -60 } },

    // 医务室
    painkiller: { name: '止痛药',       size: [1, 1], weight: 0.05, kind: 'med' },
    splint:     { name: '夹板',         size: [1, 3], weight: 0.30, kind: 'med' },

    // 实验楼：烧杯能煮水，是第 8 天停水之后的关键道具
    beaker:     { name: '烧杯',         size: [2, 2], weight: 0.35, kind: 'tool' },
    reagent:    { name: '化学试剂',     size: [1, 2], weight: 0.45, kind: 'material' },
    burner:     { name: '酒精灯',       size: [1, 1], weight: 0.22, kind: 'tool' },

    // 保安室：全校唯一的战术背包与平面图都在这里
    pitchfork:  { name: '钢叉',         size: [1, 5], weight: 2.30, kind: 'weapon' },
    baton:      { name: '警棍',         size: [1, 3], weight: 0.85, kind: 'weapon' },
    radio:      { name: '对讲机',       size: [1, 2], weight: 0.32, kind: 'tool' },
    campusMap:  { name: '校园平面图',   size: [2, 1], weight: 0.05, kind: 'tool', rare: true },
    masterKey:  { name: '万能钥匙串',   size: [1, 1], weight: 0.09, kind: 'tool', rare: true },

    // 体育器材室：登山包是全校最大的容器，本身就占三格宽四格高
    bat:        { name: '棒球棍',       size: [1, 4], weight: 0.95, kind: 'weapon' },
    starterGun: { name: '发令枪',       size: [1, 2], weight: 0.55, kind: 'tool', rare: true },
    rope:       { name: '绳索',         size: [2, 2], weight: 1.20, kind: 'material' },
    hikingBag:  { name: '登山包',       size: [3, 4], weight: 1.10, kind: 'container', grid: [6, 6], rare: true },

    // 教学楼 / 图书馆
    stationery: { name: '文具盒',       size: [2, 1], weight: 0.20, kind: 'junk' },
    manual:     { name: '技术手册',     size: [2, 3], weight: 0.90, kind: 'junk', rare: true, book: true },

    /* ── 厨房（烹饪与供电规格）──────────────────────
       加热设备与锅具都是**世界中的实体物件**：能捡、能背、能放到台面上。
       格子大小按体积给 —— 电磁炉 3×3 会吃掉小书包(5×4) 将近一半。 */
    /* 两张字条 —— **第一份和第二份环境叙事**。
       206 那张（「它们看不清，但是听得见」）是整个游戏最重要的教学文本，
       因为它是别人用命换来的经验，比任何 UI 提示都有分量。 */
    note406:     { name: '一张字条',   size: [1, 1], weight: 0.01, kind: 'note', note: 'note406' },
    note206:     { name: '一张字条',   size: [1, 1], weight: 0.01, kind: 'note', note: 'note206', rare: true },
    deskLamp:    { name: '台灯',       size: [2, 2], weight: 0.8,  kind: 'device', device: 'deskLamp' },
    kettle:      { name: '电水壶',   size: [2, 3], weight: 1.0, kind: 'heater',   heater: 'kettle' },
    inductionHob:{ name: '电磁炉',   size: [3, 3], weight: 2.6, kind: 'heater',   heater: 'inductionHob' },
    ceramicHob:  { name: '电陶炉',   size: [3, 3], weight: 2.8, kind: 'heater',   heater: 'ceramicHob' },
    riceCooker:  { name: '电饭煲',   size: [3, 3], weight: 2.4, kind: 'heater',   heater: 'riceCooker' },
    microwave:   { name: '微波炉',   size: [4, 3], weight: 12.0,kind: 'heater',   heater: 'microwave' },
    slowCooker:  { name: '电炖锅',   size: [3, 3], weight: 2.2, kind: 'heater',   heater: 'slowCooker', rare: true },
    campStove:   { name: '卡式炉',   size: [3, 2], weight: 2.1, kind: 'heater',   heater: 'campStove' },
    butane:      { name: '丁烷气罐', size: [1, 2], weight: 0.4, kind: 'fuel',     stack: 3 },
    wok:         { name: '铁炒锅',   size: [3, 3], weight: 2.2, kind: 'cookware', cookware: 'wok' },
    stockpot:    { name: '不锈钢汤锅',size:[3, 3], weight: 1.4, kind: 'cookware', cookware: 'stockpot' },
    clayPot:     { name: '砂锅',     size: [3, 3], weight: 2.6, kind: 'cookware', cookware: 'clayPot', rare: true },
    pressureCooker:{name:'高压锅',   size: [3, 3], weight: 3.1, kind: 'cookware', cookware: 'pressure', rare: true },
    steamer:     { name: '蒸锅',     size: [3, 3], weight: 1.8, kind: 'cookware', cookware: 'steamer' },
    skillet:     { name: '平底锅',   size: [2, 3], weight: 1.1, kind: 'cookware', cookware: 'skillet' },
    milkPot:     { name: '奶锅',     size: [2, 2], weight: 0.6, kind: 'cookware', cookware: 'milkPot' },
    glassBox:    { name: '玻璃饭盒', size: [2, 2], weight: 0.4, kind: 'cookware', cookware: 'glassBox' },
    /* 电线：**世界中的实体物件**，连接时能看见线拖在地上。不要做成菜单里的连线界面。 */
    shortWire:   { name: '短电线',   size: [1, 2], weight: 0.3, kind: 'cable', cable: 'shortWire' },
    powerStrip:  { name: '插线板',   size: [2, 2], weight: 0.6, kind: 'cable', cable: 'powerStrip' },
    extension:   { name: '工程延长线',size:[2, 3], weight: 2.4, kind: 'cable', cable: 'extension' },
    cableReel:   { name: '电缆盘',   size: [3, 3], weight: 6.0, kind: 'cable', cable: 'cableReel', rare: true },
    // 食材（够跑通 Lv0~Lv2 的食谱；其余按 Config.food 补）
    riceBag:     { name: '大米',     size: [2, 3], weight: 2.0, kind: 'food', food: 'rice', stack: 5 },
    flour:       { name: '面粉',     size: [2, 3], weight: 2.0, kind: 'food', food: 'flour', stack: 5 },
    driedNoodle: { name: '挂面',     size: [1, 3], weight: 0.5, kind: 'food', food: 'driedNoodle', stack: 5 },
    egg:         { name: '鸡蛋',     size: [1, 1], weight: 0.06,kind: 'food', food: 'egg', stack: 12 },
    oil:         { name: '食用油',   size: [2, 3], weight: 1.8, kind: 'food', food: 'oil', stack: 2 },
    salt:        { name: '盐',       size: [1, 1], weight: 0.3, kind: 'food', food: 'salt', stack: 3, seasoning: true },
    soySauce:    { name: '酱油',     size: [1, 2], weight: 0.6, kind: 'food', food: 'soySauce', stack: 2, seasoning: true },
    sugar:       { name: '糖',       size: [1, 1], weight: 0.4, kind: 'food', food: 'sugar', stack: 3, seasoning: true },
    onion:       { name: '洋葱',     size: [1, 1], weight: 0.2, kind: 'food', food: 'onion', stack: 4 },
    tomato:      { name: '番茄罐头', size: [1, 2], weight: 0.4, kind: 'food', food: 'tomato', stack: 3 },
    mushroom:    { name: '香菇干',   size: [1, 2], weight: 0.1, kind: 'food', food: 'mushroom', stack: 4 },
    tea:         { name: '茶叶',     size: [1, 1], weight: 0.1, kind: 'food', food: 'tea', stack: 3 },
    coffee:      { name: '咖啡',     size: [1, 1], weight: 0.1, kind: 'food', food: 'coffee', stack: 3 },
    ginger:      { name: '姜',       size: [1, 1], weight: 0.1, kind: 'food', food: 'ginger', stack: 4 },
    novel:      { name: '小说',         size: [1, 2], weight: 0.35, kind: 'junk' },

    // 车棚 / 锅炉房：结局一需要发电机与柴油，两样都大得离谱
    bikePart:   { name: '车辆零件',     size: [2, 2], weight: 1.40, kind: 'material' },
    wrench:     { name: '扳手',         size: [1, 2], weight: 0.55, kind: 'tool' },
    toolkit:    { name: '工具箱',       size: [3, 2], weight: 2.60, kind: 'tool' },
    fuse:       { name: '保险丝',       size: [1, 1], weight: 0.03, kind: 'tool', stack: 4 },
    diesel:     { name: '柴油桶',       size: [3, 3], weight: 6.50, kind: 'material', rare: true },
    generator:  { name: '发电机',       size: [4, 4], weight: 14.0, kind: 'tool', rare: true },

    // 行政楼：结局一/三的前置
    broadcastPart: { name: '广播设备零件', size: [3, 2], weight: 2.10, kind: 'material', rare: true },
    beacon:     { name: '信标',         size: [2, 3], weight: 1.90, kind: 'tool', rare: true }
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
