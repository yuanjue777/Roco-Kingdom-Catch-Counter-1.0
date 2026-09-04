/*
 * 20-save.js —— 存档（主文档 11.5）
 * 单存档、随时保存、死亡删除。JSON 便于调试。版本号写进存档头，不兼容时明确提示而不是崩溃。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const KEY = 'campus-save-v1';
  const VERSION = 1;

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
          needs: p.needs.serialize(), items: p.items
        },
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
