/*
 * 37-panel-ui.js —— 配电箱：一栋楼所有楼层的分闸
 *
 * `[实测]` 在这个文件出现之前，`panelAt` 只是一个存在数据里的坐标 ——
 * **没有任何东西渲染它，也没有任何办法跟它交互。**
 * 于是教学目标 6「配电间在一楼」和插座一样，是做不到的：
 * 玩家一路潜行下到一楼，找到了那个位置，然后发现那里什么也没有。
 *
 * 界面刻意做得很小：一栋楼几行，每行一个楼层，一个按钮。
 * **推闸响度 25**，所以这个界面上的每一次点击都是一次有代价的决定 ——
 * 它不该长得像一个设置菜单。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const PanelUI = {
    open: false, game: null, panel: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('panel');
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'close') return this.close();
        if (b.dataset.act === 'flip') this._flip(b.dataset.arg);
      });
      C.EventBus.subscribe('PanelOpenedEvent', (e) => this.toggle(e.panel));
    },

    toggle(panel) {
      if (this.open && this.panel === panel) return this.close();
      this.panel = panel;
      this.open = true;
      this.el.classList.add('open');
      this.game.releaseMouseForPanel();
      this.render();
    },
    close() {
      if (!this.open) return;
      this.open = false; this.panel = null;
      this.el.classList.remove('open');
      this.game.restoreMouseAfterPanel();
    },

    /** 走远了自动关，和搜刮/厨房一个道理 */
    update(player) {
      if (!this.open || !this.panel) return;
      if (C.V.dist(player.pos, this.panel.pos) > C.Config.interact.range + 2.0) this.close();
    },

    _circuits() {
      if (!this.panel) return [];
      const out = [];
      for (const [, c] of C.Power.circuits) {
        if (c.id.indexOf('circuit-' + this.panel.buildingKey + '-') === 0) out.push(c);
      }
      return out.sort((a, b) => (a.floor || 0) - (b.floor || 0));
    },

    _flip(id) {
      const c = C.Power.circuits.get(id);
      if (!c) return;
      /* 推闸的声音从**配电箱这个位置**发出去，不是从玩家身上。
         两者差不了几米，但「站远一点按」在这里不该变成一个规避手段。 */
      const r = C.Power.setBreaker(id, !c.breakerOn, this.panel.pos, this.game.player.id);
      this.game.msg(r.msg + (r.ok ? '（响度 ' + C.Config.power.breakerLoudness + '）' : ''));
      this.render();
    },

    render() {
      if (!this.open || !this.panel) return;
      const list = this._circuits();
      const dead = C.Power.gridUp === false;
      const rows = list.map(c => {
        const st = c.state();
        const label = st === 'live' ? '通电' : st === 'off' ? '已拉下'
                    : st === 'damaged' ? '线路损坏' : '主干线已断';
        const can = st === 'live' || st === 'off';
        return `<div class="pn-row ${st}">` +
          `<b>${c.name}</b><em>${label}</em>` +
          (can ? `<button data-act="flip" data-arg="${c.id}">${c.breakerOn ? '拉下' : '推上'}</button>`
               : '<u>修不了</u>') + '</div>';
      }).join('');

      this.el.innerHTML =
        '<div class="pn-panel">' +
          `<h5>${this.panel.name}<button class="loot-btn" data-act="close">关闭</button></h5>` +
          (dead
            /* 第 11 天之后，这个界面的意义从「推闸」变成「确认真的没救了」。
               **必须说清楚是市电没了，不是闸的问题** —— 否则玩家会反复推它。 */
            ? '<p class="pn-dead">市电已经断了 —— 推闸没有用。要用电只能自己发电。</p>'
            : `<p class="pn-hint">推一次闸响度 ${C.Config.power.breakerLoudness}。</p>`) +
          rows +
        '</div>';
    }
  };

  C.PanelUI = PanelUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
