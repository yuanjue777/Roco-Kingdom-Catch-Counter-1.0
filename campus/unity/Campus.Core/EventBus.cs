using System;
using System.Collections.Generic;

namespace Campus {
  /// <summary>跨层通信只走它。**同层之间直接调用** —— 不要为了「解耦」把同层拆成事件。</summary>
  public static class EventBus {
    static readonly Dictionary<string, List<Action<object>>> _subs = new Dictionary<string, List<Action<object>>>();

    public static Action Subscribe(string evt, Action<object> fn) {
      if (!_subs.TryGetValue(evt, out var list)) { list = new List<Action<object>>(); _subs[evt] = list; }
      list.Add(fn);
      return () => list.Remove(fn);
    }

    public static void Publish(string evt, object payload = null) {
      if (!_subs.TryGetValue(evt, out var list)) return;
      /* 复制一份再遍历：处理函数里退订或再发事件是常事，
         直接遍历原表会漏掉一个订阅者或者抛异常 —— 而且只在特定顺序下出现。 */
      var copy = list.ToArray();
      foreach (var fn in copy) fn(payload);
    }

    public static void Clear() => _subs.Clear();
    public static int Count(string evt) => _subs.TryGetValue(evt, out var l) ? l.Count : 0;
  }

  public static class Events {
    public const string SoundEmitted = "SoundEmitted";
    public const string PortalStateChanged = "PortalStateChanged";
    public const string NeedChanged = "NeedChanged";
    public const string PlayerDied = "PlayerDied";
  }
}
