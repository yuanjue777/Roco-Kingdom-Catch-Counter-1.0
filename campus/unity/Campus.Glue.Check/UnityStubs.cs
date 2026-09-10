/*
 * UnityStubs.cs —— 假的 UnityEngine，**只给命令行编译用**
 *
 * 这里只声明接缝层实际用到的那几个类型和成员，签名与 Unity 6 保持一致。
 * 它不实现任何行为，也永远不会被复制进 Unity 工程 ——
 * 真到了编辑器里，同名的真类型会顶上来。
 *
 * 加了新的 Unity API 而这里没有？编译会红，那正是这个文件存在的意义：
 * **把「在编辑器里才发现拼错了」提前到「在终端里 3 秒就知道」。**
 */
using System;

namespace UnityEngine.Audio { public static class _Exists { } }

namespace UnityEngine {
  public struct Vector3 {
    public float x, y, z;
    public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
    public Vector3 normalized => this;
    public float magnitude => 0f;
    public static Vector3 operator -(Vector3 a, Vector3 b) => a;
    public static Vector3 operator +(Vector3 a, Vector3 b) => a;
    public static Vector3 operator *(Vector3 a, float f) => a;
  }

  public struct Bounds {
    public Vector3 center, size, min, max;
  }

  public struct Color {
    public Color(float r, float g, float b, float a) { }
  }

  public struct LayerMask {
    int _v;
    public static implicit operator LayerMask(int v) => new LayerMask { _v = v };
    public static implicit operator int(LayerMask m) => m._v;
  }

  public class Object { }

  public class Component : Object {
    public Transform transform => null;
    public GameObject gameObject => null;
    public T GetComponent<T>() where T : Component => null;
  }

  public class GameObject : Object {
    public T AddComponent<T>() where T : Component => null;
  }

  public class Transform : Component {
    public Vector3 position;
  }

  public class Behaviour : Component { }

  public class MonoBehaviour : Behaviour {
    // Unity 6 里 FindObjectOfType 已经标记过时，新名字是 FindFirstObjectByType
    public static T FindFirstObjectByType<T>() where T : Object => null;
  }

  public class Collider : Component { public Bounds bounds; }
  public class BoxCollider : Collider { }

  public static class Physics {
    public static bool Raycast(Vector3 origin, Vector3 dir, float maxDistance, int layerMask) => false;
  }

  public static class Gizmos {
    public static Color color;
    public static void DrawCube(Vector3 center, Vector3 size) { }
  }

  public static class Mathf {
    public static float Sqrt(float f) => 0f;
    public static float Clamp01(float f) => 0f;
    public static float Min(float a, float b) => 0f;
    public static float Lerp(float a, float b, float t) => 0f;
  }

  public static class Debug {
    public static void Log(object message) { }
  }

  public class AudioClip : Object { }

  public class AudioSource : Behaviour {
    public float spatialBlend, volume;
    public void PlayOneShot(AudioClip clip, float scale) { }
  }

  public class AudioLowPassFilter : Behaviour { public float cutoffFrequency; }

  [AttributeUsage(AttributeTargets.Field)]
  public class TooltipAttribute : Attribute { public TooltipAttribute(string t) { } }

  [AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
  public class RequireComponent : Attribute { public RequireComponent(Type t) { } }
}
