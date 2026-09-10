/*
 * CampusAudio.cs —— 把规则层算出来的 margin 和路径，变成耳朵能感知的东西
 *
 * **这是移植到 Unity 之后最大的一处升级。**
 * 网页版只能用 margin 调音量，所以隔着门的脚步是「小声」；
 * Unity 里可以让它变「闷」—— 用 Portal 衰减驱动一个低通滤波器。
 *
 * 关键：**滤波的强度不是拍脑袋定的，是从声音系统已经算出来的衰减值来的。**
 * 玩家听到的东西和规则层算的是同一件事，两者不会各说各话。
 */
using UnityEngine;
using UnityEngine.Audio;
using Campus;

namespace CampusGame {
  [RequireComponent(typeof(AudioSource))]
  public class CampusAudio : MonoBehaviour {
    public AudioClip Footstep, Impact, Voice, Door, Ambient, Boil, Whistle, Gunshot;
    [Tooltip("完全没有遮挡时的低通截止（Hz）")]
    public float OpenCutoff = 22000f;
    [Tooltip("被完全挡死时的低通截止（Hz）。人耳对 300Hz 以下的声音会判断成「墙那边」")]
    public float BlockedCutoff = 500f;
    [Tooltip("多少点衰减算「完全挡死」。铁门关着是 70，木门 25")]
    public float FullBlockAtten = 70f;

    AudioSource _src;
    AudioLowPassFilter _lp;

    void Awake() {
      _src = GetComponent<AudioSource>();
      _src.spatialBlend = 1f;                       // 全 3D
      _lp = GetComponent<AudioLowPassFilter>();
      if (_lp == null) _lp = gameObject.AddComponent<AudioLowPassFilter>();
    }

    /// <summary>玩家听到了什么。<paramref name="h"/> 直接来自规则层。</summary>
    public void Play(Heard h, Transform listener) {
      var clip = ClipFor(h.Evt.Category);
      if (clip == null) return;

      /* 音量映射用**开方**不是线性。
         线性下 margin 5（站在烧开的水壶边上）只有满音量的 11%，几乎听不见 ——
         而 margin 5 在规则层的意思是「你确实听见了，只是很轻」。
         人耳本来就是对数的：开方之后 margin 5 -> 33%，
         「刚好听得见」和「就在耳边」之间才有可用的动态范围。 */
      float gain = Mathf.Sqrt(Mathf.Clamp01((float)(h.Margin / 45.0))) * 0.85f;

      /* **声源摆在「声音传来的方向」，不是声源真实位置。**
         声音是绕着走的：门在你左边，那脚步声就该从左边来，
         哪怕发出声音的丧尸在你右前方的另一个房间。
         这是整个声音系统在听感上最重要的一件事。 */
      var dir = h.Dir.ToUnity();
      transform.position = listener.position + dir * Mathf.Min(6f, (float)h.PathLen);

      // 遮挡 -> 低通。隔着门的声音是「闷」，不只是「小声」
      double atten = h.Evt.Loudness - h.Arrival - h.PathLen * Config.Sound.KIndoor;
      float blocked = Mathf.Clamp01((float)(atten / FullBlockAtten));
      _lp.cutoffFrequency = Mathf.Lerp(OpenCutoff, BlockedCutoff, blocked);

      _src.volume = gain;
      _src.PlayOneShot(clip, gain);
    }

    AudioClip ClipFor(string cat) {
      switch (cat) {
        case SoundCategory.Footstep: return Footstep;
        case SoundCategory.Impact:   return Impact;
        case SoundCategory.Voice:    return Voice;
        case SoundCategory.Door:     return Door;
        case SoundCategory.Ambient:  return Ambient;
        case SoundCategory.Boil:     return Boil;
        case SoundCategory.Whistle:  return Whistle;
        case SoundCategory.Gunshot:  return Gunshot;
        default: return Impact;
      }
    }
  }
}
