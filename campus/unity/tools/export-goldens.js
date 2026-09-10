/*
 * export-goldens.js —— 从 JS 引擎导出「标准答案」，给 C# 移植做对拍
 *
 * **这是移植唯一可信的验证方式。**
 * 把断言在 C# 里重写一遍，只能证明「C# 的实现符合我对规格的理解」；
 * 而对拍证明的是「C# 和已经跑了 800 条测试的 JS 算出同一个数」。
 * 后者才是「系统不变」这句话的意思。
 *
 * 跑法：node campus/unity/tools/export-goldens.js
 */
const path = require('path'), fs = require('fs');
const SRC = path.join(__dirname, '..', '..', 'web-m0', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers',
                 '04-soundgraph', '05-soundsystem', '06-hearing', '07-time', '09-collision', '08-level',
                 '18-needs', '19-sleep']) {
  require(path.join(SRC, f + '.js'));
}
const C = globalThis.Campus;

const lv = C.buildDormitory();
const time = new C.TimeSystem();
C.SoundSystem.init(lv.graph, time);

// ── 图本身：C# 那边照着这份数据建一模一样的图 ────────
const graph = {
  nodes: lv.graph.nodes.map(n => ({
    id: n.id, name: n.name, isOutdoor: n.isOutdoor, buildingId: n.buildingId,
    floor: n.floor, kind: n.kind,
    bounds: [n.bounds.min.x, n.bounds.min.y, n.bounds.min.z, n.bounds.max.x, n.bounds.max.y, n.bounds.max.z]
  })),
  portals: lv.graph.portals.map(p => ({
    id: p.id, a: p.nodeA, b: p.nodeB, type: p.type, state: p.state,
    pos: [p.position.x, p.position.y, p.position.z]
  }))
};

const room402 = lv.graph.nodes.find(n => n.name === '402');
const corr4 = lv.graph.nodes.find(n => n.name === '4F走廊');
const doorPortal = lv.graph.portals.find(p =>
  (p.nodeA === room402.id || p.nodeB === room402.id) && p.type === 'WoodDoor');
const src = C.AABB.center(room402.bounds);

const cases = [];
function golden(label, loud, pos, nodeId, portalState, hour) {
  doorPortal.state = portalState;
  time.hour = hour;
  const evt = { id: -1, worldPosition: src, nodeId: room402.id, loudness: loud,
                category: 'Impact', emitterId: -1, chainDepth: 0, timestamp: 0 };
  const res = C.SoundSystem.propagate(evt);
  const r = C.SoundSystem.resolveAt(res, pos, nodeId);
  cases.push({
    label, loud, srcNode: room402.id, doorPortalId: doorPortal.id, portalState, hour,
    listenerPos: [pos.x, pos.y, pos.z], listenerNode: nodeId,
    arrival: r ? r.arrival : 0,
    pathLen: r ? r.pathLen : 0,
    dir: r ? [r.dir.x, r.dir.y, r.dir.z] : [0, 0, 0],
    reached: res.size
  });
}

const listener = { x: src.x, y: src.y, z: 1.3 };
const p3 = { x: src.x + 3, y: src.y, z: src.z };
const far = { x: src.x + 1.2, y: src.y, z: src.z - 1.6 };

// 覆盖：同节点近/远 · 跨门开/关/破/封 · 白天/夜间/黄昏过渡 · 各档响度
for (const [loud] of [[10], [20], [45], [55], [70], [90]]) {
  golden(`同节点3m/${loud}`, loud, p3, room402.id, 'Open', 12);
  golden(`同节点斜向/${loud}`, loud, far, room402.id, 'Open', 12);
  for (const st of ['Open', 'Closed', 'Broken', 'Blocked']) {
    golden(`跨门${st}/${loud}/白天`, loud, listener, corr4.id, st, 12);
    golden(`跨门${st}/${loud}/夜间`, loud, listener, corr4.id, st, 23);
  }
  golden(`跨门Open/${loud}/黄昏过渡`, loud, listener, corr4.id, 'Open', 19.25);
  golden(`跨门Open/${loud}/黎明过渡`, loud, listener, corr4.id, 'Open', 5.75);
}
// 每个节点都测一遍：传播的完整快照
doorPortal.state = 'Open'; time.hour = 12;
const evt = { id: -1, worldPosition: src, nodeId: room402.id, loudness: 90,
              category: 'Impact', emitterId: -1, chainDepth: 0, timestamp: 0 };
