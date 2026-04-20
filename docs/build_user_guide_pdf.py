from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "tab-deck-user-guide.pdf"


pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))


def paragraph(text, style):
    return Paragraph(escape(text), style)


def bullet(text, style):
    return Paragraph(escape(text), style, bulletText="•")


def numbered(index, text, style):
    return Paragraph(escape(text), style, bulletText=f"{index}.")


styles = getSampleStyleSheet()
title = ParagraphStyle(
    "ChineseTitle",
    parent=styles["Title"],
    fontName="STSong-Light",
    fontSize=25,
    leading=32,
    textColor=colors.HexColor("#202022"),
    spaceAfter=8,
)
meta = ParagraphStyle(
    "Meta",
    parent=styles["BodyText"],
    fontName="STSong-Light",
    fontSize=10,
    leading=15,
    textColor=colors.HexColor("#666666"),
    spaceAfter=16,
)
heading = ParagraphStyle(
    "ChineseHeading",
    parent=styles["Heading2"],
    fontName="STSong-Light",
    fontSize=16,
    leading=22,
    textColor=colors.HexColor("#202022"),
    spaceBefore=14,
    spaceAfter=7,
)
subheading = ParagraphStyle(
    "ChineseSubheading",
    parent=styles["Heading3"],
    fontName="STSong-Light",
    fontSize=13,
    leading=18,
    textColor=colors.HexColor("#202022"),
    spaceBefore=10,
    spaceAfter=5,
)
body = ParagraphStyle(
    "ChineseBody",
    parent=styles["BodyText"],
    fontName="STSong-Light",
    fontSize=11,
    leading=18,
    textColor=colors.HexColor("#222222"),
    spaceAfter=6,
)
bullet_style = ParagraphStyle(
    "ChineseBullet",
    parent=body,
    leftIndent=16,
    firstLineIndent=-10,
    bulletIndent=3,
    spaceAfter=3,
)
number_style = ParagraphStyle(
    "ChineseNumber",
    parent=body,
    leftIndent=18,
    firstLineIndent=-14,
    bulletIndent=0,
    spaceAfter=3,
)
code_style = ParagraphStyle(
    "Code",
    parent=styles["Code"],
    fontName="Courier",
    fontSize=9.5,
    leading=13,
    leftIndent=6,
    rightIndent=6,
    borderWidth=0.5,
    borderColor=colors.HexColor("#d8d8d8"),
    borderPadding=8,
    backColor=colors.HexColor("#f6f6f6"),
    spaceBefore=6,
    spaceAfter=9,
)


story = [
    paragraph("Tab Deck 功能说明与使用方法", title),
    paragraph("项目地址：https://github.com/longbeach2025/tab-deck-extension", meta),
    paragraph("Tab Deck 是什么", heading),
    paragraph(
        "Tab Deck 是一个 Chrome 标签页管理插件，用来替代 Toby 这类工具。它会把 Chrome 新标签页变成一个“标签工作台”，你可以把当前打开的网页保存成集合，在多设备之间同步，再按项目、主题或工作场景恢复。",
        body,
    ),
    paragraph("核心功能", heading),
    paragraph("1. 新标签页工作台", subheading),
    paragraph("安装后，Chrome 的新标签页会变成 Tab Deck 主界面。", body),
    paragraph("左侧包括：", body),
]

for item in ["搜索框", "Spaces 空间列表", "当前窗口打开的标签页", "保存选中标签页", "保存全部标签页", "保存后关闭原标签页选项"]:
    story.append(bullet(item, bullet_style))

story.append(paragraph("右侧包括：", body))
for item in ["当前 Space 的所有 Collections", "每个 Collection 里的已保存链接", "Collection 笔记", "手动添加链接", "一键打开整个 Collection"]:
    story.append(bullet(item, bullet_style))

story.extend(
    [
        paragraph("2. Space 空间", subheading),
        paragraph("Space 是最高层级分类，可以理解为“大工作区”。例如：", body),
    ]
)
for item in ["Work", "Trading", "Research", "Personal", "Client A", "Client B"]:
    story.append(bullet(item, bullet_style))
story.append(paragraph("每个 Space 下面可以有多个 Collection。当前支持新建、切换、重命名和删除 Space。", body))

story.extend(
    [
        paragraph("3. Collection 集合", subheading),
        paragraph("Collection 是一组标签页或链接，可以理解为“一次工作会话”或“一个主题文件夹”。例如：", body),
    ]
)
for item in ["2026 Budget Review", "AI Research", "Chrome Extension Dev", "Morning Reading", "Supplier Docs"]:
    story.append(bullet(item, bullet_style))
