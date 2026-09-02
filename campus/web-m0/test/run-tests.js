/*
 * 声音系统与规则层的单元测试。
 * 跑法：node test/run-tests.js
 * 这些断言直接对应《声音系统规格》里的表格，改数值前先跑一遍。
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers',
                 '04-soundgraph', '05-soundsystem', '06-hearing', '07-time', '08-level']) {
  require(path.join(SRC, f + '.js'));
}
const C = globalThis.Campus;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  → ' + extra : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 0.05 : eps); }
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

// ── 1. 响度表与有效半径的自洽性（声音规格 6.1）────────
section('1. 行为响度 → 室内有效半径（arrival 归零处，k=2.0）');
const expectRadius = {
  crouch: 5, wallHug: 7, walk: 10, run: 22, doorOpenSlow: 6, doorOpenFast: 17,
  doorSlam: 35, stoneImpact: 22, windowClimb: 15, glassBreak: 45,
  lootFast: 20, lootSlow: 7, meleeHit: 27, playerHurt: 30, broadcast: 75
};
for (const key in expectRadius) {
  const r = C.Config.loudness[key] / C.Config.sound.kIndoor;
  ok(`${key}: ${C.Config.loudness[key]} → ${r.toFixed(1)}m（文档 ${expectRadius[key]}m）`,
     Math.abs(r - expectRadius[key]) <= 0.5, r.toFixed(2));
}

// ── 2. 传播：同节点 / 跨门 / 夜间 ────────────────────
section('2. Dijkstra 传播');
const lv = C.buildDormitory();
const time = new C.TimeSystem();
C.SoundSystem.init(lv.graph, time);

const room402 = lv.graph.nodes.find(n => n.name === '402');
const corr4 = lv.graph.nodes.find(n => n.name === '4F走廊');
const doorPortal = lv.graph.portals.find(p =>
  (p.nodeA === room402.id || p.nodeB === room402.id) && p.type === 'WoodDoor');
const src = C.AABB.center(room402.bounds);

function arrivalAt(loud, pos, nodeId, portalState) {
  if (portalState) doorPortal.state = portalState;
  const evt = { id: -1, worldPosition: src, nodeId: room402.id, loudness: loud, category: 'Impact', emitterId: -1, chainDepth: 0, timestamp: 0 };
  const res = C.SoundSystem.propagate(evt);
  const r = C.SoundSystem.resolveAt(res, pos, nodeId);
  return r ? r.arrival : 0;
}

// 同节点：正上方 3 米处
const p3 = { x: src.x + 3, y: src.y, z: src.z };
ok('同节点 3m，源 45 → 39（45−2×3）', near(arrivalAt(45, p3, room402.id, 'Open'), 39, 0.01),
   arrivalAt(45, p3, room402.id, 'Open').toFixed(2));

// 跨门：开门 vs 关门，差值必须正好是木门 Open(5) 与 Closed(45) 的差 40
const listener = { x: src.x, y: src.y, z: 1.3 };
const openA = arrivalAt(70, listener, corr4.id, 'Open');
const closedA = arrivalAt(70, listener, corr4.id, 'Closed');
ok('木门 开→关 使到达响度正好降低 40', near(openA - closedA, 40, 0.01), `open=${openA.toFixed(2)} closed=${closedA.toFixed(2)}`);
ok('撞门(70) 即使隔着关闭的木门也仍然被听见', closedA > C.Config.hearing.zombie, closedA.toFixed(2));
const walkClosed = arrivalAt(C.Config.loudness.walk, listener, corr4.id, 'Closed');
const walkOpen = arrivalAt(C.Config.loudness.walk, listener, corr4.id, 'Open');
ok('正常走路(20) 隔着关闭的木门完全传不出去', walkClosed === 0, walkClosed.toFixed(2));
ok('正常走路(20) 门开着时声音传得出去（但很弱）', walkOpen > 0, walkOpen.toFixed(2));
/* 注意这条：房间中央走路(20)，穿过开着的木门(5)到走廊 1.3m 处只剩 7.06，
   低于丧尸阈值 10 —— 也就是说门开着时，站在门外的丧尸听不见你在房间中间正常走路。
   文档 6.1 的「有效半径」是 arrival 归零处(10m)，但对丧尸而言的有效半径是
   (响度 − 阈值)/k = (20−10)/2 = 5m 路径长度。这两个数差一倍，调平衡时要用后者。 */
ok('对丧尸的有效路径长度 = (响度−阈值)/k：走路 5m、跑步 17.5m',
   near((C.Config.loudness.walk - C.Config.hearing.zombie) / C.Config.sound.kIndoor, 5) &&
   near((C.Config.loudness.run - C.Config.hearing.zombie) / C.Config.sound.kIndoor, 17.5));