const full = C.SoundSystem.propagate(evt);
const snapshot = [];
for (const [nodeId, rec] of full) {
  snapshot.push({ nodeId, arrival: rec.arrival, pathLen: rec.pathLen, entryPortalId: rec.entryPortalId });
}
snapshot.sort((a, b) => a.nodeId - b.nodeId);

// 夜间系数曲线：过渡段是 smoothstep，最容易移植错
const nightCurve = [];
for (let h = 0; h < 24; h += 0.25) { time.hour = h; nightCurve.push({ h, nf: time.getNightFactor() }); }
time.hour = 12;

// 确定性随机：**同一个种子必须逐位一致**，否则地图和物资就不是同一张
const rngSeq = [];
const rng = new C.Rng(20260905);
for (let i = 0; i < 20; i++) rngSeq.push(rng.next());


/* ── 需求：脚本化的操作序列，逐步快照 ──────────────
   移植数值系统时最容易错的不是公式，而是**顺序**：
   腹泻倍率在扣 diarrheaHours 之前还是之后、精力充沛先乘再扣还是先扣再乘、
   stamina.max 是先被困乏挤占再过管线还是反过来。
   所以对拍的不是「跑 8 小时后口渴是多少」，而是**每一步之后的全部字段**。 */
const NEED_OWNER = 7;
function snapNeeds(n) {
  return { hunger: n.hunger, thirst: n.thirst, fatigue: n.fatigue, health: n.health,
           healthMax: n.healthMax(), staminaMax: n.staminaMax(),
           diarrheaHours: n.diarrheaHours, restedHours: n.restedHours,
           dead: n.dead, cause: n.cause };
}
function runNeeds(seed, steps) {
  C.ModifierPipeline.clear();
  const rng = new C.Rng(seed);
  const n = new C.Needs(NEED_OWNER);
  const trace = [];
  for (const s of steps) {
    const [op, a, b] = s;
    if (op === 'update') n.update(a, b);
    else if (op === 'consume') n.consume(a, rng);
    else if (op === 'damage') n.damage(a, b);
    else if (op === 'heal') n.heal(a);
    else if (op === 'grantRested') n.grantRested();
    else if (op === 'staminaMod') C.Mod.add('stamina.max', 'iron', 40, NEED_OWNER);
    else if (op === 'staminaMulMod') C.Mod.mul('stamina.max', 'orderPin', 1.5, NEED_OWNER);
    else if (op === 'thirstMod') C.Mod.mul('need.thirst_rate', 'needsWater', 1.3, NEED_OWNER);
    else if (op === 'fatigueMod') C.Mod.mul('need.fatigue_rate', 'sleepyHead', 1.35, NEED_OWNER);
    else if (op === 'clearMods') C.ModifierPipeline.clear();
    trace.push({ op: s, state: snapNeeds(n) });
  }
  C.ModifierPipeline.clear();
  return trace;
}

