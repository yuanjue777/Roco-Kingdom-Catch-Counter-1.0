"""运行状态查询，仅超级用户可用，演示权限控制。"""

import time
from datetime import timedelta

import nonebot
from nonebot import on_command
from nonebot.permission import SUPERUSER
from nonebot.plugin import PluginMetadata

__plugin_meta__ = PluginMetadata(
    name="status",
    description="查看机器人运行状态（仅超级用户）",
    usage="/status",
)

_START_TIME = time.time()

status = on_command("status", aliases={"状态"}, permission=SUPERUSER, priority=5, block=True)


@status.handle()
async def handle_status() -> None:
    uptime = timedelta(seconds=int(time.time() - _START_TIME))
    plugins = nonebot.get_loaded_plugins()
    await status.finish(f"运行时长：{uptime}\n已加载插件：{len(plugins)} 个")
