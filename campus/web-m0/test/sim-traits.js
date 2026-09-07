/*
 * 角色与特性的无头测试。跑法：node test/sim-traits.js
 *
 * 这一套盯的是三件事：
 *   ① **点数与互斥的规则**（选择界面靠它，写错了玩家能捏出非法角色）
 *   ② **特性真的通过管线生效**，而不是只写在表里好看
 *   ③ **规格 4.2 的硬约束**：业务代码里不许出现任何角色/特性的条件判断
 */
const path = require('path');
const fs = require('fs');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '21-items', '22-loot', '10-player', '11-zombie',
                 '24-campus', '25-streaming', '26-notebook',
                 '29-power', '30-cooking', '31-tutorial', '33-traits']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;
const K = C.Config;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');
const L = C.Loadout;
const fresh = (id) => { C.ModifierPipeline.clear(); L.reset(); if (id) L.selectCharacter(id); return L; };

section('1. 数据完整性');
{
  const ids = Object.keys(K.traits);
  const sel = ids.filter(i => !K.traits[i].fixed);
  ok('六个角色', K.characters.length === 6);
  ok('可选特性 53 条（正 28 / 负 25）',
     sel.length === 53 && sel.filter(i => K.traits[i].value > 0).length === 28,
     sel.length + '');

  const bad = [];
  for (const id of ids) {
    const t = K.traits[id];
    if (!t.name || !t.desc) bad.push(id + ':缺名字或说明');
    if (!t.fixed && (t.value === 0 || Math.abs(t.value) > K.traitRules.valueMax)) bad.push(id + ':数值越界');
    if (t.fixed && t.value !== 0) bad.push(id + ':固定特性的 value 必须是 0');
    for (const [key, mode] of (t.keys || [])) {
      if (['add', 'mul', 'set'].indexOf(mode) < 0) bad.push(id + ':未知模式 ' + mode);
      if (!/^[a-z]+[a-z_.]*\.[a-z_]+$/.test(key)) bad.push(id + ':key 格式不对 ' + key);
    }
  }
  ok('每条特性都有名字、说明、合法数值与合法 key', bad.length === 0, bad.join(' / '));

  // 角色引用的固定特性都得存在，物品也得存在
  const miss = [];
  for (const ch of K.characters) {
    for (const id of ch.fixed) if (!K.traits[id]) miss.push(ch.id + ' 引用了不存在的特性 ' + id);
    for (const id of ch.fixed) if (!K.traits[id].fixed) miss.push(ch.id + ' 引用了非固定特性 ' + id);
    for (const e of ch.items) { const i = Array.isArray(e) ? e[0] : e; if (!C.ITEMS[i]) miss.push(ch.id + ' 的物品 ' + i + ' 不存在'); }
    if (!K.campus.buildings.some(b => b.id === ch.spawn[0])) miss.push(ch.id + ' 的出生楼不存在');
  }
  ok('角色引用的特性、物品、出生楼全都存在', miss.length === 0, miss.join(' / '));

  /* **每个角色的开局物品必须放得进 5 格。** 快取位 0 被石头占着，
     放不下的会被静默丢掉 —— 那比少给一件东西更糟。 */
  const over = K.characters.filter(c => c.items.length > 5).map(c => c.id + ':' + c.items.length);
  ok('开局物品都放得进快取位（石头占 1 格，剩 5 格）', over.length === 0, over.join());

  ok('只有「睡过头的学生」支持新手教学',
     K.characters.filter(c => c.tutorial).map(c => c.id).join() === 'student');
}

section('2. 点数：正向花、负向返');
{
  fresh('student');
  ok('学生起始 5 点（全角色最高）', L.remaining() === 5);
  L.pick('catStep');                                   // +3
  ok('选了 3 点的正向 → 剩 2', L.remaining() === 2);
  L.pick('bigAppetite');                               // −4
  ok('选了 −4 的负向 → 返 4 点，剩 6', L.remaining() === 6, String(L.remaining()));
  L.unpick('bigAppetite');
  ok('退掉负向 → 点数还回去', L.remaining() === 2);

  fresh('guard');
  ok('保安起始 1 点（全角色最低）', L.remaining() === 1);
  ok('1 点买不起 4 点的特性', L.pick('ironMan').ok === false);
  ok('买不起时说清楚还差几点', L.canPick('ironMan').why.indexOf('还差 3') >= 0, L.canPick('ironMan').why);
  /* **负向永远可以选** —— 它是用来换点数的。
     挡住它等于挡住整个构筑玩法：先欠着，再用返的点去买正向。 */
  ok('负向不受点数限制', L.pick('bigAppetite').ok === true);
  ok('返点之后买得起了', L.pick('ironMan').ok === true, String(L.remaining()));
}

