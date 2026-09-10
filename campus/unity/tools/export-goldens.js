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
                 '04-soundgraph', '05-soundsystem', '06-hearing', '07-time', '09-collision', '08-level']) {
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

const out = { graph, cases, snapshot, nightCurve, rngSeq,
              meta: { nodes: graph.nodes.length, portals: graph.portals.length, cases: cases.length } };
const file = path.join(__dirname, '..', 'Campus.Tests', 'goldens.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`已导出 ${cases.length} 个对拍用例 · ${graph.nodes.length} 节点 / ${graph.portals.length} Portal · ` +
            `快照 ${snapshot.length} 条 · 夜间曲线 ${nightCurve.length} 点 · ` +
            (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
