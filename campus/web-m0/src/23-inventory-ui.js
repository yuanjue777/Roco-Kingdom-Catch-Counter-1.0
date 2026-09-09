/*
 * 23-inventory-ui.js —— 背包与搜刮界面（主文档 14.2）
 * 用 DOM 而不是 canvas：格子拖放/点击/长按这些交互，DOM 天生就有。
 * **打开背包时游戏不暂停** —— 搜刮和整理背包本身就是有风险的行为。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const CELL = 34, GAP = 2;

  const UI = {
    open: false, container: null, game: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('inv');
      this.el.innerHTML =
        '<div class="inv-wrap">' +
          '<section class="inv-pane" id="invBagPane"></section>' +
          '<section class="inv-pane" id="invBoxPane"></section>' +
        '</div>' +
        '<p class="inv-hint"><b>拖动</b>格子搬东西（背包 ↔ 快取栏 ↔ 容器）· ' +
          '<b>左键</b>使用/拿取 · <b>右键</b>出菜单（放置 / 放到地上 / 使用）· ' +
          '<kbd>B</kbd>/<kbd>Esc</kbd> 关闭</p>' +
        '<div id="invMenu"></div>';
      this.bagPane = document.getElementById('invBagPane');
      this.boxPane = document.getElementById('invBoxPane');
      this.menuEl = document.getElementById('invMenu');
      document.getElementById('btnBag').addEventListener('click', () => this.toggle());

      /* ── 拖放 ────────────────────────────────────────
         `[实测]` 背包原来只能点，不能拖。搜刮界面（28-loot-ui）早就能拖了，
         于是**同一个格子，在两个界面里的操作方式不一样** —— 这比两个都不能拖更糟。
         按下超过 4px 才算拖，否则一次轻微的手抖会把「点击使用」吃掉。 */
      this.el.addEventListener('pointerdown', (e) => this._down(e));
      addEventListener('pointermove', (e) => this._move(e));
      addEventListener('pointerup', (e) => this._up(e));
      addEventListener('pointercancel', () => this._cancelDrag());
      this.menuEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mact]');
        if (b) { this._menuAct(b.dataset.mact); }
        this._closeMenu();
      });
    },

    toggle(container) {
      this.open = !this.open || (container && container !== this.container);
      this.container = this.open ? (container || this.container) : null;
      this.el.classList.toggle('open', this.open);
      // 开着的时候把鼠标借过来（不然点不中格子），合上再还回去
      if (this.open) { this.game.releaseMouseForPanel(); this.render(); }
      else this.game.restoreMouseAfterPanel();
    },
    close() {
      if (!this.open) return;
      this.open = false; this.container = null; this.el.classList.remove('open');
      this.game.restoreMouseAfterPanel();
    },

    /** 逐个点亮：翻找到第几件就显示到第几件（三角洲式） */
    tickSearch(dt) {
      const box = this.container;
      if (!box || !box.opened || box.revealed >= box.grid.items.length) return;
      box._t = (box._t || 0) + dt;
      const per = box.searchSeconds / Math.max(1, box.grid.items.length);
      while (box._t >= per && box.revealed < box.grid.items.length) { box._t -= per; box.revealed++; this.render(); }
    },

    render() {
      if (!this.open) return;
      const p = this.game.player;
      this.bagPane.innerHTML = this._bagHtml(p);
      this.boxPane.innerHTML = this._boxHtml();
      this._bind();
    },

    _gridHtml(grid, revealLimit) {
      const cells = `<div class="inv-grid" style="width:${grid.w * (CELL + GAP)}px;height:${grid.h * (CELL + GAP)}px">` +
        new Array(grid.w * grid.h).fill(0).map((_, i) =>
          `<i class="inv-cell" style="left:${(i % grid.w) * (CELL + GAP)}px;top:${Math.floor(i / grid.w) * (CELL + GAP)}px"></i>`).join('') +
        grid.items.map((it, idx) => {
          const hidden = revealLimit !== undefined && idx >= revealLimit;
          const s = C.itemSize(it), d = C.ITEMS[it.id];
          return `<b class="inv-item${hidden ? ' hid' : ''}${d.rare ? ' rare' : ''}" data-uid="${it.uid}"
                     style="left:${it.x * (CELL + GAP)}px;top:${it.y * (CELL + GAP)}px;
                            width:${s[0] * CELL + (s[0] - 1) * GAP}px;height:${s[1] * CELL + (s[1] - 1) * GAP}px"
                     title="${d.name}　${d.weight}kg">${hidden ? '' : d.name}${it.count > 1 ? `<u>${it.count}</u>` : ''}</b>`;
        }).join('') + '</div>';
      return cells;
    },

    _bagHtml(p) {
      const hot = `<div class="inv-hot">` + p.hotbar.map((it, i) =>
        `<span class="hot-slot" data-slot="${i}">${it ? `<b data-uid="${it.uid}">${C.ITEMS[it.id].name}${it.count > 1 ? `<u>${it.count}</u>` : ''}</b>` : ''}<em>${i + 1}</em></span>`).join('') + '</div>';
      if (!p.bag) {
        return `<h4>快取栏 <small>6 格</small></h4>${hot}
          <p class="inv-empty">你还没有背包。<br>宿舍里到处都是书包，找一个背上。</p>`;
      }
      const kg = p.totalWeight(), max = p.weightLimit();
      const r = Math.min(1, kg / max);
      return `<h4>${p.bag.label} <small>${p.bag.w}×${p.bag.h}　空 ${p.bag.freeCells()}/${p.bag.cellCount()} 格</small>
                <button class="inv-btn" id="btnTidy">整理</button></h4>` +
        this._gridHtml(p.bag) +
        `<div class="inv-load"><i style="width:${r * 100}%;background:${kg > max ? 'var(--accent)' : 'var(--signal)'}"></i></div>
         <p class="inv-load-txt">负重 ${kg.toFixed(2)} / ${max} kg　${kg > max ? '· 超重，无法奔跑' : ''}</p>
         <h4>快取栏 <small>6 格</small></h4>${hot}`;
    },

    _boxHtml() {
      const box = this.container;
      if (!box) return '<p class="inv-empty">没有打开容器。<br>走到书桌、衣柜、床下箱或书包前按 <kbd>F</kbd>。</p>';
      const total = box.grid.items.length;
      const done = box.revealed >= total;
      return `<h4>${box.name} <small>${box.roomName}　${done ? '已翻完' : `翻找中 ${box.revealed}/${total}`}</small></h4>` +
        this._gridHtml(box.grid, box.revealed) +
        (done ? '' : `<div class="inv-load"><i style="width:${(box.revealed / Math.max(1, total)) * 100}%;background:var(--part-fg,#E5B45C)"></i></div>`) +
        `<p class="inv-load-txt">翻找中（响度 40）—— 这段时间你既聋又瞎</p>`;
    },

    _bind() {
      const p = this.game.player;
      const tidy = document.getElementById('btnTidy');
      if (tidy) tidy.onclick = () => { p.bag.tidy(); this.render(); this.game.msg('整理完毕'); };

      this.el.querySelectorAll('.inv-item, .hot-slot b').forEach(el => {
        // 右键不再是「直接丢掉」——先弹菜单，因为「放置」也在这里
        el.oncontextmenu = (e) => {
          e.preventDefault(); e.stopPropagation();
          this._openMenu(+el.dataset.uid, e.clientX, e.clientY);
        };
        el.onclick = (e) => {
          if (this._dragged) return;                 // 刚刚是拖动，不当点击处理
          const uid = +el.dataset.uid;
          const box = this.container;
          const inBox = box && box.grid.items.some(i => i.uid === uid);
          if (inBox) {
            const idx = box.grid.items.findIndex(i => i.uid === uid);
            if (idx >= box.revealed) { this.game.msg('还没翻到这件'); return; }
            this._take(uid);
          } else if (e.shiftKey) this._toHotbar(uid);
          else this._use(uid);
        };
      });
      this.el.querySelectorAll('.hot-slot').forEach(el => {
        el.onclick = (e) => { if (!e.target.closest('b')) return; };
      });
    },

    _findAnywhere(uid) {
      const p = this.game.player;
      if (this.container) { const it = this.container.grid.items.find(i => i.uid === uid); if (it) return { it, from: this.container.grid }; }
      if (p.bag) { const it = p.bag.items.find(i => i.uid === uid); if (it) return { it, from: p.bag }; }
      const hi = p.hotbar.findIndex(i => i && i.uid === uid);
      if (hi >= 0) return { it: p.hotbar[hi], from: 'hotbar', slot: hi };
      return null;
    },

    _take(uid) {
      const p = this.game.player, box = this.container;
      const it = box.grid.items.find(i => i.uid === uid);
      if (!it) return;
      const r = p.acquire(it);
      if (!r.ok) { this.game.msg(r.msg); return; }
      box.grid.remove(it);
      box.revealed = Math.max(0, box.revealed - 1);
      this.game.msg('拿走 ' + C.ITEMS[it.id].name);
      this.render();
    },

    _use(uid) {
      const f = this._findAnywhere(uid);
      if (!f) return;
      const r = this.game.player.useItem(f.it);
      this.game.msg(r.msg);
      this.render();
    },

    _toHotbar(uid) {
      const p = this.game.player, f = this._findAnywhere(uid);
      if (!f || f.from === 'hotbar') return;
      const slot = p.hotbar.indexOf(null);
      if (slot < 0) { this.game.msg('快取栏满了'); return; }
      f.from.remove(f.it);
      p.hotbar[slot] = f.it;
      this.game.msg(C.ITEMS[f.it.id].name + ' → 快取栏 ' + (slot + 1));
      this.render();
    },

    /* `[实测]` 这里原来是**直接把物品删掉**。
       「丢掉」等于「销毁」，玩家永远不敢按它 —— 而背包只有几十格、
       负重上限 20kg，「放下点东西再回来拿」本该是每天都要做的决定。
       现在它走 `player.dropItem`：东西落在脚边，走近按 F 捡回来。 */
    _drop(uid) {
      const p = this.game.player, f = this._findAnywhere(+uid);
      if (!f) return;
      const r = p.dropItem(f.it);
      if (r.ok && this.game.renderer) this.game.renderer.addLoose(r.loose);
      this.game.msg(r.msg + '　（走近按 F 捡回来）');
      this.render();
    },

    /* ── 右键菜单 ────────────────────────────────────
       「放置」必须在这里，因为它是**从背包出发**的动作：
       玩家先想到「我要把水壶摆出来」，才会去想摆在哪。 */
    _openMenu(uid, x, y) {
      const f = this._findAnywhere(uid);
      if (!f) return;
      const inBox = this.container && this.container.grid.items.indexOf(f.it) >= 0;
      const def = C.ITEMS[f.it.id];
      this._menuUid = uid;
      const items = [];
      if (inBox) items.push(['take', '拿走']);
      else {
        if (def.use) items.push(['use', '使用']);
        if (C.Placement.placeable(f.it.id)) items.push(['place', '放置…', '摆到台面或地上']);
        items.push(['hot', '放进快取栏']);
        items.push(['drop', '放到地上', '走近按 F 能捡回来']);
      }
      this.menuEl.innerHTML =
        `<div class="inv-menu" style="left:${x}px;top:${y}px">` +
        `<h6>${def.name}</h6>` +
        items.map(([a, label, hint]) =>
          `<button data-mact="${a}">${label}${hint ? `<em>${hint}</em>` : ''}</button>`).join('') +
        '</div>';
      this.menuEl.classList.add('on');
    },
    _closeMenu() { this.menuEl.classList.remove('on'); this.menuEl.innerHTML = ''; this._menuUid = null; },

    _menuAct(act) {
      const uid = this._menuUid;
      if (uid === null || uid === undefined) return;
      if (act === 'use') return this._use(uid);
      if (act === 'take') return this._take(uid);
      if (act === 'hot') return this._toHotbar(uid);
      if (act === 'drop') return this._drop(uid);
      if (act === 'place') {
        const f = this._findAnywhere(uid);
        if (!f) return;
        const r = C.Placement.begin(f.it);
        this.game.msg(r.msg);
        // 放置要用准星瞄，所以**必须先把背包收起来**
        if (r.ok) this.close();
      }
    },

    /* ── 拖放 ────────────────────────────────────────
       三个去处：背包格子、快取位、容器格子。
       松手时按落点所在的面板决定搬到哪，落在外面 = 什么也不做（不是丢掉）。 */
    _down(e) {
      /* `[实测]` 菜单开着时按下鼠标要关掉它 —— **但点在菜单自己身上不算**。
         不加这个判断的话，pointerdown 会在 click 事件到达按钮之前把菜单关掉，
         于是菜单里的每一项都点不动，而且没有任何报错。 */
      if (this.menuEl.classList.contains('on')) {
        if (!e.target.closest('.inv-menu')) this._closeMenu();
        return;
      }
      if (e.button !== 0) return;
      const el = e.target.closest('.inv-item, .hot-slot b');
      if (!el || el.classList.contains('hid')) return;
      this._drag = { uid: +el.dataset.uid, x0: e.clientX, y0: e.clientY, el, ghost: null };
      this._dragged = false;
    },
    _move(e) {
      const d = this._drag;
      if (!d) return;
      if (!this._dragged) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;   // 手抖不算拖
        this._dragged = true;
        const r = d.el.getBoundingClientRect();
        const g = d.el.cloneNode(true);
        g.className = 'inv-item loot-ghost';
        g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
        document.body.appendChild(g);
        d.ghost = g; d.ox = e.clientX - r.left; d.oy = e.clientY - r.top;
        d.el.classList.add('dragging');
      }
      d.ghost.style.left = (e.clientX - d.ox) + 'px';
      d.ghost.style.top = (e.clientY - d.oy) + 'px';
    },
    _up(e) {
      const d = this._drag;
      if (!d) return;
      if (this._dragged) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        this._drop2(d.uid, under);
      }
      this._cancelDrag();
      // 让紧跟着的那次 click 知道刚才是拖动，别再当成「使用」
      setTimeout(() => { this._dragged = false; }, 0);
    },
    _cancelDrag() {
      const d = this._drag;
      if (!d) return;
      if (d.ghost) d.ghost.remove();
      if (d.el) d.el.classList.remove('dragging');
      this._drag = null;
    },

    /** 松手：按落点在哪块面板，决定搬到哪 */
    _drop2(uid, under) {
      if (!under) return;
      const slot = under.closest('.hot-slot');
      if (slot) { this._toHotbar(uid); return; }
      if (under.closest('#invBoxPane')) {
        // 往容器里放：先从身上拿掉，再塞进容器
        const p = this.game.player, box = this.container, f = this._findAnywhere(uid);
        if (!box || !f || box.grid.items.indexOf(f.it) >= 0) return;
        if (f.from === 'hotbar') p.hotbar[f.slot] = null; else f.from.remove(f.it);
        if (!box.grid.autoAdd(f.it).ok) { p.acquire(f.it); this.game.msg('容器里放不下'); }
        this.render();
        return;
      }
      if (under.closest('#invBagPane')) {
        const p = this.game.player, f = this._findAnywhere(uid);
        if (!f || !p.bag) return;
        if (f.from === p.bag) return;                       // 本来就在背包里
        if (f.from === 'hotbar') p.hotbar[f.slot] = null; else f.from.remove(f.it);
        if (!p.bag.autoAdd(f.it).ok) {
          // 放不下就退回原处，**不能把东西弄没**
          if (f.from === 'hotbar') p.hotbar[f.slot] = f.it; else f.from.autoAdd(f.it);
          this.game.msg('背包放不下');
        }
        this.render();
      }
    }
  };

  C.InventoryUI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
