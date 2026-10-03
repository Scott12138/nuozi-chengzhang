#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「手机真机试玩」二维码（HTML 原型版）。

★ 依赖装在受管的 venv 里，系统的 python3 没有 qrcode/PIL —— 必须这样调：
    /Users/consli/.workbuddy/binaries/python/envs/default/bin/python tools/make-preview-qr.py ...
  （用 /usr/bin/python3 会直接 ModuleNotFoundError: No module named 'qrcode'）

和微信小游戏的 tools/wechat-preview.sh 不是一个东西：
- 微信真机码：需要 微信开发者工具 + AppID + 真实小游戏工程（M1 之后的事）
- 本脚本：把项目根目录用局域网 HTTP 服务暴露出去，手机同 WiFi 扫码直接浏览器打开

用法：
    # 1) 先起局域网服务 —— ★ 服务根目录必须是「项目根」，不是 prototype/
    #    （因为 design/ 下的评审页也在 prototype 目录之外）
    python3 -m http.server 8848 --bind <LAN_IP> --directory .
    # 2) 再生成码
    python3 tools/make-preview-qr.py --host <LAN_IP> --port 8848 --outdir shots

产出的每张 PNG 都会做一次「自己解回来」的校验，确保扫出来就是目标地址。
"""
import argparse
import os
import sys

import qrcode
from PIL import Image, ImageDraw, ImageFont

# 手机上没有 DevTools，直接给最值得看的入口
ENTRIES = [
    ("01-选关页（本轮改动入口）", "/prototype/index.html?s=chap",
     "38 关：8 / 8 / 12 / 10 关"),
    ("02-第 1 关（教学关）", "/prototype/index.html?s=play&lv=1",
     "木 / 钅 两种偏旁；按住在牌上滑"),
    ("03-第 24 关（一关四张鸟）", "/prototype/index.html?s=play&lv=24",
     "鸽鹅鹊鸭 右半边全是「鸟」"),
    ("04-第 38 关（终章综合）", "/prototype/index.html?s=play&lv=38",
     "火 竹 钅 纟 四偏旁混排 · 7×7"),
]

CJK_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]


def load_font(size):
    for p in CJK_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def fit_font(d, text, size, maxw):
    """按实际渲染宽度自动缩字号 —— 中文副标题很容易顶出卡片被硬裁掉。"""
    f = load_font(size)
    while size > 13 and d.textlength(text, font=f) > maxw:
        size -= 2
        f = load_font(size)
    return f


def render(label, subtitle, url, out_path):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#1f2a24", back_color="white").convert("RGB")

    pad = 28
    header_h = 112
    footer_h = 52
    W = max(qr_img.width + pad * 2, 640)
    H = header_h + qr_img.height + footer_h + pad

    canvas = Image.new("RGB", (W, H), "#f7f3e8")  # 宣纸底
    d = ImageDraw.Draw(canvas)

    # 顶部标题条（字号按卡片宽度自适应，超宽就缩小，绝不裁字）
    d.rectangle([0, 0, W, header_h - 14], fill="#2f4f3e")
    f_label = fit_font(d, label, 34, W - pad * 2)
    f_sub = fit_font(d, subtitle, 22, W - pad * 2)
    d.text((pad, 16), label, font=f_label, fill="#f2e6c8")
    d.text((pad, 62), subtitle, font=f_sub, fill="#c8d8c2")

    qx = (W - qr_img.width) // 2
    canvas.paste(qr_img, (qx, header_h))
    d.rectangle([qx - 6, header_h - 6, qx + qr_img.width + 5, header_h + qr_img.height + 5],
                outline="#2f4f3e", width=3)

    uy = header_h + qr_img.height + 14
    f_url = fit_font(d, url, 20, W - pad * 2)
    tw = d.textlength(url, font=f_url)
    d.text(((W - tw) // 2, uy), url, font=f_url, fill="#5a6b5f")

    canvas.save(out_path)
    return out_path


def decode_qr(path):
    """用 OpenCV 把刚生成的图真的解回来。解不出/不一致都算失败。"""
    try:
        import cv2
    except ImportError:
        return None, "未安装 opencv-python-headless，跳过解码自检"
    img = cv2.imread(path)
    if img is None:
        return None, "读图失败"
    data, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    if not data:
        return None, "解码为空（图可能损坏）"
    return data, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True, help="本机局域网 IP，如 192.168.0.100")
    ap.add_argument("--port", default="8848")
    ap.add_argument("--outdir", default="shots")
    ap.add_argument("--prefix", default="preview-qr")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    base = f"http://{args.host}:{args.port}"

    made, failed = [], []
    for label, path, subtitle in ENTRIES:
        url = base + path
        idx = label.split("-")[0]
        out = os.path.join(args.outdir, f"{args.prefix}-{idx}.png")
        render(label, subtitle, url, out)

        got, err = decode_qr(out)
        if err:
            failed.append((out, url, err))
            print(f"  ✗ {os.path.basename(out)}  自检失败：{err}  （应为 {url}）")
        elif got != url:
            failed.append((out, url, f"解码不符：{got}"))
            print(f"  ✗ {os.path.basename(out)}  解码不符：{got}  ≠  {url}")
        else:
            made.append((label, url, out))
            print(f"  ✓ {os.path.basename(out)}  解码校验通过 -> {got}")

    print()
    print(f"通过 {len(made)} / {len(made) + len(failed)} 张，输出目录：{os.path.abspath(args.outdir)}")
    print("提醒：手机需与本机在同一个 WiFi；打不开多半是 macOS 防火墙或路由器 AP 隔离。")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
