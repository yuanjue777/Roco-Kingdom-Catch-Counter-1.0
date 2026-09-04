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
        '<p class="inv-hint">点击容器里的物品拿取 · 点击背包里的物品使用 · ' +
          '<b>Shift+点击</b>放进快取栏 · <b>右键</b>丢弃 · <kbd>B</kbd>/<kbd>Esc</kbd> 关闭</p>';
      this.bagPane = document.getElementById('invBagPane');
      this.boxPane = document.getElementById('invBoxPane');
      document.getElementById('btnBag').addEventListener('click', () => this.toggle());
    },

    toggle(container) {
      this.open = !this.open || (container && container !== this.container);
      this.container = this.open ? (container || this.container) : null;
      this.el.classList.toggle('open', this.open);
      if (this.open) this.render();
    },
    close() { this.open = false; this.container = null; this.el.classList.remove('open'); },

    /** 逐个点亮：翻找到第几件就显示到第几件（三角洲式） */
    tickSearch(dt) {
      const box = this.container;
      if (!box || !box.opened || box.revealed >= box.grid.items.length) return;
      box._t = (box._t || 0) + dt;
      const per = box.searchSeconds * (box.slow ? 2.25 : 1) / Math.max(1, box.grid.items.length);
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
      const kg = p.totalWeight(), max = C.Config.player.weightLimit;
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
        `<p class="inv-load-txt">${box.slow ? '缓慢翻找（响度 15）' : '快速翻找（响度 40）'}</p>`;
    },

    _bind() {
      const p = this.game.player;
      const tidy = document.getElementById('btnTidy');
      if (tidy) tidy.onclick = () => { p.bag.tidy(); this.render(); this.game.msg('整理完毕'); };

      this.el.querySelectorAll('.inv-item, .hot-slot b').forEach(el => {
        el.oncontextmenu = (e) => { e.preventDefault(); this._drop(el.dataset.uid); };
        el.onclick = (e) => {
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

    _drop(uid) {
      const p = this.game.player, f = this._findAnywhere(+uid);
      if (!f) return;
      if (f.from === 'hotbar') p.hotbar[f.slot] = null; else f.from.remove(f.it);
      this.game.msg('丢掉 ' + C.ITEMS[f.it.id].name);
      this.render();
    }
  };

  C.InventoryUI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
