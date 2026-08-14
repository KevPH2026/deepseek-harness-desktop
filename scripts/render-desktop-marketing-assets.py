#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs/user/marketing"
BACKDROP = OUTPUT / "deepseek-harness-desktop-feature-backdrop.png"
SCREENSHOT = ROOT / "docs/user/deepseek-harness-desktop-plugin-marketplace.zh.png"
ICON = ROOT / "apps/desktop/build/icon.icns"
FFMPEG = Path("/opt/homebrew/bin/ffmpeg")
PINGFANG = Path(
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/"
    "86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc"
)
SF_PRO = Path("/System/Library/Fonts/SFNS.ttf")
CANVAS = (1600, 900)


COPY = {
    "en": {
        "badge": "0.1.0-beta.1 · UNOFFICIAL COMMUNITY EDITION · APPLE SILICON",
        "hero_eyebrow": "DESKTOP AGENT WORKSPACE",
        "hero_title": "Reason. Build. Create. Deliver.",
        "hero_subtitle": (
            "One focused workspace for code, tools, media, models, and community extensions."
        ),
        "hero_footer": "From conversation to finished work.",
        "feature_eyebrow": "ONE WORKSPACE · SIX WAYS TO FINISH THE WORK",
        "feature_title": "A desktop agent workspace that grows with the task",
        "features": [
            ("Code & tools", "Inspect · plan · execute"),
            ("Image generation", "On demand · approval before spend"),
            ("Video generation", "Veo-compatible long tasks"),
            ("Models & gateways", "DeepSeek · compatible providers"),
            ("Plugin discovery", "Source facts · manifest validation"),
            ("Updates & feedback", "Release notes · controlled checks"),
        ],
        "plugin_eyebrow": "SOURCE-AWARE COMMUNITY CATALOG",
        "plugin_title": "Discover plugins with the source in view.",
        "plugin_points": [
            "Browse the dsh-plugin community topic",
            "Inspect license, revision, freshness, and risk",
            "Validate a pinned manifest before compatibility is shown",
            "Start from a copyable plugin template",
        ],
        "plugin_boundary": "INSTALLATION REMAINS DISABLED IN THIS BETA",
        "cta_eyebrow": "BUILT IN THE OPEN",
        "cta_title": "Help shape the desktop agent workspace.",
        "cta_subtitle": (
            "Star the repository. Follow the build. Share what you want to finish next."
        ),
        "cta_button": "★  STAR ON GITHUB",
    },
    "zh": {
        "badge": "0.1.0-beta.1 · 非官方社区版 · APPLE SILICON",
        "hero_eyebrow": "桌面 AGENT 工作台",
        "hero_title": "推理、执行、创作，直到真正交付",
        "hero_subtitle": (
            "把代码、工具、多模态、模型和社区扩展，放进一个专注的桌面工作区。"
        ),
        "hero_footer": "从对话，走到真正完成。",
        "feature_eyebrow": "一个工作区 · 六种方式把任务真正做完",
        "feature_title": "随任务生长的桌面 Agent 工作台",
        "features": [
            ("编程与工具", "查看 · 规划 · 执行"),
            ("图片生成", "按需调用 · 付费前审批"),
            ("视频生成", "Veo 兼容长任务"),
            ("模型与网关", "DeepSeek · 兼容服务"),
            ("插件发现", "来源可见 · Manifest 核验"),
            ("更新与反馈", "版本说明 · 可控检查"),
        ],
        "plugin_eyebrow": "来源清晰的社区插件目录",
        "plugin_title": "先看来源，再验证兼容性。",
        "plugin_points": [
            "同步 dsh-plugin 社区话题",
            "查看许可证、固定版本、更新时间与风险",
            "Manifest 通过核验后才显示结构兼容",
            "一键复制可用的插件起步模板",
        ],
        "plugin_boundary": "当前 BETA 的插件安装功能仍保持关闭",
        "cta_eyebrow": "在开源社区持续构建",
        "cta_title": "一起把桌面 Agent 工作台做得更好。",
        "cta_subtitle": (
            "Star 仓库，关注进展，也告诉我们你下一个想完成的任务。"
        ),
        "cta_button": "★  在 GITHUB 上 STAR",
    },
}


def require_inputs() -> None:
    for path in (BACKDROP, SCREENSHOT, ICON, FFMPEG, PINGFANG, SF_PRO):
        if not path.exists():
            raise FileNotFoundError(f"Missing marketing render dependency: {path}")


