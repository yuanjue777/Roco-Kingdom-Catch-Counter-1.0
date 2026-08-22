"""关键词自动回复，演示插件配置与消息规则。

回复内容通过 .env 里的 KEYWORD_REPLIES / KEYWORD_GROUPS 配置，改词不用改代码。
"""

import nonebot
from nonebot import on_message
from nonebot.adapters.onebot.v11 import GroupMessageEvent, MessageEvent
from nonebot.plugin import PluginMetadata
from nonebot.rule import Rule

from src.core.keyword import match_keyword

from .config import Config

__plugin_meta__ = PluginMetadata(
    name="keyword",
    description="关键词自动回复",
    usage="群里说出配置好的关键词即可触发，词表见 .env 的 KEYWORD_REPLIES",
    config=Config,
)

plugin_config = nonebot.get_plugin_config(Config)


async def _in_scope(event: MessageEvent) -> bool:
    if not plugin_config.keyword_replies:
        return False
    if not plugin_config.keyword_groups:
        return True
    return isinstance(event, GroupMessageEvent) and event.group_id in plugin_config.keyword_groups


keyword = on_message(rule=Rule(_in_scope), priority=50, block=False)


@keyword.handle()
async def handle_keyword(event: MessageEvent) -> None:
    reply = match_keyword(event.get_plaintext(), plugin_config.keyword_replies)
    if reply is not None:
        await keyword.finish(reply)
