using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Campus {
  public static class SoundCategory {
    public const string Footstep = "Footstep", Impact = "Impact", Voice = "Voice",
      Gunshot = "Gunshot", Ambient = "Ambient", Door = "Door", Boil = "Boil", Whistle = "Whistle";
  }

  public sealed class SoundEvent {
    public int Id;
    public V3 WorldPosition;
    public int NodeId = -1;
    public double Loudness;
    public string Category = SoundCategory.Impact;
    public int EmitterId = -1;
    public int ChainDepth;
    public double Timestamp;
    public string Label = "";
  }

  /// <summary>某个节点上算出来的到达情况。</summary>
  public struct Reach {
    public double Arrival;       // 到达该节点【入口点】时的响度
    public V3 EntryPos;          // 声音是从哪儿进这个节点的
    public int EntryPortalId;
    public double PathLen;
  }

  /// <summary>听者在自己位置上的结算结果。</summary>
  public sealed class Heard {
    public double Arrival;       // 到达听者耳朵的响度
    public V3 Dir;               // **路径入口方向，不是声源真实方向**
    public double PathLen;
    public int EntryPortalId;
    public SoundEvent Evt;
    public double Margin;        // 到达响度 − 听者阈值
  }

  public interface IListener {
    bool Active { get; }
    int SelfEmitterId { get; }
    V3 Position { get; }
    int NodeId { get; }
    void Deliver(SoundEvent evt, Heard info);
  }

  /// <summary>最小二叉堆。用自带的 SortedSet/PriorityQueue 会引入 netstandard 兼容问题，
  /// 而且这个堆每帧要跑上千次 —— 自己写反而更可控。</summary>
  sealed class Heap {
    readonly List<(double cost, int nodeId)> _a = new List<(double, int)>();
    public int Size => _a.Count;
    public void Push(double cost, int nodeId) {
      _a.Add((cost, nodeId));
      int i = _a.Count - 1;
      while (i > 0) {
        int p = (i - 1) >> 1;
        if (_a[p].cost <= _a[i].cost) break;
        var t = _a[p]; _a[p] = _a[i]; _a[i] = t; i = p;
      }
    }
    public (double cost, int nodeId) Pop() {
      var top = _a[0];
      var last = _a[_a.Count - 1];
      _a.RemoveAt(_a.Count - 1);
      if (_a.Count > 0) {
        _a[0] = last;
        int i = 0;
        while (true) {
          int l = i * 2 + 1, r = l + 1, s = i;
          if (l < _a.Count && _a[l].cost < _a[s].cost) s = l;
          if (r < _a.Count && _a[r].cost < _a[s].cost) s = r;
          if (s == i) break;
          var t = _a[s]; _a[s] = _a[i]; _a[i] = t; i = s;
        }
      }
      return top;
    }
  }

  public sealed class SoundStats { public int Culled; public double LastMs; public int LastExpanded; public int Acc; }
  public sealed class LogEntry { public double T; public string Cat; public double Loud; public int Node; public string Label; public int Emitter; }

  /// <summary>声音传播。**调用方不需要知道图、节点、Portal 的任何事情** —— 只管 Emit。</summary>
  public sealed class SoundSystem {
    public SoundGraph Graph;
    public ITimeSource Time;
    /// <summary>室外遮挡判定：两点之间有没有建筑挡着。声音系统只拿到一个纯函数，**不认识 World**。</summary>
    public Func<V3, V3, bool> OcclusionTest;

    public readonly List<IListener> Listeners = new List<IListener>();
    public readonly List<LogEntry> Log = new List<LogEntry>();
    public readonly SoundStats Stats = new SoundStats();
    public SoundEvent LastEvent;
    public Dictionary<int, Reach> LastResult;
    int _seq;

    public void Init(SoundGraph graph, ITimeSource time, Func<V3, V3, bool> occlusionTest = null) {
      Graph = graph; Time = time; OcclusionTest = occlusionTest;
    }
    public void Reset() {
      Listeners.Clear(); Log.Clear(); LastEvent = null; LastResult = null; _seq = 0;
      Stats.Culled = 0; Stats.LastMs = 0; Stats.LastExpanded = 0; Stats.Acc = 0;
    }
    public void AddListener(IListener l) { if (!Listeners.Contains(l)) Listeners.Add(l); }
    public void RemoveListener(IListener l) => Listeners.Remove(l);

    /// <summary>当前的距离衰减系数（夜晚全局 ×nightFactor）。</summary>
    public double KFor(SoundNode node) {
      double base_ = (node != null && node.IsOutdoor) ? Config.Sound.KOutdoor : Config.Sound.KIndoor;
      return base_ * (Time?.NightFactor ?? 1.0);
    }

    /* 直线距离剪枝。全校 320 只丧尸，每只每 1.1 秒拖一次脚步 ——
       不剪枝的话每秒要跑近三百次 Dijkstra，光这一项就吃掉整个帧预算。

       剪的是**证明不可能被任何人听见**的那些：图上的路径是折线，长度永远不小于
       两点直线距离；k 取全场最小（室外 × 夜间系数），阈值取全场最低。所以
           可听半径上限 = (响度 − 最低阈值) / k_min
       之外的听者无论路怎么绕都不可能听见。**这是等价变换，不是近似。** */
    bool AnyListenerWithin(SoundEvent evt) {
      double nf = Time?.NightFactor ?? 1.0;
      double kMin = Config.Sound.KOutdoor * nf;
      double maxR = (evt.Loudness - Config.Sound.GlobalMinThreshold) / kMin;
      if (maxR <= 0) return false;
      double r2 = maxR * maxR;
      foreach (var hc in Listeners) {
        if (!hc.Active || hc.SelfEmitterId == evt.EmitterId) continue;
        var d = V.Sub(hc.Position, evt.WorldPosition);
        if (d.x * d.x + d.y * d.y + d.z * d.z <= r2) return true;
      }
      return false;
    }

    public SoundEvent Emit(V3 worldPosition, double loudness, string category = null,
                           int emitterId = -1, int chainDepth = 0, string label = "", int nodeIdHint = -1) {
      var node = Graph.GetNodeAt(worldPosition, nodeIdHint);
      var evt = new SoundEvent {
        Id = _seq++, WorldPosition = worldPosition, NodeId = node?.Id ?? -1,
        Loudness = loudness, Category = category ?? SoundCategory.Impact,
        EmitterId = emitterId, ChainDepth = chainDepth,
        Timestamp = Time?.TotalGameSeconds ?? 0, Label = label ?? ""
      };
      if (evt.NodeId < 0 || evt.Loudness <= 0) return evt;

      /* 剪掉的只是「跑图」和「送达」两步 —— **事件本身照发、照记日志、照上总线**。
         调试面板和音效层要看到玩家自己踢到的每一块石头，
         哪怕全校没有一只丧尸听得见。 */
      bool audible = AnyListenerWithin(evt);
      if (!audible) Stats.Culled++;

      if (audible) {
        var sw = Stopwatch.StartNew();
        var result = Propagate(evt);
        sw.Stop();
        Stats.LastMs = sw.Elapsed.TotalMilliseconds;
        Stats.LastExpanded = result.Count;
        Stats.Acc++;
        LastResult = result;
        foreach (var hc in Listeners) {
          if (!hc.Active || hc.SelfEmitterId == evt.EmitterId) continue;   // 过滤自己的声音
          var r = ResolveAt(result, hc.Position, hc.NodeId);
          if (r == null) continue;
          r.Evt = evt;
          hc.Deliver(evt, r);
        }
      }
      LastEvent = evt;

      Log.Add(new LogEntry { T = evt.Timestamp, Cat = evt.Category, Loud = evt.Loudness,
                             Node = evt.NodeId, Label = evt.Label, Emitter = evt.EmitterId });
      if (Log.Count > Config.Debug.LogMaxEntries) Log.RemoveAt(0);

      EventBus.Publish(Events.SoundEmitted, evt);
      return evt;
    }

    /// <summary>Dijkstra，代价 = 累计衰减量。</summary>
    public Dictionary<int, Reach> Propagate(SoundEvent evt) {
      var g = Graph;
      double minT = Config.Sound.GlobalMinThreshold;
      var outp = new Dictionary<int, Reach>();
      var startNode = g.GetNode(evt.NodeId);
      if (startNode == null) return outp;

      // 起始节点的入口点 = 声源位置本身，累计衰减 = 0
      outp[startNode.Id] = new Reach { Arrival = evt.Loudness, EntryPos = evt.WorldPosition, EntryPortalId = -1, PathLen = 0 };
      var heap = new Heap();
      heap.Push(0, startNode.Id);
      var settled = new HashSet<int>();
      int guard = (int)Config.Sound.MaxExpandedNodes;

      while (heap.Size > 0 && guard-- > 0) {
        var cur = heap.Pop();
        if (settled.Contains(cur.nodeId)) continue;
        settled.Add(cur.nodeId);

        var node = g.GetNode(cur.nodeId);
        var rec = outp[cur.nodeId];
        double k = KFor(node);

        foreach (var pid in node.Portals) {
          var portal = g.GetPortal(pid);
          int otherId = g.Other(portal, node.Id);
          if (settled.Contains(otherId)) continue;

          double segLen = V.Dist(rec.EntryPos, portal.Position);
          double newCost = cur.cost + k * segLen + g.GetAttenuation(portal);
          double arrival = evt.Loudness - newCost;
          if (arrival < minT) continue;          // 低于全场最低阈值的传播没有意义

          if (!outp.TryGetValue(otherId, out var prev) || arrival > prev.Arrival) {
            outp[otherId] = new Reach {
              Arrival = arrival, EntryPos = portal.Position,
              EntryPortalId = portal.Id, PathLen = rec.PathLen + segLen
            };
            heap.Push(newCost, otherId);
          }
        }
      }
      return outp;
    }

    /// <summary>听者结算：加上节点内的最后一段距离。
    /// **同一房间内贴脸和隔十米不再等价。**</summary>
    public Heard ResolveAt(Dictionary<int, Reach> result, V3 pos, int nodeId) {
      if (!result.TryGetValue(nodeId, out var rec)) return null;
      var node = Graph.GetNode(nodeId);
      double k = KFor(node);
      double segLen = V.Dist(rec.EntryPos, pos);
      double arrival = rec.Arrival - k * segLen;
      /* 室外没有天然的房间边界：同一个室外节点内，若入口点与听者之间隔着建筑体，
         额外扣一次固定遮挡值。只对室外、只在同节点内做。 */
      if (node.IsOutdoor && OcclusionTest != null && segLen > 0.5 && !OcclusionTest(rec.EntryPos, pos))
        arrival -= Config.Sound.OutdoorOcclusion;
      if (arrival <= 0) return null;
      // **方向 = 声音传来的路径入口方向，不是声源真实方向**
      return new Heard {
        Arrival = arrival, Dir = V.Norm(V.Sub(rec.EntryPos, pos)),
        PathLen = rec.PathLen + segLen, EntryPortalId = rec.EntryPortalId
      };
    }
  }
}
