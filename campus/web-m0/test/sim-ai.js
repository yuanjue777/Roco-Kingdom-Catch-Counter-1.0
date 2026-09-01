/*
 * 无头 AI 仿真测试：不开浏览器就验证丧尸状态机与寻路。
 * 跑法：node test/sim-ai.js
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '10-player', '11-zombie']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function makeSim() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear();
  const level = C.buildDormitory();
  const world = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time);
  C.Projectiles.init(world);
  const player = { alive: false, pos: C.V.copy(level.spawn), flashlight: false,
                   eyePos() { return { x: this.pos.x, y: this.pos.y + 1.65, z: this.pos.z }; },
                   detectMultiplier() { return 1; }, die() { this.alive = false; } };
  return { level, world, time, player };
}
function step(sim, seconds, dt) {
  dt = dt || 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    sim.time.update(dt);
    C.Projectiles.update(dt);
    C.ZombieManager.update(dt, sim.player, sim.time);
  }
}

// ── 1. 听声 → 警觉 → 调查 → 搜索 → 游荡 ─────────────
section('1. 状态机完整流程');
let sim = makeSim();
const S = C.ZombieState;
// 只留一只：1F 走廊的游荡者
const z = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, sim.world);
step(sim, 0.2);
ok('初始为游荡', z.state === S.Wander, z.state);

// 在 6 米外扔一块石头（响度 45）
C.SoundSystem.emit({ worldPosition: C.V.make(16, 0.2, 1.3), loudness: C.Config.loudness.stoneImpact,
                     category: C.SoundCategory.Impact, emitterId: -1, label: '测试石头' });
ok('听到石头后进入警觉', z.state === S.Alert, z.state);
ok('反应延迟按公式计算且 >0', z.reactTimer > 0 && z.reactTimer <= 3.0, z.reactTimer.toFixed(2));
ok('目标点带定位误差且已固定', z.target !== null && z.targetError >= 0,
   '误差半径 ' + (z.targetError || 0).toFixed(2) + 'm');
const targetSnapshot = JSON.stringify(z.target);
step(sim, 0.5);
ok('警觉期间目标点不重算（不抖）', JSON.stringify(z.target) === targetSnapshot);

step(sim, 3.5);
ok('延迟结束后进入调查', z.state === S.Investigate || z.state === S.Search, z.state);
const distStart = C.V.distXZ(z.pos, z.target);
step(sim, 12);
ok('走到了目标点附近并转入搜索', z.state === S.Search, z.state + ' 距目标 ' + C.V.distXZ(z.pos, z.target).toFixed(2) + 'm');
step(sim, 18);
ok('搜索超时后回到游荡', z.state === S.Wander, z.state);

// ── 2. 优先级覆盖（声音规格 5.3）────────────────────
section('2. 连续投石不会让丧尸原地抽搐');
sim = makeSim();
const z2 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, sim.world);
step(sim, 0.2);
C.SoundSystem.emit({ worldPosition: C.V.make(14, 0.2, 1.3), loudness: 45, category: C.SoundCategory.Impact, emitterId: -1 });
const firstTarget = JSON.stringify(z2.target);
C.SoundSystem.emit({ worldPosition: C.V.make(6, 0.2, 1.3), loudness: 45, category: C.SoundCategory.Impact, emitterId: -1 });
ok('同等响度的第二块石头不切换目标', JSON.stringify(z2.target) === firstTarget);
C.SoundSystem.emit({ worldPosition: C.V.make(10.5, 0.2, 1.3), loudness: 90, category: C.SoundCategory.Impact, emitterId: -1 });
ok('显著更响的声音才切换目标', JSON.stringify(z2.target) !== firstTarget);

// ── 3. 跨楼层寻路（楼梯）───────────────────────────
section('3. 楼梯寻路');
sim = makeSim();
const z3 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, sim.world);
step(sim, 0.2);
const startFloor = Math.floor(z3.pos.y / 3.2);
// 二楼走廊里一声巨响
C.SoundSystem.emit({ worldPosition: C.V.make(8, 3.4, 1.3), loudness: 120, category: C.SoundCategory.Impact, emitterId: -1 });
ok('隔层也能听见（声音走楼梯口传下来）', z3.state === S.Alert, z3.state);
step(sim, 45);
const endFloor = Math.floor((z3.pos.y + 0.1) / 3.2);
ok('丧尸真的爬上了楼梯', endFloor > startFloor, `从 ${startFloor + 1}F 到 ${endFloor + 1}F, y=${z3.pos.y.toFixed(2)}`);

// ── 3b. 楼层边界的节点归属 ──────────────────────────
section('3b. 地板平面上的点属于哪一层');
sim = makeSim();
const g3 = sim.level.graph;
const H3 = 3.2;
for (let f = 0; f < 4; f++) {
  const p = C.V.make(16, f * H3, 1.3);      // 正好站在第 f 层地板上
  const n = g3.getNodeAt(p);
  ok(`y=${(f * H3).toFixed(1)} 属于 ${f + 1}F 走廊而不是楼下`, n && n.name === (f + 1) + 'F走廊', n && n.name);
}
// 浮点回归：直接写字面量 9.6（而不是 3×3.2）也必须判到 4F
ok('字面量 y=9.6 也判到 4F（浮点容差）', g3.getNodeAt(C.V.make(16, 9.6, 1.3)).name === '4F走廊',
   g3.getNodeAt(C.V.make(16, 9.6, 1.3)).name);
ok('楼层中部 y=11.0 判到 4F', g3.getNodeAt(C.V.make(16, 11.0, 1.3)).name === '4F走廊');
ok('楼下中部 y=8.0 判到 3F', g3.getNodeAt(C.V.make(16, 8.0, 1.3)).name === '3F走廊');

// 回归：丧尸的低吼从脚下发出，不能被算成楼下发出的
const zf = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(16, 3 * H3, 1.3) }, sim.world);
step(sim, 0.2);
zf.chainDepth = 0; zf.visible = false; zf.lastSeen = C.V.make(20, 3 * H3, 1.3); zf._setState(S.Chase);
step(sim, 2);
const growl = C.SoundSystem.log.filter(e => e.label === '低吼').pop();
ok('追击低吼记在 4F 走廊', growl && g3.getNode(growl.node).name === '4F走廊', growl && g3.getNode(growl.node).name);
ok('丧尸朝着同层的目标移动（不会跑去楼下）', zf.pos.x > 16.2, 'x=' + zf.pos.x.toFixed(2));

// ── 4. 关门挡人也挡路（Portal 状态同时管声与行）────
section('4. 关门阻断寻路');
sim = makeSim();
const g = sim.level.graph;
const room402 = g.nodes.find(n => n.name === '402');
const door402 = g.portals.find(p => (p.nodeA === room402.id || p.nodeB === room402.id) && p.type === 'WoodDoor');
g.setPortalState(door402, 'Open');
const z4 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(7, 9.6, 1.3) }, sim.world);
step(sim, 0.2);
z4._pathTo(C.AABB.center(room402.bounds));
ok('门开着时能找到进房间的路', z4.path.length > 0, '路点数 ' + z4.path.length);
g.setPortalState(door402, 'Closed');
z4._pathTo(C.AABB.center(room402.bounds));
ok('门关上后找不到路', z4.path.length === 0);

// ── 5. 连锁警戒上限（主文档 5.5）────────────────────
section('5. 连锁警戒');
sim = makeSim();
const a = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(6, 0, 1.3) }, sim.world);
const b = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(12, 0, 1.3) }, sim.world);
step(sim, 0.2);
// 深度 0 的低吼：应该能引到人
C.SoundSystem.emit({ worldPosition: C.V.make(9, 0, 1.3), loudness: C.Config.loudness.zombieGrowl,
                     category: C.SoundCategory.Voice, emitterId: 999, chainDepth: 0 });
ok('第 0 层低吼能引来其他丧尸', a.state === S.Alert && b.state === S.Alert);
sim = makeSim();
const a2 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(6, 0, 1.3) }, sim.world);
step(sim, 0.2);
C.SoundSystem.emit({ worldPosition: C.V.make(9, 0, 1.3), loudness: C.Config.loudness.zombieGrowl,
                     category: C.SoundCategory.Voice, emitterId: 999, chainDepth: 2 });
ok('达到上限层数的低吼不再引人', a2.state === S.Wander, a2.state);

// ── 6. 蜷伏者（主文档 5.2）──────────────────────────
section('6. 蜷伏者');
sim = makeSim();
const cr = C.ZombieManager.spawn({ type: 'Crawler', pos: C.V.make(10, 0, 4.0) }, sim.world);
step(sim, 0.2);
ok('初始为趴伏', cr.state === S.Prone);
C.SoundSystem.emit({ worldPosition: C.V.make(10, 0, 16.0), loudness: 90, category: C.SoundCategory.Impact, emitterId: -1 });
ok('声源在 8m 外时不起身（哪怕很响）', cr.state === S.Prone, cr.state);
C.SoundSystem.emit({ worldPosition: C.V.make(10, 0, 7.5), loudness: 45, category: C.SoundCategory.Impact, emitterId: -1 });
ok('声源进入 8m 内才起身', cr.state === S.Alert, cr.state);

/* 蜷伏者呼吸声的可听半径 —— 这一段测出了一个设计问题，见下方注释。
   可听半径 = (响度 − 阈值) / k
     常态 : (12 − 25) / 2 < 0    永远听不见
     屏息 : (12 −  8) / 2 = 2m   必须贴到 2 米以内
   文档 5.2 说「屏息时能听到它们极轻微的呼吸声 —— 这是屏息作为侦查工具的核心价值」，
   但 2 米在室内基本等于已经走进它的起身范围(8m)了，侦查价值几乎为零。
   要让屏息真的能用来「扫房间」，crawlerBreath 需要提到 20–24（可听半径 6–8m），
   或者给环境类声音单独一个更小的 k。这个数只能靠实机手感定，配置里已经留了开关。 */
