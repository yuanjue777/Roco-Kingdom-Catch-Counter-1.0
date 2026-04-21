import ctypes
import json
import os
import re
import sys
import threading
import time
import wave
from collections import Counter

import cv2
import mss
import numpy as np
import pyaudio
import tkinter as tk
from scipy.signal import correlate
from tkinter import messagebox, scrolledtext, ttk

try:
    import pytesseract
except Exception:
    pytesseract = None

# ================== 配置 ==================
# 图像检测（捏球判定）
TEMPLATE_FILE = "1.png"
TARGET_CENTER_X = 1852
TARGET_CENTER_Y = 969
VISUAL_THRESHOLD = 0.3

# 图像检测（抓到精灵判定）
CAPTURE_TEMPLATE_FILE = "2.png"
CAPTURE_CENTER_X = 188
CAPTURE_CENTER_Y = 99
CAPTURE_VISUAL_THRESHOLD = 0.40
CAPTURE_COOLDOWN_SEC = 0.8

# 第三检测区域（OCR星光）: left, top, right, bottom
STAR_OCR_X1 = 204
STAR_OCR_Y1 = 87
STAR_OCR_X2 = 255
STAR_OCR_Y2 = 113
STAR_METER_MAX = 700.0
STAR_METER_RIGHT_MAX = 1370.0
STAR_OCR_MIN = 10
STAR_OCR_MAX = 800

# 音频检测（丢球命中判定）
HIT_AUDIO_FILES = ["hit1.wav", "hit2.wav", "hit3.wav"]
AUDIO_THRESHOLD = 0.50
THROW_DETECT_WINDOW_SEC = 2.5
BUFFER_SEC = 3
SEARCH_MARGIN_SEC = 0.35

# 调试输出
DEBUG_MIN_SCORE = 0.20
DEBUG_LOG_COOLDOWN = 0.35

# 设备筛选
DEVICE_KEYWORDS = ["CABLE Output", "VB-Audio", "Loopback", "立体声混音", "Stereo Mix"]
AUDIO_DEVICE_STRICT = True

# 热键（Windows Virtual-Key）
HOTKEY_CLEAR_VK = 0x6B  # 默认 Num+
HOTKEY_FADED_VK = 0x6D  # 默认 Num-

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "counter_state.json")
UI_BG = "#1e1e1e"
TRANSPARENT_KEY = "#010203"
CONFIG_TXT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.txt")
# =======================================


def _parse_cfg_value(raw):
    s = raw.strip()
    if not s:
        return ""
    if s.lower() in ("true", "false"):
        return s.lower() == "true"
    if s.lower().startswith("0x"):
        try:
            return int(s, 16)
        except Exception:
            pass
    # 列表：a,b,c
    if "," in s:
        return [x.strip() for x in s.split(",") if x.strip()]
    # 数值
    try:
        if "." in s:
            return float(s)
        return int(s)
    except Exception:
        return s


def load_config_txt():
    cfg = {}
    if not os.path.exists(CONFIG_TXT_FILE):
        return cfg
    try:
        with open(CONFIG_TXT_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if (not line) or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                key = k.strip()
                # 去掉“空白 + #”形式的行尾注释，避免把颜色值 #xxxxxx 误裁掉
                m = re.search(r"\s+#", v)
                val = v[:m.start()].strip() if m else v.strip()
                if key:
                    cfg[key] = _parse_cfg_value(val)
    except Exception:
        return {}
    return cfg


APP_CFG = load_config_txt()


def _cfg(key, default):
    return APP_CFG.get(key, default)


def get_bundle_resource_path(file_name):
    # PyInstaller 打包后，内置资源位于 _MEIPASS
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(base, file_name)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), file_name)


# 使用 config.txt 覆盖默认配置
TEMPLATE_FILE = _cfg("TEMPLATE_FILE", TEMPLATE_FILE)
TARGET_CENTER_X = _cfg("TARGET_CENTER_X", TARGET_CENTER_X)
TARGET_CENTER_Y = _cfg("TARGET_CENTER_Y", TARGET_CENTER_Y)
VISUAL_THRESHOLD = _cfg("VISUAL_THRESHOLD", VISUAL_THRESHOLD)

CAPTURE_TEMPLATE_FILE = _cfg("CAPTURE_TEMPLATE_FILE", CAPTURE_TEMPLATE_FILE)
CAPTURE_CENTER_X = _cfg("CAPTURE_CENTER_X", CAPTURE_CENTER_X)
CAPTURE_CENTER_Y = _cfg("CAPTURE_CENTER_Y", CAPTURE_CENTER_Y)
CAPTURE_VISUAL_THRESHOLD = _cfg("CAPTURE_VISUAL_THRESHOLD", CAPTURE_VISUAL_THRESHOLD)
CAPTURE_COOLDOWN_SEC = _cfg("CAPTURE_COOLDOWN_SEC", CAPTURE_COOLDOWN_SEC)

STAR_OCR_X1 = _cfg("STAR_OCR_X1", STAR_OCR_X1)
STAR_OCR_Y1 = _cfg("STAR_OCR_Y1", STAR_OCR_Y1)
STAR_OCR_X2 = _cfg("STAR_OCR_X2", STAR_OCR_X2)
STAR_OCR_Y2 = _cfg("STAR_OCR_Y2", STAR_OCR_Y2)
STAR_METER_MAX = _cfg("STAR_METER_MAX", STAR_METER_MAX)
STAR_OCR_MIN = _cfg("STAR_OCR_MIN", STAR_OCR_MIN)
STAR_OCR_MAX = _cfg("STAR_OCR_MAX", STAR_OCR_MAX)

HIT_AUDIO_FILES = _cfg("HIT_AUDIO_FILES", HIT_AUDIO_FILES)
AUDIO_THRESHOLD = _cfg("AUDIO_THRESHOLD", AUDIO_THRESHOLD)
THROW_DETECT_WINDOW_SEC = _cfg("THROW_DETECT_WINDOW_SEC", THROW_DETECT_WINDOW_SEC)
BUFFER_SEC = _cfg("BUFFER_SEC", BUFFER_SEC)
SEARCH_MARGIN_SEC = _cfg("SEARCH_MARGIN_SEC", SEARCH_MARGIN_SEC)

DEBUG_MIN_SCORE = _cfg("DEBUG_MIN_SCORE", DEBUG_MIN_SCORE)
DEBUG_LOG_COOLDOWN = _cfg("DEBUG_LOG_COOLDOWN", DEBUG_LOG_COOLDOWN)
DEVICE_KEYWORDS = _cfg("DEVICE_KEYWORDS", DEVICE_KEYWORDS)
AUDIO_DEVICE_STRICT = _cfg("AUDIO_DEVICE_STRICT", AUDIO_DEVICE_STRICT)
HOTKEY_CLEAR_VK = _cfg("HOTKEY_CLEAR_VK", HOTKEY_CLEAR_VK)
HOTKEY_FADED_VK = _cfg("HOTKEY_FADED_VK", HOTKEY_FADED_VK)
UI_BG = _cfg("UI_BG", UI_BG)
TRANSPARENT_KEY = _cfg("TRANSPARENT_KEY", TRANSPARENT_KEY)


def _safe_vk(v, default_vk):
    try:
        return int(v)
    except Exception:
        return int(default_vk)


def vk_to_text(vk):
    vk = int(vk)
    vk_map = {
        0x6B: "Num+",
        0x6D: "Num-",
        0x60: "Num0",
        0x61: "Num1",
        0x62: "Num2",
        0x63: "Num3",
        0x64: "Num4",
        0x65: "Num5",
        0x66: "Num6",
        0x67: "Num7",
        0x68: "Num8",
        0x69: "Num9",
        0x20: "Space",
        0x0D: "Enter",
        0x1B: "Esc",
        0x09: "Tab",
    }
    if vk in vk_map:
        return vk_map[vk]
    if 0x30 <= vk <= 0x39:
        return chr(vk)  # 主键盘数字
    if 0x41 <= vk <= 0x5A:
        return chr(vk)  # A-Z
    return f"VK(0x{vk:02X})"


def _to_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default


def _to_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default