section('3. 互斥与名额');
{
  fresh('student');
  L.pick('sharpEars');
  const r = L.pick('keenEar');
  ok('同一互斥组只能选一个', r.ok === false && r.why.indexOf('冲突') >= 0, JSON.stringify(r));
  ok('冲突时说出是跟谁冲突', r.why.indexOf('天生耳力') >= 0, r.why);

  /* 角色固定特性也占互斥组。保安固定「耳背」，
     所以他这辈子都不可能是「天生耳力」—— 这正是他的角色定位。 */
  fresh('guard');
  const r2 = L.canPick('sharpEars');
  ok('角色固定特性也占互斥组', r2.ok === false && r2.why.indexOf('固定特性') >= 0, r2.why);

  fresh('student');
  // 正向上限 5：先堆负向换够点数
  for (const id of ['bigAppetite', 'needsWater', 'sleepyHead', 'heavyFoot']) L.pick(id);
  ok('负向已满 4 个', L.counts().neg === 4);
  const r3 = L.pick('myopia');
  ok('第 5 条负向被拦住', r3.ok === false && r3.why.indexOf('负向已满') >= 0, r3.why);
  /* 挑五条**和上面四条负向不冲突**的正向。
     耐渴/觉少 分别和「离不开水」「嗜睡」同组 —— 选了负向就等于把那一组用掉了，
     这本身也是构筑的一部分：**你不能既大胃口又吃得少。** */
  for (const id of ['catStep', 'longWind', 'strongBack', 'gourmet', 'neatPacker']) L.pick(id);
  ok('正向已满 5 个', L.counts().pos === 5, JSON.stringify(L.counts()));
  ok('第 6 条正向被拦住', L.pick('lightFoot').why.indexOf('正向已满') >= 0, L.canPick('lightFoot').why);

  /* 正负同组互斥是构筑的核心张力：**你不能既大胃口又吃得少。**
     单独验一次（上面那组名额已满，会先撞到「正向已满」那条消息）。 */
  fresh('student');
  L.pick('needsWater');
  ok('选了「离不开水」就不能再选「耐渴」',
     L.canPick('thirstProof').why.indexOf('冲突') >= 0, L.canPick('thirstProof').why);
}

section('4. 确认条件只有一条：剩余点数 ≥ 0');
{
  fresh('cook');                                       // 2 点
  L.pick('bigAppetite'); L.pick('ironMan');            // 返 4 花 4 → 剩 2
  ok('剩余 ≥ 0 可以开始', L.canConfirm().ok === true, String(L.remaining()));
  /* 退掉负向可能让点数变成负的（正向已经花出去了）。
     **这时候不阻止退，让数字变红** —— 玩家看得见自己欠多少，比按钮点不动好。 */
  L.unpick('bigAppetite');
  ok('退掉负向后点数可以为负', L.remaining() === -2, String(L.remaining()));
  ok('但确认会被拦住，并说明超了几点',
     L.canConfirm().ok === false && L.canConfirm().why.indexOf('超了 2') >= 0, L.canConfirm().why);
  fresh(); ok('没选角色不能开始', L.canConfirm().ok === false);
}

section('5. 换角色会清空已选');
{
  fresh('student');
  L.pick('bigAppetite'); L.pick('ironMan');
  L.selectCharacter('guard');
  /* 新角色的固定特性可能和已选的冲突，起始点数也变了。
     **留着一份非法配置比清空更糟。** */
  ok('换角色 → 已选清空', L.picked.length === 0);
  ok('换角色 → 点数按新角色算', L.remaining() === 1);
}

