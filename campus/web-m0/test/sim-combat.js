/*
 * 战斗与伤势的无头测试。跑法：node test/sim-combat.js
 *
 * 盯的是这一套的**设计判断**，不是伤害数字：
 *   ① 单体威胁来自「退不掉」，不是「打得疼」
 *   ② 战斗不是解法，是失败的代价（挥击比追击低吼还响，挥空也响）
 *   ③ 弹弓不是武器（一把静音远程武器会拆掉支柱一）
 *   ④ 受伤是要养好几天的状态，不是一场战斗内的资源
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '19-sleep', '21-items', '22-loot', '10-player', '11-zombie',
                 '24-campus', '25-streaming', '26-notebook', '29-power', '30-cooking',
                 '31-tutorial', '33-traits', '35-outlets', '38-placement',
                 '40-combat', '41-injury', '20-save']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;
const K = C.Config;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function sim() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  C.Loadout.reset().selectCharacter('student'); C.Loadout.apply();
  const level = C.buildDormitory();
  C.placeContainers(level); C.placeLooseItems(level);
  const world = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time, (a, b) => world.lineOfSight(a, b));
  C.Power.reset(level); C.Cooking.reset(); C.Outlets.reset(); C.Placement.reset();
  C.Combat.reset(); C.Injury.reset(0);
  const player = new C.Player(level, world);
  C.ZombieManager.spawnAll(level, world);
  return { level, world, time, player, zombies: C.ZombieManager.list };
}
/** 造一只贴在玩家身边的丧尸 */
function zombieAt(s, type, dx, dz) {
  const z = s.zombies[0];
  z.pos = { x: s.player.pos.x + (dx || 0), y: s.player.pos.y, z: s.player.pos.z + (dz || 0) };
  z.alive = true; z.hp = 100;
  if (type) z.typeName = type;
  return z;
}

section('1. 单体威胁来自「退不掉」，不是「打得疼」');
{
  /* **这是整套战斗的核心判断。**
     游荡者追击 2.7 m/s < 玩家奔跑 4.6 m/s —— 玩家永远能退。
     所以把单体伤害调到 50 也没用，只会得到「一对一绝对安全、
     一对多瞬间暴毙」的断崖，中间没有过渡。 */
  ok('丧尸追不上跑起来的玩家', K.zombieTypes.Wanderer.speedChase < K.player.speedRun,
     K.zombieTypes.Wanderer.speedChase + ' < ' + K.player.speedRun);
  const g = K.combat.grabs.Wanderer;
  ok('所以单次咬伤不高（一口 14，可用生命 ~70）', g.bite <= 20, String(g.bite));
  /* 真正的杀伤力是**它把你钉在原地并让你大声呼痛** —— 那几秒足够别的丧尸赶到。 */
  ok('被抓住时呼痛响度 60，和「玩家受伤」同级',
     K.combat.grab.cryLoudness === K.loudness.playerHurt, String(K.combat.grab.cryLoudness));
  ok('呼痛比追击低吼还响 —— 它在把整层楼叫过来',
     K.combat.grab.cryLoudness > K.loudness.zombieGrowl,
     K.combat.grab.cryLoudness + ' > ' + K.loudness.zombieGrowl);
  ok('抓住最长 4 秒 —— 这就是「容错窗口」的长度', g.hold === 4.0, String(g.hold));

  // 三种丧尸的抓法不同：越晚出现的越狠
  const G = K.combat.grabs;
  ok('奔行者咬得最疼、抓得最短、还会撞倒',
     G.Runner.bite > G.Wanderer.bite && G.Runner.hold < G.Wanderer.hold && G.Runner.knockdown > 0);
  ok('蜷伏者抓脚踝 —— 它趴着，这是它唯一合理的攻击方式', G.Crawler.knockdown > 0);
}

