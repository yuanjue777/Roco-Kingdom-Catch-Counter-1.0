#!/usr/bin/env bash
# 把规则层和接缝层装进一个 Unity 工程。
#
#   ./install-to-unity.sh ~/我的Unity工程
#
# 装两份东西，去两个地方：
#   Campus.Core/*.cs   → Assets/Plugins/Campus.Core/     零 UnityEngine 引用的规则层
#   UnityGlue/*.cs     → Assets/Scripts/CampusBridge/    唯一 using UnityEngine 的接缝层
#
# 两个 .asmdef 一起装。Campus.Core 那个的 noEngineReferences 是 true ——
# **顺手在规则层里 using UnityEngine 会当场编译失败**，而不是三个月后
# 才发现规则层再也没法在命令行里测了。
#
# 用源码不用 DLL：Unity 的热重载和调试体验好得多，而且 Config.g.cs 是生成的，
# 改完 00-config.js 重新生成，编辑器里直接就生效。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-}"

if [ -z "$DEST" ]; then
  echo "用法：$0 <Unity 工程根目录>" >&2
  exit 1
fi
if [ ! -d "$DEST/Assets" ]; then
  echo "在 $DEST 下找不到 Assets/ —— 这不像是一个 Unity 工程根目录。" >&2
  echo "要的是包含 Assets/ 和 ProjectSettings/ 的那一层。" >&2
  exit 1
fi

CORE="$DEST/Assets/Plugins/Campus.Core"
BRIDGE="$DEST/Assets/Scripts/CampusBridge"
mkdir -p "$CORE" "$BRIDGE"

cp "$HERE"/Campus.Core/*.cs "$CORE"/
cp "$HERE"/UnityProject/Assets/Plugins/Campus.Core/Campus.Core.asmdef "$CORE"/
cp "$HERE"/UnityGlue/*.cs "$BRIDGE"/
cp "$HERE"/UnityProject/Assets/Scripts/CampusBridge/*.cs "$BRIDGE"/
cp "$HERE"/UnityProject/Assets/Scripts/CampusBridge/*.asmdef "$BRIDGE"/

echo "规则层  → $CORE"
echo "接缝层  → $BRIDGE"
echo
echo "回到 Unity，等它编译完（Console 应该是干净的），然后："
echo "  1. 场景里建一个空物体，挂上 CampusSelfTest"
echo "  2. 按播放"
echo "  3. Console 里应该出现：关着木门 到达 14 / 余量 4，门开着 到达 34 / 余量 24"
echo
echo "这几个数和网页版、和命令行对拍的是同一套 —— 对上了就说明规则层在 Unity 里是活的。"