story.append(
    paragraph("每个 Collection 支持保存多个标签页、添加笔记、手动添加链接、删除单个链接、删除整个 Collection，以及一键打开全部链接。", body)
)

story.extend(
    [
        paragraph("4. 保存当前标签页", subheading),
        paragraph("点击浏览器右上角的 Tab Deck 插件图标，会打开 popup。在 popup 里可以：", body),
    ]
)
for item in ["选择 Space", "选择已有 Collection", "或输入一个新 Collection 名称", "保存当前标签页", "保存当前窗口所有标签页", "选择保存后是否关闭原标签页"]:
    story.append(bullet(item, bullet_style))
story.append(paragraph("这个入口适合快速整理当前浏览状态。", body))

story.extend(
    [
        paragraph("5. 保存当前窗口", subheading),
        paragraph("在主工作台左侧，可以看到当前窗口所有可保存的标签页。你可以：", body),
    ]
)
for item in ["勾选部分标签页，然后点击 Save selected", "直接点击 Save all", "勾选 Close after save，保存后自动关闭这些标签页"]:
    story.append(bullet(item, bullet_style))
story.append(paragraph("这适合把一堆打开的网页收纳起来，清空浏览器窗口。", body))

story.extend(
    [
        paragraph("6. 拖拽保存", subheading),
        paragraph("主界面左侧的当前标签页可以直接拖到右侧某个 Collection 里。这个方式适合你边整理边归类，不用每次弹窗输入。", body),
        paragraph("7. 搜索", subheading),
        paragraph("顶部搜索框可以搜索：", body),
    ]
)
for item in ["链接标题", "URL", "域名", "Collection 名称", "Collection 笔记"]:
    story.append(bullet(item, bullet_style))
story.append(paragraph("保存很多链接后，可以用搜索快速找回。", body))

story.extend(
    [
        paragraph("8. 多设备同步", subheading),
        paragraph("当前版本已经支持 Chrome 账号同步。", body),
    ]
)
for item in [
    "默认保存到 chrome.storage.sync",
    "多台设备登录同一个 Chrome 账号后自动同步",
    "同时保留一份 chrome.storage.local 本地副本",
    "如果同步失败或数据超过限制，会退回本地保存，并显示 Local fallback",
]:
    story.append(bullet(item, bullet_style))
story.append(paragraph("注意：Chrome sync 适合个人多设备轻量使用，不适合无限量存储。大概几百个链接以内比较合适。", body))

story.append(paragraph("安装方法", heading))
for index, item in enumerate(
    [
        "打开 GitHub 仓库：https://github.com/longbeach2025/tab-deck-extension",
        "克隆或下载代码到本地。",
        "打开 Chrome：chrome://extensions",
        "打开右上角 Developer mode。",
        "点击 Load unpacked。",
        "选择本地目录：/Users/reclina/tab-deck-extension",
        "安装后打开一个新标签页，就会进入 Tab Deck 主界面。",
    ],
    1,
):
    story.append(numbered(index, item, number_style))

story.extend(
    [
        paragraph("推荐使用方式", heading),
        paragraph("可以按这个结构管理：", body),
        Preformatted(
            """Space: Work
  Collection: Finance Budget
  Collection: Chrome Extension Dev
  Collection: Vendor Research

Space: Personal
  Collection: Reading List
  Collection: Travel
  Collection: Shopping

Space: Trading
  Collection: Market Dashboards
  Collection: Research Reports""",
            code_style,
        ),
        paragraph("日常流程：", body),
    ]
)
for index, item in enumerate(
    [
        "工作时先正常打开网页。",
        "准备切换任务时，打开 Tab Deck。",
        "选择当前窗口的标签页。",
        "保存到某个 Collection。",
        "勾选 Close after save 清空窗口。",
        "下次继续时，找到 Collection，点击打开全部链接。",
    ],
    1,
):
    story.append(numbered(index, item, number_style))

story.append(paragraph("当前还没做的功能", heading))
for item in [
    "导入 / 导出 JSON",
    "导出 Markdown",
    "快捷键",
    "Collection 手动排序",
    "Space / Collection 图标",
    "批量移动链接",
    "标签去重增强",
    "自有后端同步",
    "团队共享",
    "登录系统",
    "历史版本恢复",
    "Chrome Web Store 发布打包",
]:
    story.append(bullet(item, bullet_style))

story.extend(
    [
        Spacer(1, 5 * mm),
        paragraph("当前版本已经是一个能实际使用的个人多设备标签管理 MVP。", body),
    ]
)


doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=18 * mm,
    bottomMargin=18 * mm,
    title="Tab Deck 功能说明与使用方法",
    author="Tab Deck",
)
doc.build(story)
print(OUTPUT)
