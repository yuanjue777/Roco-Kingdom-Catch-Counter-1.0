using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Campus {
  /// <summary>够用就好的 JSON 读取器（约 120 行，零依赖）。
  /// 只用来读生成出来的配置 —— **不是通用库**，不处理注释、不处理超大数、不做流式。
  /// 之所以自己写：netstandard2.1 没有内置 JSON，而为了读一份自己生成的配置
  /// 去引一个 NuGet 包，会让 Unity 那边多一层版本冲突的风险。</summary>
  public sealed class Json {
    public enum Kind { Null, Bool, Number, String, Array, Object }
    public Kind Type;
    public bool Bool;
    public double Number;
    public string Str;
    public List<Json> Array;
    public Dictionary<string, Json> Object;

    public bool IsNull => Type == Kind.Null;
    public Json this[string key] =>
      Type == Kind.Object && Object.TryGetValue(key, out var v) ? v : new Json { Type = Kind.Null };
    public Json this[int i] =>
      Type == Kind.Array && i >= 0 && i < Array.Count ? Array[i] : new Json { Type = Kind.Null };
    public int Count => Type == Kind.Array ? Array.Count : (Type == Kind.Object ? Object.Count : 0);
    public IEnumerable<KeyValuePair<string, Json>> Fields =>
      Type == Kind.Object ? (IEnumerable<KeyValuePair<string, Json>>)Object : new Dictionary<string, Json>();
    public IEnumerable<Json> Items =>
      Type == Kind.Array ? (IEnumerable<Json>)Array : new List<Json>();

    public double AsDouble(double dflt = 0) => Type == Kind.Number ? Number : dflt;
    public double? AsNullable() => Type == Kind.Number ? Number : (double?)null;
    public string AsString(string dflt = null) => Type == Kind.String ? Str : dflt;
    public bool AsBool(bool dflt = false) => Type == Kind.Bool ? Bool : dflt;
    public bool Exists => Type != Kind.Null;

    public static Json Parse(string s) { int i = 0; var v = ParseValue(s, ref i); return v; }

    static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

    static Json ParseValue(string s, ref int i) {
      Ws(s, ref i);
      if (i >= s.Length) return new Json { Type = Kind.Null };
      char c = s[i];
      if (c == '{') return ParseObject(s, ref i);
      if (c == '[') return ParseArray(s, ref i);
      if (c == '"') return new Json { Type = Kind.String, Str = ParseString(s, ref i) };
      if (c == 't') { i += 4; return new Json { Type = Kind.Bool, Bool = true }; }
      if (c == 'f') { i += 5; return new Json { Type = Kind.Bool, Bool = false }; }
      if (c == 'n') { i += 4; return new Json { Type = Kind.Null }; }
      int st = i;
      while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
      return new Json { Type = Kind.Number, Number = double.Parse(s.Substring(st, i - st), CultureInfo.InvariantCulture) };
    }

    static Json ParseObject(string s, ref int i) {
      var o = new Dictionary<string, Json>();
      i++; Ws(s, ref i);
      if (i < s.Length && s[i] == '}') { i++; return new Json { Type = Kind.Object, Object = o }; }
      while (i < s.Length) {
        Ws(s, ref i);
        var key = ParseString(s, ref i);
        Ws(s, ref i); i++;                       // ':'
        o[key] = ParseValue(s, ref i);
        Ws(s, ref i);
        if (i < s.Length && s[i] == ',') { i++; continue; }
        if (i < s.Length && s[i] == '}') { i++; break; }
        break;
      }
      return new Json { Type = Kind.Object, Object = o };
    }

    static Json ParseArray(string s, ref int i) {
      var a = new List<Json>();
      i++; Ws(s, ref i);
      if (i < s.Length && s[i] == ']') { i++; return new Json { Type = Kind.Array, Array = a }; }
      while (i < s.Length) {
        a.Add(ParseValue(s, ref i));
        Ws(s, ref i);
        if (i < s.Length && s[i] == ',') { i++; continue; }
        if (i < s.Length && s[i] == ']') { i++; break; }
        break;
      }
      return new Json { Type = Kind.Array, Array = a };
    }

    static string ParseString(string s, ref int i) {
      var sb = new StringBuilder();
      i++;                                        // 开头的引号
      while (i < s.Length && s[i] != '"') {
        if (s[i] == '\\') {
          i++;
          char e = s[i];
          if (e == 'n') sb.Append('\n');
          else if (e == 't') sb.Append('\t');
          else if (e == 'r') sb.Append('\r');
          else if (e == 'b') sb.Append('\b');
          else if (e == 'f') sb.Append('\f');
          else if (e == 'u') { sb.Append((char)Convert.ToInt32(s.Substring(i + 1, 4), 16)); i += 4; }
          else sb.Append(e);
          i++;
        } else sb.Append(s[i++]);
      }
      i++;                                        // 结尾的引号
      return sb.ToString();
    }
  }
}
