/*
 * 34-loadout-ui.js —— 开局的角色与特性选择界面（角色与特性规格 4.5）
 *
 * 界面只有一条硬规矩（规格 4.5）：
 *   **固定特性与自选特性分区显示，不混在一起。**
 *   玩家需要一眼看清「哪些是我改不了的」。
 *
 * 三栏：角色 ｜ 这个角色是谁（固定特性、出生地、开局物品）｜ 特性池。
 * 顶上永远挂着剩余点数与两个名额计数 —— 那是玩家做每一个决定时唯一要看的数。
 *
 * 表现层：只读 Loadout 的状态，不自己算点数。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /* 特性池的分组顺序。**正向和负向必须分开显示** ——
     混在一起的话「这条是花钱的还是赚钱的」要靠数字正负去认，太累。 */
  const SECTIONS = [
    { key: 'pos', title: '正向特性　花点数', test: (t) => t.value > 0 },
    { key: 'neg', title: '负向特性　返点数', test: (t) => t.value < 0 }
  ];

  const LoadoutUI = {
    el: null, onStart: null, open: false,

    init(onStart) {
      this.onStart = onStart;
      this.el = document.getElementById('pick');
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act, arg = b.dataset.arg;
        if (act === 'char') C.Loadout.selectCharacter(arg);
        else if (act === 'trait') {
          const r = C.Loadout.toggle(arg);
          if (!r.ok) this._flash(r.why);
        } else if (act === 'clear') C.Loadout.picked = [];
        else if (act === 'start') return this._start();
        this.render();
      });
    },

    show() {
      this.open = true;
      C.Loadout.reset();
      C.Loadout.selectCharacter('student');     // 默认落在「推荐首次游玩」那个
      this.el.classList.add('on');
      this.render();
    },
    hide() { this.open = false; this.el.classList.remove('on'); },

    _start() {
      const r = C.Loadout.canConfirm();
      if (!r.ok) return this._flash(r.why);
      this.hide();
      if (this.onStart) this.onStart();
    },
    _flash(why) {
      const el = this.el.querySelector('.pick-warn');
      if (!el) return;
      el.textContent = why;
      el.classList.add('on');
      clearTimeout(this._wt);
      this._wt = setTimeout(() => el.classList.remove('on'), 2200);
    },

    render() {
      const L = C.Loadout, ch = L.character();
      const left = L.remaining(), cnt = L.counts(), R = C.Config.traitRules;

      // ── 左栏：六个角色
      const chars = C.Config.characters.map(c =>
        `<button class="pick-char ${c.id === L.characterId ? 'on' : ''}" data-act="char" data-arg="${c.id}">` +
        `<b>${c.name}</b><span class="pick-stars">${'★'.repeat(c.stars)}${'☆'.repeat(3 - c.stars)}</span>` +
        `<em>${c.where.split('（')[0]}</em>` +
        `<u>起始 ${c.points} 点</u>` +
        (c.tutorial ? '<i class="pick-tut">含新手引导</i>' : '') +
        '</button>').join('');

      // ── 中栏：这个角色是谁
      let mid = '<p class="pick-empty">先选一个角色</p>';
      if (ch) {
        const fixed = L.fixedTraits().map(t => this._chip(t, 'fx')).join('');
        const items = ch.items.map(e => {
          const id = Array.isArray(e) ? e[0] : e, n = Array.isArray(e) ? e[1] : 1;
          return `<span class="pick-item">${C.ITEMS[id] ? C.ITEMS[id].name : id}${n > 1 ? ' ×' + n : ''}</span>`;
        }).join('');
        mid =
          `<h6>${ch.name}<span class="pick-stars">${'★'.repeat(ch.stars)}${'☆'.repeat(3 - ch.stars)}</span></h6>` +
          `<p class="pick-flavor">${ch.flavor}</p>` +
          `<h7>出生</h7><p class="pick-where">${ch.where}</p>` +
          `<h7>开局物品</h7><div class="pick-items">${items}</div>` +
          /* 规格 4.5：**固定特性单独一块，不和自选的混在一起。** */
          `<h7>固定特性　不消耗点数，也不占名额</h7><div class="pick-chips">${fixed}</div>` +
          `<p class="pick-note">${this._bold(ch.note)}</p>` +
          (ch.tutorial ? '' :
            /* 规格 5.2 风险四：其他五个角色没有引导，**必须在这里说清楚**，
               而不是让玩家进去以后发现没人说话。 */
            '<p class="pick-warn2">该角色不含新手引导。建议先用「睡过头的学生」完成一局。</p>');
      }

      // ── 右栏：特性池
      const taken = L.takenGroups();
      const pool = SECTIONS.map(sec => {
        const rows = L.pool().filter(sec.test)
          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
          .map(t => {
            const on = L.picked.indexOf(t.id) >= 0;
            const chk = on ? { ok: true } : L.canPick(t.id);
            return `<button class="pick-trait ${on ? 'on' : ''} ${chk.ok ? '' : 'no'}" ` +
              `data-act="trait" data-arg="${t.id}">` +
              `<b>${t.name}</b><u class="${t.value > 0 ? 'p' : 'n'}">${t.value > 0 ? '+' : ''}${t.value}</u>` +
              `<em>${t.desc}</em>` +
              (t.live ? '' : '<i class="pick-dead">未实装</i>') +
              (!on && !chk.ok ? `<i class="pick-why">${chk.why}</i>` : '') +
              '</button>';
          }).join('');
        return `<h7>${sec.title}　<small>${sec.key === 'pos' ? cnt.pos + ' / ' + R.positiveMax
                                                             : cnt.neg + ' / ' + R.negativeMax}</small></h7>` +
               `<div class="pick-traits">${rows}</div>`;
      }).join('');

      /* 已选区（规格 4.5 的示意图里就有这一块）。
         **不能只给一个「已选 2 正 2 负」的计数** —— 特性池有 53 条，
         玩家往下滚两屏之后就想不起来自己选了什么，只能滚回去找高亮的。 */
      const picked = L.picked.length
        ? L.picked.map(id => {
            const t = L.trait(id);
            return `<button class="pick-sel ${t.value > 0 ? 'p' : 'n'}" data-act="trait" data-arg="${id}">` +
                   `${t.name}<u>${t.value > 0 ? '花 ' + t.value : '返 ' + (-t.value)}</u>×</button>`;
          }).join('')
        : '<span class="pick-selnone">还没选特性 —— 直接开始也可以</span>';

      const conf = L.canConfirm();
      this.el.innerHTML =
        '<div class="pick-wrap">' +
          '<div class="pick-head">' +
            '<h5>校园<small>选一个人，然后决定他有什么毛病</small></h5>' +
            `<div class="pick-points ${left < 0 ? 'bad' : ''}">` +
              `<b>${left}</b><span>剩余点数</span></div>` +
            `<button class="pick-go ${conf.ok ? '' : 'no'}" data-act="start">开始</button>` +
          '</div>' +
          '<div class="pick-cols">' +
            `<div class="pick-col pick-chars">${chars}</div>` +
            `<div class="pick-col pick-mid">${mid}</div>` +
            `<div class="pick-col pick-pool">` +
              `<div class="pick-poolhead">已选 <b>${cnt.pos}</b> 正 · <b>${cnt.neg}</b> 负` +
              `<button class="loot-btn" data-act="clear">清空</button></div>` +
              `<div class="pick-sels">${picked}</div>` +
              pool + '</div>' +
          '</div>' +
          '<div class="pick-warn"></div>' +
        '</div>';
    },

    _chip(t, cls) {
      return `<span class="pick-chip ${cls} ${t.value > 0 ? 'p' : (t.value < 0 ? 'n' : '')}">` +
        `<b>${t.name}</b><em>${t.desc}</em>` + (t.live ? '' : '<i>未实装</i>') + '</span>';
    },
    _bold(s) { return String(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
  };

  C.LoadoutUI = LoadoutUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