def font(locale: str, size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    if locale == "zh":
        return ImageFont.truetype(str(PINGFANG), size, index=11 if weight == "bold" else 3)
    return ImageFont.truetype(str(SF_PRO), size)


def fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    locale: str,
    start_size: int,
    max_width: int,
    weight: str = "regular",
) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > 12:
        candidate = font(locale, size, weight)
        if draw.textbbox((0, 0), text, font=candidate)[2] <= max_width:
            return candidate
        size -= 1
    return font(locale, size, weight)


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    max_width: int,
    locale: str,
) -> list[str]:
    units = list(text) if locale == "zh" else text.split(" ")
    separator = "" if locale == "zh" else " "
    lines: list[str] = []
    current = ""
    for unit in units:
        candidate = f"{current}{separator if current else ''}{unit}"
        if draw.textbbox((0, 0), candidate, font=text_font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = unit
    if current:
        lines.append(current)
    return lines


def draw_centered_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    center_x: int,
    top: int,
    text_font: ImageFont.FreeTypeFont,
    fill: str,
    spacing: int = 8,
) -> int:
    y = top
    for line in lines:
        box = draw.textbbox((0, 0), line, font=text_font)
        height = box[3] - box[1]
        draw.text((center_x, y), line, font=text_font, fill=fill, anchor="ma")
        y += height + spacing
    return y


def tint_icon(source: Image.Image, size: tuple[int, int], color: str) -> Image.Image:
    icon = ImageOps.contain(source.convert("RGBA"), size, Image.Resampling.LANCZOS)
    alpha = icon.getchannel("A")
    tinted = Image.new("RGBA", icon.size, color)
    tinted.putalpha(alpha)
    return tinted


def rounded_shot(
    canvas: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
) -> None:
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    fitted = ImageOps.fit(source.convert("RGB"), (width, height), Image.Resampling.LANCZOS)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width, height), radius=radius, fill=255)

    shadow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (left - 6, top + 8, right + 6, bottom + 18),
        radius=radius + 6,
        fill=(0, 0, 0, 170),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shadow)
    canvas.paste(fitted, (left, top), mask)
    ImageDraw.Draw(canvas, "RGBA").rounded_rectangle(
        box,
        radius=radius,
        outline=(103, 232, 249, 125),
        width=2,
    )


def backdrop_scene(dim: int = 35, blur: int = 0) -> Image.Image:
    background = ImageOps.fit(
        Image.open(BACKDROP).convert("RGB"),
        CANVAS,
        Image.Resampling.LANCZOS,
    )
    if blur:
        background = background.filter(ImageFilter.GaussianBlur(blur))
    background = ImageEnhance.Brightness(background).enhance((100 - dim) / 100)
    return background.convert("RGBA")


def draw_header(canvas: Image.Image, locale: str, icon_source: Image.Image) -> None:
    draw = ImageDraw.Draw(canvas, "RGBA")
    white_icon = tint_icon(icon_source, (42, 42), "#ffffff")
    canvas.alpha_composite(white_icon, (42, 28))
    draw.text(
        (98, 49),
        "DeepSeek Harness Desktop",
        font=font("en", 27, "bold"),
        fill="#f8fbff",
        anchor="lm",
    )
    badge_font = fit_text(draw, COPY[locale]["badge"], locale, 14, 530, "bold")
    badge_box = draw.textbbox((0, 0), COPY[locale]["badge"], font=badge_font)
    badge_width = badge_box[2] + 32
    draw.rounded_rectangle(
        (1558 - badge_width, 27, 1558, 70),
        radius=22,
        fill=(3, 10, 28, 215),
        outline=(125, 211, 252, 90),
        width=1,
    )
    draw.text(
        (1542, 49),
        COPY[locale]["badge"],
        font=badge_font,
        fill="#bae6fd",
        anchor="rm",
    )


def draw_eyebrow(
    draw: ImageDraw.ImageDraw,
    text: str,
    locale: str,
    center_x: int,
    y: int,
    max_width: int,
) -> None:
    text_font = fit_text(draw, text, locale, 16, max_width, "bold")
    draw.text((center_x, y), text, font=text_font, fill="#67e8f9", anchor="ma")


def render_hero(locale: str, screenshot: Image.Image, icon_source: Image.Image) -> Image.Image:
    canvas = backdrop_scene(dim=27)
    draw_header(canvas, locale, icon_source)
    draw = ImageDraw.Draw(canvas, "RGBA")
    text = COPY[locale]
    draw_eyebrow(draw, text["hero_eyebrow"], locale, 800, 96, 900)
    title_font = fit_text(draw, text["hero_title"], locale, 62, 1240, "bold")
    draw.text((800, 130), text["hero_title"], font=title_font, fill="#f8fbff", anchor="ma")
    subtitle_font = font(locale, 23)
    subtitle_lines = wrap_text(draw, text["hero_subtitle"], subtitle_font, 1050, locale)
    draw_centered_lines(draw, subtitle_lines, 800, 204, subtitle_font, "#cbd5e1", 6)
    rounded_shot(canvas, screenshot, (475, 286, 1125, 689), 24)
    footer_font = fit_text(draw, text["hero_footer"], locale, 29, 1000, "bold")
    draw.text((800, 804), text["hero_footer"], font=footer_font, fill="#e0f2fe", anchor="mm")
    return canvas


