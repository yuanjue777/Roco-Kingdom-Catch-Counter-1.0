/*
 * 32-kitchen-ui.js —— 厨房与教学的界面层
 *
 * 两块内容，都只读下层状态、不反向写：
 *   ① 厨房面板（K）：**功率余量必须一眼可见** —— 跳闸永远应该是玩家的失误，不是意外
 *   ② 教学提示：目标一行小字 5 秒淡出、按键提示、一次性说明、独白
 *      **四种全部不暂停游戏。** 这个游戏从第一秒起就不给人喘息。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const KitchenUI = {
    open: false, game: null, station: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('kitchen');
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) this._act(b.dataset.act, b.dataset.arg);
      });
    },

    toggle() {
      if (this.open) { this.close(); return; }
      this.station = this._nearest();
      if (!this.station) { this.game.msg('附近没有厨房。把台面和加热设备放下来才能做饭'); return; }
      this.open = true;
      this.el.classList.add('open');
      this.game.releaseMouseForPanel();
      this.render();
    },
    close() {
      if (!this.open) return;
      this.open = false; this.station = null;
      this.el.classList.remove('open');
      this.game.restoreMouseAfterPanel();
    },

    _nearest() {
      const p = this.game.player;
      let best = null, bd = C.Config.interact.range + 1.5;
      for (const st of C.Cooking.stations) {
        if (!st.pos) continue;
        const d = C.V.dist(p.pos, st.pos);
        if (d < bd) { bd = d; best = st; }
      }
      return best;
    },

    /** 走远了自动关，和搜刮界面一个道理 */
    update(player) {
      if (!this.open || !this.station) return;
      if (C.V.dist(player.pos, this.station.pos) > C.Config.interact.range + 2.0) this.close();
      else if (this._t === undefined || (this._t += 1) % 20 === 0) this.render();
    },

    render() {
      if (!this.open || !this.station) return;
      const st = this.station, K = C.Config.cooking;
      const H = st.heater ? K.heaters[st.heater] : null;
      const cw = st.cookware ? K.cookware[st.cookware] : null;
      const now = this.game.time.totalGameSeconds / 3600;

      /* ── 电力：已用 / 上限 一定要在最上面 ────────────
         **跳闸不是随机的，是玩家算错了。** 所以余量必须一眼可见。 */
      let power = '<p class="kit-none">这台设备没接电</p>';
      if (st.link) {
        const r = C.Power.readout(st.link);
        // 上限是 0（闸没推 / 停电）时进度条要是**空的**，不是满的 —— 满的会读成「用满了」
        const pct = r.limit > 0 ? Math.min(100, r.used / r.limit * 100) : 0;
        const over = r.limit > 0 && r.used > r.limit;
        power =
          `<div class="kit-row"><b>${r.sourceName}</b>` +
          `<span class="kit-watt ${over || r.limit <= 0 ? 'bad' : ''}">` +
          (r.limit > 0 ? `已用 ${r.used} / ${r.limit} W` : '这条回路没电') + '</span></div>' +
          `<div class="kit-bar"><i style="width:${pct}%;background:${over ? 'var(--accent)' : 'var(--signal)'}"></i></div>` +
          r.devices.map(d => `<div class="kit-dev"><span>${d.label}</span>` +
            `<span>${d.watt} W</span><em>${d.on ? '运行中' : '关'}</em></div>`).join('') +
          (r.fuel !== null ? `<p class="kit-fuel">剩余柴油 ${r.fuel.toFixed(1)} L` +
            `（约 ${r.fuelHours.toFixed(0)} 小时）</p>` : '') +
          (r.tripped ? '<p class="kit-trip">已跳闸 —— <button data-act="reset">复位</button></p>' : '');
      }

      // ── 设备与锅具
      const gear = `<div class="kit-row"><span>${H ? H.name : '（没有加热设备）'}</span>` +
        `<span>${cw ? cw.name : (H && H.needsCookware ? '**缺一口锅**' : '自带内胆')}</span></div>`;

      // ── 正在做的
      let doing = '';
      const ss = st.session;
      if (ss) {
        const r = C.Config.recipes.find(x => x.id === ss.recipeId);
        const total = ss.ruinAt - ss.startAt;
        const p = Math.min(1, (now - ss.startAt) / Math.max(1e-6, ss.doneAt - ss.startAt));
        doing =
          `<h6>${r.name}　<small>${ss.phase}</small></h6>` +
          `<div class="kit-bar"><i style="width:${(p * 100).toFixed(0)}%;background:var(--warn,#E5B45C)"></i></div>` +
          (ss.phase === C.CookPhase.Cooking
            ? `<p class="kit-fuel">完成于 ${this._clock(ss.doneAt)}</p>`
            : `<p class="kit-fuel">${ss.phase === C.CookPhase.Ruined ? '糊了' :
                 '黄金窗口到 ' + this._clock(ss.goldenEnd)}</p>`) +
          (ss.venting > 0 ? '<p class="kit-trip">高压锅要泄压：' +
            '<button data-act="ventSlow">等 15 分钟（20）</button> ' +
            '<button data-act="ventFast">立刻放（**55**）</button></p>' : '') +
          `<p><button data-act="take">取出</button> <button data-act="stop">关火</button></p>`;
      } else {
        /* 能做什么：**不能做的也列出来，并写清楚为什么** ——
           「锅具不兼容」「功率不够：还要 2000W，只剩 400W」这种话本身就是教学。 */
        const lv = C.Cooking.level();
        const rows = C.Config.recipes.map(r => {
          const chk = C.Cooking.canCook(r, st);
          const mat = Object.keys(r.need).map(k =>
            (C.Config.ingredientNames[k] || k) + (r.need[k] > 1 ? '×' + r.need[k] : '')).join(' + ');
          const mins = C.Cooking.minutesFor(r, st);
          return `<div class="kit-recipe ${chk.ok ? '' : 'no'}">` +
            `<b>${r.name}</b><span class="kit-mat">${mat}</span>` +
            `<span class="kit-eff">${mins.toFixed(0)}分　噪音 ${r.loud}　气味 ${r.odor}</span>` +
            (chk.ok ? `<button data-act="cook" data-arg="${r.id}">做</button>`
                    : `<em class="kit-why">${chk.why}</em>`) + '</div>';
        }).join('');
        doing = `<h6>能做什么　<small>烹饪 ${lv} 级 · ${C.Cooking.xp} 经验</small></h6>` +
                `<div class="kit-list">${rows}</div>`;
      }

      this.el.innerHTML =
        '<div class="kit-panel">' +
          '<h5>厨房<button class="loot-btn" data-act="close">关闭</button></h5>' +
          power + gear + doing +
        '</div>';
    },

    _clock(h) {
      const t = ((h % 24) + 24) % 24;
      return String(Math.floor(t)).padStart(2, '0') + ':' + String(Math.floor((t % 1) * 60)).padStart(2, '0');
    },

    _act(act, arg) {
      const st = this.station, now = this.game.time.totalGameSeconds / 3600;
      if (act === 'close') return this.close();
      if (act === 'reset') { C.Power.resetBreakerOf(st.link); return this.render(); }
      if (act === 'ventSlow' || act === 'ventFast') {
        this.game.msg(C.Cooking.vent(st, act === 'ventFast').msg); return this.render();
      }
      if (act === 'stop') { this.game.msg(C.Cooking.stop(st).msg); return this.render(); }
      if (act === 'take') {
        const r = C.Cooking.take(st, now);
        this.game.msg(r.msg || '还没好');
        if (r.ok) C.EventBus.publish('FoodCookedEvent', { food: r.food });
        return this.render();
      }
      if (act === 'cook') {
        const r = C.Cooking.start(arg, st, now, { seasonings: 0 });
        this.game.msg(r.msg);
        return this.render();
      }
    }
  };

  /* ── 教学提示 ────────────────────────────────────────
     **不做任务列表面板。** 目标是左上角一行小字，5 秒后淡出。 */
  const TutorialUI = {
    game: null, objective: '', objTimer: 0, key: null, keyTimer: 0,
    mono: '', monoTimer: 0, panel: null,

    init(game) {
      this.game = game;
      this.el = document.getElementById('tut');
      this.el.innerHTML =
        '<div id="tutObj"></div><div id="tutMono"></div>' +
        '<div id="tutKey"></div><div id="tutPanel"></div>';
      this.objEl = document.getElementById('tutObj');
      this.monoEl = document.getElementById('tutMono');
      this.keyEl = document.getElementById('tutKey');
      this.panelEl = document.getElementById('tutPanel');
      this.panelEl.addEventListener('click', () => this._closePanel());
    },

    update(dt) {
      for (const p of C.Tutorial.take()) this._show(p);
      // 目标 5 秒后淡出；长按 Tab 可以重新调出（装配层把 Tab 转过来）
      if (this.objTimer > 0) { this.objTimer -= dt; if (this.objTimer <= 0) this.objEl.classList.remove('on'); }
      if (this.monoTimer > 0) { this.monoTimer -= dt; if (this.monoTimer <= 0) this.monoEl.classList.remove('on'); }
      if (this.keyTimer > 0) { this.keyTimer -= dt; if (this.keyTimer <= 0) this.keyEl.classList.remove('on'); }
      if (C.Tutorial.finished && this.el.style.display !== 'none') {
        // **教学结束后，目标 UI 永久移除，本局游戏不再出现**
        this.el.style.display = 'none';
      }
    },

    /** 长按 Tab 重新调出当前目标 */
    recall() {
      if (!C.Tutorial.enabled || !C.Tutorial.objective) return;
      this.objEl.textContent = C.Tutorial.objectiveText();
      this.objEl.classList.add('on');
      this.objTimer = 5;
    },

    _show(p) {
      if (p.kind === 'objective') {
        this.objEl.textContent = p.text; this.objEl.classList.add('on'); this.objTimer = 5;
      } else if (p.kind === C.TutorialHintKind.Monologue) {
        this.monoEl.textContent = p.text; this.monoEl.classList.add('on'); this.monoTimer = 4;
      } else if (p.kind === C.TutorialHintKind.Key) {
        this.keyEl.innerHTML = `<kbd>${p.key}</kbd><span>${p.text}</span>`;
        this.keyEl.classList.add('on'); this.keyTimer = 8;
      } else {
        this.panelEl.innerHTML = `<div class="tut-card"><h6>${p.title}</h6>` +
          `<p>${p.text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>` +
          '<em>按任意键继续</em></div>';
        this.panelEl.classList.add('on');
      }
    },
    _closePanel() { this.panelEl.classList.remove('on'); },
    anyKey() { if (this.panelEl.classList.contains('on')) this._closePanel(); }
  };

  C.KitchenUI = KitchenUI;
  C.TutorialUI = TutorialUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
