/*
 * 31-tutorial.js —— 新手教学（新手教学关卡设计 v1）
 *
 * **核心判断：宿舍楼不能一只丧尸都没有。**
 * 如果整栋楼完全空置，玩家会花二十多分钟熟练掌握一个「没有威胁的游戏」，
 * 然后在推开大门的那一刻被迫在三十秒内同时理解声音传播、潜行姿态、投石引怪、屏息侦查。
 * **教学教会了错误的游戏，而真正的考试在门外。**
 *
 * 正确的做法：把危险分级引入 ——
 * 每一个机制都在零风险的环境下被教会，然后才拿到有风险的环境里考。
 *
 * 本文件是第 4 层：读状态、发提示，**不改规则**。
 * 关卡布置（谁在哪、哪扇门锁着）在 08-level / 24-campus，因为那是几何。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /* ── 危险分层（设计 0.2）────────────────────────────
     玩家在见到第一只可能伤害自己的丧尸之前，有约 15 分钟的完全安全时间。
     「安心入手」完全满足，而且教学没有骗人。 */
  const FLOOR_DANGER = [
    { floor: 3, zombies: 0, note: '出生层。绝对安全：移动、搜刮、背包、需求' },
    { floor: 2, zombies: 0, note: '绝对安全：电力、水、手电' },
    { floor: 1, zombies: 1, locked: true,  note: '安全但有临场感。**在这里教完全部声音机制**' },
    { floor: 0, zombies: 1, locked: false, note: '第一次真正的考试' }
  ];

  /* ── 七个目标（设计 第二部分）────────────────────────
     **全部用主角的第一人称内心独白语气**，不用系统指令语气：
       ✗「前往一楼配电间推上电闸」
       ✓「水壶插上了没反应。配电间应该在一楼。」 */
  const OBJECTIVES = [
    { id: 'drink',   text: '嗓子干得厉害，先找点喝的。',   teaches: '移动、交互、搜刮、需求条' },
    { id: 'bag',     text: '东西拿不下了，得找个包。',     teaches: '背包、格子、重量' },
    { id: 'boil',    text: '有水壶，烧点开水吧。',         teaches: '插座、电线、回路是死的' },
    { id: 'sound',   text: '楼下有声音。',                 teaches: '**全部声音机制**' },
    { id: 'sleep',   text: '天黑了。今晚就在这儿吧。',     teaches: '封锁、睡眠、安全睡点' },
    { id: 'breaker', text: '配电间在一楼。',               teaches: '潜行实战、推闸' },
    { id: 'leave',   text: '不能一直待在这栋楼里。',       teaches: '投石过开阔地' }
  ];

  /* ── 提示（设计 4.2 触发表）──────────────────────────
     规矩：**按键提示只在该操作第一次在情境中变得必要时出现，出现一次，之后永不再现。** */
  const Kind = { Key: 'key', Panel: 'panel', Monologue: 'mono' };
  const HINTS = {
    T01: { kind: Kind.Key,   text: '交互',            key: 'F' },
    T02: { kind: Kind.Panel, title: '需求',           text: '饥饿和口渴从右边挤占生命上限。吃喝解除挤占，但**不会回血** —— 受过的伤要单独治。' },
    T03: { kind: Kind.Key,   text: '打开背包',        key: 'B' },
    T04: { kind: Kind.Panel, title: '背包',           text: '格子越大越占地方，能转 90°。重量超了跑不动。口袋里的六格是快取位，1–6 直接用。' },
    T05: { kind: Kind.Key,   text: '手电',            key: 'L' },
    T06: { kind: Kind.Monologue, text: '灯光在黑暗里能传很远。' },
    T07: { kind: Kind.Panel, title: '该插座无电',     text: '插上了，没反应。' },
    T08: { kind: Kind.Monologue, text: '跳闸了？配电间……在一楼吧。' },
    /* **全表最重要的一条。** 如果玩家错过它，整个二楼的教学都会失效。
       所以它的触发条件最宽松，而且是**全表唯一允许重复一次**的提示。 */
    T09: { kind: Kind.Key,   text: '屏息',            key: 'Z', repeatAfter: 8 },
    T10: { kind: Kind.Key,   text: '拾取',            key: 'F' },
    T11: { kind: Kind.Key,   text: '蓄力投掷',        key: 'G' },
    T12: { kind: Kind.Key,   text: '关门 / 按住缓慢', key: 'F' },
    T13: { kind: Kind.Key,   text: '贴墙',            key: 'V' },
    T14: { kind: Kind.Key,   text: '探头',            key: 'Q / E' },
    T15: { kind: Kind.Key,   text: '蹲行',            key: 'Ctrl' },
    T16: { kind: Kind.Monologue, text: '天黑了。' },
    T17: { kind: Kind.Panel, title: '睡不着',         text: '门开着，挡不住什么。' },
    T18: { kind: Kind.Key,   text: '封锁',            key: 'F' },
    T19: { kind: Kind.Panel, title: '睡眠',           text: '22:00 前入睡且睡满 6 小时会得到「精力充沛」。睡眠会被声音吵醒。' },
    T20: { kind: Kind.Panel, title: '通电了',         text: '每条链路有功率上限，超了会跳闸，**跳闸会毁掉正在做的东西**。' },
    T21: { kind: Kind.Panel, title: '跳闸',           text: '同时开的设备加起来超过了上限。去配电箱复位。' },
    T22: { kind: Kind.Panel, title: '净化',           text: '烧开的水可以放心喝。第 8 天之前自来水是安全的。' }
  };

  /* ── 环境叙事（设计 3.1 / 3.3）──────────────────────
     **这三句话是整个游戏最重要的教学文本。**
     它比任何 UI 提示都有分量，因为它是别人用命换来的经验。 */
  const NOTES = {
    note406: '三楼水龙头没水了，四楼还有。别下楼。\n——不知道谁',
    note206: '它们看不清，但是听得见。\n走慢一点。别跑。\n我在图书馆。'
  };

  const Tutorial = {
    enabled: true,
    finished: false,
    objective: null,          // 当前目标 id
    done: {},                 // 已完成的目标
    shown: {},                // 已出现过的提示
    pending: [],              // 待显示的提示队列（界面层消费）
    _repeat: {},              // T09 专用：允许重复一次

    reset(enabled) {
      this.enabled = enabled !== false;
      this.finished = false;
      this.objective = null;
      this.done = {}; this.shown = {}; this.pending = []; this._repeat = {};
      if (this.enabled) this.setObjective('drink');
      return this;
    },

    /** 跳过教学：**关卡布置不变**，只是没人说话（设计 4.3）*/
    skip() {
      this.enabled = false;
      this.finished = true;
      this.objective = null;
      this.pending = [];
    },

    objectiveText() {
      const o = OBJECTIVES.find(x => x.id === this.objective);
      return o ? o.text : '';
    },
    setObjective(id) {
      if (!this.enabled || this.finished) return false;
      if (this.done[id] || this.objective === id) return false;
      this.objective = id;
      this.pending.push({ kind: 'objective', id, text: this.objectiveText() });
      C.EventBus.publish('TutorialObjectiveEvent', { id, text: this.objectiveText() });
      return true;
    },
    completeObjective(id) {
      if (!this.enabled || this.done[id]) return false;
      this.done[id] = true;
      if (this.objective === id) this.objective = null;
      return true;
    },

    /**
     * 触发一条提示。**出现一次，之后永不再现** ——
     * 唯一的例外是 T09（屏息），它允许在 8 秒后再提示一次。
     */
    hint(id, nowSeconds) {
      if (!this.enabled || this.finished) return false;
      const h = HINTS[id];
      if (!h) return false;
      /* `[实测]` 这里必须用 `!== undefined` 判断「出现过没有」。
         写成 `if (this.shown[id])` 的话，游戏第 0 秒触发的提示存进去是 0，
         下一次判断时 0 是假值 —— 提示会被重复播一遍。 */
      if (this.shown[id] !== undefined) {
        if (!h.repeatAfter || this._repeat[id]) return false;
        if (nowSeconds - this.shown[id] < h.repeatAfter) return false;
        this._repeat[id] = true;                 // 只准重复这一次
      } else {
        this.shown[id] = nowSeconds || 0;
      }
      this.pending.push(Object.assign({ id }, h));
      return true;
    },
    /** 玩家做出了这个动作 → 提示可以收了 */
    satisfied(id) { this._repeat[id] = true; },

    take() { const p = this.pending; this.pending = []; return p; },

    /**
     * **教学结束后，目标 UI 永久消失，整局游戏再也不出现。**
     * 这个消失本身是一句话：从现在起没人告诉你该干什么了。
     * 没有庆祝、没有「教学完成」字样、没有音乐变化。
     */
    finish(notebook, time) {
      if (this.finished) return false;
      this.finished = true;
      this.enabled = false;
      this.objective = null;
      this.pending = [];
      if (notebook) notebook.addClue('离开宿舍楼', time);
      C.EventBus.publish('TutorialFinishedEvent', {});
      return true;
    },

    serialize() {
      return { enabled: this.enabled, finished: this.finished, objective: this.objective,
               done: this.done, shown: this.shown, repeat: this._repeat };
    },
    deserialize(d) {
      if (!d) return this;
      this.enabled = d.enabled !== false;
      this.finished = !!d.finished;
      this.objective = d.objective || null;
      this.done = d.done || {}; this.shown = d.shown || {}; this._repeat = d.repeat || {};
      this.pending = [];
      return this;
    }
  };

  C.TutorialFloors = FLOOR_DANGER;
  C.TutorialObjectives = OBJECTIVES;
  C.TutorialHints = HINTS;
  C.TutorialHintKind = Kind;
  C.TutorialNotes = NOTES;
  C.Tutorial = Tutorial;
})(typeof globalThis !== 'undefined' ? globalThis : this);