// 夜间：同一事件传得更远
time.hour = 23;
const nightA = arrivalAt(70, listener, corr4.id, 'Open');
time.hour = 12;
ok('夜间 nightFactor=0.7，到达响度更高', nightA > openA, `day=${openA.toFixed(2)} night=${nightA.toFixed(2)}`);
time.hour = 23;
ok('夜间有效半径约为白天的 1.43 倍', near(1 / C.Config.time.nightFactor, 1.428, 0.01));
time.hour = 12;

// 多通道取最优：把门关上后，声音应该改走窗户+室外这条更差的路径或直接到不了
doorPortal.state = 'Open';

// 室外遮挡（声音规格 4.3）
section('2b. 室外建筑遮挡');
{
  const g2 = new C.SoundGraph();
  const out = g2.addNode({ name: '空地', kind: 'outdoor', isOutdoor: true,
    bounds: C.AABB.make(-50, 0, -50, 50, 20, 50) });
  const t2 = new C.TimeSystem(); t2.hour = 12;
  const src2 = C.V.make(0, 1.5, 0), ear2 = C.V.make(20, 1.5, 0);
  const mk = (occ) => {
    C.SoundSystem.init(g2, t2, occ);
    const r = C.SoundSystem.propagate({ id: 0, worldPosition: src2, nodeId: out.id,
      loudness: 90, category: 'Impact', emitterId: -1, chainDepth: 0, timestamp: 0 });
    return C.SoundSystem.resolveAt(r, ear2, out.id).arrival;
  };
  const clear = mk(() => true), blocked = mk(() => false);
  ok('室外 k=1.2：20m 处 90 → 66', near(clear, 90 - 1.2 * 20, 0.01), clear.toFixed(2));
  ok('有建筑遮挡时再扣 25', near(clear - blocked, C.Config.sound.outdoorOcclusion, 0.01),
     `无遮挡 ${clear.toFixed(1)} / 有遮挡 ${blocked.toFixed(1)}`);
  ok('遮挡判定只对室外生效', (() => {
    const g3 = new C.SoundGraph();
    const room = g3.addNode({ name: '室内', bounds: C.AABB.make(-50, 0, -50, 50, 20, 50) });
    C.SoundSystem.init(g3, t2, () => false);
    const r = C.SoundSystem.propagate({ id: 0, worldPosition: src2, nodeId: room.id,
      loudness: 90, category: 'Impact', emitterId: -1, chainDepth: 0, timestamp: 0 });
    return near(C.SoundSystem.resolveAt(r, ear2, room.id).arrival, 90 - 2.0 * 20, 0.01);
  })());
  C.SoundSystem.init(lv.graph, time);
}

// ── 3. 反应公式（声音规格 5.2）──────────────────────
section('3. 丧尸反应公式');
ok('margin=0  → 延迟 3.0s，误差 12m', near(C.Reaction.delay(0), 3.0) && near(C.Reaction.localizationError(0), 12));
ok('margin=20 → 延迟 1.8s，误差 7m', near(C.Reaction.delay(20), 1.8) && near(C.Reaction.localizationError(20), 7));
ok('margin=50 → 延迟 0.1s（下限），误差 0m', near(C.Reaction.delay(50), 0.1) && near(C.Reaction.localizationError(50), 0));
ok('距离分级：margin 40→很近，20→中等，5→很远',
   C.Reaction.distanceBand(40) === '很近' && C.Reaction.distanceBand(20) === '中等' && C.Reaction.distanceBand(5) === '很远');

// ── 4. 修正管线执行顺序（主文档 11.3）────────────────
section('4. 数值修正管线');
C.ModifierPipeline.clear();
C.Mod.add('t.x', 'a1', 10);
C.Mod.mul('t.x', 'm1', 2);
ok('先 Additive 再 Multiplicative：(100+10)×2 = 220', C.ModifierPipeline.query('t.x', 100, 1) === 220,
   String(C.ModifierPipeline.query('t.x', 100, 1)));
C.Mod.override('t.x', 'o1', 8);
ok('Override 最后生效，结果为 8', C.ModifierPipeline.query('t.x', 100, 1) === 8);
C.ModifierPipeline.clear();
C.Mod.mul('t.y', 'own', 0.5, 7);
ok('ownerId 过滤：非本人不受影响', C.ModifierPipeline.query('t.y', 100, 3) === 100);
ok('ownerId 过滤：本人受影响', C.ModifierPipeline.query('t.y', 100, 7) === 50);
C.ModifierPipeline.clear();

// 负重公式（主文档 7.1）
const r = 0.6;
ok('负重 r=0.6：脚步响度 ×1.3', near(1 + C.Config.player.weightLoudnessCoef * r, 1.3));
ok('负重 r=0.6：体力消耗 ×1.48', near(1 + C.Config.player.weightStaminaCoef * r, 1.48));
ok('负重 r=0.6：奔跑速度 ×0.85', near(1 - C.Config.player.weightSpeedCoef * r, 0.85));

