/*
 * 20-save.js —— 存档（主文档 11.5）
 * 单存档、随时保存、死亡删除。JSON 便于调试。版本号写进存档头，不兼容时明确提示而不是崩溃。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const KEY = 'campus-save-v1';
  const VERSION = 2;   // v2：加了背包/容器/笔记本，v1 存档不再兼容

  C.Save = {
    version: VERSION,

    build(game) {
      const p = game.player, t = game.time;
      return {
        version: VERSION,
        savedAt: new Date().toISOString(),
        time: { day: t.day, hour: t.hour, totalGameSeconds: t.totalGameSeconds },
        player: {
          pos: C.V.copy(p.pos), yaw: p.yaw, pitch: p.pitch,
          stamina: p.stamina, stones: p.stones, flashlight: p.flashlight,
          needs: p.needs.serialize(), items: p.items,
          // 背包与快取栏：格子布局要一起存，否则读档后拼图全乱
          bagItemId: p.bagItemId || null,
          bag: p.bag ? p.bag.serialize() : null,
          hotbar: (p.hotbar || []).map(it => (it ? { id: it.id, count: it.count } : null))
        },
        // 容器：只存翻过的（opened），没翻过的按固定种子重新生成即可
        containers: (game.level.containers || [])
          .filter(b => b.opened)
          .map(b => ({ id: b.id, revealed: b.revealed, grid: b.grid.serialize() })),
        loose: (game.level.looseItems || [])
          .map((l, i) => (l.taken ? i : -1)).filter(i => i >= 0),
        notebook: C.Notebook.serialize(),
        skills: JSON.parse(JSON.stringify(C.Config.skills)),
        // 丧尸：ID、类型、位置、生命、行为状态、目标点
        zombies: C.ZombieManager.list.map(z => ({
          id: z.id, type: z.typeName, pos: C.V.copy(z.pos), yaw: z.yaw,
          hp: z.hp, alive: z.alive, state: z.state, homeNodeId: z.homeNodeId,
          target: z.target ? C.V.copy(z.target) : null
        })),
        // 只存与出厂状态不同的 Portal，存档小且改地图后仍能读
        portals: game.level.graph.portals
          .map((p2, i) => ({ i, s: p2.state }))
          .filter(r => r.s !== game.level.portalInitialStates[r.i])
      };
    },

    save(game) {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.build(game)));
        return { ok: true };
      } catch (e) { return { ok: false, msg: String(e) }; }
    },

    read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (d.version !== VERSION) return { incompatible: true, version: d.version };
        return d;
      } catch (e) { return null; }
    },

    apply(game, d) {
      if (!d || d.incompatible) return false;
      const p = game.player, t = game.time;
      t.day = d.time.day; t.hour = d.time.hour; t.totalGameSeconds = d.time.totalGameSeconds;
      p.pos = C.V.copy(d.player.pos); p.yaw = d.player.yaw; p.pitch = d.player.pitch;
      p.stamina = d.player.stamina; p.stones = d.player.stones; p.flashlight = !!d.player.flashlight;
      p.needs.deserialize(d.player.needs);
      if (d.player.items) p.items = d.player.items;
      p.bagItemId = d.player.bagItemId || null;
      p.bag = d.player.bag ? C.Grid.deserialize(d.player.bag) : null;
      if (d.player.hotbar) p.hotbar = d.player.hotbar.map(r => (r ? C.makeItem(r.id, r.count) : null));
      const boxes = new Map((game.level.containers || []).map(b => [b.id, b]));
      for (const r of d.containers || []) {
        const b = boxes.get(r.id);
        if (!b) continue;
        b.opened = true; b.revealed = r.revealed; b.grid = C.Grid.deserialize(r.grid);
      }
      for (const i of d.loose || []) {
        if (game.level.looseItems && game.level.looseItems[i]) game.level.looseItems[i].taken = true;
      }
      C.Notebook.deserialize(d.notebook);
      if (d.skills) Object.assign(C.Config.skills, d.skills);
      for (const r of d.portals || []) {
        const portal = game.level.graph.portals[r.i];
        if (portal) portal.state = r.s;
      }
      C.EventBus.publish(C.Events.PortalStateChanged, { portalId: -1, prev: null, state: null });
      // 丧尸按存档还原；数量不符时以存档为准
      const byId = new Map(C.ZombieManager.list.map(z => [z.id, z]));
      for (const zs of d.zombies || []) {
        const z = byId.get(zs.id);
        if (!z) continue;
        z.pos = C.V.copy(zs.pos); z.yaw = zs.yaw; z.hp = zs.hp; z.alive = zs.alive;
        z.homeNodeId = zs.homeNodeId; z.target = zs.target ? C.V.copy(zs.target) : null;
        z._setState(zs.state);
      }
      return true;
    },

    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },
    exists() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