section('2. 抓取：钉住 · 挨咬 · 呼痛 · 挣脱');
{
  const s = sim();
  const z = zombieAt(s, 'Wanderer', 0.5, 0);
  const cries = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (e.label === '呼痛') cries.push(e); });

  ok('贴身就会被抓住', C.Combat.tryGrab(z, s.player) === true);
  ok('同一时刻只能被一只抓着', C.Combat.tryGrab(s.zombies[1], s.player) === false);
  ok('被抓住时不能移动', C.Combat.moveMul() === 0);
  ok('被抓住时挥不了武器', C.Combat.attack(s.player, s.zombies).ok === false);

  const hp0 = s.player.needs.health;
  for (let i = 0; i < 20; i++) C.Combat.update(0.1, s.player, s.zombies);   // 2 秒
  ok('挨了咬', s.player.needs.health < hp0, hp0 + ' → ' + s.player.needs.health.toFixed(0));
  ok('被咬会流血', C.Injury.bleedHours > 0);
  ok('每秒呼痛一次', cries.length >= 2, String(cries.length));
  ok('呼痛是从玩家位置发出去的', C.V.dist(cries[0].worldPosition, s.player.pos) < 0.01);

  // 挣脱：连打才有用
  const st0 = C.Combat.grabbedBy.struggle;
  C.Combat.struggle(s.player);
  ok('按一下有进度', C.Combat.grabbedBy.struggle > st0);
  C.Combat.update(1.0, s.player, s.zombies);
  ok('不按会衰减 —— **连打才有用**', C.Combat.grabbedBy === null || C.Combat.grabbedBy.struggle < 34);

  const s2 = sim();
  const z2 = zombieAt(s2, 'Wanderer', 0.5, 0);
  C.Combat.tryGrab(z2, s2.player);
  s2.player.stamina = 100;
  let n = 0;
  while (C.Combat.grabbedBy && n < 10) { C.Combat.struggle(s2.player); n++; }
  ok('连打三下能挣脱', C.Combat.grabbedBy === null && n <= 3, String(n));
  ok('挣脱消耗体力', s2.player.stamina < 100, s2.player.stamina.toFixed(0));

  /* **体力管理在这里最锋利**：没力气就挣不动，而没力气正是因为你刚才跑了。 */
  const s3 = sim();
  const z3 = zombieAt(s3, 'Wanderer', 0.5, 0);
  C.Combat.tryGrab(z3, s3.player);
  s3.player.stamina = 0;
  C.Combat.struggle(s3.player);
  ok('没体力时挣脱效率大降',
     C.Combat.grabbedBy.struggle < K.combat.grab.struggleGain,
     C.Combat.grabbedBy.struggle.toFixed(1) + ' < ' + K.combat.grab.struggleGain);

  // 抓不住那么久也会松手
  const s4 = sim();
  const z4 = zombieAt(s4, 'Wanderer', 0.5, 0);
  s4.player.needs.health = 100;
  C.Combat.tryGrab(z4, s4.player);
  for (let i = 0; i < 60 && C.Combat.grabbedBy; i++) C.Combat.update(0.1, s4.player, s4.zombies);
  ok('到时间它会松手（不是必死）', C.Combat.grabbedBy === null);
  ok('松手后有冷却，不会下一帧又抓住', C.Combat.tryGrab(z4, s4.player) === false);
}

section('3. 战斗不是解法，是失败的代价');
{
  const s = sim();
  const heard = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (/挥/.test(e.label || '')) heard.push(e); });
  const z = zombieAt(s, 'Wanderer', 0, -1.0);
  s.player.yaw = 0;                                   // 面朝 −z
  s.player.stamina = 100;

  const w = C.Combat.weaponOf(s.player);
  ok('身上没武器就是徒手', w.id === 'fist');
  ok('徒手伤害很低', w.def.damage <= 8, String(w.def.damage));

  C.Combat.attack(s.player, s.zombies);
  ok('抬手期间几乎不能动', C.Combat.moveMul() < 0.5, String(C.Combat.moveMul()));
  C.Combat.update(w.def.windup + 0.01, s.player, s.zombies);
  ok('抬手结束才结算命中', z.hp < 100, String(z.hp));
  ok('挥击有声音', heard.length === 1);
  /* 每一次挥击都至少和翻找一样响（40），**重武器比追击低吼还响（≥55）** ——
     斧头砍下去的动静就该比拳头大。这条比「一律 55」更符合直觉，
     也让「拿刀还是拿斧」变成一个要考虑噪音的决定。 */
  ok('徒手挥击至少和翻找一样响', heard[0].loudness >= K.loudness.lootFast,
     heard[0].loudness + ' vs ' + K.loudness.lootFast);
  const heavy = ['pitchfork', 'bat', 'axe'];
  ok('重武器响度 ≥ 追击低吼 —— **它在把人叫过来**',
     heavy.every(id => K.combat.weapons[id].loud >= K.loudness.zombieGrowl),
     heavy.map(id => id + ':' + K.combat.weapons[id].loud).join(' '));
  ok('轻武器安静一些（水果刀 45 < 55）', K.combat.weapons.knife.loud < K.loudness.zombieGrowl);

  /* **挥空也响。** 否则玩家会用「反正没打中」来免费试探。 */
  const s2 = sim();
  const heard2 = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (/挥/.test(e.label || '')) heard2.push(e); });
  s2.zombies.forEach(z2 => { z2.pos = { x: 999, y: 0, z: 999 }; });
  s2.player.stamina = 100;
  C.Combat.attack(s2.player, s2.zombies);
  C.Combat.update(0.5, s2.player, s2.zombies);
  ok('挥空一样响', heard2.length === 1 && /挥空/.test(heard2[0].label), JSON.stringify(heard2.map(h => h.label)));

  ok('没体力挥不动', (() => { const s3 = sim(); s3.player.stamina = 0;
    return C.Combat.attack(s3.player, s3.zombies).ok === false; })());
}