def load_state_from_disk():
    if not os.path.exists(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

label_text = "咕噜球使用数量"
label_color = "#00ff00"
BALL_TYPES = ["高级咕噜球", "光合球", "网兜球", "调温球", "淘沙球", "绝缘球", "美妙球", "好战球", "暗星球", "变幻球"]

use_count = 0
throw_count = 0
hit_count = 0
captured_count = 0
total_starlight = 0
base_starlight_total = 0
base_starlight_meter = 0.0
base_star_parts = {}
pollution_count = 0
faded_pollution_count = 0
meter_reduce_logs = []

saved_ball_type = BALL_TYPES[0]
saved_extra_rate = "70"
saved_pet_base = "100"

loaded_state = load_state_from_disk()
if loaded_state:
    use_count = _to_int(loaded_state.get("use_count"), 0)
    throw_count = _to_int(loaded_state.get("throw_count"), 0)
    hit_count = _to_int(loaded_state.get("hit_count"), 0)
    captured_count = _to_int(loaded_state.get("captured_count"), 0)
    total_starlight = _to_int(loaded_state.get("total_starlight"), 0)
    base_starlight_total = _to_int(loaded_state.get("base_starlight_total"), 0)
    base_starlight_meter = _to_float(loaded_state.get("base_starlight_meter"), 0.0)
    pollution_count = _to_int(loaded_state.get("pollution_count"), 0)
    faded_pollution_count = _to_int(loaded_state.get("faded_pollution_count"), 0)
    loaded_meter_logs = loaded_state.get("meter_reduce_logs", [])
    if isinstance(loaded_meter_logs, list):
        meter_reduce_logs = loaded_meter_logs[:]

    loaded_parts = loaded_state.get("base_star_parts", {})
    if isinstance(loaded_parts, dict):
        base_star_parts = { _to_int(k, 0): _to_int(v, 0) for k, v in loaded_parts.items() if _to_int(k, 0) > 0 and _to_int(v, 0) > 0 }

    bt = str(loaded_state.get("ball_type", BALL_TYPES[0]))
    saved_ball_type = bt if bt in BALL_TYPES else BALL_TYPES[0]
    saved_extra_rate = str(loaded_state.get("extra_rate", "70"))
    saved_pet_base = str(loaded_state.get("pet_base", "100"))

running = True
is_topmost = False
simplified_mode = False
cursor_hide_paused = False
alt_prev = False

# 共享音频缓冲
buffer = np.array([], dtype=np.float32)
buffer_lock = threading.Lock()

# 触发状态
mouse_left_down_prev = False
in_squeeze_state = False
throw_window_deadline = 0.0
throw_window_active = False

last_debug_print_time = 0.0

# 资源
hit_ref_features = []  # (ref_centered, ref_norm, ref_len, file_name)
sample_rate = None

template_gray = None
capture_region = None
capture_template_gray = None
capture_region_2 = None
capture_present_prev = False
last_capture_time = 0.0
num_plus_prev = False
num_minus_prev = False
ocr_unavailable_warned = False

# 开发窗口相关（按需弹出）
dev_window = None
log_text = None
detect_value_1 = None
detect_value_2 = None
dev_log_buffer = []
meter_log_window = None
meter_log_text = None

# ====================== GUI ======================
root = tk.Tk()
root.title("咕噜球音频检测器")
root.geometry("1020x300")
root.configure(bg=UI_BG)
root.resizable(True, False)
root.overrideredirect(True)

INPUT_BG = "#1f2230"
INPUT_FG = "#f2ecff"
INPUT_BORDER = "#6f45a8"

combo_style = ttk.Style()
try:
    combo_style.theme_use("clam")
except Exception:
    pass
combo_style.configure(
    "Beauty.TCombobox",
    fieldbackground=INPUT_BG,
    background="#2b2f3d",
    foreground=INPUT_FG,
    bordercolor=INPUT_BORDER,
    darkcolor=INPUT_BORDER,
    lightcolor=INPUT_BORDER,
    arrowcolor="#d8b8ff",
    insertcolor=INPUT_FG,
    relief="flat",
    padding=4,
    font=("Microsoft YaHei", 9)
)
combo_style.map(
    "Beauty.TCombobox",
    fieldbackground=[("readonly", INPUT_BG)],
    foreground=[("readonly", INPUT_FG)],
    selectbackground=[("readonly", "#6f45a8")],
    selectforeground=[("readonly", "#ffffff")]
)
root.option_add("*TCombobox*Listbox.background", INPUT_BG)
root.option_add("*TCombobox*Listbox.foreground", INPUT_FG)
root.option_add("*TCombobox*Listbox.selectBackground", "#6f45a8")
root.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")


def set_window_no_activate(enabled):
    # 仅在 Windows 上生效：置顶后不抢焦点
    if os.name != "nt":
        return
    try:
        hwnd = root.winfo_id()
        GWL_EXSTYLE = -20
        WS_EX_NOACTIVATE = 0x08000000
        SWP_NOSIZE = 0x0001
        SWP_NOMOVE = 0x0002
        SWP_NOZORDER = 0x0004
        SWP_NOACTIVATE = 0x0010
        SWP_FRAMECHANGED = 0x0020

        user32 = ctypes.windll.user32
        ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        if enabled:
            ex_style |= WS_EX_NOACTIVATE
        else:
            ex_style &= ~WS_EX_NOACTIVATE
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style)
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)
    except Exception:
        pass


def set_counter_cursor_hidden(hidden):
    # 仅影响计数器窗口本身的光标显示，不影响系统全局
    cur = "none" if hidden else ""
    try:
        root.configure(cursor=cur)
    except Exception:
        pass

    def _walk(w):
        try:
            w.configure(cursor=cur)
        except Exception:
            pass
        try:
            for c in w.winfo_children():
                _walk(c)
        except Exception:
            pass

    _walk(root)


def apply_cursor_visibility_policy():
    hide_cursor = is_topmost and (not cursor_hide_paused)
    set_counter_cursor_hidden(hide_cursor)


def toggle_topmost():
    global is_topmost, cursor_hide_paused
    is_topmost = not is_topmost
    root.attributes("-topmost", is_topmost)
    set_window_no_activate(is_topmost)
    if not is_topmost:
        cursor_hide_paused = False
    apply_cursor_visibility_policy()
    if is_topmost:
        pin_button.config(bg="#28a745", activebackground="#218838")
    else:
        pin_button.config(bg="#3a3f4b", activebackground="#4b5262")


def start_drag(event):
    if not is_topmost:
        root.x = event.x
        root.y = event.y


def drag_motion(event):
    if not is_topmost:
        dx = event.x - root.x
        dy = event.y - root.y
        x = root.winfo_x() + dx
        y = root.winfo_y() + dy
        root.geometry(f"+{x}+{y}")


root.bind("<Button-1>", start_drag)
root.bind("<B1-Motion>", drag_motion)

main_container = tk.Frame(root, bg=UI_BG)
main_container.pack(fill="both", expand=True, padx=10, pady=5)

# 左侧计量表（基础星光）
meter_frame = tk.Frame(main_container, bg="#2d2d2d", width=96, height=250, relief="ridge", bd=2)
meter_frame.pack_propagate(False)
meter_frame.pack(side="left", fill="y", padx=(0, 8), pady=10)

meter_title = tk.Label(meter_frame, text="污染计量表", font=("Microsoft YaHei", 9, "bold"), fg="#b84dff", bg="#2d2d2d")
meter_title.pack(anchor="center", pady=(4, 0))

meter_canvas = tk.Canvas(meter_frame, width=88, height=200, bg="#2d2d2d", highlightthickness=0)
meter_canvas.pack(pady=(2, 0))

meter_value_label = tk.Label(meter_frame, text="0 / 700", font=("Consolas", 9, "bold"), fg="#d8b8ff", bg="#2d2d2d")
meter_value_label.pack(anchor="center", pady=(0, 2))

meter_gain_hint_label = tk.Label(meter_frame, text="", font=("Consolas", 10, "bold"), fg="#b84dff", bg="#2d2d2d")
meter_gain_hint_label.pack(anchor="center", pady=(0, 2))
meter_gain_anim_token = 0

# 简化模式专用信息框（默认隐藏）
simplified_panel = tk.Frame(main_container, bg="#2d2d2d", width=190, height=250, relief="flat", bd=0, highlightthickness=1, highlightbackground="#454c5f")
simplified_panel.pack_propagate(False)

simp_inner = tk.Frame(simplified_panel, bg="#2d2d2d")
simp_inner.pack(fill="both", expand=True, padx=10, pady=8)

simp_indicator_row = tk.Frame(simp_inner, bg="#2d2d2d")
simp_indicator_row.pack(anchor="w")

simplified_indicator_canvas = tk.Canvas(simp_indicator_row, width=34, height=34, bg="#2d2d2d", highlightthickness=0)
simplified_indicator_canvas.pack(side="left", padx=(0, 8))
simplified_indicator_light = simplified_indicator_canvas.create_oval(5, 5, 29, 29, fill="#333333", outline="#555555", width=3)

simp_use_title = tk.Label(simp_indicator_row, text="已使用咕噜球：", font=("Microsoft YaHei", 11), fg="#ffffff", bg="#2d2d2d")
simp_use_title.pack(side="left")

simp_use_digits_frame = tk.Frame(simp_inner, bg="#2d2d2d")
simp_use_digits_frame.pack(anchor="w", pady=(6, 4))

simp_use_digit_labels = []
for _ in range(4):
    d = tk.Label(
        simp_use_digits_frame,
        text="0",
        font=("Consolas", 11, "bold"),
        fg="#ffe08a",
        bg="#3a2f16",
        width=2,
        relief="flat",
        bd=0,
        highlightthickness=1,
        highlightbackground="#c79a3a",
        highlightcolor="#c79a3a"
    )
    d.pack(side="left", padx=(0, 3))
    simp_use_digit_labels.append(d)

