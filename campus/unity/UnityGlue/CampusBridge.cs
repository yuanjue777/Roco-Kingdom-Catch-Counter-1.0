/*
 * CampusBridge.cs —— Unity 与规则层之间唯一的接缝
 *
 * 把这个文件（和同目录其它 UnityGlue/*.cs）放进 Unity 工程的
 * `Assets/Scripts/Bridge/`，把 Campus.Core 放进 `Assets/Plugins/Campus.Core/`。
 *
 * **规矩和网页版一样：只有这一层允许把各层连起来。**
 * Campus.Core 里零 UnityEngine 引用；这里是唯一知道 Vector3、MonoBehaviour 的地方。
 * 一旦开始在规则层里 `using UnityEngine`，「改数值不引入回归」这件事就结束了。
 */
using System;
using UnityEngine;
using Campus;

namespace CampusGame {

  /// <summary>坐标转换。**Unity 的 Vector3 是 float，规则层是 double** ——
  /// 转换只发生在这一层，规则内部永远是 double，避免声音传播在长路径上累积浮点误差。</summary>
  public static class Conv {
    public static V3 ToCore(this Vector3 v) => new V3(v.x, v.y, v.z);
    public static Vector3 ToUnity(this V3 v) => new Vector3((float)v.x, (float)v.y, (float)v.z);
  }

  /// <summary>时间系统的 Unity 外壳。挂在场景里一个常驻物体上。</summary>
  public class CampusClock : MonoBehaviour, ITimeSource {
    public TimeSystem Core = new TimeSystem();
    public double NightFactor => Core.NightFactor;
    public double TotalGameSeconds => Core.TotalGameSeconds;
    public int Day => Core.Day;
    public float Hour => (float)Core.Hour;

    /// <summary>返回本帧经过的**游戏小时**，需求/伤势/烹饪都按它推进。</summary>
    public double Tick(float dt) => Core.Advance(dt);
  }

  /// <summary>声音系统的 Unity 外壳。</summary>
  public class CampusSound : MonoBehaviour {
    public static CampusSound I { get; private set; }
    public SoundSystem Core = new SoundSystem();
    public SoundGraph Graph = new SoundGraph();
    [Tooltip("室外遮挡判定用的层。声音系统只拿到一个纯函数，不认识 Unity。")]
    public LayerMask OcclusionMask = ~0;

    void Awake() {
      I = this;
      var clock = FindObjectOfType<CampusClock>();
      Core.Init(Graph, clock, (a, b) => {
        var pa = a.ToUnity(); var pb = b.ToUnity();
        var d = pb - pa;
        // true = 看得见（没被挡住）
        return !Physics.Raycast(pa, d.normalized, d.magnitude, OcclusionMask);
      });
    }

    /// <summary>发出一次声音。**调用方不需要知道图、节点、Portal 的任何事情。**</summary>
    public void Emit(Vector3 pos, double loudness, string category, int emitterId, string label = "") {
      Core.Emit(pos.ToCore(), loudness, category, emitterId, 0, label);
    }
  }

  /// <summary>听觉组件的 Unity 外壳。挂在玩家和每一只丧尸身上。</summary>
  public class CampusEars : MonoBehaviour {
    public int OwnerId;
    [Tooltip("丧尸 10、玩家 8。**不要在这里写死** —— 从 Config 取。")]
    public double BaseThreshold = Config.Hearing.Zombie;
    [Tooltip("只有丧尸闻得到味 —— 玩家不是靠鼻子找饭吃的。")]
    public bool Smells = true;

    public HearingComponent Core;
    public event Action<Heard> Heard;

    void OnEnable() {
      Core = new HearingComponent(OwnerId, BaseThreshold) {
        Sound = CampusSound.I.Core, Smells = Smells
      };
      Core.OnHeard = h => Heard?.Invoke(h);
      CampusSound.I.Core.AddListener(Core);
    }
    void OnDisable() { CampusSound.I?.Core.RemoveListener(Core); }

    void Update() {
      // 听者是**被动接收方**，不主动查询 —— 它只负责把自己的位置报上去
      Core.Pos = transform.position.ToCore();
      var n = CampusSound.I.Graph.GetNodeAt(Core.Pos, Core.Node);
      Core.Node = n?.Id ?? -1;
    }
  }

  /// <summary>Portal 的 Unity 外壳：一扇门 / 一扇窗 / 一个楼梯口。</summary>
  public class CampusPortal : MonoBehaviour {
    public string Type = PortalType.WoodDoor;
    public string State = PortalState.Closed;
    public CampusNode A, B;
    public Portal Core;

    void Start() {
      Core = CampusSound.I.Graph.AddPortal(A.Core.Id, B.Core.Id, transform.position.ToCore(), Type, State);
    }
    public void SetState(string s) => CampusSound.I.Graph.SetPortalState(Core, s);

    /// <summary>当前这扇门挡掉多少响度。**给音频层做低通滤波用** ——
    /// 隔着门的声音应该是「闷」，不只是「小声」。</summary>
    public double Attenuation => CampusSound.I.Graph.GetAttenuation(Core);
  }

  /// <summary>声图节点的 Unity 外壳：一个房间 / 一段走廊 / 一个室外分区。
  /// 用一个 BoxCollider 画出它的范围，编辑器里所见即所得。</summary>
  [RequireComponent(typeof(BoxCollider))]
  public class CampusNode : MonoBehaviour {
    public string NodeName = "房间";
    public bool IsOutdoor;
    public int BuildingId;
    public int Floor;
    public string Kind = "room";
    public SoundNode Core;

    void Awake() {
      var bc = GetComponent<BoxCollider>();
      var c = bc.bounds;
      Core = CampusSound.I.Graph.AddNode(NodeName,
        AABB.Make(c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z),
        IsOutdoor, BuildingId, Floor, Kind);
    }

    void OnDrawGizmosSelected() {
      var bc = GetComponent<BoxCollider>();
      if (bc == null) return;
      Gizmos.color = IsOutdoor ? new Color(0.4f, 0.8f, 0.6f, 0.25f) : new Color(0.4f, 0.6f, 0.9f, 0.25f);
      Gizmos.DrawCube(bc.bounds.center, bc.bounds.size);
    }
  }
}