section('4. 武器：地点即难度，高阶的都在远而危险的地方');
{
  const W = K.combat.weapons;
  ok('六种武器', Object.keys(W).length === 6);
  /* **伤害越高，抬手越慢、越响。** 消防斧一下 55，但抬手 0.95 秒、响度 60。 */
  const list = Object.values(W).filter(x => x.damage > 0);
  const sorted = list.slice().sort((a, b) => a.damage - b.damage);
  ok('伤害越高抬手越慢', sorted.every((w, i) => i === 0 || w.windup >= sorted[i - 1].windup),
     sorted.map(w => w.name + ':' + w.windup).join(' '));
  ok('伤害越高越响', sorted.every((w, i) => i === 0 || w.loud >= sorted[i - 1].loud));
  ok('最强的消防斧一下 55，够杀掉半只游荡者', W.axe.damage === 55);
  ok('水果刀要挥五下才能杀掉一只（100 血 / 22）', Math.ceil(100 / W.knife.damage) === 5);

  // 地点即难度：高阶武器只出现在固定放置或后期建筑的池子里
  const lv = C.buildCampus(); C.placeCampusContainers(lv);
  const where = {};
  for (const b of lv.containers) for (const it of b.grid.items) {
    if (W[it.id]) (where[it.id] = where[it.id] || new Set()).add(b.roomName.replace(/\d+$/, ''));
  }
  ok('消防斧只在锅炉房', where.axe && [...where.axe].join() === '锅', JSON.stringify([...(where.axe||[])]));
  ok('钢叉/警棍只在保安室', [...(where.pitchfork||[])].join() === '保' && [...(where.baton||[])].join() === '保');
  ok('棒球棍只在体育馆', [...(where.bat||[])].join() === '体');
  ok('水果刀在宿舍 —— 前期唯一的武器', where.knife && [...where.knife].join() === '男');
  ok('固定放置没有一件塞不下（唯一物品不能悄悄消失）',
     C.fixedLootOverflow.length === 0, JSON.stringify(C.fixedLootOverflow));
}

section('5. 处决：战斗唯一一次比它引来的麻烦更划算');
{
  const s = sim();
  const heard = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (/处决|挥/.test(e.label || '')) heard.push(e); });
  s.player.hotbar[1] = C.makeItem('knife');
  const z = zombieAt(s, 'Wanderer', 0, -0.8);
  /* 朝向：forward = (−sin(yaw), −cos(yaw))。玩家在丧尸的 +z 侧，
     所以丧尸要朝 −z（yaw = 0）才算「背对玩家」。 */
  z.yaw = 0; s.player.yaw = 0;
  s.player.stamina = 100;
  z.state = '游荡';

  const r = C.Combat.attack(s.player, s.zombies);
  ok('从背后偷袭 = 处决', r.execute === true, JSON.stringify(r));
  ok('秒杀', z.alive === false);
  ok('响度只有 30，远低于挥击的 45+',
     heard[0].loudness === K.combat.execute.loud && heard[0].loudness < K.combat.weapons.knife.loud,
     String(heard[0].loudness));

  /* **它必须没察觉你。** 一旦进入追击/调查，背后偷袭就不算数了 ——
     否则「绕到背后处决」会变成对付任何一只丧尸的万能解。 */
  const s2 = sim();
  s2.player.hotbar[1] = C.makeItem('knife');
  const z2 = zombieAt(s2, 'Wanderer', 0, -0.8);
  z2.yaw = 0; s2.player.yaw = 0; s2.player.stamina = 100;
  z2.state = '追击';
  ok('它已经在追你了就不能处决', C.Combat.attack(s2.player, s2.zombies).execute !== true);

  // 徒手不能处决
  const s3 = sim();
  const z3 = zombieAt(s3, 'Wanderer', 0, -0.8);
  z3.yaw = 0; s3.player.yaw = 0; s3.player.stamina = 100; z3.state = '游荡';
  ok('徒手不能处决', C.Combat.attack(s3.player, s3.zombies).execute !== true);
  ok('警棍也不能（钝器捅不进去）', K.combat.weapons.baton.exec === false);
}