simp_captured_label = tk.Label(simp_inner, text="抓到精灵：0", font=("Microsoft YaHei", 10), fg="#00aaff", bg="#2d2d2d")
simp_captured_label.pack(anchor="w", pady=(2, 0))

simp_hit_label = tk.Label(simp_inner, text="命中数量：0", font=("Microsoft YaHei", 10), fg="#ffd24d", bg="#2d2d2d")
simp_hit_label.pack(anchor="w", pady=(2, 0))

simp_pollute_prob_label = tk.Label(simp_inner, text="单球出污染概率：0.00%", font=("Microsoft YaHei", 10), fg="#b84dff", bg="#2d2d2d")
simp_pollute_prob_label.pack(anchor="w", pady=(2, 0))

simp_pollution_row = tk.Frame(simp_inner, bg="#2d2d2d")
simp_pollution_row.pack(anchor="w", pady=(6, 0))

simp_pollution_title = tk.Label(simp_pollution_row, text="总污染计数：", font=("Microsoft YaHei", 11, "bold"), fg="#b84dff", bg="#2d2d2d")
simp_pollution_title.pack(side="left")

simp_pollution_digits_frame = tk.Frame(simp_pollution_row, bg="#2d2d2d")
simp_pollution_digits_frame.pack(side="left", padx=(4, 0))

simp_pollution_digit_labels = []
for _ in range(2):
    d = tk.Label(
        simp_pollution_digits_frame,
        text="0",
        font=("Consolas", 11, "bold"),
        fg="#f0dcff",
        bg="#2b2038",
        width=2,
        relief="flat",
        bd=0,
        highlightthickness=1,
        highlightbackground="#8a4dd1",
        highlightcolor="#8a4dd1"
    )
    d.pack(side="left", padx=(0, 3))
    simp_pollution_digit_labels.append(d)

simp_shiny_prob_label = tk.Label(simp_inner, text="褪色出异色概率：1.8%", font=("Microsoft YaHei", 10), fg="#b84dff", bg="#2d2d2d")
simp_shiny_prob_label.pack(anchor="w", pady=(8, 0))

# 右侧主区域：上行三框 + 下行日志/检测/按钮
right_area = tk.Frame(main_container, bg=UI_BG)
right_area.pack(side="left", fill="both", expand=True)

indicator_row = tk.Frame(right_area, bg=UI_BG)
indicator_row.pack(side="top", fill="x")

frame = tk.Frame(indicator_row, bg="#2d2d2d", width=245, height=114, relief="flat", bd=0, highlightthickness=1, highlightbackground="#454c5f")
frame.pack_propagate(False)
frame.pack(side="left", padx=8, pady=10)

indicator_canvas = tk.Canvas(frame, width=40, height=40, bg="#2d2d2d", highlightthickness=0)
indicator_canvas.pack(side="left", padx=10)
indicator_light = indicator_canvas.create_oval(6, 6, 34, 34, fill="#333333", outline="#555555", width=3)

text_frame = tk.Frame(frame, bg="#2d2d2d")
text_frame.pack(side="left", fill="y", pady=5)
counter_label = tk.Label(text_frame, text="已使用咕噜球：", font=("Microsoft YaHei", 11), fg="#ffffff", bg="#2d2d2d")
counter_label.pack(anchor="w", pady=1)

use_count_digits_frame = tk.Frame(text_frame, bg="#2d2d2d")
use_count_digits_frame.pack(anchor="w", pady=(2, 2))

use_count_digit_labels = []
for _ in range(4):
    d = tk.Label(
        use_count_digits_frame,
        text="0",
        font=("Consolas", 11, "bold"),
        fg="#ffe08a",
        bg="#3a2f16",
        width=2,
        relief="flat",
        bd=0,
        highlightthickness=1,
        highlightbackground="#c79a3a",
        highlightcolor="#c79a3a"
    )
    d.pack(side="left", padx=(0, 3))
    use_count_digit_labels.append(d)


def update_use_count_digits(value):
    digits = str(max(0, int(value))).zfill(4)
    if len(digits) > 4:
        digits = digits[-4:]
    for i, ch in enumerate(digits):
        use_count_digit_labels[i].config(text=ch)
        simp_use_digit_labels[i].config(text=ch)

ball_type_var = tk.StringVar(value=saved_ball_type)
ball_combo = ttk.Combobox(text_frame, style="Beauty.TCombobox", state="readonly", values=BALL_TYPES, textvariable=ball_type_var, width=16)
ball_combo.pack(anchor="w", pady=(6, 0))

# 统计框
stats_frame = tk.Frame(indicator_row, bg="#2d2d2d", width=245, height=114, relief="flat", bd=0, highlightthickness=1, highlightbackground="#454c5f")
stats_frame.pack_propagate(False)
stats_frame.pack(side="left", padx=8, pady=10)

stats_inner = tk.Frame(stats_frame, bg="#2d2d2d")
stats_inner.pack(fill="both", expand=True, padx=10, pady=6)

row1 = tk.Frame(stats_inner, bg="#2d2d2d")
row1.pack(fill="x")
captured_label = tk.Label(row1, text="抓到精灵：0", font=("Microsoft YaHei", 10), fg="#00aaff", bg="#2d2d2d")
captured_label.pack(side="left")
capture_rate_label = tk.Label(row1, text="捕获率：0.0%", font=("Microsoft YaHei", 10), fg="#00aaff", bg="#2d2d2d")
capture_rate_label.pack(side="right")

row2 = tk.Frame(stats_inner, bg="#2d2d2d")
row2.pack(fill="x")
hit_label = tk.Label(row2, text="命中数量：0", font=("Microsoft YaHei", 10), fg="#ffd24d", bg="#2d2d2d")
hit_label.pack(side="left")
rate_label = tk.Label(row2, text="命中率：0.0%", font=("Microsoft YaHei", 10), fg="#ffd24d", bg="#2d2d2d")
rate_label.pack(side="right")

row3 = tk.Frame(stats_inner, bg="#2d2d2d")
row3.pack(fill="x")
throw_label = tk.Label(row3, text="丢球数量：0", font=("Microsoft YaHei", 10), fg="#ffffff", bg="#2d2d2d")
throw_label.pack(side="left")

# 额外星光获取率配置框（位于统计框右侧）
star_cfg_frame = tk.Frame(indicator_row, bg="#2d2d2d", width=245, height=114, relief="flat", bd=0, highlightthickness=1, highlightbackground="#454c5f")
star_cfg_frame.pack_propagate(False)
star_cfg_frame.pack(side="left", padx=8, pady=10)

star_cfg_inner = tk.Frame(star_cfg_frame, bg="#2d2d2d")
star_cfg_inner.pack(fill="both", expand=True, padx=8, pady=6)

rate_row = tk.Frame(star_cfg_inner, bg="#2d2d2d")
rate_row.pack(anchor="w")

rate_label_name = tk.Label(rate_row, text="额外星光获取率", font=("Microsoft YaHei", 10), fg="#ffffff", bg="#2d2d2d")
rate_label_name.pack(side="left")

extra_rate_var = tk.StringVar(value=saved_extra_rate)
extra_rate_entry = tk.Entry(
    rate_row,
    textvariable=extra_rate_var,
    width=6,
    font=("Consolas", 10, "bold"),
    bd=0,
    relief="flat",
    justify="center",
    bg=INPUT_BG,
    fg=INPUT_FG,
    insertbackground=INPUT_FG,
    highlightthickness=1,
    highlightbackground=INPUT_BORDER,
    highlightcolor="#b084f5"
)
extra_rate_entry.pack(side="left", padx=(6, 2))

rate_unit_label = tk.Label(rate_row, text="%", font=("Microsoft YaHei", 10), fg="#ffffff", bg="#2d2d2d")
rate_unit_label.pack(side="left")

total_star_label = tk.Label(star_cfg_inner, text="总星光：0", font=("Microsoft YaHei", 10), fg="#d8b8ff", bg="#2d2d2d")
total_star_label.pack(anchor="w", pady=(6, 0))

base_star_row = tk.Frame(star_cfg_inner, bg="#2d2d2d")
base_star_row.pack(anchor="w")

base_star_label = tk.Label(base_star_row, text="基础星光累计：0", font=("Microsoft YaHei", 10), fg="#d8b8ff", bg="#2d2d2d")
base_star_label.pack(side="left")

detail_btn = tk.Button(base_star_row, text="?", font=("Consolas", 9, "bold"), width=2, relief="flat", bg="#3a3f4b", fg="#ffffff", activebackground="#4b5262", activeforeground="#ffffff")
detail_btn.pack(side="left", padx=(6, 0))

base_star_detail_popup = None
base_star_detail_text = None
base_star_detail_visible = False

bottom_section = tk.Frame(right_area, bg=UI_BG)
bottom_section.pack(side="top", fill="x")