const needsTraces = [];
{
  const steps = [
    ['snap'],
    ['update', 0.5, false], ['update', 2, false], ['update', 0.25, false],
    ['staminaMod'],                         // stamina.max +40（铁人）
    /* **加法看不出顺序**：(100−困乏)+40 和 (100+40)−困乏 是同一个数。
       目前 52 条特性挂在 stamina.max 上的**全是加法**，所以「先挤占再过管线」
       这条顺序今天不影响任何结果 —— 也就意味着它可以被悄悄改掉而没人发现。
       这里挂一条乘法把顺序钉死：将来真加了乘法特性，改错顺序会立刻变红。 */
    ['staminaMulMod'],
    ['thirstMod'],                          // need.thirst_rate ×1.3（离不开水）
    ['update', 1, false],
    ['consume', 'raw'],                     // 40% 腹泻，rng 注入 → 必定可复现
    ['update', 1, false],                   // 腹泻期内：口渴速率 ×2 且 ×1.3
    ['consume', 'water'], ['consume', 'water'],
    ['update', 4, false],
    ['consume', 'water'],
    ['update', 4, false],                   // **这一步把 diarrheaHours 扣到 0，但整步仍按 ×2 算**
    ['update', 1, false],                   // 下一步倍率必须已经消失
    ['consume', 'cooked'], ['consume', 'nosuch'],
    ['fatigueMod'],                         // need.fatigue_rate ×1.35（嗜睡）
    ['update', 3, false],
    ['grantRested'],
    ['update', 2, false],                   // 精力充沛期：困乏 ×0.75 且 restedHours 递减
    ['update', 0, false], ['update', -1, false],   // 零/负 dt 必须原地不动
    ['damage', 10, '摔伤'], ['heal', 100],  // 治疗抬不过当前上限
    ['consume', 'water'],
    ['update', 6, true],                    // 睡眠：困乏退、饥渴照涨，上限把当前生命压下去
    ['clearMods'],
    ['update', 20, false],                  // 一路挤占到死
    ['update', 5, false],                   // 死后必须什么都不做
    ['damage', 5, '补刀']
  ];
  needsTraces.push(runNeeds(4242, steps));
}

/* ── 第二条轨迹：**专门跨过「精力充沛」到期的那一步** ──
   `[实测]` 第一条轨迹里 restedHours 一直是 24 → 22，从没归零，
   于是「先乘 0.75 再扣时长」和「先扣时长、扣完就不乘了」算出来一模一样 ——
   把顺序改反，32 步全绿。对拍能过不等于对拍在管事。
   这条轨迹让 restedHours 在第 6 次清醒更新里正好跨过 0，顺序一改就红。
   中间穿插睡觉和进食，是为了不让困乏顶到 100、也不让人渴死 ——
   **一旦撞上钳制，差异就被吃掉了，这一条又变回摆设。** */
{
  const cycle = [['update', 4.5, false], ['update', 1, true],
                 ['consume', 'water'], ['consume', 'water'], ['consume', 'cooked']];
  const steps = [['grantRested']];
  for (let i = 0; i < 7; i++) for (const c of cycle) steps.push(c);
  needsTraces.push(runNeeds(99, steps));
}

/* ── 睡眠：状态机 + 惊醒阈值 ────────────────────── */
const sleepTrace = [];
{
  const t = new C.TimeSystem();
  const steps = [
    ['begin', 21, 8], ['update', 2], ['update', 3],
    ['interrupt', '被脚步声惊醒'],           // 中断 → grantsRested 必须 false
    ['begin', 21, 8], ['update', 5], ['update', 1.5],   // 睡满 6.5 → 够 6 小时
    ['begin', 23, 8], ['update', 7],         // 23 点入睡 → 过了 22 点，不给 buff
    ['begin', 2, 8], ['update', 7],          // 凌晨 2 点入睡 → 算数（h < 6）
    ['begin', 21, 99], ['update', 20],       // 上限 10 小时
    ['begin', 21, 8], ['update', 6],         // **正好 6 小时**：>= 还是 > 就差在这一步
    ['begin', 21, 8], ['update', 5.999],     // 差一点点 → 不给
    ['begin', 21, 0], ['update', 1],         // hours 省略 → 默认 8
    ['reset']
  ];
  for (const s of steps) {
    const [op, a, b] = s;
    let ret = '';
    if (op === 'begin') { t.hour = a; C.Sleep.begin(null, t, b); }
    else if (op === 'update') ret = C.Sleep.update(a, t);
    else if (op === 'interrupt') C.Sleep.interrupt(t, a);
    else if (op === 'reset') C.Sleep.reset();
    sleepTrace.push({ op: s, ret,
      state: { active: C.Sleep.active, slept: C.Sleep.slept, target: C.Sleep.target,
               startHour: C.Sleep.startHour, interrupted: C.Sleep.interrupted,
               wokeReason: C.Sleep.wokeReason, grantsRested: C.Sleep.grantsRested(),
               timeScale: t.timeScale } });
  }
  // 惊醒阈值走管线：睡得沉 35 / 浅眠 6
  C.ModifierPipeline.clear();
  const wake = [{ id: 'base', v: C.ModifierPipeline.query('sleep.interrupt_threshold', C.Config.sleep.interruptMargin, 0) }];
  C.Mod.override('sleep.interrupt_threshold', 'deepSleeper', 35, 0);
  wake.push({ id: 'deepSleeper', v: C.ModifierPipeline.query('sleep.interrupt_threshold', C.Config.sleep.interruptMargin, 0) });
  C.ModifierPipeline.unregister('sleep.interrupt_threshold', 'deepSleeper');
  C.Mod.override('sleep.interrupt_threshold', 'lightSleeper', 6, 0);
  wake.push({ id: 'lightSleeper', v: C.ModifierPipeline.query('sleep.interrupt_threshold', C.Config.sleep.interruptMargin, 0) });
  C.ModifierPipeline.clear();
  sleepTrace.wake = wake;
  var wakeThresholds = wake;
}