section('6. 特性真的通过管线生效');
{
  const q = (k, base, o) => C.ModifierPipeline.query(k, base, o === undefined ? 0 : o);

  fresh('student'); L.apply();
  const baseThirst = q('need.thirst_rate', 10);
  ok('学生没有口渴相关特性 → 速率不变', Math.abs(baseThirst - 10) < 1e-9, String(baseThirst));

  fresh('student'); L.pick('thirstProof'); L.apply();
  ok('耐渴 −20% 真的落在 need.thirst_rate 上', Math.abs(q('need.thirst_rate', 10) - 8) < 1e-9);

  fresh('guard'); L.apply();
  ok('保安固定耳背 → 听觉阈值 8 → 16', q('hearing.threshold', 8) === 16);
  ok('保安固定上了年纪 → 移动速度 ×0.945', Math.abs(q('move.speed', 100) - 94.5) < 1e-9);

  fresh('athlete'); L.apply();
  ok('体育队长 长跑底子 → 体力上限 +30', q('stamina.max', 100) === 130);
  ok('体育队长 大胃口 → 饥饿 ×1.35', Math.abs(q('need.hunger_rate', 1) - 1.35) < 1e-9);
  ok('体育队长 脚步重 → 脚步响度 ×1.2', Math.abs(q('sound.footstep', 20) - 24) < 1e-9);

  fresh('medic'); L.apply();
  ok('校医 手无缚鸡之力 → 体力上限 −25', q('stamina.max', 100) === 75);

  /* **固定特性也占互斥组。** 不占的话，后厨师傅能在「掌勺 3 级起步」上
     再叠一个「掌勺 2 级起步」花掉 3 点买了个寂寞，而界面上看不出任何问题。 */
  fresh('teacher');
  ok('固定「体弱」占住了体力上限组，自选体弱选不了', L.canPick('frail').ok === false, L.canPick('frail').why);
  ok('同组的长跑底子、铁人也一并挡住', L.canPick('longRunner').ok === false && L.canPick('ironMan').ok === false);
  fresh('cook');
  ok('固定「掌勺」占住烹饪组，自选掌勺选不了', L.canPick('chef').ok === false, L.canPick('chef').why);
  ok('但厨房杀手（同组）也选不了 —— 他不可能既是大厨又是杀手', L.canPick('kitchenBane').ok === false);

  // 叠加：固定 + 自选走同一个 key
  fresh('student'); L.pick('longRunner'); L.apply();
  ok('自选长跑底子 → 体力上限 +25', q('stamina.max', 100) === 125, String(q('stamina.max', 100)));

  // Override 模式
  fresh('student'); L.pick('deepSleeper'); L.apply();
  ok('睡得沉 → 睡眠中断阈值被覆盖成 35', q('sleep.interrupt_threshold', 15) === 35);
  fresh('student'); L.pick('lightSleeper'); L.apply();
  ok('浅眠 → 覆盖成 6', q('sleep.interrupt_threshold', 15) === 6);
}

section('7. 「N 级起步」只给等级，不给经验');
{
  C.Cooking.reset();
  fresh('cook'); L.apply();
  ok('后厨师傅烹饪 3 级起步', C.Cooking.level() === 3);
  /* **只给等级，不给经验**（规格 1.5）。写成「直接送 950 经验」的话，
     他做完两道新菜就跳到 4 级，等于把整条成长曲线送掉一半。 */
  ok('但经验条还是 0 —— 后续成长和常人一样', C.Cooking.xp === 0);
  C.Cooking.reset();
  fresh('student'); L.pick('chef'); L.apply();
  ok('自选掌勺 → 2 级起步', C.Cooking.level() === 2 && C.Cooking.xp === 0);
  C.Cooking.reset(); fresh(); L.selectCharacter('student'); L.apply();
  ok('换回没有掌勺的配置 → 回到 0 级', C.Cooking.level() === 0);
}

section('8. 卸载要卸干净');
{
  const q = (k, b) => C.ModifierPipeline.query(k, b, 0);
  C.ModifierPipeline.clear();
  L.reset().selectCharacter('athlete'); L.apply();
  ok('挂上了', q('need.hunger_rate', 1) > 1.3);
  L.unapply();
  /* 重开一局时管线会被 clear，但 unapply 也必须自己能卸干净 ——
     否则「换角色重开」会把上一局的特性叠进这一局，而且不报任何错。 */
  ok('卸载后管线回到干净状态', q('need.hunger_rate', 1) === 1);
  ok('卸载后起步等级也归零', C.Cooking.level() === 0);
}