bottom_row = tk.Frame(bottom_section, bg=UI_BG)
bottom_row.pack(side="top", fill="x", padx=8, pady=(0, 8))

formula_frame = tk.Frame(bottom_row, bg="#2d2d2d", width=443, height=114, relief="flat", bd=0, highlightthickness=1, highlightbackground="#454c5f")
formula_frame.pack_propagate(False)
formula_frame.pack(side="left", anchor="n", padx=(0, 6))

formula_inner = tk.Frame(formula_frame, bg="#2d2d2d")
formula_inner.pack(fill="x", padx=10, pady=6)

formula_top = tk.Frame(formula_inner, bg="#2d2d2d")
formula_top.pack(fill="x")

pet_base_title = tk.Label(formula_top, text="宠物基础星光值", font=("Microsoft YaHei", 10), fg="#d8b8ff", bg="#2d2d2d")
pet_base_title.pack(side="left")

pet_base_var = tk.StringVar(value=saved_pet_base)
pet_base_entry = tk.Entry(
    formula_top,
    textvariable=pet_base_var,
    width=8,
    font=("Consolas", 10, "bold"),
    bd=0,
    relief="flat",
    justify="center",
    bg=INPUT_BG,
    fg=INPUT_FG,
    insertbackground=INPUT_FG,
    highlightthickness=1,
    highlightbackground=INPUT_BORDER,
    highlightcolor="#b084f5"
)
pet_base_entry.pack(side="left", padx=(8, 0))

formula_row1 = tk.Frame(formula_inner, bg="#2d2d2d")
formula_row1.pack(fill="x", pady=(6, 0))
pollute_prob_label = tk.Label(formula_row1, text="单球出污染概率 = 宠物基础星光值 / 700 = 0.00% / 当前实际值 = 0.00%", font=("Microsoft YaHei", 9), fg="#b84dff", bg="#2d2d2d", anchor="w")
pollute_prob_label.pack(side="left")

formula_row2 = tk.Frame(formula_inner, bg="#2d2d2d")
formula_row2.pack(fill="x", pady=(2, 0))
expected_star_label = tk.Label(formula_row2, text="单球期望星光 = 宠物基础星光值 × 捕获率 = 0.00 / 当前实际值 = 0.00", font=("Microsoft YaHei", 9), fg="#d8b8ff", bg="#2d2d2d", anchor="w")
expected_star_label.pack(side="left")

formula_row3 = tk.Frame(formula_inner, bg="#2d2d2d")
formula_row3.pack(fill="x", pady=(2, 0))
avg_balls_label = tk.Label(formula_row3, text="平均多少球出一个污染 = 700 / 单球期望星光 = ∞ / 当前实际值 = ∞", font=("Microsoft YaHei", 9), fg="#ffffff", bg="#2d2d2d", anchor="w")
avg_balls_label.pack(side="left")

pollution_frame = tk.Frame(bottom_row, bg="#2d2d2d", width=313, height=114, relief="flat", bd=0, highlightthickness=1, highlightbackground="#454c5f")
pollution_frame.pack_propagate(False)
pollution_frame.pack(side="left", anchor="n", padx=(6, 0))

pollution_inner = tk.Frame(pollution_frame, bg="#2d2d2d")
pollution_inner.pack(fill="both", expand=True, padx=10, pady=8)

pollution_count_row = tk.Frame(pollution_inner, bg="#2d2d2d")
pollution_count_row.pack(anchor="w", fill="x")

pollution_count_label = tk.Label(
    pollution_count_row,
    text="总污染计数：",
    font=("Microsoft YaHei", 11, "bold"),
    fg="#b84dff",
    bg="#2d2d2d"
)
pollution_count_label.pack(side="left")

pollution_count_digits_frame = tk.Frame(pollution_count_row, bg="#2d2d2d")
pollution_count_digits_frame.pack(side="left", padx=(4, 0))

pollution_count_digit_labels = []
for _ in range(2):
    d = tk.Label(
        pollution_count_digits_frame,
        text="0",
        font=("Consolas", 11, "bold"),
        fg="#f0dcff",
        bg="#2b2038",
        width=2,
        relief="flat",
        bd=0,
        highlightthickness=1,
        highlightbackground="#8a4dd1",
        highlightcolor="#8a4dd1"
    )
    d.pack(side="left", padx=(0, 3))
    pollution_count_digit_labels.append(d)


def update_pollution_count_digits(value):
    digits = str(max(0, int(value))).zfill(2)
    if len(digits) > 2:
        digits = digits[-2:]
    for i, ch in enumerate(digits):
        pollution_count_digit_labels[i].config(text=ch)
        simp_pollution_digit_labels[i].config(text=ch)

faded_pollution_label = tk.Label(
    pollution_count_row,
    text="褪色污染计数：0",
    font=("Microsoft YaHei", 10, "bold"),
    fg="#c78cff",
    bg="#2d2d2d"
)
faded_pollution_label.pack(side="left", padx=(12, 0))

pollution_hint_label = tk.Label(
    pollution_inner,
    text=f"（出现污染精灵按一次 {vk_to_text(_safe_vk(HOTKEY_CLEAR_VK, 0x6B))}）",
    font=("Microsoft YaHei", 8),
    fg="#bfa6d9",
    bg="#2d2d2d"
)
pollution_hint_label.pack(anchor="w", pady=(2, 0))

faded_hint_label = tk.Label(
    pollution_inner,
    text=f"（与污染精灵战斗后褪色按一次 {vk_to_text(_safe_vk(HOTKEY_FADED_VK, 0x6D))}）",
    font=("Microsoft YaHei", 8),
    fg="#bfa6d9",
    bg="#2d2d2d"
)
faded_hint_label.pack(anchor="w")

shiny_prob_label = tk.Label(
    pollution_inner,
    text="当前污染褪色时出异色的概率：1.8%",
    font=("Microsoft YaHei", 10),
    fg="#b84dff",
    bg="#2d2d2d"
)
shiny_prob_label.pack(anchor="w", pady=(8, 0))


def on_pet_base_changed(*_):
    refresh_stats()


pet_base_var.trace_add("write", on_pet_base_changed)

control_bar = tk.Frame(right_area, bg=UI_BG)
control_bar.place(relx=1.0, y=8, anchor="ne")

BUTTON_WIDTH = 8
BUTTON_FONT = ("Microsoft YaHei", 9)
BUTTON_HEIGHT = 1
last_saved_state_signature = ""


def build_state_payload():
    return {
        "use_count": int(use_count),
        "throw_count": int(throw_count),
        "hit_count": int(hit_count),
        "captured_count": int(captured_count),
        "total_starlight": int(total_starlight),
        "base_starlight_total": int(round(base_starlight_total)),
        "base_starlight_meter": float(base_starlight_meter),
        "base_star_parts": {str(k): int(v) for k, v in base_star_parts.items()},
        "pollution_count": int(pollution_count),
        "faded_pollution_count": int(faded_pollution_count),
        "meter_reduce_logs": meter_reduce_logs[-500:],
        "ball_type": ball_type_var.get(),
        "extra_rate": extra_rate_var.get(),
        "pet_base": pet_base_var.get(),
    }


def save_state_to_disk(force=False):
    global last_saved_state_signature
    payload = build_state_payload()
    sig = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if (not force) and sig == last_saved_state_signature:
        return
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        last_saved_state_signature = sig
    except Exception:
        pass


def reset_all_counters():
    global use_count, throw_count, hit_count, captured_count
    global total_starlight, base_starlight_total, base_starlight_meter, base_star_parts
    global pollution_count, faded_pollution_count, meter_reduce_logs

    use_count = 0
    throw_count = 0
    hit_count = 0
    captured_count = 0
    total_starlight = 0
    base_starlight_total = 0
    base_starlight_meter = 0.0
    base_star_parts = {}
    pollution_count = 0
    faded_pollution_count = 0
    meter_reduce_logs = []

    refresh_stats()
    refresh_star_meter()
    save_state_to_disk(force=True)
    log("已执行数据重置", "#ff8800")


def confirm_reset_data():
    if not messagebox.askyesno("重置确认", "是否选择重置？\n重置后将清空当前累计数据。"):
        return
    reset_all_counters()


def on_closing():
    global running
    save_state_to_disk(force=True)
    running = False
    time.sleep(0.2)
    root.destroy()


def _set_shell_bg(color):
    root.configure(bg=color)
    main_container.configure(bg=color)
    right_area.configure(bg=color)
    indicator_row.configure(bg=color)
    control_bar.configure(bg=color)
    bottom_section.configure(bg=color)
    bottom_row.configure(bg=color)


