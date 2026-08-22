"""骰子表达式解析与投掷。

这一层不依赖 NoneBot，纯函数便于单测——业务逻辑与适配层分离是本项目的约定。
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

MAX_COUNT = 20
MAX_FACES = 1000

_DICE_RE = re.compile(r"^\s*(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$")


class DiceError(ValueError):
    """骰子表达式不合法。"""


@dataclass(frozen=True)
class Dice:
    count: int
    faces: int
    modifier: int = 0

    def __str__(self) -> str:
        expr = f"{self.count}d{self.faces}"
        if self.modifier:
            expr += f"{self.modifier:+d}"
        return expr


def parse_dice(expression: str) -> Dice:
    """把 "2d6+1" 这样的表达式解析成 Dice。"""
    match = _DICE_RE.match(expression)
    if match is None:
        raise DiceError(f"看不懂的骰子表达式：{expression!r}")

    raw_count, raw_faces, sign, raw_modifier = match.groups()
    count = int(raw_count) if raw_count else 1
    faces = int(raw_faces)
    modifier = int(raw_modifier) if raw_modifier else 0
    if sign == "-":
        modifier = -modifier

    if not 1 <= count <= MAX_COUNT:
        raise DiceError(f"骰子个数需在 1~{MAX_COUNT} 之间")
    if not 2 <= faces <= MAX_FACES:
        raise DiceError(f"骰子面数需在 2~{MAX_FACES} 之间")

    return Dice(count=count, faces=faces, modifier=modifier)


def roll(dice: Dice, rng: random.Random | None = None) -> tuple[list[int], int]:
    """投掷骰子，返回 (每颗点数, 总和)。传入 rng 可让结果可复现。"""
    generator = rng or random
    rolls = [generator.randint(1, dice.faces) for _ in range(dice.count)]
    return rolls, sum(rolls) + dice.modifier


def format_result(dice: Dice, rolls: list[int], total: int) -> str:
    if dice.count == 1 and not dice.modifier:
        return f"{dice} = {total}"
    detail = " + ".join(str(r) for r in rolls)
    if dice.modifier:
        detail += f" {'+' if dice.modifier > 0 else '-'} {abs(dice.modifier)}"
    return f"{dice} = {detail} = {total}"