section('6. 弹弓不是武器');
{
  /* **一把能无声杀伤的远程武器会拆掉支柱一。**
     潜行游戏一旦有静音狙击，最优解永远是「站远点一个一个点掉」，
     声音系统就退化成背景装饰。 */
  ok('弹弓不在武器表里', K.combat.weapons.slingshot === undefined);
  ok('弹弓伤害是 0', K.combat.slingshot.damage === 0);
  ok('它做的是「更远更准的投石」', K.combat.slingshot.speedMul > 1 && K.combat.slingshot.spreadMul < 1,
     JSON.stringify(K.combat.slingshot));
  ok('钢珠比石头轻得多（能多带）',
     C.ITEMS.pellet.weight < C.ITEMS.stone.weight, C.ITEMS.pellet.weight + ' < ' + C.ITEMS.stone.weight);
  ok('弹弓的 kind 是 tool 不是 weapon', C.ITEMS.slingshot.kind === 'tool');
  ok('石头落地仍然是响度 45 —— 那才是它的作用', K.loudness.stoneImpact === 45);
}

section('7. 耐久：武器会用坏');
{
  const s = sim();
  s.player.hotbar[1] = C.makeItem('knife');
  const w = C.Combat.weaponOf(s.player);
  ok('拿起水果刀', w.id === 'knife');
  ok('初始耐久 40', C.Combat.durabilityOf(w) === 40);
  ok('徒手没有耐久概念', C.Combat.durabilityOf({ id: 'fist', def: K.combat.weapons.fist }) === Infinity);

  for (let i = 0; i < 39; i++) C.Combat._spend(w, s.player, 1);
  ok('用了 39 下还在', s.player.hotbar.some(x => x && x.id === 'knife'), String(C.Combat.durabilityOf(w)));
  const broke = C.Combat._spend(w, s.player, 1);
  ok('第 40 下断了', broke === true);
  ok('断了就从身上消失', !s.player.hotbar.some(x => x && x.id === 'knife'));
}

section('8. 伤势：受伤是要养好几天的状态');
{
  const s = sim();
  const n = s.player.needs;
  n.health = 100;
  /* **吃喝不回血**（见 §5）—— 所以出血/骨折/感染都不是一场战斗内的资源。 */
  const before = n.health;
  n.consume('water');
  ok('喝水不回血', n.health === before);

  // 出血：立刻、可逆、便宜
  C.Injury.reset(0);
  C.Injury.bite(n, 14, new C.Rng(1));
  ok('被咬会流血', C.Injury.bleedHours > 0, String(C.Injury.bleedHours));
  const h1 = n.health;
  C.Injury.update(2, n);
  ok('流血持续掉血', n.health < h1, h1.toFixed(0) + ' → ' + n.health.toFixed(0));
  ok('绷带能止血', C.Injury.bandage(n).ok === true);

  // 骨折：惩罚的是跌落，不是战斗
  C.Injury.reset(0);
  ok('小高度掉下来不骨折', C.Injury.fall(n, 1.0, new C.Rng(1)).fractured === false);
  C.Injury.fracture();
  ok('骨折后移动大幅变慢', C.Injury.speedMul() === K.injury.fractureSpeedMul);
  ok('要养四天', C.Injury.fractureHours === K.injury.fractureHealHours);
  C.Injury.splint();
  ok('夹板能缩短到 1.6 天', Math.abs(C.Injury.fractureHours - 96 * 0.4) < 0.01, String(C.Injury.fractureHours));
  ok('上了夹板走得快一些但仍然慢', C.Injury.speedMul() > K.injury.fractureSpeedMul && C.Injury.speedMul() < 1);

  // 感染：延迟发作，全游戏最致命
  C.Injury.reset(0);
  let got = false;
  for (let i = 0; i < 30 && !got; i++) { C.Injury.reset(0); got = C.Injury.bite(n, 10, new C.Rng(i + 7)).infected; }
  ok('被咬有概率感染', got === true);
  ok('有 30 小时潜伏期', C.Injury.infectionHours === K.injury.incubationHours);
  /* 单独验潜伏期：**先把出血清掉**，否则掉的血是流血掉的，测不到感染这一条。 */
  C.Injury.bleedHours = 0;
  const h2 = n.health;
  C.Injury.update(10, n);
  ok('潜伏期内不掉血', n.health === h2, h2 + ' vs ' + n.health);
  /* **一次 update 跨过发作那一刻，两边都要结算。**
     不这样的话睡一觉（8 小时、时间 ×90）会把整段感染伤害吞掉，
     玩家睡醒一滴血没掉，然后以为感染是假的。 */
  n.health = 100;
  C.Injury.update(25, n);
  ok('一步跨过发作时刻，后半段的伤害不会丢', n.health < 100, String(n.health));
  const h3 = n.health;
  C.Injury.update(4, n);
  ok('发作后每小时掉 2.5',
     Math.abs((h3 - n.health) - K.injury.infectedHealthPerHour * 4) < 0.01,
     (h3 - n.health).toFixed(1));
  /* **抗生素不是必成功的** —— 15% 失败率意味着「我有一支抗生素」
     不等于「我安全了」，玩家仍然要避免被咬。 */
  ok('抗生素有失败的可能', K.injury.antibioticCureChance < 1, String(K.injury.antibioticCureChance));
  let cured = false;
  for (let i = 0; i < 20 && !cured; i++) cured = C.Injury.antibiotic(new C.Rng(i + 1)).ok;
  ok('抗生素能治好', cured === true && C.Injury.infected === false);
}