def toggle_simplified_mode():
    global simplified_mode
    if not simplified_mode:
        bottom_section.pack_forget()
        frame.pack_forget()
        stats_frame.pack_forget()
        star_cfg_frame.pack_forget()
        meter_frame.pack_configure(padx=(0, 0), pady=10)
        simplified_panel.pack(before=right_area, side="left", fill="y", padx=(0, 0), pady=10)
        _set_shell_bg(TRANSPARENT_KEY)
        exit_button.pack_forget()
        dev_button.pack_forget()
        pin_button.pack_forget()
        reset_button.pack_forget()
        meter_log_button.pack_forget()
        simplify_button.pack_forget()
        simplify_button.pack(side="top", pady=4)
        try:
            root.wm_attributes("-transparentcolor", TRANSPARENT_KEY)
        except Exception:
            pass
        simplify_button.config(text="还原", bg="#6f45a8", activebackground="#8a62bf")
        simplified_mode = True
    else:
        try:
            root.wm_attributes("-transparentcolor", "#010204")
        except Exception:
            pass
        _set_shell_bg(UI_BG)
        simplified_panel.pack_forget()
        meter_frame.pack_configure(padx=(0, 8), pady=10)
        frame.pack(side="left", padx=8, pady=10)
        stats_frame.pack(side="left", padx=8, pady=10)
        star_cfg_frame.pack(side="left", padx=8, pady=10)
        bottom_section.pack(side="top", fill="x")
        simplify_button.pack_forget()
        exit_button.pack(side="top", pady=4)
        dev_button.pack(side="top", pady=5)
        pin_button.pack(side="top", pady=4)
        reset_button.pack(side="top", pady=4)
        meter_log_button.pack(side="top", pady=4)
        simplify_button.pack(side="top", pady=4)
        simplify_button.config(text="简化", bg="#4b5262", activebackground="#5b6478")
        simplified_mode = False


exit_button = tk.Button(control_bar, text="✕ 退出", font=BUTTON_FONT, bg="#3a3f4b", fg="white", relief="flat", width=BUTTON_WIDTH, height=BUTTON_HEIGHT, command=lambda: on_closing())
exit_button.pack(side="top", pady=4)


def open_dev_window():
    global dev_window, log_text, detect_value_1, detect_value_2

    def _alive(win):
        try:
            return win is not None and bool(win.winfo_exists())
        except Exception:
            return False

    # 兜底：如果已有同名开发窗口，复用第一个并清理其余重复窗口
    existed = []
    for w in root.winfo_children():
        try:
            if isinstance(w, tk.Toplevel) and w.winfo_exists() and w.title() == "开发面板":
                existed.append(w)
        except Exception:
            pass

    if existed:
        dev_window = existed[0]
        for w in existed[1:]:
            try:
                w.destroy()
            except Exception:
                pass
        try:
            dev_window.attributes("-topmost", True)
            dev_window.deiconify()
            dev_window.lift()
        except Exception:
            pass
        return

    if _alive(dev_window):
        try:
            dev_window.attributes("-topmost", True)
            dev_window.deiconify()
            dev_window.lift()
        except Exception:
            pass
        return

    dev_window = tk.Toplevel(root)
    dev_window.title("开发面板")
    dev_window.geometry("560x280")
    dev_window.configure(bg="#1e1e1e")
    dev_window.attributes("-topmost", True)

    def _on_dev_close():
        global dev_window, log_text, detect_value_1, detect_value_2
        try:
            dev_window.destroy()
        except Exception:
            pass
        dev_window = None
        log_text = None
        detect_value_1 = None
        detect_value_2 = None

    dev_window.protocol("WM_DELETE_WINDOW", _on_dev_close)

    body = tk.Frame(dev_window, bg="#1e1e1e")
    body.pack(fill="both", expand=True, padx=8, pady=8)

    log_text = scrolledtext.ScrolledText(body, height=10, width=30, font=("Consolas", 9), bg="#0d0d0d", fg="#00ff88", bd=0, highlightthickness=0)
    log_text.pack(side="left", fill="both", expand=True, padx=(0, 6))

    detect_panel = tk.Frame(body, bg="#1e1e1e", width=220)
    detect_panel.pack(side="left", fill="y")

    detect_box1 = tk.Frame(detect_panel, bg="#2d2d2d", width=200, height=60, relief="ridge", bd=2)
    detect_box1.pack_propagate(False)
    detect_box1.pack(side="top", fill="x", pady=(0, 6))

    detect_title_1 = tk.Label(detect_box1, text="区域1 1.png（捏球）", font=("Microsoft YaHei", 9, "bold"), fg="#aaaaaa", bg="#2d2d2d")
    detect_title_1.pack(anchor="w", padx=6, pady=(4, 0))

    detect_value_1 = tk.Label(detect_box1, text="匹配: 0.000 | 未命中", font=("Consolas", 9), fg="#cccccc", bg="#2d2d2d")
    detect_value_1.pack(anchor="w", padx=6)

    detect_box2 = tk.Frame(detect_panel, bg="#2d2d2d", width=200, height=60, relief="ridge", bd=2)
    detect_box2.pack_propagate(False)
    detect_box2.pack(side="top", fill="x")

    detect_title_2 = tk.Label(detect_box2, text="区域2 2.png（抓到）", font=("Microsoft YaHei", 9, "bold"), fg="#aaaaaa", bg="#2d2d2d")
    detect_title_2.pack(anchor="w", padx=6, pady=(4, 0))

    detect_value_2 = tk.Label(detect_box2, text="匹配: 0.000 | 未命中", font=("Consolas", 9), fg="#cccccc", bg="#2d2d2d")
    detect_value_2.pack(anchor="w", padx=6)

    # 回填历史日志
    for line, color in dev_log_buffer[-300:]:
        log_text.insert(tk.END, line + "\n")
        tag = f"c{abs(hash((line, color))) % 1000000}"
        log_text.tag_add(tag, "end-2l", "end-1l")
        log_text.tag_config(tag, foreground=color)
    log_text.see(tk.END)


def _build_meter_log_lines():
    if not meter_reduce_logs:
        return ["暂无记录"]
    lines = []
    for i, item in enumerate(meter_reduce_logs, start=1):
        if isinstance(item, dict):
            t = str(item.get("time", "--:--:--"))
            b = int(_to_int(item.get("before"), 0))
            a = int(_to_int(item.get("after"), 0))
            lines.append(f"{i:03d}. [{t}] Num+ 前={b}，清空后={a}")
        else:
            lines.append(f"{i:03d}. {item}")
    return lines


def refresh_meter_log_view():
    if meter_log_text is None or (not meter_log_text.winfo_exists()):
        return
    meter_log_text.config(state="normal")
    meter_log_text.delete("1.0", tk.END)
    meter_log_text.insert(tk.END, "\n".join(_build_meter_log_lines()))
    meter_log_text.config(state="disabled")
    meter_log_text.see(tk.END)


def open_meter_log_window():
    global meter_log_window, meter_log_text

    def _alive(win):
        try:
            return win is not None and bool(win.winfo_exists())
        except Exception:
            return False

    if _alive(meter_log_window):
        meter_log_window.deiconify()
        meter_log_window.lift()
        refresh_meter_log_view()
        return

    meter_log_window = tk.Toplevel(root)
    meter_log_window.title("计量日志")
    meter_log_window.geometry("420x320")
    meter_log_window.configure(bg="#1e1e1e")
    meter_log_window.attributes("-topmost", True)

    def _on_close():
        global meter_log_window, meter_log_text
        try:
            meter_log_window.destroy()
        except Exception:
            pass
        meter_log_window = None
        meter_log_text = None

    meter_log_window.protocol("WM_DELETE_WINDOW", _on_close)

    title = tk.Label(meter_log_window, text="Num+ 计量日志（记录按下时基础星光）", font=("Microsoft YaHei", 10, "bold"), fg="#d8b8ff", bg="#1e1e1e")
    title.pack(anchor="w", padx=10, pady=(8, 6))

    meter_log_text = scrolledtext.ScrolledText(meter_log_window, width=50, height=14, font=("Consolas", 10), bg="#0d0d0d", fg="#d7d7d7", bd=0, highlightthickness=0)
    meter_log_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))
    refresh_meter_log_view()


dev_button = tk.Button(control_bar, text="开发", font=BUTTON_FONT, bg="#b00020", fg="white", relief="flat", width=BUTTON_WIDTH, height=BUTTON_HEIGHT, command=open_dev_window)
dev_button.pack(side="top", pady=5)

pin_button = tk.Button(control_bar, text="📌 置顶", font=BUTTON_FONT, bg="#3a3f4b", fg="white", relief="flat", width=BUTTON_WIDTH, height=BUTTON_HEIGHT, command=toggle_topmost)
pin_button.pack(side="top", pady=4)

reset_button = tk.Button(control_bar, text="重置", font=BUTTON_FONT, bg="#ff8800", fg="white", relief="flat", width=BUTTON_WIDTH, height=BUTTON_HEIGHT, command=confirm_reset_data)
reset_button.pack(side="top", pady=4)

meter_log_button = tk.Button(control_bar, text="计量日志", font=BUTTON_FONT, bg="#5b3f9c", fg="white", relief="flat", width=BUTTON_WIDTH, height=BUTTON_HEIGHT, command=open_meter_log_window)
meter_log_button.pack(side="top", pady=4)