// ── 5. 听觉组件与自声过滤（声音规格 4.5）─────────────
section('5. 听觉组件');
C.SoundSystem.reset();
C.SoundSystem.init(lv.graph, time);
let heardCount = 0, lastMargin = 0;
const hc = new C.HearingComponent({
  ownerId: 99, baseThreshold: C.Config.hearing.zombie,
  onHeard: (info) => { heardCount++; lastMargin = info.margin; }
});
hc.position = listener; hc.nodeId = corr4.id;
C.SoundSystem.registerListener(hc);
C.SoundSystem.emit({ worldPosition: src, loudness: 70, category: 'Impact', emitterId: 1 });
ok('跨开着的门能听见', heardCount === 1, 'margin=' + lastMargin.toFixed(2));
C.SoundSystem.emit({ worldPosition: src, loudness: 70, category: 'Impact', emitterId: 99 });
ok('自己发出的声音被过滤', heardCount === 1);
C.SoundSystem.emit({ worldPosition: src, loudness: 6, category: 'Footstep', emitterId: 1 });
ok('低于阈值的声音不触发', heardCount === 1);

// 玩家听觉：阈值即范围
const HH = C.Config.hearing;
const player = new C.HearingComponent({ ownerId: 1, baseThreshold: HH.player });
ok('玩家初始阈值 9，只比丧尸的 10 好一点点', player.finalThreshold() === 9 && HH.player < HH.zombie);
ok('对丧尸脚步(30)的初始可听半径 10.5m',
   near(player.audibleRange(C.Config.loudness.zombieShuffle), 10.5, 0.01),
   player.audibleRange(C.Config.loudness.zombieShuffle).toFixed(2) + 'm');
C.Mod.add('hearing.threshold', 'holdBreath', () => -HH.holdBreathBonus, 1);
ok('屏息是在当前阈值上做减法（9−4=5），不是覆盖', player.finalThreshold() === 5);
ok('屏息后可听半径扩到 12.5m', near(player.audibleRange(C.Config.loudness.zombieShuffle), 12.5, 0.01));
C.Mod.remove('hearing.threshold', 'holdBreath');
ok('松开屏息恢复 9', player.finalThreshold() === 9);
// 熟练度逐级降阈值 = 逐级扩范围
let prevT = Infinity, mono = true;
for (let l = 0; l <= 5; l++) {
  const t = HH.playerLevelThreshold[l];
  if (t >= prevT) mono = false;
  prevT = t;
}
ok('听觉 Lv0→Lv5 阈值单调下降', mono, HH.playerLevelThreshold.join(' → '));
const rng = (L, t) => (L - t) / C.Config.sound.kIndoor;
ok('等级对很轻的声音影响巨大：蜷伏者呼吸 1.5m → 5.0m',
   near(rng(12, HH.playerLevelThreshold[0]), 1.5, 0.01) && near(rng(12, HH.playerLevelThreshold[5]), 5.0, 0.01));
ok('对很响的声音影响有限：追击低吼 23m → 26.5m（上限由声源响度决定）',
   near(rng(55, HH.playerLevelThreshold[0]), 23, 0.01) && near(rng(55, HH.playerLevelThreshold[5]), 26.5, 0.01));
ok('阈值有下限，不会出现负阈值', (() => {
  const h = new C.HearingComponent({ ownerId: 2, baseThreshold: 2 });
  C.Mod.add('hearing.threshold', 'hb2', () => -99, 2);
  const t = h.finalThreshold();
  C.Mod.remove('hearing.threshold', 'hb2');
  return t === HH.minThreshold;
})());

// ── 6. 夜间系数曲线（主文档 3.1）────────────────────
section('6. 夜间系数平滑过渡');
const t2 = new C.TimeSystem();
t2.hour = 18.9; const a = t2.getNightFactor();
t2.hour = 19.25; const b = t2.getNightFactor();
t2.hour = 19.6; const c = t2.getNightFactor();
t2.hour = 5.75; const d = t2.getNightFactor();
ok('18:54 = 1.0', near(a, 1.0));
ok('19:15 介于 1.0 与 0.7 之间（不是硬切换）', b < 1.0 && b > 0.7, b.toFixed(3));
ok('19:36 = 0.7', near(c, 0.7));
ok('05:45 回升中', d > 0.7 && d < 1.0, d.toFixed(3));

// ── 7. 性能预算（声音规格 9）────────────────────────
section('7. 性能');
const t0 = Date.now();
const N = 2000;
for (let i = 0; i < N; i++) {
  C.SoundSystem.propagate({ id: i, worldPosition: src, nodeId: room402.id, loudness: 90, category: 'Impact', emitterId: -1, chainDepth: 0, timestamp: 0 });
}
const per = (Date.now() - t0) / N;
ok(`单次传播 ${per.toFixed(3)} ms < 0.5ms 预算`, per < 0.5, per.toFixed(3) + 'ms');
const bigRes = C.SoundSystem.propagate({ id: 0, worldPosition: src, nodeId: room402.id, loudness: 150, category: 'Gunshot', emitterId: -1, chainDepth: 0, timestamp: 0 });
ok(`响度 150 展开节点数 ${bigRes.size} < 150`, bigRes.size < 150, String(bigRes.size));

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
