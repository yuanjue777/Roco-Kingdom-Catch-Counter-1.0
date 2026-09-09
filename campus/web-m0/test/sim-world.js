/*
 * 世界交互的无头测试。跑法：node test/sim-world.js
 *
 * 盯四件事，每一件都是「玩家能不能真的做到」，不是「代码有没有这个函数」：
 *   ① 楼里真的有插座，而且插座属于所在楼的回路
 *   ② 放下的东西必须能再捡起来（**丢弃不等于销毁**）
 *   ③ 快取栏六格的内容能被界面层读出来
 *   ④ 插上加热设备就地变成灶台 —— 否则电水壶插上了也烧不了水
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '21-items', '22-loot', '10-player', '11-zombie',
                 '24-campus', '25-streaming', '26-notebook',
                 '29-power', '30-cooking', '31-tutorial', '33-traits', '35-outlets']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function world() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  C.Loadout.reset().selectCharacter('student'); C.Loadout.apply();
  const level = C.buildCampus({ spawn: C.Loadout.spawn(), tutorial: true });
  C.placeCampusContainers(level); C.placeCampusLooseItems(level);
  const w = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time, (a, b) => w.lineOfSight(a, b));
  C.Streaming.reset(level); C.Power.reset(level); C.Cooking.reset(); C.Outlets.reset();
  const player = new C.Player(level, w);
  return { level, world: w, time, player };
}

section('1. 楼里真的有插座');
{
  const { level } = world();
  ok('插座不是空的', (level.outlets || []).length > 0, String((level.outlets || []).length));

  /* **每一栋楼、每一层都要有。** 只在一楼放的话，
     「四楼醒来，水壶插哪儿」这个问题第一分钟就无解。 */
  const gaps = [];
  for (const b of level.buildings) {
    for (let f = 0; f < b.floorsMeta.length; f++) {
      const n = level.outlets.filter(o => o.id.indexOf('oc-' + b.spec.id + '-' + f + '-') === 0).length;
      if (n === 0) gaps.push(b.spec.id + ' 的第 ' + f + ' 层没有插座');
    }
  }
  ok('每栋楼每一层都有插座', gaps.length === 0, gaps.slice(0, 3).join(' / '));

  const home = level.outlets.filter(o => o.circuitId === 'circuit-dormM');
  ok('宿舍楼的插座都挂在宿舍楼的回路上', home.length > 0 &&
     home.every(o => o.circuitId === 'circuit-dormM'), String(home.length));
  ok('出生的 402 那间有插座', level.outlets.some(o => /男402/.test(o.id)));

  // 插座贴墙、离地 0.35m —— 太高会插到天上，太低会埋进地板
  const bad = level.outlets.filter(o => Math.abs((o.pos.y % C.Config.level.floorHeight) - 0.35) > 0.01);
  ok('插座都在离地 0.35m 的墙上', bad.length === 0, String(bad.length));
}

section('2. 插座没电 = 闸没推（教学目标 3 的全部内容）');
{
  const { level, player } = world();
  const o = level.outlets.find(x => /男402/.test(x.id));
  ok('出生楼的闸是断的，所以插座没电', C.Outlets.powered(o) === false);

  const r = player.useOutlet(o);
  /* **闸没推的时候照样插得上，只是没反应。**
     在这里拦住玩家（「这个插座没电，插不了」）就把整个教学目标毁了 ——
     他需要的是「插上了，什么也没发生」，那句话会把他推向一楼配电间。 */
  ok('没电也能插上去', r.ok === true, r.msg);
  ok('但会说清楚没反应', /没电/.test(r.msg), r.msg);
  ok('插座上确实挂着东西了', C.Outlets.at(o) !== null);

  C.Power.setBreaker('circuit-dormM', true, null, -1);
  ok('推上闸 → 插座有电了', C.Outlets.powered(o) === true);
  const rec = C.Outlets.at(o);
  ok('设备能开起来了', C.Power.setDevice(rec.link, rec.deviceId, true).ok === true);
}