simplify_button = tk.Button(control_bar, text="简化", font=BUTTON_FONT, bg="#4b5262", fg="white", relief="flat", width=BUTTON_WIDTH, height=BUTTON_HEIGHT, command=toggle_simplified_mode)
simplify_button.pack(side="top", pady=4)


def log(msg, color="#00ff88"):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    dev_log_buffer.append((line, color))
    if log_text is not None and log_text.winfo_exists():
        log_text.insert(tk.END, line + "\n")
        tag = f"c{abs(hash((line, color))) % 1000000}"
        log_text.tag_add(tag, "end-2l", "end-1l")
        log_text.tag_config(tag, foreground=color)
        log_text.see(tk.END)


def set_indicator_color(color):
    indicator_canvas.itemconfig(indicator_light, fill=color)
    simplified_indicator_canvas.itemconfig(simplified_indicator_light, fill=color)


def _blend_hex_color(c_from, c_to, t):
    t = max(0.0, min(1.0, float(t)))
    rf, gf, bf = int(c_from[1:3], 16), int(c_from[3:5], 16), int(c_from[5:7], 16)
    rt, gt, bt = int(c_to[1:3], 16), int(c_to[3:5], 16), int(c_to[5:7], 16)
    r = int(rf + (rt - rf) * t)
    g = int(gf + (gt - gf) * t)
    b = int(bf + (bt - bf) * t)
    return f"#{r:02x}{g:02x}{b:02x}"


def show_meter_gain_hint(base_gain):
    global meter_gain_anim_token
    try:
        val = int(base_gain)
    except Exception:
        return
    if val <= 0:
        return

    meter_gain_anim_token += 1
    token = meter_gain_anim_token
    meter_gain_hint_label.config(text=f"+{val}", fg="#b84dff")

    total_steps = 14  # 14 * 100ms = 1.4s

    def _fade(step):
        if token != meter_gain_anim_token:
            return
        if step >= total_steps:
            meter_gain_hint_label.config(text="")
            return
        color = _blend_hex_color("#b84dff", "#2d2d2d", step / (total_steps - 1))
        meter_gain_hint_label.config(fg=color)
        root.after(100, lambda: _fade(step + 1))

    _fade(0)


def get_shiny_probability_percent(count):
    if count <= 59:
        return 1.8
    if count >= 80:
        return 100.0
    # 60 -> 10%, 79 -> 50%，中间线性递增
    return 10.0 + (count - 60) * (40.0 / 19.0)


def refresh_stats():
    hit_rate = (hit_count / throw_count * 100.0) if throw_count > 0 else 0.0
    capture_rate = (captured_count / hit_count * 100.0) if hit_count > 0 else 0.0
    capture_rate_ratio = (captured_count / hit_count) if hit_count > 0 else 0.0
    try:
        pet_base = max(0.0, float(pet_base_var.get().strip()))
    except Exception:
        pet_base = 0.0
    pollute_prob = pet_base / 700.0
    expected_star = pet_base * capture_rate_ratio
    avg_balls = (700.0 / expected_star) if expected_star > 1e-9 else 0.0
    actual_pollute_prob = (pollution_count / hit_count) if hit_count > 0 else 0.0
    actual_expected_star = (base_starlight_total / hit_count) if hit_count > 0 else 0.0
    actual_avg_balls = (hit_count / pollution_count) if pollution_count > 0 else 0.0
    shiny_prob = get_shiny_probability_percent(pollution_count)

    update_use_count_digits(use_count)
    throw_label.config(text=f"丢球数量：{throw_count}")
    hit_label.config(text=f"命中数量：{hit_count}")
    rate_label.config(text=f"命中率：{hit_rate:.1f}%")
    captured_label.config(text=f"抓到精灵：{captured_count}")
    capture_rate_label.config(text=f"捕获率：{capture_rate:.1f}%")
    total_star_label.config(text=f"总星光：{total_starlight}")
    base_star_label.config(text=f"基础星光累计：{int(round(base_starlight_total))}")
    pollute_prob_label.config(text=f"单球出污染概率 = 宠物基础星光值 / 700 = {pollute_prob * 100.0:.2f}% / 当前实际值 = {actual_pollute_prob * 100.0:.2f}%")
    expected_star_label.config(text=f"单球期望星光 = 宠物基础星光值 × 捕获率 = {expected_star:.2f} / 当前实际值 = {actual_expected_star:.2f}")
    avg_balls_label.config(
        text=(
            f"平均多少球出一个污染 = 700 / 单球期望星光 = {avg_balls:.2f} / 当前实际值 = {actual_avg_balls:.2f}"
            if avg_balls > 0 and actual_avg_balls > 0
            else f"平均多少球出一个污染 = 700 / 单球期望星光 = {'∞' if avg_balls <= 0 else f'{avg_balls:.2f}'} / 当前实际值 = {'∞' if actual_avg_balls <= 0 else f'{actual_avg_balls:.2f}'}"
        )
    )
    update_pollution_count_digits(pollution_count)
    simp_captured_label.config(text=f"抓到精灵：{captured_count}")
    simp_hit_label.config(text=f"命中数量：{hit_count}")
    simp_pollute_prob_label.config(text=f"单球出污染概率：{pollute_prob * 100.0:.2f}%")
    simp_shiny_prob_label.config(text=f"褪色出异色概率：{shiny_prob:.1f}%")
    faded_pollution_label.config(text=f"褪色污染计数：{faded_pollution_count}")
    shiny_prob_label.config(text=f"当前污染褪色时出异色的概率：{shiny_prob:.1f}%")
    if base_star_detail_visible and base_star_detail_popup is not None and base_star_detail_popup.winfo_exists() and base_star_detail_text is not None:
        base_star_detail_text.config(state="normal")
        base_star_detail_text.delete("1.0", tk.END)
        base_star_detail_text.insert(tk.END, get_base_star_details_text())
        base_star_detail_text.config(state="disabled")
    save_state_to_disk()


def get_base_star_details_text():
    if not base_star_parts:
        return "基础星光组成：暂无记录"
    lines = ["基础星光组成："]
    for val in sorted(base_star_parts.keys()):
        lines.append(f"基础{val}星光：{base_star_parts[val]}次")
    return "\n".join(lines)


def show_base_star_details():
    global base_star_detail_visible, base_star_detail_popup, base_star_detail_text

    def close_popup():
        global base_star_detail_visible, base_star_detail_popup, base_star_detail_text
        if base_star_detail_popup is not None and base_star_detail_popup.winfo_exists():
            base_star_detail_popup.destroy()
        base_star_detail_popup = None
        base_star_detail_text = None
        base_star_detail_visible = False
        detail_btn.config(text="?")

    if base_star_detail_visible and base_star_detail_popup is not None and base_star_detail_popup.winfo_exists():
        close_popup()
        return

    base_star_detail_popup = tk.Toplevel(root)
    base_star_detail_popup.title("基础星光组成")
    base_star_detail_popup.configure(bg="#1e1e1e")
    base_star_detail_popup.geometry("340x240")
    base_star_detail_popup.resizable(False, False)
    base_star_detail_popup.transient(root)

    try:
        px = detail_btn.winfo_rootx() + 20
        py = detail_btn.winfo_rooty() + 24
        base_star_detail_popup.geometry(f"340x240+{px}+{py}")
    except Exception:
        pass

    title = tk.Label(base_star_detail_popup, text="基础星光组成明细", font=("Microsoft YaHei", 10, "bold"), fg="#ffffff", bg="#1e1e1e")
    title.pack(anchor="w", padx=10, pady=(8, 6))

    base_star_detail_text = scrolledtext.ScrolledText(base_star_detail_popup, width=36, height=10, font=("Consolas", 10), bg="#0d0d0d", fg="#d7d7d7", bd=0, highlightthickness=0)
    base_star_detail_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))
    base_star_detail_text.insert(tk.END, get_base_star_details_text())
    base_star_detail_text.config(state="disabled")

    base_star_detail_popup.protocol("WM_DELETE_WINDOW", close_popup)
    base_star_detail_visible = True
    detail_btn.config(text="×")


def get_extra_rate_percent():
    try:
        return max(0.0, float(extra_rate_var.get().strip()))
    except Exception:
        return 0.0


