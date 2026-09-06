/*
 * 27-notebook-ui.js —— 笔记本界面（主文档 14.3）
 * 四页标签 + 一张手绘感的校园平面图。只读 26-notebook 的数据，不反向写规则。
 *
 * 地图页故意画得粗：**没走过的地方就是空的**。玩家的地图知识是跨局资产，
 * 把没探过的楼提前画出来等于把这份资产白送。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const UI = {
    open: false, page: 'map', game: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('note');
      this.el.innerHTML =
        '<div class="note-wrap">' +
          '<nav class="note-tabs">' +
            '<button data-page="map">地图</button><button data-page="clue">线索</button>' +
            '<button data-page="recipe">配方</button><button data-page="obs">观察</button>' +
            '<span class="note-close">按 <kbd>J</kbd> / <kbd>Esc</kbd> 合上</span>' +
          '</nav>' +
          '<div class="note-body">' +
            '<div class="note-page" id="notePageMap">' +
              '<canvas id="noteMap"></canvas>' +
              '<div class="note-pins" id="notePins"></div>' +
            '</div>' +
            '<div class="note-page" id="notePageText"></div>' +
          '</div>' +
        '</div>';
      this.canvas = document.getElementById('noteMap');
      this.pinBar = document.getElementById('notePins');
      this.textPane = document.getElementById('notePageText');
      this.mapPane = document.getElementById('notePageMap');

      this.el.querySelectorAll('.note-tabs button').forEach(b => {
        b.onclick = () => { this.page = b.dataset.page; this.render(); };
      });
      this.pinBar.innerHTML = C.PinTypes.map(t =>
        `<button data-pin="${t.id}" style="--pc:${t.color}">${t.label}</button>`).join('') +
        '<em>点图上任意处放标记，点已有标记删掉它</em>';
      this.pinBar.querySelectorAll('button').forEach(b => {
        b.onclick = () => { C.Notebook.pinType = b.dataset.pin; this.render(); };
      });
      this.canvas.addEventListener('click', (e) => this._mapClick(e));
      const btn = document.getElementById('btnNote');
      if (btn) btn.addEventListener('click', () => this.toggle());
    },

    toggle() {
      // 合上走 close()，别在这里各写一遍 —— 上一版就是漏了这条，
      // 按 J 合上笔记本之后鼠标没锁回去，得再点一下画面才能转视角
      if (this.open) { this.close(); return; }
      this.open = true;
      this.el.classList.add('open');
      C.Notebook.unread = 0;
      // 桌面端要把指针交还给鼠标，否则地图上的标记点不中；合上时再锁回去
      this.game.releaseMouseForPanel();
      this.render();
    },
    close() {
      if (!this.open) return;
      this.open = false; this.el.classList.remove('open');
      if (this.game && this.game.restoreMouseAfterPanel) this.game.restoreMouseAfterPanel();
    },

    render() {
      if (!this.open) return;
      this.el.querySelectorAll('.note-tabs button').forEach(b =>
        b.classList.toggle('on', b.dataset.page === this.page));
      this.pinBar.querySelectorAll('button').forEach(b =>
        b.classList.toggle('on', b.dataset.pin === C.Notebook.pinType));
      const isMap = this.page === 'map';
      this.mapPane.style.display = isMap ? 'flex' : 'none';
      this.textPane.style.display = isMap ? 'none' : 'block';
      if (isMap) this._drawMap(); else this.textPane.innerHTML = this._textHtml();
    },

    /* ── 地图 ──────────────────────────────────────── */

    _view() {
      const lv = this.game.level, b = lv.bounds;
      const cv = this.canvas;
      const w = cv.clientWidth || 860, h = cv.clientHeight || 520;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = 14;
      const s = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxZ - b.minZ));
      // 北在上：世界 +z 向北，屏幕 y 向下，所以 z 要翻过来
      const toX = (x) => pad + (x - b.minX) * s;
      const toY = (z) => h - pad - (z - b.minZ) * s;
      return { ctx, w, h, s, toX, toY,
               fromX: (px) => (px - pad) / s + b.minX,
               fromZ: (py) => (h - pad - py) / s + b.minZ };
    },

    _drawMap() {
      const lv = this.game.level;
      const N = C.Notebook;
      const view = this._view();
      const { ctx, w, h, s, toX, toY } = view;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, w, h);

      // 围墙
      if (lv.exits) {
        const wl = C.Config.campus.wall;
        ctx.strokeStyle = '#2c3644'; ctx.lineWidth = 2;
        ctx.strokeRect(toX(wl.x0), toY(wl.z1), (wl.x1 - wl.x0) * s, (wl.z1 - wl.z0) * s);
      }

      // 室外分区：走过的才写名字
      for (const z of (lv.zones || [])) {
        const node = lv.zoneNodes && lv.zoneNodes.get(z.id);
        const seen = node && N.nodes.has(node.id);
        ctx.strokeStyle = seen ? '#243040' : '#171e28';
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        ctx.strokeRect(toX(z.x0), toY(z.z1), (z.x1 - z.x0) * s, (z.z1 - z.z0) * s);
        ctx.setLineDash([]);
        if (seen) {
          ctx.fillStyle = '#3d4a5c'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(z.name, toX((z.x0 + z.x1) / 2), toY(z.z1) + 14);
        }
      }

      // 建筑：进过的画实心并按探明比例填色，没进过的只有一个虚线轮廓
      for (const b of (lv.buildings || [])) {
        const f = b.footprint;
        const x = toX(f.x0), y = toY(f.z1), ww = (f.x1 - f.x0) * s, hh = (f.z1 - f.z0) * s;
        const known = N.buildings.has(b.buildingId);
        if (!known) {
          ctx.strokeStyle = '#232c38'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
          ctx.strokeRect(x, y, ww, hh); ctx.setLineDash([]);
          continue;
        }
        const ratio = N.exploredRatio(b);
        ctx.fillStyle = '#1b2531'; ctx.fillRect(x, y, ww, hh);
        ctx.fillStyle = 'rgba(111,211,232,0.20)'; ctx.fillRect(x, y, ww * ratio, hh);
        ctx.strokeStyle = '#3a4a5e'; ctx.lineWidth = 1; ctx.strokeRect(x, y, ww, hh);
        ctx.fillStyle = '#b6c2cf'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(b.name, x + ww / 2, y + hh / 2 + 3);
        ctx.fillStyle = '#5f6b78'; ctx.font = '9px ui-monospace, monospace';
        ctx.fillText((ratio * 100).toFixed(0) + '%', x + ww / 2, y + hh / 2 + 15);
      }

      // 出入口（13.3）：知道校门在哪是逃出去的前提，所以一开始就画
      for (const e of (lv.exits || [])) {
        const wl = C.Config.campus.wall;
        const mid = (e.a0 + e.a1) / 2;
        const p = e.side === 'south' ? [mid, wl.z0] : e.side === 'north' ? [mid, wl.z1]
                : e.side === 'west' ? [wl.x0, mid] : [wl.x1, mid];
        ctx.fillStyle = '#E4573D';
        ctx.beginPath(); ctx.arc(toX(p[0]), toY(p[1]), 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a6055'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(e.name, toX(p[0]), toY(p[1]) - 6);
      }

      // 手动标记
      for (const pin of N.pins) {
        const t = C.PinTypes.find(q => q.id === pin.type) || C.PinTypes[0];
        ctx.fillStyle = t.color;
        ctx.beginPath(); ctx.arc(toX(pin.x), toY(pin.z), 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 1; ctx.stroke();
      }

      // 玩家：一个点 + 朝向
      const p = this.game.player;
      const px = toX(p.pos.x), py = toY(p.pos.z);
      ctx.strokeStyle = '#E5B45C'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(p.yaw) * 12, py - Math.cos(p.yaw) * 12); ctx.stroke();
      ctx.fillStyle = '#E5B45C';
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();

      // 指北 + 当前位置
      ctx.fillStyle = '#5f6b78'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
      ctx.fillText('北 ↑', 8, 16);
      const S = C.Streaming;
      if (S && S.placeName) ctx.fillText('你在 ' + S.placeName, 8, 30);
    },

    _mapClick(e) {
      if (this.page !== 'map') return;
      const r = this.canvas.getBoundingClientRect();
      const v = this._view();
      const x = v.fromX(e.clientX - r.left), z = v.fromZ(e.clientY - r.top);
      const near = C.Notebook.pinNear(x, z, 8 / v.s);
      if (near) C.Notebook.removePin(near); else C.Notebook.addPin(x, z);
      this._drawMap();
    },

    /* ── 线索 / 配方 / 观察 ─────────────────────────── */

    _textHtml() {
      const N = C.Notebook;
      if (this.page === 'clue') {
        if (!N.clues.length) return '<p class="note-empty">还没有任何线索。走出去看看。</p>';
        return '<ul class="note-list">' + N.clues.map(c =>
          `<li><span class="note-when">第 ${c.day} 天 ${c.hhmm}</span>${c.text}</li>`).join('') + '</ul>';
      }
      if (this.page === 'recipe') {
        return '<ul class="note-list">' + C.Config.recipes.map(r => {
          const on = N.recipes.has(r.id);
          return `<li class="${on ? '' : 'note-locked'}"><b>${on ? r.name : '？？'}</b>` +
                 `<span class="note-need">${on ? r.need : '需要先找到' + (r.unlock === 'manual' ? '技术手册' : '课本')}</span>` +
                 `<span class="note-when">${on ? r.note : ''}</span></li>`;
        }).join('') + '</ul>';
      }
      if (!N.obs.size) return '<p class="note-empty">还没有观察到什么。屏息听听。</p>';
      const rows = Array.from(N.obs.values()).sort((a, b) => b.count - a.count);
      return '<ul class="note-list">' + rows.map(o =>
        `<li><span class="note-when">第 ${o.firstDay} 天起</span>${o.label}` +
        `<span class="note-need">×${o.count}</span></li>`).join('') + '</ul>';
    }
  };

  C.NotebookUI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