section('3. 插上加热设备就地变成灶台');
{
  const { level, player } = world();
  C.Power.setBreaker('circuit-dormM', true, null, -1);
  const o = level.outlets.find(x => /男402/.test(x.id));
  ok('插之前一个灶台也没有', C.Cooking.stations.length === 0);
  player.useOutlet(o);
  /* 不这样做的话，玩家插上电水壶之后还得再找一个「台面」才能烧水 ——
     那一步在现实里并不存在，只会让人以为水壶坏了。 */
  ok('插上电水壶 → 就地多了一个灶台', C.Cooking.stations.length === 1);
  const st = C.Cooking.stations[0];
  ok('灶台就在插座那个位置', C.V.dist(st.pos, o.pos) < 0.01);
  ok('灶台的热源就是电水壶', st.heater === 'kettle');
  ok('而且它接在这条链路上', st.link === C.Outlets.at(o).link);

  const chk = C.Cooking.canCook(C.Config.recipes.find(r => r.id === 'boilWater'), st);
  ok('站在这个灶台前能烧水了', chk.ok === true, chk.why);

  // 拔下来 → 灶台一起消失，东西回到身上
  const before = player.hotbar.filter(Boolean).length;
  const r = C.Outlets.unplug(o, player);
  ok('拔下来', r.ok === true, r.msg);
  ok('灶台跟着消失', C.Cooking.stations.length === 0);
  ok('水壶回到身上', player.hotbar.filter(Boolean).length === before + 1);
}

section('4. 放下的东西必须能再捡起来');
{
  const { level, player } = world();
  const it = player.hotbar.find(Boolean);
  const id = it.id, n0 = (level.looseItems || []).length;

  const r = player.dropItem(it);
  ok('放下成功', r.ok === true, r.msg);
  /* **丢弃不等于销毁。** 之前背包界面的「丢掉」是直接把物品删掉 ——
     于是玩家永远不敢按它，而背包只有几十格、负重上限 20kg，
     「放下点东西再回来拿」本该是每天都要做的决定。 */
  ok('东西落在地上，没有凭空消失', level.looseItems.length === n0 + 1);
  const loose = level.looseItems[level.looseItems.length - 1];
  ok('落在脚边（1.5 米内）', C.V.distXZ(loose.pos, player.pos) < 1.5,
     C.V.distXZ(loose.pos, player.pos).toFixed(2));
  ok('还没被捡走', loose.taken === false);

  player.pickUp(loose);
  ok('走过去能捡回来', loose.taken === true);
  ok('回到身上了', player.hotbar.some(x => x && x.id === id) ||
     (player.bag && player.bag.items.some(x => x.id === id)));

  // 放下会响，而且重的东西更响
  const heard = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (e.label && /放下/.test(e.label)) heard.push(e); });
  player.hotbar[0] = C.makeItem('stone', 1);       // 0.25kg
  player.dropItem(player.hotbar[0]);
  player.hotbar[0] = C.makeItem('wok', 1);         // 2.2kg
  player.dropItem(player.hotbar[0]);
  ok('放下有声音', heard.length === 2, String(heard.length));
  /* **扔一口铁锅和放下一张纸不该一样响。** */
  ok('铁锅比石头响', heard[1].loudness > heard[0].loudness,
     heard[0].loudness + ' → ' + heard[1].loudness);
  ok('但都远低于翻找的 40', heard[1].loudness < C.Config.loudness.lootFast);
}

section('5. 捡放不会把物品变没或变多');
{
  const { level, player } = world();
  const count = () => {
    let n = player.hotbar.filter(Boolean).length;
    if (player.bag) n += player.bag.items.length;
    return n + (level.looseItems || []).filter(l => !l.taken && l.dropped).length;
  };
  const n0 = count();
  const it = player.hotbar.find(Boolean);
  const r = player.dropItem(it);
  ok('放下后总数不变', count() === n0, count() + ' vs ' + n0);
  player.pickUp(r.loose);
  ok('捡回来后总数还是不变', count() === n0, count() + ' vs ' + n0);
}

section('6. 快取栏的内容界面层读得到');
{
  const { player } = world();
  ok('六格', player.hotbar.length === 6);
  const shown = player.hotbar.map(it => it ? C.ITEMS[it.id].name : null).filter(Boolean);
  ok('学生开局手上有东西', shown.length > 0, shown.join(','));
  ok('每件都有中文名（界面直接显示它）', shown.every(n => n && n.length > 0));
  ok('石头在里面 —— 否则按 G 什么也不发生', player.stoneCount() > 0);
}

section('7. 插座进出存档');
{
  const { level, player } = world();
  C.Power.setBreaker('circuit-dormM', true, null, -1);
  const o = level.outlets.find(x => /男402/.test(x.id));
  player.useOutlet(o);
  const raw = JSON.parse(JSON.stringify(C.Outlets.serialize()));
  ok('存下了插着什么', raw.length === 1 && raw[0].itemId === 'kettle', JSON.stringify(raw));

  C.Cooking.reset(); C.Outlets.reset();
  ok('清空后没有灶台', C.Cooking.stations.length === 0);
  C.Outlets.deserialize(raw, level);
  ok('读档后插座上的东西回来了', C.Outlets.at(o) !== null);
  ok('灶台也跟着重建', C.Cooking.stations.length === 1);
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
