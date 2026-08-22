"""帮助菜单：汇总所有插件的 PluginMetadata。"""

import nonebot
from nonebot import on_command
from nonebot.plugin import PluginMetadata

__plugin_meta__ = PluginMetadata(
    name="menu",
    description="功能菜单",
    usage="/help —— 列出全部可用功能",
)

menu = on_command("help", aliases={"菜单", "帮助"}, priority=5, block=True)


def build_menu() -> str:
    lines = ["可用功能："]
    for plugin in sorted(nonebot.get_loaded_plugins(), key=lambda p: p.name):
        meta = plugin.metadata
        if meta is None:
            continue
        lines.append(f"· {meta.name}：{meta.description}")
        if meta.usage:
            lines.append(f"  {meta.usage}")
    return "\n".join(lines)


@menu.handle()
async def handle_menu() -> None:
    await menu.finish(build_menu())
