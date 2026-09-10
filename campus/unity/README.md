# Unity 6 移植 · Campus.Core

> 规则层的 C# 移植。**零 `UnityEngine` 引用**，能在命令行里跑测试。
> 设计文档：[`../docs/设计文档-v3.md`](../docs/设计文档-v3.md)

## 现在是什么状态

| | 状态 |
|---|---|
| 数学 / 确定性随机 / 事件总线 / 修正管线 | ✅ 已移植，**与 JS 对拍一致** |
| 配置（79 组数值、32 配方、79 特性、94 物品） | ✅ **从 `00-config.js` 自动生成**，不是手抄 |
| 声图 / Dijkstra 传播 / 听觉 / 气味 / 时钟 | ✅ 已移植，**72 个用例逐个对拍，误差 < 1e-9** |
| 需求（饥饿 / 口渴 / 困乏 / 生命）| ✅ 已移植，**68 步操作逐字段对拍** |
| 睡眠与安全睡点 | ✅ 已移植（找床归几何层，见下） |
| Unity 接缝（时钟 / 声音 / 听觉 / 门 / 节点 / 音频） | ✅ `UnityGlue/`，**一条命令装进工程**，带自检场景 |
| 玩家控制器 / 丧尸 AI / 供电 / 烹饪 / 战斗 / 教学 | ⏳ 还在 JS 里，按同样的方式往下搬 |

**53 条对拍断言全绿。**

## 一条命令

```bash
export DOTNET_ROOT=/path/to/dotnet && export PATH=$DOTNET_ROOT:$PATH
./verify.sh                      # 下面四步一次跑完

node tools/export-config.js      # 00-config.js  → Campus.Core/Config.g.cs
node tools/export-goldens.js     # JS 引擎跑一遍 → Campus.Tests/goldens.json（标准答案）
dotnet run --project Campus.Tests # 对拍
dotnet build Campus.Glue.Check    # 接缝层拿假 UnityEngine 桩编译一遍
```

**改了 `00-config.js` 之后整条链都要重跑。** 前两步是生成，后两步是验证。

## 为什么是「对拍」而不是「重写断言」

把 JS 那 800 多条断言在 C# 里重写一遍，只能证明
**「C# 符合我对规格的理解」**。

而对拍证明的是
**「C# 和已经跑通 800 条测试的 JS 算出同一个数」**。

后者才是「系统不变」这句话的意思。所以 `goldens.json` 里存的是
JS 引擎实际算出来的到达响度、路径长度、入口 Portal、夜间系数曲线、
随机数序列 —— C# 逐个对，误差超过 1e-9 就红。

### 对拍能过 ≠ 对拍在管事

`[实测]` 需求系统移植完，48 条断言第一次跑就全绿。
然后把 `staminaMax()` 的顺序**故意改反**（先过管线再减困乏）—— **还是全绿**。
原因：挂在 `stamina.max` 上的 52 条特性**全是加法**，而加法换个顺序算出来一样。

所以每写一段对拍，都要**先把实现改坏一次，确认它真的会红**。
现在轨迹里专门钉了这些边界：

| 钉子 | 不钉会怎样 |
|---|---|
| `stamina.max` 上挂一条**乘法** | 「先挤占再过管线」这条顺序可以被悄悄改掉 |
| `restedHours` 正好在某一步**跨过 0** | 「先乘 0.75 再扣时长」和「扣完就不乘」算出来一样 |
| 腹泻剩余时长跨过 0 的那一步 | 同上，×2 到底管不管这一整步看不出来 |
| 睡眠**正好 6.00 小时** | `>=` 写成 `>` 不会红 |
| 中断后 `timeScale` 回到 1 | 忘了还原时间流速，测试照样绿 |

写第二条轨迹时还得盯着钳制：困乏顶到 100、口渴钳到 0，
**差异会被钳制吃掉**，那一条又变回摆设。

> `[实测]` 这套对拍上线第一次跑就抓到一个致命差异：
> **`Rng.Next()` 的中间那一步在 JS 里是【有符号】右移**（`>>` 会先转 int32），
> 而 C# 的 `uint >>` 是逻辑右移。直接照抄的话，同一个种子从第一个数就分岔 ——
> **Unity 版和网页版根本不是同一所学校，而且没有任何东西会报错。**

## 在 Unity 6 里怎么接

### 一条命令

```bash
./install-to-unity.sh ~/你的Unity工程        # 那一层要能看到 Assets/ 和 ProjectSettings/
```

它装两份东西，去两个地方：

| 装什么 | 去哪 | 什么性质 |
|---|---|---|
| `Campus.Core/*.cs` | `Assets/Plugins/Campus.Core/` | 规则层，**零 UnityEngine 引用** |
| `UnityGlue/*.cs` + `CampusSelfTest.cs` | `Assets/Scripts/CampusBridge/` | 接缝层，**唯一 using UnityEngine 的地方** |

两个 `.asmdef` 一起装。`Campus.Core` 那个的 `noEngineReferences` 是 `true`，
所以**顺手在规则层里 `using UnityEngine` 会当场编译失败** ——
而不是三个月后才发现规则层再也没法在命令行里测了。
这条和 `Campus.Tests` 第 14 节的断言是同一件事的两道锁。