section('9. 特性真的接上了战斗与伤势');
{
  const q = (k, b) => C.ModifierPipeline.query(k, b, 0);
  const fresh = (id, picks) => {
    C.ModifierPipeline.clear(); C.Loadout.reset().selectCharacter(id);
    for (const p of picks || []) C.Loadout.pick(p);
    C.Loadout.apply();
  };
  fresh('student', ['infectProof']);
  ok('抗感染 → 感染概率 60% → 30%', Math.abs(q('injury.infection_chance', 0.6) - 0.3) < 1e-9);
  fresh('student', ['easyInfect']);
  ok('易感染 → 60% → 85%', Math.abs(q('injury.infection_chance', 0.6) - 0.85) < 0.01,
     String(q('injury.infection_chance', 0.6)));
  fresh('student', ['bleeder']);
  ok('血友 → 出血速度 ×2', q('injury.bleed_rate', 6) === 12);
  fresh('student', ['thickSkin']);
  ok('皮实 → 出血速度 −50%', q('injury.bleed_rate', 6) === 3);
  fresh('guard');
  ok('保安固定「有家伙」→ 近战伤害 +15%', Math.abs(q('combat.melee_damage', 100) - 115) < 1e-9);
  ok('并且耐久消耗 −25%', Math.abs(q('combat.durability_cost', 1) - 0.75) < 1e-9);
  fresh('medic');
  ok('校医「手无缚鸡之力」→ 近战伤害 −30%', Math.abs(q('combat.melee_damage', 100) - 70) < 1e-9);
  ok('校医「会包扎」→ 出血 −60%', Math.abs(q('injury.bleed_rate', 10) - 4) < 1e-9);
  fresh('student', ['painful']);
  ok('怕疼 → 被抓住时呼痛 60 → 80', q('injury.cry_loudness', 60) === 80);

  const T = C.Config.traits, ids = Object.keys(T);
  ok('已接入的特性从 41 涨到 52', ids.filter(i => T[i].live).length === 52,
     String(ids.filter(i => T[i].live).length));
}

section('10. 战斗与伤势进存档');
{
  const s = sim();
  s.player.hotbar[1] = C.makeItem('knife');
  const w = C.Combat.weaponOf(s.player);
  C.Combat._spend(w, s.player, 5);
  C.Injury.reset(0); C.Injury.fracture(); C.Injury.bleedHours = 3;
  const raw = JSON.parse(JSON.stringify(C.Save.build({ player: s.player, time: s.time, level: s.level })));
  ok('耐久进存档', raw.combat && raw.combat.durability.knife === 35, JSON.stringify(raw.combat));
  ok('伤势进存档', raw.injury && raw.injury.fractured === true && raw.injury.bleedHours === 3);

  C.Combat.reset(); C.Injury.reset(0);
  C.Save.apply({ player: s.player, time: s.time, level: s.level }, raw);
  ok('耐久还原', C.Combat.durability.knife === 35);
  ok('伤势还原', C.Injury.fractured === true && C.Injury.bleedHours === 3);
  /* 读档不该还被抓着 —— 那是一个「正在发生的动作」，不是状态。 */
  ok('读档后不会还被抓着', C.Combat.grabbedBy === null);
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
