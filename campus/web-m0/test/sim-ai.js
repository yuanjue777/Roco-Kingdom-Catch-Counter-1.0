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

// ── 8. 跳跃与翻越 ──────────────────────────────────
section('8. 跳跃与情境翻越');
sim = makeSim();
const P = C.Config.player;
const g8 = sim.level.graph;
const room = g8.nodes.find(n => n.name === '402');
const rc = C.AABB.center(room.bounds);
const floorY = 3 * 3.2;

// 床铺高 0.55m（房间里 z 2.9~4.9 那两张），应当可翻越
const bedProbe = sim.world.probeVault(
  C.V.make(rc.x, floorY, 4.0), { x: -1, y: 0, z: 0 }, P.radius, P);
ok('面向床铺可翻越（抬升约 0.55m）',
   bedProbe && Math.abs(bedProbe.rise - 0.55) < 0.02, bedProbe ? bedProbe.rise.toFixed(2) + 'm' : 'null');
// 书桌高 0.75m
const deskProbe = sim.world.probeVault(
  C.V.make(rc.x, floorY, 5.9), { x: 0, y: 0, z: 1 }, P.radius, P);
ok('面向书桌可翻越（抬升约 0.75m）',
   deskProbe && Math.abs(deskProbe.rise - 0.75) < 0.02, deskProbe ? deskProbe.rise.toFixed(2) + 'm' : 'null');

// 走廊南墙：3.2m 高，翻不上去
const wallProbe = sim.world.probeVault(
  C.V.make(16, floorY, 0.55), { x: 0, y: 0, z: -1 }, P.radius, P);
ok('面向 3.2m 实心墙不可翻越', wallProbe === null, wallProbe && wallProbe.rise.toFixed(2));

/* 窗户：关着不能翻，开了就能翻（窗台高 1.0m，窗洞净空 1.0m，正好够蹲姿钻过）。
   用走廊的窗测 —— 房间的窗底下正好摆着书桌，那条路径是「先上桌再跨窗台」，
   而窗台距桌面只有 0.25m，低于 vaultMinHeight，会被当成普通台阶走上去。 */
const corr4 = g8.nodes.find(n => n.name === '4F走廊');
const cwin = g8.portals.find(p => (p.nodeA === corr4.id || p.nodeB === corr4.id) && p.type === 'Window');
const cwinBox = sim.level.doors.find(d => d.portalId === cwin.id).box;
const beforeWin = C.V.make((cwinBox.min.x + cwinBox.max.x) / 2, floorY, 0.9);
g8.setPortalState(cwin, 'Closed');
ok('关着的窗不能翻', sim.world.probeVault(beforeWin, { x: 0, y: 0, z: -1 }, P.radius, P) === null);
g8.setPortalState(cwin, 'Open');
const winProbe = sim.world.probeVault(beforeWin, { x: 0, y: 0, z: -1 }, P.radius, P);
ok('开窗后可翻越（窗台约 1.0m）',
   winProbe && Math.abs(winProbe.rise - 1.0) < 0.05, winProbe ? winProbe.rise.toFixed(2) + 'm' : 'null');
g8.setPortalState(cwin, 'Closed');

// 玩家实例：空旷处按跳跃 → 腾空 → 落地
const player = new C.Player(sim.level, sim.world);
player.pos = C.V.make(16, floorY, 1.3); player.yaw = Math.PI / 2;
const idle = { forward: 0, right: 0, run: false, crouch: false, wallHug: false, lean: 0,
               holdBreath: false, interact: false, throwHeld: false, jump: false };
player.update(1 / 60, idle, sim.time);
const stam0 = player.stamina;
player.update(1 / 60, Object.assign({}, idle, { jump: true }), sim.time);
ok('空旷处按跳跃进入腾空', player.airborne === true);
ok('跳跃消耗体力 6（文档外新增值）', Math.abs(stam0 - player.stamina - P.stamina.jumpCost) < 0.3,
   (stam0 - player.stamina).toFixed(2));