**用源码不用 DLL**：Unity 的热重载和调试体验好得多，
而且 `Config.g.cs` 是生成的，改完 `00-config.js` 重新生成，编辑器里直接就生效。
如果坚持要 DLL：`dotnet build Campus.Core -c Release`，
目标框架**必须是 netstandard2.1**，Unity 的 Mono/IL2CPP 读不了 net8.0。

### 装完先按播放

场景里建一个空物体，挂上 `CampusSelfTest`，按播放。它不依赖场景里任何东西：
自己搭两个房间和一扇木门，喊一声，再让一个人饿八个小时。Console 应该出现：

```
关着木门：到达 14.00  余量 4.00  路径 3.00 m
门开着：  到达 34.00  余量 24.00 路径 3.00 m
开局口渴 30  可用生命上限 70
醒着过 8 小时：口渴 58.6  饥饿 16.0  困乏 40.0  生命上限 25.4
```

**这几个数不是我编的**，是 JS 引擎算出来存在 `goldens.json` 里的，
`Campus.Tests` 第 13 节每次都对一遍。对上了，就说明配置、声图、传播、需求
四件事在编辑器里都是活的 —— 接下来才轮到建模和音效。

一扇关着的木门把 45 分贝的跑步声压到余量 4，
**丧尸勉强听得见**；门一开变成 24，站在走廊那头也躲不掉。
这就是这个游戏的全部玩法，它现在在 Unity 里跑着。

### 接缝层没有 Unity 也能编译

`Campus.Glue.Check/` 是个不会进 Unity 的工程，里面有一套**假的 UnityEngine 桩**
（`MonoBehaviour`、`Vector3`、`AudioLowPassFilter`… 只声明用到的那些，签名对齐 Unity 6）。

为什么值得：接缝层是唯一 `using UnityEngine` 的地方，
也就是唯一 `Campus.Tests` 覆盖不到的地方。一个手滑，
代价是对面在编辑器里对着一屏红字排查。现在 `verify.sh` 第 4 步 3 秒就告诉你。

> `[实测]` 这套桩第一次跑就抓到两个：`FindObjectOfType` 在 Unity 6 里已经过时
> （新名字是 `FindFirstObjectByType`），以及 `CampusSound.I` 原本在 `Awake` 里赋值，
> 而 `CampusNode.Awake` 就要用它 —— **Unity 不保证谁先跑**，
> 换台机器、改一下脚本执行顺序就可能空引用。现在改成懒查找，顺序问题不存在了。

### 场景里怎么搭

| 组件 | 挂在哪 | 作用 |
|---|---|---|
| `CampusClock` | 一个常驻空物体 | 游戏时钟，`Tick(dt)` 返回本帧的游戏小时 |
| `CampusSound` | 同上 | 声音系统 + 声图。室外遮挡用 `Physics.Raycast` |
| `CampusNode` | 每个房间/走廊/室外分区 | 需要一个 `BoxCollider` 画范围，**编辑器里所见即所得** |
| `CampusPortal` | 每扇门/窗/楼梯口 | 连接两个 `CampusNode` |
| `CampusEars` | 玩家 + 每只丧尸 | 听觉组件。**听者是被动接收方，不主动查询** |
| `CampusAudio` | 音效播放器 | 把 margin 变成音量、把 Portal 衰减变成低通 |

### 4. URP，不要 HDRP

单人开发、昏暗走廊、雾里 12–60 米 —— HDRP 的复杂度和性能开销换不来对应的画面收益。

320 只丧尸：开 **GPU Resident Drawer**。
网页版在这件事上已经付过学费：一只一个 `Group` 渲染时帧率 60 → 13，
合批之后 draw call 从 687 掉到 107。

## 声音在 Unity 里能做到而网页做不到的

这是移植最大的收益，**也是这个游戏最该投入的地方**：

| | 网页版 | Unity |
|---|---|---|
| 音量 | ✅ `√(margin/45)` | 一样 |
| 方向 | ✅ 左右声像 | ✅ 真 3D，**声源摆在「声音传来的方向」而不是声源真实位置** |
| **遮挡** | ❌ 隔着门只是「小声」 | ✅ **低通滤波，隔着门是「闷」** |
| 混响 | ❌ | ✅ 走廊 / 房间 / 室外不同的 Reverb Zone |

`CampusAudio.cs` 里的低通截止频率**不是拍脑袋定的**，
是从声音系统已经算出来的衰减值来的 —— 玩家听到的和规则层算的是同一件事。

## 接下来往下搬的顺序

按依赖顺序，每一步都先导标准答案再移植：

1. ~~`18-needs` `19-sleep`~~ ✅ 已完成
2. `09-collision` `08-level` `24-campus` —— 几何，用同样的「导出图 → 对拍」方式。
   **`Sleep.Check` 的「附近有没有床」现在是个入参**：床是 `level.solids` 里 tag=bed 的方块，
   属于几何层。这一步搬完要把它接回去，规则层仍然只问「有没有」，不问「在哪」。
3. `11-zombie` —— 状态机，注意反应延迟/定位误差是 margin 的确定函数
4. `29-power` `30-cooking` `41-injury` `40-combat` —— 各自独立，可并行
5. `33-traits` —— 它只往管线挂修正，移植量很小但连着 52 条特性
6. `20-save` —— 最后，因为它依赖上面所有人的 `serialize()`

**每一步都要有对应的 `export-goldens` 用例。**
没有对拍的移植等于重写，而重写就意味着「系统不变」这句话不成立。