function breathHeardWithin(dist, threshold) {
  const sim2 = makeSim();
  C.ZombieManager.spawn({ type: 'Crawler', pos: C.V.make(10, 0, 4.0) }, sim2.world);
  let heard = 0;
  const ear = new C.HearingComponent({ ownerId: 1, baseThreshold: threshold,
    onHeard: (i) => { if (i.evt.label === '蜷伏者呼吸') heard++; } });
  ear.position = C.V.make(10 + dist, 1.65, 4.0);
  ear.nodeId = sim2.level.graph.getNodeAt(ear.position).id;
  C.SoundSystem.registerListener(ear);
  step(sim2, 8);
  return heard;
}
const TH = C.Config.hearing;
ok('常态（阈值25）无论多近都听不见呼吸（响度 12 < 25）', breathHeardWithin(1.0, TH.player) === 0);
ok('屏息（阈值8）几乎贴脸（水平 0.5m）才听得见', breathHeardWithin(0.5, TH.playerHoldBreath) > 0);
ok('屏息在水平 1.5m 外就听不见了', breathHeardWithin(1.5, TH.playerHoldBreath) === 0);
/* 雪上加霜：呼吸声从蜷伏者所在的地面高度发出，玩家耳朵在 1.65m，
   光是这个高度差就吃掉了 2m 可听预算里的 1.65m，水平可听距离只剩约 1.1m。 */
ok('高度差吃掉大部分预算：水平 1.1m 时 3D 距离已接近 2m',
   Math.abs(Math.hypot(1.1, 1.65) - 1.98) < 0.05);
ok('若把 crawlerBreath 提到 24，可听半径变成 8m（与起身范围一致）',
   (24 - TH.playerHoldBreath) / C.Config.sound.kIndoor === 8);

// ── 7. 追击上限 ────────────────────────────────────
section('7. 同时追击上限');
sim = makeSim();
C.Config.zombieReaction.maxChasers = 3;
const many = [];
for (let i = 0; i < 6; i++) many.push(C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(4 + i * 3, 0, 1.3) }, sim.world));
for (const m of many) { m.chainDepth = 0; m._setState(S.Chase); m.lastSeen = C.V.make(10, 0, 1.3); m.visible = false; }
sim.player.pos = C.V.make(10, 0, 1.3);
C.ZombieManager._enforceChaseCap(sim.player);
const chasing = C.ZombieManager.list.filter(x => x.state === S.Chase).length;
ok('超过上限时最远的转为搜索', chasing === 3, String(chasing));
C.Config.zombieReaction.maxChasers = C.ConfigDefaults.zombieReaction.maxChasers;

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