section('9. 出生地不同 = 换一整个开局');
{
  const seen = {};
  for (const ch of K.characters) seen[ch.spawn[0]] = (seen[ch.spawn[0]] || 0) + 1;
  ok('六个角色出生在六栋不同的楼', Object.keys(seen).length === 6, JSON.stringify(seen));

  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  fresh('guard');
  const lv = C.buildCampus({ spawn: L.spawn(), tutorial: L.tutorialSupported() });
  C.Streaming.reset(lv);
  const guardB = lv.buildings.find(b => b.spec.id === 'guard');
  const inGuard = C.rectDist(guardB.footprint, lv.spawn.x, lv.spawn.z) <= 0.01;
  ok('选保安 → 出生点真的在保安室里', inGuard, JSON.stringify(lv.spawn));
  ok('保安出生在一楼', Math.abs(lv.spawn.y) < 0.5, String(lv.spawn.y));

  /* **教学分层只在走教学的那局铺。** 否则选了保安，
     男生宿舍楼会凭空只剩 2 只丧尸 —— 一栋空楼白送。 */
  const dormZ = lv.zombieSpawns.filter(z => z.buildingId === 'dormM').length;
  ok('不走教学时宿舍楼恢复正常密度（26 只）', dormZ === 26, String(dormZ));
  ok('丧尸总数仍然是 320', lv.zombieSpawns.length === K.campus.zombieTotal, String(lv.zombieSpawns.length));

  C.SoundSystem.reset(); C.ZombieManager.reset(); C.EventBus.clear();
  fresh('student');
  const lv2 = C.buildCampus({ spawn: L.spawn(), tutorial: true });
  const dormZ2 = lv2.zombieSpawns.filter(z => z.buildingId === 'dormM').length;
  ok('走教学时宿舍楼是分层的 2 只', dormZ2 === 2, String(dormZ2));
  ok('教学局总数也还是 320', lv2.zombieSpawns.length === K.campus.zombieTotal);
  ok('学生出生在四楼 402', Math.abs(lv2.spawn.y - 3 * K.level.floorHeight) < 0.5, String(lv2.spawn.y));

  // 出生楼的闸永远是断的（教学目标 3 靠它成立）
  const own = lv.circuits.find(c => c.id === 'circuit-guard');
  ok('出生楼的闸是断的 —— 不管出生在哪栋', own && own.breakerOn === false);
  ok('别的楼照常通电', lv.circuits.find(c => c.id === 'circuit-dormM').breakerOn === true);
}

section('10. 开局物品与出生点进游戏');
{
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  fresh('cook'); L.apply();
  const lv = C.buildCampus({ spawn: L.spawn(), tutorial: false });
  C.placeCampusContainers(lv); C.placeCampusLooseItems(lv);
  const world = new C.World(lv);
  const time = new C.TimeSystem();
  C.SoundSystem.init(lv.graph, time, (a, b) => world.lineOfSight(a, b));
  C.Streaming.reset(lv);
  const p = new C.Player(lv, world);
  const held = p.hotbar.filter(Boolean).map(i => i.id);
  ok('后厨师傅带着铁炒锅开局', held.indexOf('wok') >= 0, held.join());
  ok('米是两袋一格', (p.hotbar.find(i => i && i.id === 'riceBag') || {}).count === 2);
  ok('石头还在（不然按 G 什么也不发生）', held.indexOf('stone') >= 0);
  ok('六格快取位没被挤爆', p.hotbar.filter(Boolean).length <= 6);
  ok('腰不好 → 负重上限 20 → 16', p.weightLimit() === 16, String(p.weightLimit()));
}

section('11. 存档往返');
{
  fresh('teacher'); L.pick('catStep'); L.pick('bigAppetite');
  const raw = JSON.parse(JSON.stringify(L.serialize()));
  fresh();
  L.deserialize(raw);
  ok('角色还原', L.characterId === 'teacher');
  ok('已选特性还原', L.picked.join() === 'catStep,bigAppetite');
  ok('点数跟着还原', L.remaining() === 3 - 3 + 4, String(L.remaining()));
  L.deserialize({ characterId: 'teacher', picked: ['catStep', '不存在的特性'] });
  ok('**读到不认识的特性直接丢掉**，不让存档把游戏搞崩', L.picked.join() === 'catStep');
}