/* ── 安全睡点判定：门 / 隔壁丧尸 / 床，三条各自独立 ── */
const sleepChecks = [];
{
  const zAtCorr = [{ alive: true, nodeId: corr4.id }];
  const zDead = [{ alive: false, nodeId: room402.id }];
  const zFar = [{ alive: true, nodeId: lv.graph.nodes.find(n => n.name === '1F走廊').id }];
  const combos = [
    ['全部满足', 'Closed', [], true],
    ['门开着', 'Open', [], true],
    ['门破了', 'Broken', [], true],
    ['门封死', 'Blocked', [], true],
    ['隔壁有丧尸', 'Closed', zAtCorr, true],
    ['隔壁的是尸体', 'Closed', zDead, true],
    ['丧尸在很远的地方', 'Closed', zFar, true],
    ['没有床', 'Closed', [], false],
    ['全都不满足', 'Open', zAtCorr, false]
  ];
  for (const [label, st, zs, hasBed] of combos) {
    // 把 402 的所有 Portal 都设成同一个状态，判定才只由这一个变量决定
    for (const pid of room402.portals) lv.graph.getPortal(pid).state = st;
    const fake = { pos: { x: 0, y: 0, z: 0 }, nodeId: room402.id };
    const origFind = C.Sleep.findBed;
    C.Sleep.findBed = () => (hasBed ? {} : null);
    const r = C.Sleep.check(fake, lv, zs);
    C.Sleep.findBed = origFind;
    sleepChecks.push({ label, portalState: st, nodeId: room402.id, hasBed,
                       zombieNodes: zs.filter(z => z.alive).map(z => z.nodeId),
                       ok: r.ok, reasons: r.reasons });
  }
  for (const pid of room402.portals) lv.graph.getPortal(pid).state = 'Open';
  doorPortal.state = 'Open';
}

const out = { graph, cases, snapshot, nightCurve, rngSeq, needsTraces, sleepTrace, wakeThresholds, sleepChecks,
              meta: { nodes: graph.nodes.length, portals: graph.portals.length, cases: cases.length, needsTraces: needsTraces.map(t => t.length), sleepTrace: sleepTrace.length } };
const file = path.join(__dirname, '..', 'Campus.Tests', 'goldens.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`已导出 ${cases.length} 个对拍用例 · ${graph.nodes.length} 节点 / ${graph.portals.length} Portal · ` +
            `快照 ${snapshot.length} 条 · 夜间曲线 ${nightCurve.length} 点 · ` +
            `需求 ${needsTraces.map(t => t.length).join('+')} 步 / 睡眠 ${sleepTrace.length} 步 / 睡点 ${sleepChecks.length} 例 · ` +
            (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
