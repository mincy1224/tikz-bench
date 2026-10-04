# TikZ Bench

[English](README.md)

本地自托管的 TikZ 可视化工作台。在画布或源码编辑器中修改支持的图形，项目以 TikZ 源码保存。

TikZ Bench 基于 **Dominik Peters** 的 [TikZ Editor](https://github.com/DominikPeters/tikz-editor) 修改并独立维护，保留原项目的解析与渲染基础，增加本地项目管理、格式编辑和系统安装支持。

## 功能

- 图形、路径、曲线、文字、组合和锚点连线。
- 分区矩形：横向／纵向排列、逐区内容与填色。
- 字号、颜色、线宽、双端箭头独立尺寸；实时预览、撤销／重做、多选批量编辑。
- 本地项目自动保存，支持 TeX、SVG、PNG 和 PDF 导出。
- 同源 MathJax 公式资源，本地 LaTeX／中文 XeLaTeX 编译。
- 矩阵、流程图、图表、电路等示例。高级 Forest、PGFPlots、Circuitikz 代码通过本地 TeX 编译；直接画布编辑取决于编辑器支持的语法。

## 从源码一键安装到系统

**目标环境：**启用 systemd 的 Ubuntu 24.04，包括启用 systemd 的 WSL2。需要 sudo 权限、能够访问 npm／apt 的网络，以及已有的完整 TeX Live。目标版本为 TeX Live 2026；安装器不自动安装或替换 TeX。

`git clone` **本仓库**之后，在仓库根目录直接执行：

```bash
bash install.sh
```

无需手工构建或打包。脚本通过 apt 补齐缺失的非 TeX 工具，执行 `npm ci`、构建前端和服务端，在服务隔离环境下检查编译，然后安装 `tikz-bench` 系统命令和 systemd 服务。构建需要 Node.js 18.19+ 和 npm（推荐 Node.js 22+）；已有 Node.js 版本过低时需先更新。

现有 TeX 需要提供 `latex`、`xelatex`、`dvisvgm`、`dvipdfmx` 和 `kpsewhich`，包含 TikZ、standalone、Forest、PGFPlots、Circuitikz、ctex、fontspec 和 Fandol 字体。中文系统字体缺失时通过 apt 补齐。也可以显式指定 TeX 路径：

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

全新安装后自动启动，在浏览器打开 **http://localhost:5173**。已有安装保留配置、项目数据和原服务状态，**无需先删除旧版**。检查失败时恢复旧程序与配置。真实 Ubuntu／systemd／TeX Live 2026 验收尚待完成。

## 使用与升级

新建项目，输入 TikZ 代码或从工具栏添加图形，选中对象后在右栏修改格式。项目自动保存；高级代码使用 **LaTeX 编译预览**。

```bash
tikz-bench start
tikz-bench status
tikz-bench stop
tikz-bench restart
tikz-bench logs
tikz-bench version
tikz-bench backup ./projects-backup.sqlite
tikz-bench upgrade /path/to/tikz-bench-source
tikz-bench rollback
```

升级时，在源码仓库运行 `git pull --ff-only`，再执行 `bash install.sh`。也可运行 `tikz-bench upgrade /path/to/tikz-bench-source`，构建并安装指定源码目录。`rollback` 切换程序，不覆盖数据库；备份命令恢复服务原先的运行／停止状态。

程序目录：`/opt/tikz-bench/releases/`。配置：`/etc/default/tikz-bench`。默认数据库：`/var/lib/tikz-bench/tikz-bench.sqlite`。服务默认监听 `127.0.0.1:5173`。

## 开发

使用 Node.js 22+ 和 npm，在项目根目录运行 `npm ci`，再运行 `npm run dev:full`。仅构建生产版本、不安装服务时，依次运行 `npm run build` 和 `npm run build:full`。系统安装需要 Linux；开发构建也可以在 Windows 上运行。

更多说明见[服务端配置](apps/server/README.md)与[源码安装说明](design/build-and-upgrade.md)。

## 许可证

采用 MIT 许可证；[LICENSE](LICENSE) 保留原作者的版权及许可声明。[NOTICE.md](NOTICE.md) 说明项目来源与修改内容。TikZ Bench 独立维护，这些修改不代表原作者认可或参与维护。打包的第三方组件保留各自的许可证。
