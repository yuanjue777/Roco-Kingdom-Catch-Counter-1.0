import random

import pytest

from src.core.dice import Dice, DiceError, format_result, parse_dice, roll


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("d20", Dice(1, 20, 0)),
        ("2d6", Dice(2, 6, 0)),
        ("2d6+1", Dice(2, 6, 1)),
        ("3D8 - 2", Dice(3, 8, -2)),
        ("  1d100  ", Dice(1, 100, 0)),
    ],
)
def test_parse_dice_ok(expression: str, expected: Dice) -> None:
    assert parse_dice(expression) == expected


@pytest.mark.parametrize("expression", ["", "abc", "0d6", "21d6", "1d1", "1d1001", "2x6"])
def test_parse_dice_rejects_bad_input(expression: str) -> None:
    with pytest.raises(DiceError):
        parse_dice(expression)


def test_roll_is_reproducible_and_in_range() -> None:
    dice = parse_dice("3d6+2")
    rolls, total = roll(dice, random.Random(42))

    assert len(rolls) == 3
    assert all(1 <= r <= 6 for r in rolls)
    assert total == sum(rolls) + 2
    assert roll(dice, random.Random(42)) == (rolls, total)


def test_format_result() -> None:
    assert format_result(Dice(1, 100), [57], 57) == "1d100 = 57"
    assert format_result(Dice(2, 6, 1), [3, 4], 8) == "2d6+1 = 3 + 4 + 1 = 8"
    assert format_result(Dice(2, 6, -1), [3, 4], 6) == "2d6-1 = 3 + 4 - 1 = 6"