def render_feature(locale: str, screenshot: Image.Image, icon_source: Image.Image) -> Image.Image:
    canvas = backdrop_scene(dim=20)
    draw_header(canvas, locale, icon_source)
    draw = ImageDraw.Draw(canvas, "RGBA")
    text = COPY[locale]
    draw_eyebrow(draw, text["feature_eyebrow"], locale, 800, 90, 900)
    title_font = fit_text(draw, text["feature_title"], locale, 38, 900, "bold")
    draw.text((800, 127), text["feature_title"], font=title_font, fill="#f8fbff", anchor="ma")
    rounded_shot(canvas, screenshot, (490, 242, 1110, 627), 21)

    positions = [
        (72, 264),
        (35, 506),
        (100, 748),
        (1236, 264),
        (1273, 506),
        (1208, 748),
    ]
    for index, (title, detail) in enumerate(text["features"]):
        left, top = positions[index]
        right, bottom = left + 292, top + 90
        draw.rounded_rectangle(
            (left, top, right, bottom),
            radius=16,
            fill=(2, 8, 23, 225),
            outline=(125, 211, 252, 85),
            width=1,
        )
        title_font = fit_text(draw, title, locale, 20, 258, "bold")
        detail_font = fit_text(draw, detail, locale, 14, 258)
        draw.text((left + 17, top + 15), title, font=title_font, fill="#f8fafc")
        draw.text((left + 17, top + 52), detail, font=detail_font, fill="#a5d8ff")

    boundary = "BETA · UNOFFICIAL COMMUNITY EDITION · macOS Apple Silicon"
    boundary_font = font("en", 14, "bold")
    draw.text((800, 868), boundary, font=boundary_font, fill="#94a3b8", anchor="mm")
    return canvas


def render_plugin(locale: str, screenshot: Image.Image, icon_source: Image.Image) -> Image.Image:
    canvas = backdrop_scene(dim=65, blur=5)
    draw_header(canvas, locale, icon_source)
    rounded_shot(canvas, screenshot, (55, 122, 1070, 752), 28)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle(
        (1120, 142, 1538, 770),
        radius=28,
        fill=(3, 11, 29, 232),
        outline=(125, 211, 252, 75),
        width=1,
    )
    text = COPY[locale]
    eyebrow_font = fit_text(draw, text["plugin_eyebrow"], locale, 15, 354, "bold")
    draw.text((1152, 177), text["plugin_eyebrow"], font=eyebrow_font, fill="#67e8f9")
    title_font = fit_text(draw, text["plugin_title"], locale, 43, 350, "bold")
    title_lines = wrap_text(draw, text["plugin_title"], title_font, 350, locale)
    y = draw_centered_lines(draw, title_lines, 1329, 222, title_font, "#f8fbff", 7) + 20
    point_font = font(locale, 18)
    for point in text["plugin_points"]:
        point_lines = wrap_text(draw, point, point_font, 314, locale)
        draw.text((1152, y + 2), "✓", font=font("en", 19, "bold"), fill="#22d3ee")
        for line in point_lines:
            draw.text((1180, y), line, font=point_font, fill="#dbeafe")
            y += 27
        y += 14
    draw.rounded_rectangle(
        (1148, 677, 1510, 735),
        radius=12,
        fill=(120, 53, 15, 75),
        outline=(251, 191, 36, 125),
        width=1,
    )
    boundary_font = fit_text(draw, text["plugin_boundary"], locale, 13, 330, "bold")
    boundary_lines = wrap_text(draw, text["plugin_boundary"], boundary_font, 330, locale)
    draw_centered_lines(draw, boundary_lines, 1329, 689, boundary_font, "#fde68a", 2)
    return canvas