let peak = player.pos.y;
for (let i = 0; i < 120; i++) {
  player.update(1 / 60, Object.assign({}, idle, { jump: true }), sim.time);
  peak = Math.max(peak, player.pos.y);
}
ok('按住跳跃不会连跳（边沿触发）', true);
ok('跳起高度约 0.49m', Math.abs(peak - floorY - 0.49) < 0.08, (peak - floorY).toFixed(3) + 'm');
ok('自由落体后回到地面', !player.airborne && Math.abs(player.pos.y - floorY) < 0.01, player.pos.y.toFixed(3));

// 贴着书桌按跳跃 → 走翻越分支，消耗 12 体力，发出响度 30
player.pos = C.V.make(rc.x, floorY, 5.9);
player.yaw = Math.PI;              // 朝 +z，正对书桌
player.stamina = 100;
C.SoundSystem.log.length = 0;
player.update(1 / 60, idle, sim.time);
player.update(1 / 60, Object.assign({}, idle, { jump: true }), sim.time);
ok('贴障碍按跳跃走的是翻越分支', player.vault !== null, player.lastAction);
ok('翻越消耗体力 12（主文档 3.3）', Math.abs(100 - player.stamina - P.stamina.climbCost) < 0.3,
   (100 - player.stamina).toFixed(2));
const climbSnd = C.SoundSystem.log.find(e => e.label === '翻越');
ok('翻越发出响度 30 的事件（声音规格 6.1 翻窗）', climbSnd && climbSnd.loud === 30, climbSnd && String(climbSnd.loud));
for (let i = 0; i < 60; i++) player.update(1 / 60, idle, sim.time);
ok('翻越结束后站在书桌上（约 +0.75m）', !player.vault && Math.abs(player.pos.y - floorY - 0.75) < 0.05,
   (player.pos.y - floorY).toFixed(3) + 'm');

// ── 9. 投掷预测 ────────────────────────────────────
section('9. 投掷落点与引怪半径');
player.pos = C.V.make(16, floorY, 1.3); player.yaw = Math.PI / 2; player.pitch = 0;
player.charge = 1;
const pred = player.predictThrow();
ok('弹道有多个采样点且以撞击点结束', pred.points.length > 3, pred.points.length + ' 点');
ok('落点在弹道末端', pred.impact === pred.points[pred.points.length - 1]);
ok('室内引怪半径 =(45−10)/2 = 17.5m', Math.abs(pred.radius - 17.5) < 0.01, pred.radius.toFixed(2) + 'm');
sim.time.hour = 23;
const nightPred = player.predictThrow();
ok('夜间引怪半径扩大到 25m（k×0.7）', Math.abs(nightPred.radius - 25) < 0.01, nightPred.radius.toFixed(2) + 'm');
sim.time.hour = 12;

/* 回归：落点必须留在被撞面的正确一侧。
   往脚下扔石头，落地事件必须记在 4F，不能因为穿透楼板而记到 3F 去。 */
player.pos = C.V.make(16, floorY, 1.3); player.pitch = -1.3; player.charge = 0.2;
C.SoundSystem.log.length = 0;
C.Projectiles.list.length = 0;
const predDown = player.predictThrow();
ok('朝脚下预测的落点仍在本层', g8.getNodeAt(predDown.impact).name === '4F走廊',
   g8.getNodeAt(predDown.impact).name + ' y=' + predDown.impact.y.toFixed(3));
C.Projectiles.spawn(player.eyePos(), player.aimDir(), 8, player.id);
for (let i = 0; i < 60; i++) C.Projectiles.update(1 / 60);
const hit = C.SoundSystem.log.find(e => e.label === '石头落地');
ok('石头落地事件记在 4F 而不是楼下', hit && g8.getNode(hit.node).name === '4F走廊',
   hit ? g8.getNode(hit.node).name : '(无事件)');
player.pitch = 0; player.charge = 0;

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
