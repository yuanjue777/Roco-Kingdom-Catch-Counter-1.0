"""骰子插件，演示命令参数解析。"""

from nonebot import on_command
from nonebot.adapters.onebot.v11 import Message
from nonebot.params import CommandArg
from nonebot.plugin import PluginMetadata

from src.core.dice import DiceError, format_result, parse_dice, roll

__plugin_meta__ = PluginMetadata(
    name="roll",
    description="投骰子",
    usage="/roll 2d6+1 —— 不带参数时默认 1d100",
)

roll_cmd = on_command("roll", aliases={"骰子"}, priority=10, block=True)


@roll_cmd.handle()
async def handle_roll(args: Message = CommandArg()) -> None:
    expression = args.extract_plain_text().strip() or "1d100"
    try:
        dice = parse_dice(expression)
    except DiceError as exc:
        await roll_cmd.finish(str(exc))

    rolls, total = roll(dice)
    await roll_cmd.finish(format_result(dice, rolls, total))