section('12. 硬约束：业务代码里不许出现角色/特性的条件判断');
{
  /* 规格 4.2。这条是整套系统能不能长期维护的关键：
     角色和特性开局把 modifiers 挂上管线，之后再不参与任何逻辑。
     **一旦有人写下 `if (character === 'guard')`，这条测试就该红。** */
  const allow = ['33-traits.js', '34-loadout-ui.js', '00-config.js', '16-main.js'];
  const hits = [];
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js') || allow.indexOf(f) >= 0) continue;
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    // 去掉注释再查，免得文档性说明触发误报
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /* 查的是**条件判断**，不是字符串出现。
       `[实测]` 只查 `'cook'` 会打到厨房界面的 `data-act="cook"` —— 那是按钮名，不是角色。
       真正违规的形状是拿角色 id 去比较。 */
    /* 和楼 id 撞名的角色（保安 = 保安室）跳过：
       `b.spec.id === 'guard'` 是合法的几何判断，不是按角色分支。 */
    const buildingIds = K.campus.buildings.map(b => b.id);
    for (const id of K.characters.map(c => c.id).filter(i => buildingIds.indexOf(i) < 0)) {
      const re = new RegExp("(===?|!==?)\\s*['\"]" + id + "['\"]|['\"]" + id + "['\"]\\s*(===?|!==?)");
      if (re.test(code)) hits.push(f + ' 拿角色 id ' + id + ' 做了条件判断');
    }
    if (/Loadout\.(character|picked|trait)\b/.test(code)) hits.push(f + ' 直接读了 Loadout 的角色状态');
  }
  ok('规则层与实体层里没有任何角色条件判断', hits.length === 0, hits.join(' / '));

  // 16-main 是装配层，允许提到角色，但也只允许在开局那几行
  const main = fs.readFileSync(path.join(SRC, '16-main.js'), 'utf8');
  ok('装配层只在 restart/start 里碰 Loadout',
     (main.match(/C\.Loadout\./g) || []).length <= 8, String((main.match(/C\.Loadout\./g) || []).length));
}

section('13. 未实装的特性要如实标出来');
{
  /* **骗玩家比缺功能更糟。** 战斗、伤势、幸存者、视觉模糊都是后面的里程碑，
     依赖它们的特性现在是哑的 —— 选择界面必须把「未实装」印在卡片上。 */
  const ids = Object.keys(K.traits);
  const live = ids.filter(i => K.traits[i].live);
  ok('每条特性都明确标了 live', ids.every(i => typeof K.traits[i].live === 'boolean'));
  ok('已接入的占多数', live.length > ids.length / 2, live.length + ' / ' + ids.length);

  /* 已接入 = 它的 key 必须真的有人 query，或者它靠 skill 起步等级生效。
     **表里写着「已接入」但全项目没人读那个 key，是最难发现的一种谎。** */
  const all = C.Config.characters.map(c => 0);  // 占位，下面用文件内容
  let queried = '';
  for (const f of fs.readdirSync(SRC)) if (f.endsWith('.js')) queried += fs.readFileSync(path.join(SRC, f), 'utf8');
  const dead = [];
  for (const id of live) {
    const t = K.traits[id];
    if (t.skill) continue;
    if (!t.keys) continue;
    for (const [key] of t.keys) {
      if (queried.indexOf("query('" + key + "'") < 0) dead.push(id + ' → ' + key);
    }
  }
  ok('标了「已接入」的特性，它的 key 全都真的有人 query', dead.length === 0, dead.join(' / '));

  // 反过来：标了未实装的，不该已经接上了（那是漏更新标记）
  const shouldBeLive = [];
  for (const id of ids.filter(i => !K.traits[i].live)) {
    const t = K.traits[id];
    if (!t.keys || t.flags || t.skill) continue;
    if (t.keys.every(([k]) => queried.indexOf("query('" + k + "'") >= 0)) shouldBeLive.push(id);
  }
  ok('标了「未实装」的特性确实还没人读它的 key', shouldBeLive.length === 0, shouldBeLive.join(' / '));
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
