using System.Collections.Generic;

namespace Campus {
  /// <summary>那些形状用生成的嵌套静态类表达不了的表，在这里从 `AllJson` 建出来。
  /// **数字的来源仍然只有一个**：`campus/web-m0/src/00-config.js`。</summary>
  public static partial class Config {
    static Json _all;
    public static Json All => _all ?? (_all = Json.Parse(AllJson));

    static Dictionary<string, Dictionary<string, double?>> _atten;
    /// <summary>`[Portal 类型][状态] → 衰减`。**值可以是 null** ——
    /// 意思是「这个类型没有这个状态」（门洞没有 Closed），此时回退到 Open。</summary>
    public static Dictionary<string, Dictionary<string, double?>> PortalAttenuationTable {
      get {
        if (_atten != null) return _atten;
        _atten = new Dictionary<string, Dictionary<string, double?>>();
        foreach (var kv in All["portalAttenuation"].Fields) {
          var row = new Dictionary<string, double?>();
          foreach (var st in kv.Value.Fields) row[st.Key] = st.Value.AsNullable();
          _atten[kv.Key] = row;
        }
        return _atten;
      }
    }

    static Dictionary<string, bool> _passable;
    /// <summary>哪些状态允许实体通行。**Closed 与 Blocked 同时阻断通行。**</summary>
    public static Dictionary<string, bool> PortalPassableTable {
      get {
        if (_passable != null) return _passable;
        _passable = new Dictionary<string, bool>();
        foreach (var kv in All["portalPassable"].Fields) _passable[kv.Key] = kv.Value.AsBool();
        return _passable;
      }
    }

    static Dictionary<string, double> _loud;
    /// <summary>行为响度表，按名字查。</summary>
    public static Dictionary<string, double> LoudnessTable {
      get {
        if (_loud != null) return _loud;
        _loud = new Dictionary<string, double>();
        foreach (var kv in All["loudness"].Fields) _loud[kv.Key] = kv.Value.AsDouble();
        return _loud;
      }
    }
  }
}