def render_cta(locale: str, icon_source: Image.Image) -> Image.Image:
    canvas = backdrop_scene(dim=64, blur=8)
    draw_header(canvas, locale, icon_source)
    draw = ImageDraw.Draw(canvas, "RGBA")
    for x in range(0, 1600, 50):
        draw.line((x, 120, x, 900), fill=(96, 165, 250, 20), width=1)
    for y in range(120, 900, 50):
        draw.line((0, y, 1600, y), fill=(96, 165, 250, 20), width=1)
    draw.rounded_rectangle((744, 135, 856, 247), radius=29, fill="#f8fafc")
    black_icon = tint_icon(icon_source, (72, 72), "#050816")
    canvas.alpha_composite(black_icon, (764, 155))
    text = COPY[locale]
    draw_eyebrow(draw, text["cta_eyebrow"], locale, 800, 292, 900)
    title_font = fit_text(draw, text["cta_title"], locale, 60, 1120, "bold")
    title_lines = wrap_text(draw, text["cta_title"], title_font, 1120, locale)
    y = draw_centered_lines(draw, title_lines, 800, 336, title_font, "#f8fbff", 7) + 22
    subtitle_font = font(locale, 23)
    subtitle_lines = wrap_text(draw, text["cta_subtitle"], subtitle_font, 930, locale)
    y = draw_centered_lines(draw, subtitle_lines, 800, y, subtitle_font, "#cbd5e1", 7) + 28
    button_font = fit_text(draw, text["cta_button"], locale, 18, 330, "bold")
    button_width = draw.textbbox((0, 0), text["cta_button"], font=button_font)[2] + 58
    draw.rounded_rectangle(
        (800 - button_width // 2, y, 800 + button_width // 2, y + 54),
        radius=27,
        fill="#0ea5e9",
        outline=(103, 232, 249, 170),
        width=1,
    )
    draw.text((800, y + 27), text["cta_button"], font=button_font, fill="#ffffff", anchor="mm")
    draw.text(
        (800, y + 86),
        "github.com/KevPH2026/deepseek-harness-desktop",
        font=font("en", 16, "bold"),
        fill="#94a3b8",
        anchor="mm",
    )
    return canvas


def render_gif(scene_paths: list[Path], output: Path, width: int, fps: int, colors: int) -> None:
    height = width * 9 // 16
    filter_graph = ";".join(
        [
            f"[0:v]scale={width}:{height}:flags=lanczos,setpts=PTS-STARTPTS,format=rgba[v0]",
            f"[1:v]scale={width}:{height}:flags=lanczos,setpts=PTS-STARTPTS,format=rgba[v1]",
            f"[2:v]scale={width}:{height}:flags=lanczos,setpts=PTS-STARTPTS,format=rgba[v2]",
            f"[3:v]scale={width}:{height}:flags=lanczos,setpts=PTS-STARTPTS,format=rgba[v3]",
            "[v0][v1]xfade=transition=fade:duration=0.3:offset=1.5[x1]",
            "[x1][v2]xfade=transition=fade:duration=0.3:offset=3.0[x2]",
            "[x2][v3]xfade=transition=fade:duration=0.3:offset=4.5[xf]",
            f"[xf]fps={fps},split[frames][palette_source]",
            f"[palette_source]palettegen=max_colors={colors}:stats_mode=diff[palette]",
            "[frames][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[out]",
        ]
    )
    command = [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y"]
    for scene in scene_paths:
        command.extend(["-loop", "1", "-t", "1.8", "-i", str(scene)])
    command.extend(["-filter_complex", filter_graph, "-map", "[out]", "-loop", "0", str(output)])
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    require_inputs()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    screenshot = Image.open(SCREENSHOT).convert("RGB")
    icon_source = Image.open(ICON).convert("RGBA")

    with tempfile.TemporaryDirectory(prefix="dsh-marketing-") as temporary:
        temporary_path = Path(temporary)
        for locale in ("en", "zh"):
            scenes = [
                render_hero(locale, screenshot, icon_source),
                render_feature(locale, screenshot, icon_source),
                render_plugin(locale, screenshot, icon_source),
                render_cta(locale, icon_source),
            ]
            scene_paths: list[Path] = []
            for name, scene in zip(("hero", "feature", "plugin", "cta"), scenes):
                scene_path = temporary_path / f"{name}.{locale}.png"
                scene.convert("RGB").save(scene_path, "PNG", optimize=True)
                scene_paths.append(scene_path)

            feature_map = OUTPUT / f"deepseek-harness-desktop-feature-map.{locale}.png"
            shutil.copyfile(scene_paths[1], feature_map)
            tour = OUTPUT / f"deepseek-harness-desktop-tour.{locale}.gif"
            render_gif(scene_paths, tour, 1200, 8, 128)
            if tour.stat().st_size > 5 * 1024 * 1024:
                render_gif(scene_paths, tour, 1120, 6, 96)
            if tour.stat().st_size > 5 * 1024 * 1024:
                raise RuntimeError(f"{tour} exceeds the 5 MiB README budget")

    for locale in ("en", "zh"):
        feature_map = OUTPUT / f"deepseek-harness-desktop-feature-map.{locale}.png"
        tour = OUTPUT / f"deepseek-harness-desktop-tour.{locale}.gif"
        print(f"{feature_map}: {feature_map.stat().st_size} bytes")
        print(f"{tour}: {tour.stat().st_size} bytes")


if __name__ == "__main__":
    main()