def refresh_star_meter():
    meter_canvas.delete("all")
    cw = int(meter_canvas.cget("width"))
    ch = int(meter_canvas.cget("height"))
    pad = 4
    x1 = pad
    y1 = pad
    x2 = cw - pad
    y2 = ch - pad

    # 整体计量背景（灰）
    meter_canvas.create_rectangle(x1, y1, x2, y2, outline="#666666", fill="#4a4a4a", width=2)

    meter_now = max(0.0, float(base_starlight_meter))
    left_max = float(STAR_METER_MAX)
    right_max = max(left_max + 1.0, float(STAR_METER_RIGHT_MAX))
    right_span = right_max - left_max

    mid_x = (x1 + x2) // 2
    meter_canvas.create_line(mid_x, y1 + 1, mid_x, y2 - 1, fill="#777777", width=1)

    inner_top = y1 + 2
    inner_bottom = y2 - 2
    inner_height = max(1, inner_bottom - inner_top)

    # 左半：0~700
    left_x1, left_x2 = x1 + 2, mid_x - 1
    meter_canvas.create_rectangle(left_x1, inner_top, left_x2, inner_bottom, outline="", fill="#3f3f3f")
    left_ratio = min(max(meter_now / left_max, 0.0), 1.0)
    left_fill_h = int(inner_height * left_ratio)
    if left_fill_h > 0:
        lf_y1 = inner_bottom - left_fill_h
        meter_canvas.create_rectangle(left_x1, lf_y1, left_x2, inner_bottom, outline="", fill="#b84dff")

    # 右半：700~1370
    right_x1, right_x2 = mid_x + 1, x2 - 2
    meter_canvas.create_rectangle(right_x1, inner_top, right_x2, inner_bottom, outline="", fill="#3f3f3f")
    right_progress = max(0.0, meter_now - left_max)
    right_ratio = min(right_progress / right_span, 1.0)
    right_fill_h = int(inner_height * right_ratio)
    if right_fill_h > 0:
        rf_y1 = inner_bottom - right_fill_h
        meter_canvas.create_rectangle(right_x1, rf_y1, right_x2, inner_bottom, outline="", fill="#7f9dff")

    meter_denom = int(round(left_max if meter_now <= left_max else right_max))
    meter_value_label.config(text=f"{int(round(meter_now))} / {meter_denom}")


def update_detect_status(score1, score2):
    hit1 = score1 >= VISUAL_THRESHOLD
    hit2 = score2 >= CAPTURE_VISUAL_THRESHOLD

    if detect_value_1 is not None and detect_value_1.winfo_exists():
        detect_value_1.config(
            text=f"匹配: {score1:.3f} | {'命中' if hit1 else '未命中'}",
            fg="#ffd24d" if hit1 else "#cccccc"
        )
    if detect_value_2 is not None and detect_value_2.winfo_exists():
        detect_value_2.config(
            text=f"匹配: {score2:.3f} | {'命中' if hit2 else '未命中'}",
            fg="#00aaff" if hit2 else "#cccccc"
        )


def read_star_value_from_region():
    global ocr_unavailable_warned
    if pytesseract is None:
        if not ocr_unavailable_warned:
            log("OCR不可用：未安装 pytesseract（仅影响星光读取）", "#ff8800")
            ocr_unavailable_warned = True
        return None

    region = {
        "left": STAR_OCR_X1,
        "top": STAR_OCR_Y1,
        "width": STAR_OCR_X2 - STAR_OCR_X1,
        "height": STAR_OCR_Y2 - STAR_OCR_Y1,
    }
    with mss.mss() as sct:
        img = np.array(sct.grab(region))

    gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    gray = cv2.resize(gray, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 去掉左侧容易引入噪声的区域（常见图标/装饰），只保留数字主体
    cut_x = int(th.shape[1] * 0.18)
    roi = th[:, cut_x:]

    ocr_candidates = []
    for im in (roi, cv2.bitwise_not(roi)):
        text = pytesseract.image_to_string(
            im,
            config="--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789"
        )
        nums = re.findall(r"\d+", text)
        for s in nums:
            # 原值
            try:
                ocr_candidates.append(int(s))
            except Exception:
                pass
            # 尾数候选：处理 4102 -> 102 这类前缀脏字符
            if len(s) > 3:
                try:
                    ocr_candidates.append(int(s[-3:]))
                except Exception:
                    pass
            if len(s) > 2:
                try:
                    ocr_candidates.append(int(s[-2:]))
                except Exception:
                    pass

    valid = [v for v in ocr_candidates if STAR_OCR_MIN <= v <= STAR_OCR_MAX]
    if not valid:
        return None

    # 取最高频候选；并列时取更大的值，避免偏向短尾数
    cnt = Counter(valid)
    best = max(cnt.items(), key=lambda kv: (kv[1], kv[0]))[0]
    return best


def is_numpad_plus_down():
    return bool(ctypes.windll.user32.GetAsyncKeyState(_safe_vk(HOTKEY_CLEAR_VK, 0x6B)) & 0x8000)


def is_numpad_minus_down():
    return bool(ctypes.windll.user32.GetAsyncKeyState(_safe_vk(HOTKEY_FADED_VK, 0x6D)) & 0x8000)


def is_alt_down():
    # VK_MENU = Alt
    return bool(ctypes.windll.user32.GetAsyncKeyState(0x12) & 0x8000)


# ====================== 核心函数 ======================
def is_left_down():
    return bool(ctypes.windll.user32.GetAsyncKeyState(0x01) & 0x8000)


def max_pearson_score(search_signal, ref_centered, ref_norm):
    n = len(ref_centered)
    if len(search_signal) < n:
        return 0.0

    x = search_signal.astype(np.float64, copy=False)
    numerators = correlate(x, ref_centered, mode="valid")

    csum = np.concatenate(([0.0], np.cumsum(x)))
    csum2 = np.concatenate(([0.0], np.cumsum(x * x)))
    win_sum = csum[n:] - csum[:-n]
    win_sum2 = csum2[n:] - csum2[:-n]
    var_term = np.maximum(win_sum2 - (win_sum * win_sum) / n, 1e-12)
    win_norm = np.sqrt(var_term)

    scores = np.abs(numerators) / (win_norm * ref_norm + 1e-8)
    return float(np.max(scores)) if len(scores) > 0 else 0.0


def get_best_hit_score_and_name(audio_buffer):
    best_score = 0.0
    best_name = "-"
    for ref_centered, ref_norm, ref_len, file_name in hit_ref_features:
        search_margin = int(sample_rate * SEARCH_MARGIN_SEC)
        search_len = ref_len + search_margin
        if len(audio_buffer) < search_len:
            continue
        segment = audio_buffer[-search_len:]
        score = max_pearson_score(segment, ref_centered, ref_norm)
        if score > best_score:
            best_score = score
            best_name = file_name
    return best_score, best_name


def get_visual_match_score(template, region):
    with mss.mss() as sct:
        img = np.array(sct.grab(region))
    gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    score = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)[0, 0]
    return float(score)


# ====================== 资源加载 ======================
def load_template():
    global template_gray, capture_region, capture_template_gray, capture_region_2
    template_gray_local = cv2.imread(TEMPLATE_FILE, cv2.IMREAD_GRAYSCALE)
    if template_gray_local is None:
        raise FileNotFoundError(f"未找到模板图片: {TEMPLATE_FILE}")

    h, w = template_gray_local.shape
    left = int(TARGET_CENTER_X - w / 2)
    top = int(TARGET_CENTER_Y - h / 2)

    template_gray = template_gray_local
    capture_region = {"left": left, "top": top, "width": w, "height": h}

    # 2.png（抓到精灵）
    capture_template_local = cv2.imread(CAPTURE_TEMPLATE_FILE, cv2.IMREAD_GRAYSCALE)
    if capture_template_local is None:
        raise FileNotFoundError(f"未找到模板图片: {CAPTURE_TEMPLATE_FILE}")

    h2, w2 = capture_template_local.shape
    left2 = int(CAPTURE_CENTER_X - w2 / 2)
    top2 = int(CAPTURE_CENTER_Y - h2 / 2)

    capture_template_gray = capture_template_local
    capture_region_2 = {"left": left2, "top": top2, "width": w2, "height": h2}


def load_hit_audio_refs():
    global sample_rate
    resolved_audio_files = []
    missing = []
    for f in HIT_AUDIO_FILES:
        local_path = f
        bundle_path = get_bundle_resource_path(f)
        if os.path.exists(local_path):
            resolved_audio_files.append(local_path)
        elif os.path.exists(bundle_path):
            resolved_audio_files.append(bundle_path)
        else:
            missing.append(f)
    if missing:
        raise FileNotFoundError(f"缺少命中音频模板: {missing}")

    for fp in resolved_audio_files:
        with wave.open(fp, "rb") as wf:
            data = wf.readframes(wf.getnframes())
            audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            if wf.getnchannels() > 1:
                audio = audio.reshape(-1, wf.getnchannels()).mean(axis=1)
            audio = audio / (np.max(np.abs(audio)) + 1e-8)
            ref_centered = audio - np.mean(audio)
            ref_norm = np.linalg.norm(ref_centered) + 1e-8
            hit_ref_features.append((ref_centered, ref_norm, len(audio), os.path.basename(fp)))
            if sample_rate is None:
                sample_rate = wf.getframerate()


def find_audio_device_index(p):
    # 仅按关键词匹配（推荐 VBCABLE）
    for kw in DEVICE_KEYWORDS:
        for i in range(p.get_device_count()):
            info = p.get_device_info_by_index(i)
            if info["maxInputChannels"] > 0 and kw.lower() in info["name"].lower():
                log(f"锁定监听设备: {info['name']}", "#00ff00")
                return i

    return None


