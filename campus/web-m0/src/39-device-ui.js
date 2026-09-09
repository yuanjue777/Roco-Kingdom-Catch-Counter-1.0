/*
 * 39-device-ui.js —— 放置模式的准星预览 · 放好之后那台设备的操作菜单
 *
 * 两块：
 *   ① 放置预览：屏幕中间一行字 + 一个绿/红的落点框。**不暂停游戏。**
 *   ② 设备菜单：对准放好的东西按 F 弹出。插电 / 加水 / 烧水 / 收起。
 *
 * 菜单上永远写着**现在还差什么**（「没插电」「这条回路没电」「壶里没水」）——
 * 三种「按了没反应」是三件不同的事，把它们说清楚，玩家就不会以为设备坏了。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const DeviceUI = {
    open: false, game: null, placed: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('device');
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) this._act(b.dataset.act);
      });
      C.EventBus.subscribe('DeviceOpenedEvent', (e) => this.toggle(e.placed));
    },

    toggle(placed) {
      if (this.open && this.placed === placed) return this.close();
      this.placed = placed; this.open = true;
      this.el.classList.add('open');
      this.game.releaseMouseForPanel();
      this.render();
    },
    close() {
      if (!this.open) return;
      this.open = false; this.placed = null;
      this.el.classList.remove('open');
      this.game.restoreMouseAfterPanel();
    },
    update(player) {
      if (!this.open || !this.placed) return;
      if (C.V.dist(player.pos, this.placed.pos) > C.Config.interact.range + 2.0) this.close();
    },

    _act(act) {
      const P = C.Placement, pl = this.placed, p = this.game.player;
      if (act === 'close') return this.close();
      if (act === 'cable') { this.game.msg(P.takeCable(pl).msg); return this.close(); }
      if (act === 'unplug') { this.game.msg(P.unplug(pl).msg); return this.render(); }
      if (act === 'water') { this.game.msg(P.addWater(pl, p).msg); return this.render(); }
      if (act === 'take') { const r = P.takeBack(pl, p); this.game.msg(r.msg); return r.ok ? this.close() : this.render(); }
      if (act === 'boil') {
        const now = this.game.time.totalGameSeconds / 3600;
        const r = C.Cooking.start('boilWater', pl.station, now, {});
        this.game.msg(r.msg);
        return this.render();
      }
      if (act === 'kitchen') { this.close(); return C.KitchenUI.toggle(); }
    },

    render() {
      if (!this.open || !this.placed) return;
      const P = C.Placement, pl = this.placed;
      const name = C.ITEMS[pl.itemId].name;
      const st = pl.station;
      const blocker = P.blocker(pl);
      const rows = [];

      if (pl.kind === 'device') {
        const watt = C.Config.power.devices[pl.itemId];
        rows.push(pl.outletId
          ? `<button data-act="unplug">拔掉电线</button><em>${P.powered(pl) ? '通电中' : '插着，但没电'}　${watt}W</em>`
          : `<button data-act="cable">插电</button><em>拿起它自带的电线（${C.Config.power.cordMetres} 米）　${watt}W</em>`);
      }
      if (st && st.water !== null && st.water !== undefined) {
        rows.push(st.water >= 1
          ? '<span class="dv-ok">水是满的</span>'
          : '<button data-act="water">加水</button><em>用掉身上一瓶水</em>');
      }
      if (st && st.heater === 'kettle') {
        const ss = st.session;
        if (ss) {
          rows.push(`<span class="dv-ok">${ss.phase === C.CookPhase.Cooking ? '正在烧……' : '烧好了'}</span>`);
        } else {
          const chk = C.Cooking.canCook(C.Config.recipes.find(r => r.id === 'boilWater'), st);
          rows.push(chk.ok && !blocker
            ? '<button data-act="boil">烧水</button><em>约 9 分钟，烧开会响</em>'
            : `<span class="dv-no">${blocker || chk.why}</span>`);
        }
      } else if (st && st.heater) {
        rows.push('<button data-act="kitchen">打开厨房</button><em>选配方（K）</em>');
      }
      rows.push('<button data-act="take">收起来</button><em>放回背包</em>');

      this.el.innerHTML =
        '<div class="dv-panel">' +
          `<h5>${name}<button class="loot-btn" data-act="close">关闭</button></h5>` +
          (blocker ? `<p class="dv-block">现在还差：<b>${blocker}</b></p>` : '') +
          rows.map(r => `<div class="dv-row">${r}</div>`).join('') +
        '</div>';
    }
  };

  /* ── 放置预览 ────────────────────────────────────────
     屏幕中间一行字 + 落点框。**绿=放得下，红=放不下并说明原因。** */
  const PlaceUI = {
    game: null,
    init(game) { this.game = game; this.el = document.getElementById('place'); },
    update() {
      const gh = C.Placement.ghost;
      if (!gh) { if (this.el.classList.contains('on')) this.el.classList.remove('on'); return; }
      this.el.classList.add('on');
      this.el.innerHTML =
        `<div class="pl-box ${gh.ok ? 'ok' : 'no'}"></div>` +
        `<div class="pl-tip">${gh.ok ? '左键放下 ' + C.ITEMS[gh.itemId].name : (gh.why || '这里放不下')}` +
        '<small>Esc 取消</small></div>';
    }
  };

  C.DeviceUI = DeviceUI;
  C.PlaceUI = PlaceUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
