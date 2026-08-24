<!-- inkspace:view {"font":"serif"} -->
# Inkspace

Inkspace 是一款 Windows 桌面 Markdown 编辑器。它以本地文件或文件夹为工作区，不需要账户，不使用浏览器本地存储，也不会访问网络。打开 Markdown 文件后，文档会直接以 UTF-8 保存在原路径。

## 下载与运行

前往 [Releases](https://github.com/Ayaname-Rei/first_markdown/releases/latest) 下载以下任一文件：

- `Inkspace-0.1.0-setup.exe`：推荐。以管理员权限安装后会注册 `.md` 和 `.markdown` 文件类型，可在 Windows 的“默认应用”中将 Inkspace 设为默认编辑器。
- `Inkspace-0.1.0-portable.exe`：无需安装，下载后可直接运行；便携版不修改系统默认应用设置。

当前发行版适用于 Windows 10/11 64 位系统。程序未进行代码签名，Windows SmartScreen 首次运行时可能显示发布者未知的提示；确认下载来源为本仓库后，可在“更多信息”中选择“仍要运行”。

## 快速开始

1. 启动 Inkspace 后选择“打开 Markdown 文件”，或双击已关联的 `.md` / `.markdown` 文件。
2. 直接编辑并按 `Ctrl+S` 保存；自动保存同样会写回原文件。
3. 使用 `Ctrl+Shift+S` 另存为，或在页面右上角显示当前文件所在位置。
4. 需要管理一组笔记时，选择“打开文件夹”，在左侧栏新建、重命名或整理页面。
5. 点击页面右上角的导出按钮，可生成 Markdown、HTML 或 PDF 文件。

每个页面的子页面会存放在与父文档同名的文件夹中。例如：

```text
知识库/
  项目.md
  项目/
    会议记录.md
```

因此整个工作区可以直接用资源管理器、Git 或其他 Markdown 工具管理，不依赖私有数据库或云服务。

## 功能

- 本地优先：只访问用户显式打开的文件或文件夹；应用内网络请求和网页跳转默认被拦截。
- 类 VS Code 文件操作：支持双击打开 Markdown、`Ctrl+O` 打开文件、`Ctrl+S` 保存、`Ctrl+Shift+S` 另存为、关闭窗口前保存，以及在资源管理器中定位当前文件。
- Notion 风格的文档树、子页面、搜索、暗色界面与侧栏展开/收起。
- 所见即所得 Markdown 编辑，支持标题、任务清单、表格、代码块、链接、引用、删除线、下划线和分隔线。
- 实时数学公式：行内 `$...$` 与块级 `$$...$$` 均在本地渲染，可点击后直接编辑。
- Obsidian 常用预览语法：Frontmatter、Callout 和简单脚注。
- 代码块支持语言选择、复制、2 空格 Tab/Shift+Tab 缩进和横向滚动。
- 每篇文档可独立选择无衬线、艺术标题或衬线阅读字体，以及字号和行宽。
- 内置离线字体：Noto Sans SC、Ma Shan Zheng、Source Han Serif CN。
- 导出 Markdown、HTML、PDF；导出过程同样不加载外部资源。

## 从源码运行或构建

需要 Node.js 20 或更高版本，以及 Windows x64 环境。

```powershell
npm ci
npm run desktop
```

构建可分发的安装版和便携版：

```powershell
npm run dist:win
```

生成的文件位于 `release/`，包括安装版 `Inkspace-0.1.0-setup.exe` 和便携版 `Inkspace-0.1.0-portable.exe`。安装版会注册 Markdown 文件类型；Windows 会保留用户对默认应用的最终选择，可在应用菜单“文件 → 设置 Markdown 默认应用”中打开系统设置确认。该目录被 Git 忽略，正式发行文件应通过 GitHub Releases 分发。

## 第三方声明

依赖和字体的许可证信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。字体许可证原文位于 `licenses/SIL-OFL-1.1.txt`。
