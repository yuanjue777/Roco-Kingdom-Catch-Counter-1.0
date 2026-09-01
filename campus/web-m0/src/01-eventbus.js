/*
 * 01-eventbus.js —— 事件总线（主文档 11.2）
 * 跨系统通信一律走这里。事件对象发出后视为不可变，处理器不得修改。
 * 约束：处理器不得递归发出同类事件；深度超过 8 记录警告。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const handlers = new Map();   // eventType(string) -> Set<fn>
  let depth = 0;
  const MAX_DEPTH = 8;

  C.EventBus = {
    subscribe(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => C.EventBus.unsubscribe(type, fn);
    },
    unsubscribe(type, fn) {
      const s = handlers.get(type);
      if (s) s.delete(fn);
    },
    publish(type, evt) {
      const s = handlers.get(type);
      if (!s || s.size === 0) return;
      depth++;
      if (depth > MAX_DEPTH) {
        console.warn('[EventBus] 事件递归深度超过 ' + MAX_DEPTH + '，类型：' + type);
        depth--;
        return;
      }
      for (const fn of Array.from(s)) {
        try { fn(evt); }
        catch (e) { console.error('[EventBus] 处理器异常 ' + type, e); }
      }
      depth--;
    },
    clear() { handlers.clear(); depth = 0; }
  };

  // 核心事件类型名（主文档 11.2 表格）。M0 只用到其中一部分。
  C.Events = {
    SoundEmitted: 'SoundEmittedEvent',
    SoundHeard: 'SoundHeardEvent',
    PortalStateChanged: 'PortalStateChangedEvent',
    HourPassed: 'HourPassedEvent',
    DayPassed: 'DayPassedEvent',
    NeedChanged: 'NeedChangedEvent',
    PlayerDamaged: 'PlayerDamagedEvent',
    ZombieStateChanged: 'ZombieStateChangedEvent',
    PlayerDied: 'PlayerDiedEvent'
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
