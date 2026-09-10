#!/usr/bin/env bash
# 一条命令跑完整条链：生成配置 → 导标准答案 → 对拍
# 改了 campus/web-m0/src/00-config.js 之后跑这个。
set -e
cd "$(dirname "$0")"
: "${DOTNET_ROOT:=/tmp/dotnet}"
export DOTNET_ROOT PATH="$DOTNET_ROOT:$PATH" DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1

echo "1/3  从 00-config.js 生成 C# 配置"
node tools/export-config.js
echo "2/3  用 JS 引擎导出标准答案"
node tools/export-goldens.js
echo "3/3  C# 对拍"
dotnet run --project Campus.Tests -v q --nologo
