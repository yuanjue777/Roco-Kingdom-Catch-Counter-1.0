/*
 * 28-loot-ui.js —— 搜刮界面（主文档 14.2b）
 *
 * 与背包总览（23-inventory-ui）的区别，只有一条但很关键：
 * **搜刮界面不遮挡游戏画面。** 没有全屏黑底，只有两块浮在画面上的格子板 ——
 * 容器在上、自己的背包在下。翻找期间游戏不暂停，玩家必须能看见身后的走廊。
 *
 * 交互：F 开、再按 F 关；格子里的物品可以拖动 ——
 * 容器 ↔ 背包互拖，同一个格子板内拖动 = 挪位置。
 * 放不下时自动试转 90°，再放不下就弹回原位（东西永远不会凭空消失）。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /* 格子边长。手机上屏幕小、手指粗，格子反而要更大一点才点得准，
     但格子板整体不能超过屏幕宽度，所以按可用宽度回退。 */
  function cellSize() {
    const touch = C.Touch && C.Touch.enabled;
    const base = touch ? 40 : 36;
    const budget = Math.min(innerWidth, innerHeight * 1.9) - 60;
    return Math.max(24, Math.min(base, Math.floor(budget / 12)));
  }
  const GAP = 2;

  const UI = {
    open: false, container: null, game: null, drag: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('loot');
      /* 左边是自己的背包、右边是容器 —— 和「从右边往左边搬」的动作方向一致。
         两块板并排放在画面正中，中间那条缝就是拖动的路径。 */
      this.el.innerHTML =
        '<div class="loot-row">' +
          '<div class="loot-panel" id="lootBag"></div>' +
          '<div class="loot-panel" id="lootBox"></div>' +
        '</div>' +
        '<div class="loot-tip" id="lootTip"></div>';
      this.boxPane = document.getElementById('lootBox');
      this.bagPane = document.getElementById('lootBag');
      this.tip = document.getElementById('lootTip');
      // 拖动用 pointer 事件：鼠标和手指走同一条路
      this.el.addEventListener('pointerdown', (e) => this._down(e));
      addEventListener('pointermove', (e) => this._move(e));
      addEventListener('pointerup', (e) => this._up(e));
      addEventListener('pointercancel', () => this._cancel());
    },

    /** 打开某个容器的搜刮界面。开关由规则层（Player.openContainer）决定，这里只负责显示 */
    toggle(box) {
      this.container = box || this.container;
      if (!this.container) return;
      this.open = true;
      this.el.classList.add('open');
      // 桌面端要把鼠标还回来，否则拖不动格子
      if (document.pointerLockElement) document.exitPointerLock();
      this.render();
    },

    close() {
      this._cancel();
      // 通知规则层：不然它以为还开着，下一次按 F 会变成「关」
      if (this.container && this.game) this.game.player.closeContainer(this.container);
      this.open = false; this.container = null;
      this.el.classList.remove('open');
      if (this.game && this.game._syncStartHint) this.game._syncStartHint();
    },

    /** 逐个点亮：翻找到第几件就显示到第几件（三角洲式） */
    tickSearch(dt) {
      const box = this.container;
      if (!this.open || !box || !box.opened || box.revealed >= box.grid.items.length) return;
      box._t = (box._t || 0) + dt;
      const per = box.searchSeconds / Math.max(1, box.grid.items.length);
      while (box._t >= per && box.revealed < box.grid.items.length) { box._t -= per; box.revealed++; this.render(); }
    },

    /** 走远了自动关 —— 界面不遮画面，玩家很容易忘了它还开着 */
    update(player) {
      if (!this.open || !this.container) return;
      if (C.V.dist(player.pos, this.container.pos) > C.Config.interact.range + 1.6) this.close();
    },

    /* ── 渲染 ────────────────────────────────────────── */

    render() {
      if (!this.open) return;
      const p = this.game.player, box = this.container;
      const cell = cellSize();
      const total = box.grid.items.length;
      const done = box.revealed >= total;

      this.boxPane.innerHTML =
        `<h5>${box.name}<small>${box.roomName || ''}　${done ? '已翻完' : `翻找中 ${box.revealed}/${total}`}</small>` +
        `<button class="loot-btn" id="lootClose">关闭</button></h5>` +
        this._grid(box.grid, cell, 'box', box.revealed);

      this.bagPane.innerHTML = p.bag
        ? `<h5>${p.bag.label}<small>空 ${p.bag.freeCells()}/${p.bag.cellCount()} 格　` +
          `${p.totalWeight().toFixed(2)}/${C.Config.player.weightLimit}kg</small>` +
          `<button class="loot-btn" id="lootTidy">整理</button></h5>` +
          this._grid(p.bag, cell, 'bag')
        : `<h5>快取栏<small>你还没有背包</small></h5>${this._hotbar(p, cell)}`;

      const tidy = document.getElementById('lootTidy');
      if (tidy) tidy.onclick = () => { p.bag.tidy(); this.render(); this.game.msg('整理完毕'); };
      // 手机上没有 F 键可按，标题栏留一个明确的关闭按钮
      document.getElementById('lootClose').onclick = () => this.close();
      this.tip.textContent = C.Touch && C.Touch.enabled
        ? '拖动搬运物品 · 再按一次 F 关闭'
        : '拖动搬运物品 · 拖动时按 R 转 90° · 再按 F 或 Esc 关闭';
    },

    _grid(grid, cell, which, revealLimit) {
      const st = cell + GAP;
      let html = `<div class="loot-grid" data-grid="${which}" ` +
        `style="width:${grid.w * st - GAP}px;height:${grid.h * st - GAP}px">`;
      for (let i = 0; i < grid.w * grid.h; i++) {
        html += `<i style="left:${(i % grid.w) * st}px;top:${Math.floor(i / grid.w) * st}px;` +
                `width:${cell}px;height:${cell}px"></i>`;
      }
      grid.items.forEach((it, idx) => {
        const hidden = revealLimit !== undefined && idx >= revealLimit;
        const s = C.itemSize(it), d = C.ITEMS[it.id];
        html += `<b class="loot-item${hidden ? ' hid' : ''}${d.rare ? ' rare' : ''}" ` +
          `data-uid="${it.uid}" data-grid="${which}" ` +
          `style="left:${it.x * st}px;top:${it.y * st}px;` +
          `width:${s[0] * cell + (s[0] - 1) * GAP}px;height:${s[1] * cell + (s[1] - 1) * GAP}px" ` +
          `title="${d.name}　${d.weight}kg">${hidden ? '？' : d.name}` +
          `${it.count > 1 ? `<u>${it.count}</u>` : ''}</b>`;
      });
      return html + '</div>';
    },

    /** 没背包时下面那块显示六格快取栏，拖进去一样能用 */
    _hotbar(p, cell) {
      const st = cell + GAP;
      let html = `<div class="loot-grid" data-grid="hotbar" style="width:${6 * st - GAP}px;height:${cell}px">`;
      for (let i = 0; i < 6; i++) {
        html += `<i style="left:${i * st}px;top:0;width:${cell}px;height:${cell}px"></i>`;
      }
      p.hotbar.forEach((it, i) => {
        if (!it) return;
        html += `<b class="loot-item" data-uid="${it.uid}" data-grid="hotbar" ` +
          `style="left:${i * st}px;top:0;width:${cell}px;height:${cell}px">` +
          `${C.ITEMS[it.id].name}${it.count > 1 ? `<u>${it.count}</u>` : ''}</b>`;
      });
      return html + '</div>';
    },

    /* ── 拖动 ────────────────────────────────────────── */

    _locate(uid) {
      const p = this.game.player, box = this.container;
      if (box) { const it = box.grid.items.find(i => i.uid === uid); if (it) return { it, grid: box.grid, which: 'box' }; }
      if (p.bag) { const it = p.bag.items.find(i => i.uid === uid); if (it) return { it, grid: p.bag, which: 'bag' }; }
      const hi = p.hotbar.findIndex(i => i && i.uid === uid);
      if (hi >= 0) return { it: p.hotbar[hi], grid: null, which: 'hotbar', slot: hi };
      return null;
    },

    _down(e) {
      const el = e.target.closest('.loot-item');
      if (!el || el.classList.contains('hid')) {
        if (el) this.game.msg('还没翻到这件');
        return;
      }
      const f = this._locate(+el.dataset.uid);
      if (!f) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.className = 'loot-item loot-ghost' + (C.ITEMS[f.it.id].rare ? ' rare' : '');
      ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
      document.body.appendChild(ghost);
      this.drag = { ...f, el, ghost, rot: f.it.rot || 0,
                    // 抓在物品内部的哪个位置：放下时要按这个偏移算落点，不然会差半格
                    ox: e.clientX - r.left, oy: e.clientY - r.top, cell: cellSize() };
      el.classList.add('dragging');
      this._moveGhost(e.clientX, e.clientY);
    },

    _moveGhost(x, y) {
      const d = this.drag;
      d.ghost.style.left = (x - d.ox) + 'px';
      d.ghost.style.top = (y - d.oy) + 'px';
    },

    _move(e) { if (this.drag) { e.preventDefault(); this._moveGhost(e.clientX, e.clientY); } },

    /** 拖动中按 R：转 90°（装配层把按键转过来） */
    rotate() {
      const d = this.drag;
      if (!d) return false;
      const base = C.ITEMS[d.it.id].size;
      if (base[0] === base[1]) return true;            // 方的转了也一样
      d.rot = d.rot ? 0 : 1;
      const st = d.cell + GAP;
      const w = d.rot ? base[1] : base[0], h = d.rot ? base[0] : base[1];
      d.ghost.style.width = (w * d.cell + (w - 1) * GAP) + 'px';
      d.ghost.style.height = (h * d.cell + (h - 1) * GAP) + 'px';
      d.ox = Math.min(d.ox, w * st - 4); d.oy = Math.min(d.oy, h * st - 4);
      return true;
    },

    _cancel() {
      if (!this.drag) return;
      this.drag.ghost.remove();
      this.drag.el.classList.remove('dragging');
      this.drag = null;
    },

    _up(e) {
      const d = this.drag;
      if (!d) return;
      // 落点：手指/鼠标下面那块格子板，按物品左上角折算成格坐标
      const gx = e.clientX - d.ox, gy = e.clientY - d.oy;
      let target = null;
      for (const pane of this.el.querySelectorAll('.loot-grid')) {
        const r = pane.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          target = { which: pane.dataset.grid, r };
          break;
        }
      }
      const cell = d.cell + GAP;
      this._cancel();
      if (!target) { this.render(); return; }              // 拖到界面外：什么也不做

      const p = this.game.player;
      const dst = target.which === 'box' ? this.container.grid
                : target.which === 'bag' ? p.bag : null;
      const cx = Math.round((gx - target.r.left) / cell);
      const cy = Math.round((gy - target.r.top) / cell);

      if (target.which === 'hotbar') { this._toHotbar(d, cx); this.render(); return; }
      if (!dst) { this.render(); return; }

      const moved = this._place(d, dst, cx, cy);
      if (!moved) this.game.msg('这里放不下');
      else if (d.which === 'box' && target.which !== 'box') {
        // 从容器里拿走一件：已点亮数跟着减，否则后面的物品会莫名变暗
        this.container.revealed = Math.max(0, this.container.revealed - 1);
      }
      this.render();
    },

    /**
     * 把 d.it 放到 dst 的 (cx,cy)。放不下就依次退让：
     * 转 90° → 自动找位置 → 全都不行则原样退回（**东西不会凭空消失**）。
     */
    _place(d, dst, cx, cy) {
      const from = d.which === 'hotbar' ? null : d.grid;
      const wasSlot = d.slot;
      // 先从原处摘下来，否则它自己会挡住自己
      if (from) from.remove(d.it); else this.game.player.hotbar[wasSlot] = null;

      const put = () => {
        if (dst.placeAt(d.it, cx, cy, d.rot)) return true;
        if (dst.placeAt(d.it, cx, cy, d.rot ? 0 : 1)) return true;
        return dst.autoAdd(d.it).ok;
      };
      if (put()) return true;

      // 退回原处。原位一定放得回去（刚从那儿摘下来的）
      if (from) from.placeAt(d.it, d.it.x, d.it.y, d.it.rot);
      else this.game.player.hotbar[wasSlot] = d.it;
      return false;
    },

    _toHotbar(d, slot) {
      const p = this.game.player;
      slot = Math.max(0, Math.min(5, slot));
      if (d.which === 'hotbar') {                      // 快取栏内部换位：直接交换
        const tmp = p.hotbar[slot];
        p.hotbar[slot] = d.it; p.hotbar[d.slot] = tmp;
        return;
      }
      const free = p.hotbar[slot] === null ? slot : p.hotbar.indexOf(null);
      if (free < 0) { this.game.msg('快取栏满了'); return; }
      d.grid.remove(d.it);
      p.hotbar[free] = d.it;
      if (d.which === 'box') this.container.revealed = Math.max(0, this.container.revealed - 1);
    }
  };

  C.LootUI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
