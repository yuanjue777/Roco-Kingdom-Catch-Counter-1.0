/*
 * 36-hotbar-ui.js —— 常驻快取栏（屏幕正下方居中）
 *
 * 六格快取栏一直存在（主文档 10.1），但在这之前它**只在背包界面里看得见** ——
 * 于是「按 1–6 直接用」这条规则，玩家要么记不住，要么根本不知道自己拿着什么。
 *
 * 三条规矩：
 *   ① **常驻**。它是 HUD，不是面板 —— 不暂停、不抢鼠标、不挡准星。
 *   ② 空格子也画出来。**六个格子的形状本身就是「你只有六格」这句话。**
 *   ③ 只在内容变了的时候重画。每帧写 DOM 是白烧性能，而它一秒钟变不了两次。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const HotbarUI = {
    game: null, el: null, _sig: '',

    init(game) {
      this.game = game;
      this.el = document.getElementById('hotbar');
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-slot]');
        if (b) this._use(+b.dataset.slot);
      });
      /* 右键 = 放下。**右键在游戏里是屏息**，所以只有点在格子上才算，
         并且要吃掉浏览器菜单。 */
      this.el.addEventListener('contextmenu', (e) => {
        const b = e.target.closest('[data-slot]');
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        this._drop(+b.dataset.slot);
      });
      this.render(true);
    },

    _use(i) {
      const p = this.game.player, it = p.hotbar[i];
      if (!it) return;
      this.game.msg(p.useItem(it).msg);
      this.render(true);
    },
    _drop(i) {
      const p = this.game.player, it = p.hotbar[i];
      if (!it) return;
      const r = p.dropItem(it);
      if (r.ok && this.game.renderer) this.game.renderer.addLoose(r.loose);
      this.game.msg(r.msg + '　（走近按 F 捡回来）');
      this.render(true);
    },

    update() { this.render(false); },

    render(force) {
      const p = this.game && this.game.player;
      if (!p || !this.el) return;
      const sig = p.hotbar.map(it => it ? it.id + ':' + it.count : '-').join('|');
      if (!force && sig === this._sig) return;
      this._sig = sig;
      this.el.innerHTML = p.hotbar.map((it, i) => {
        if (!it) return `<i class="hb-slot empty"><b>${i + 1}</b></i>`;
        const def = C.ITEMS[it.id];
        return `<i class="hb-slot ${def.rare ? 'rare' : ''}" data-slot="${i}" title="左键用 · 右键放下">` +
          `<b>${i + 1}</b><span>${def.name}</span>` +
          (it.count > 1 ? `<u>×${it.count}</u>` : '') + '</i>';
      }).join('');
    }
  };

  C.HotbarUI = HotbarUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
