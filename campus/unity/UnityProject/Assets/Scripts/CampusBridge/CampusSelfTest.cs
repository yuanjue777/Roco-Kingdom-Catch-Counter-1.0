/*
 * CampusSelfTest.cs —— 把它挂在任意一个空物体上，按播放
 *
 * 它不依赖场景里的任何东西：自己搭两个房间和一扇木门，喊一声，
 * 再让一个人饿八个小时，然后把结果打到 Console。
 *
 * **这是「Unity 里跑的是同一套规则」的第一份证据。**
 * 如果这几行数字和网页版对得上，说明配置、声图、传播、需求
 * 四件事在编辑器里都是活的，接下来才轮到美术和音效。
 */
using UnityEngine;
using Campus;

namespace CampusGame {
  public class CampusSelfTest : MonoBehaviour {
    void Start() {
      var graph = new SoundGraph();
      var room = graph.AddNode("402", AABB.Make(0, 0, 0, 4, 3, 6));
      var corr = graph.AddNode("4F走廊", AABB.Make(4, 0, 0, 6, 3, 20), false, 0, 4, "corridor");
      var door = graph.AddPortal(room.Id, corr.Id, new V3(4, 0, 3), PortalType.WoodDoor, PortalState.Closed);

      var clock = new TimeSystem();
      var sound = new SoundSystem();
      sound.Init(graph, clock, (a, b) => true);

      var ears = new HearingComponent(1, Config.Hearing.Zombie) { Sound = sound, Node = corr.Id, Pos = new V3(5, 0, 3) };
      sound.AddListener(ears);

      Debug.Log($"[Campus] 配置来自 00-config.js：室内 k={Config.Sound.KIndoor}　跑步响度={Config.Loudness.Run}　" +
                $"丧尸阈值={Config.Hearing.Zombie}　可听半径={ears.AudibleRange(Config.Loudness.Run)} m");

      Heard last = null;
      ears.OnHeard = h => last = h;

      sound.Emit(new V3(2, 0, 3), Config.Loudness.Run, SoundCategory.Footstep, 99, 0, "跑步");
      Debug.Log(last == null
        ? "[Campus] 关着木门：走廊里的丧尸没听见"
        : $"[Campus] 关着木门：到达 {last.Arrival:0.00}　余量 {last.Margin:0.00}　路径 {last.PathLen:0.00} m");

      graph.SetPortalState(door, PortalState.Open);
      last = null;
      sound.Emit(new V3(2, 0, 3), Config.Loudness.Run, SoundCategory.Footstep, 99, 0, "跑步");
      Debug.Log(last == null
        ? "[Campus] 门开着：竟然还是没听见（这就不对了）"
        : $"[Campus] 门开着：到达 {last.Arrival:0.00}　余量 {last.Margin:0.00}　路径 {last.PathLen:0.00} m");

      var needs = new Needs(1);
      Debug.Log($"[Campus] 开局口渴 {needs.Thirst}　可用生命上限 {needs.HealthMax()}");
      needs.Update(8, false);
      Debug.Log($"[Campus] 醒着过 8 小时：口渴 {needs.Thirst:0.0}　饥饿 {needs.Hunger:0.0}　" +
                $"困乏 {needs.Fatigue:0.0}　生命上限 {needs.HealthMax():0.0}");
    }
  }
}