def ensure_audio_device_before_start():
    p = pyaudio.PyAudio()
    try:
        idx = find_audio_device_index(p)
    finally:
        p.terminate()
    if idx is None:
        messagebox.showerror("音频设备错误", "未找到 VBCABLE 监听设备。\n请先启用/安装 VBCABLE 后再启动程序。")
        return False
    return True


# ====================== 线程1：音频采集 ======================
def audio_capture_loop():
    global buffer
    p = pyaudio.PyAudio()
    log("正在搜索音频设备...", "#ffff00")
    device_index = find_audio_device_index(p)

    if device_index is None:
        log("未找到 VBCABLE 设备", "#ff0000")
        p.terminate()
        return

    stream = None
    last_err = None
    candidate_rates = []
    for r in [sample_rate, 48000, 44100]:
        if r and int(r) not in candidate_rates:
            candidate_rates.append(int(r))
    if not candidate_rates:
        candidate_rates = [48000, 44100]

    for rate_try in candidate_rates:
        for use_loopback in (True, False):
            try:
                kwargs = dict(
                    format=pyaudio.paFloat32,
                    channels=1,
                    rate=rate_try,
                    input=True,
                    input_device_index=device_index,
                    frames_per_buffer=1024,
                )
                if use_loopback:
                    kwargs["as_loopback"] = True
                stream = p.open(**kwargs)
                rate = rate_try
                break
            except Exception as e:
                last_err = e
                continue
        if stream is not None:
            break

    if stream is None:
        log(f"音频流打开失败: {last_err}", "#ff0000")
        p.terminate()
        return

    log(f"✅ 音频监听已启动 ({rate}Hz)", "#00ff00")

    while running:
        try:
            data = stream.read(1024, exception_on_overflow=False)
            chunk = np.frombuffer(data, dtype=np.float32)

            with buffer_lock:
                buffer = np.append(buffer, chunk)
                max_len = int(rate * BUFFER_SEC)
                if len(buffer) > max_len:
                    buffer = buffer[-max_len:]
        except Exception as e:
            log(f"音频线程错误: {e}", "#ff0000")
            break

    stream.stop_stream()
    stream.close()
    p.terminate()


# ====================== 线程2：状态机 ======================
def state_machine_loop():
    global mouse_left_down_prev, in_squeeze_state
    global throw_window_active, throw_window_deadline, last_debug_print_time
    global use_count, throw_count, hit_count, captured_count, capture_present_prev
    global last_capture_time, num_plus_prev, num_minus_prev, total_starlight, base_starlight_total, base_starlight_meter, base_star_parts, pollution_count, faded_pollution_count
    global alt_prev, cursor_hide_paused

    while running:
        try:
            now = time.time()
            left_down = is_left_down()

            # Alt 单击切换：置顶时可暂停/恢复窗口内隐藏鼠标
            alt_down = is_alt_down()
            if alt_down and not alt_prev:
                cursor_hide_paused = not cursor_hide_paused
                root.after(0, apply_cursor_visibility_policy)
                if cursor_hide_paused:
                    log("ALT切换：已暂停隐藏鼠标指针", "#bfa6d9")
                else:
                    log("ALT切换：已恢复隐藏鼠标指针", "#bfa6d9")
            alt_prev = alt_down

            # 抓到精灵检测：2.png 出现一次计一次（上升沿）
            capture_score = get_visual_match_score(capture_template_gray, capture_region_2)
            capture_now = capture_score >= CAPTURE_VISUAL_THRESHOLD
            if capture_now and not capture_present_prev and (now - last_capture_time) >= CAPTURE_COOLDOWN_SEC:
                captured_count += 1
                last_capture_time = now

                # 仅在图2突破阈值时，读取第三区域OCR星光
                star_gain = read_star_value_from_region()
                if star_gain is not None:
                    total_starlight += star_gain
                    extra_rate = get_extra_rate_percent()
                    base_gain_raw = star_gain / (1.0 + extra_rate / 100.0)
                    base_gain = int(round(base_gain_raw))
                    base_starlight_total += base_gain
                    base_starlight_meter = max(0.0, base_starlight_meter + base_gain)
                    base_star_parts[base_gain] = base_star_parts.get(base_gain, 0) + 1
                    root.after(0, lambda v=base_gain: show_meter_gain_hint(v))
                    log(f"抓到一只精灵（匹配 {capture_score:.3f}）| 星光+{star_gain} | 基础+{base_gain}", "#00aaff")
                else:
                    log(f"抓到一只精灵（匹配 {capture_score:.3f}）| 星光OCR失败", "#00aaff")

                root.after(0, refresh_stats)
                root.after(0, refresh_star_meter)
            capture_present_prev = capture_now

            # 区域1实时分数（用于状态框显示）
            visual_score = get_visual_match_score(template_gray, capture_region)

            root.after(0, lambda s1=visual_score, s2=capture_score: update_detect_status(s1, s2))

            # 捏球判定：左键按住 + 图像匹配达到阈值
            if left_down:
                if visual_score >= VISUAL_THRESHOLD:
                    if not in_squeeze_state:
                        in_squeeze_state = True
                        set_indicator_color("#ffd24d")  # 黄色：捏球状态
                        log(f"进入捏球状态 (图像匹配 {visual_score:.3f})", "#ffff00")

            # 左键释放：若之前处于捏球状态，则进入一次独立丢球检测窗口
            if (not left_down) and mouse_left_down_prev and in_squeeze_state:
                in_squeeze_state = False
                throw_window_active = True
                throw_window_deadline = now + THROW_DETECT_WINDOW_SEC
                set_indicator_color("#333333")  # 灰色：已丢出，等待命中结果
                throw_count += 1
                root.after(0, refresh_stats)
                log(f"进入丢球检测窗口：0~{THROW_DETECT_WINDOW_SEC:.1f}s", "#ffff00")

            mouse_left_down_prev = left_down

            # 丢球状态：做一次独立检测
            if throw_window_active:
                if now > throw_window_deadline:
                    log("丢球结果：未命中（超时）", "#ff8800")
                    set_indicator_color("#333333")
                    throw_window_active = False
                else:
                    with buffer_lock:
                        buf_copy = buffer.copy()

                    score, ref_name = get_best_hit_score_and_name(buf_copy)

                    if score >= DEBUG_MIN_SCORE and now - last_debug_print_time >= DEBUG_LOG_COOLDOWN:
                        res = "【命中!!】" if score >= AUDIO_THRESHOLD else "失败"
                        print(f"DEBUG[丢球检测] {res} | 模板: {ref_name} | 相似度: {score:.3f}")
                        last_debug_print_time = now

                    if score >= AUDIO_THRESHOLD:
                        log(f"丢球命中 → 模板 {ref_name} (相似度 {score:.3f})", label_color)
                        set_indicator_color("#00ff00")  # 绿色：命中
                        hit_count += 1
                        use_count = hit_count
                        root.after(0, refresh_stats)
                        throw_window_active = False

            # Num+ 手动清空计量表
            num_plus_down = is_numpad_plus_down()
            if num_plus_down and not num_plus_prev:
                meter_before = int(round(max(0.0, base_starlight_meter)))
                base_starlight_meter = 0.0
                meter_after = int(round(max(0.0, base_starlight_meter)))
                meter_reduce_logs.append({
                    "time": time.strftime("%H:%M:%S"),
                    "before": meter_before,
                    "after": meter_after,
                })
                pollution_count += 1
                root.after(0, refresh_stats)
                root.after(0, refresh_star_meter)
                root.after(0, refresh_meter_log_view)
                log(f"Num+记录：当前基础星光={meter_before}，清空后={meter_after} | 总污染计数={pollution_count}", "#b84dff")
            num_plus_prev = num_plus_down

            # Num- 记录褪色污染：仅褪色污染+1
            num_minus_down = is_numpad_minus_down()
            if num_minus_down and not num_minus_prev:
                faded_pollution_count += 1
                root.after(0, refresh_stats)
                log(f"记录褪色污染（Num-）| 褪色污染计数={faded_pollution_count}", "#c78cff")
            num_minus_prev = num_minus_down

            time.sleep(0.03)

        except Exception as e:
            log(f"状态机线程错误: {e}", "#ff0000")
            time.sleep(0.1)


# ====================== 启动 ======================
try:
    load_template()
    load_hit_audio_refs()
except Exception as e:
    log(f"初始化失败: {e}", "#ff0000")

if not ensure_audio_device_before_start():
    root.destroy()
    raise SystemExit(1)

threading.Thread(target=audio_capture_loop, daemon=True).start()
threading.Thread(target=state_machine_loop, daemon=True).start()

root.protocol("WM_DELETE_WINDOW", on_closing)
detail_btn.config(command=show_base_star_details)
refresh_stats()
refresh_star_meter()
root.mainloop()