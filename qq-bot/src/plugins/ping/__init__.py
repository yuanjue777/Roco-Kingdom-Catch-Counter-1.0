"""最小示例插件：回复 ping。"""

from nonebot import on_command
from nonebot.plugin import PluginMetadata

__plugin_meta__ = PluginMetadata(
    name="ping",
    description="连通性测试",
    usage="/ping —— 机器人回复 pong",
)

ping = on_command("ping", aliases={"在吗"}, priority=10, block=True)


@ping.handle()
async def handle_ping() -> None:
    await ping.finish("pong")
