# 团队共创空间

这里是团队共创空间 Windows 客户端的下载与打开入口。项目、资料目录、帮助和协作功能集中在本地客户端。

## Windows 客户端

[下载 0.4.2 预览版](https://github.com/i010542/team-space/releases/download/desktop-v0.4.2/Team-Space-0.4.2-Setup.exe) · [客户端说明与源码](desktop/README.md)

成员可以直接使用客户端登录 GitHub、选择正在使用的 FVA 文件夹、查看修改并发给团队审核，也可比较团队更新、为双方都改过的文件选好用哪一份，再备份并更新自己的文件，不需要安装 GitHub Desktop 或输入命令。当前接入 FVA；安装包自带所需工具。下面的 Node.js 与构建步骤仅供维护网站的开发者使用。

首次安装或升级到 0.4.2 后，可直接从桌面打开客户端，也可点击网页中的打开按钮；浏览器可能需要用户确认。网页不检测本机安装状态，不直接访问本地文件。旧项目、资料和指南链接保留为客户端的兼容入口。

- 网页的客户端版本、下载链接和打开入口由 `app/catalog.ts` 维护。
- FVA 的原始资料由私有 GitHub 仓库提供，查看原文需要仓库权限。
- 客户端资料索引手动维护，原文和人工审核从客户端打开 GitHub。

## 本地开发

需要 Node.js 22.13 或更新版本。

```sh
npm ci
npm run dev
```

## 构建 GitHub Pages

`main` 存放源码，`gh-pages` 根目录存放构建产物。构建时的基础路径须与 Pages 地址一致。当前站点为 `https://i010542.github.io/team-space/`，对应基础路径 `/team-space`。

PowerShell：

```powershell
$env:NEXT_PUBLIC_BASE_PATH = '/team-space'
npm run build
```

Bash：

```sh
NEXT_PUBLIC_BASE_PATH=/team-space npm run build
```

生成的文件位于 `out/`。其中的 `.nojekyll` 让 GitHub Pages 直接发布静态文件，并保留 `_next/` 资源目录。

## 更新站点

在目标仓库的 **Settings → Pages** 选择 **Deploy from a branch**，使用 `gh-pages` 分支的 `/(root)`。合并源码变更后，从最新的 `main` 重新构建。签出 `gh-pages` 到单独的工作目录，用 `out/` 的全部内容替换该分支上已有的构建文件，保留该工作目录的 Git 元数据。确认 `.nojekyll` 和 `_next/` 已包含，再提交并推送 `gh-pages`。在仓库的 Pages 部署记录中检查结果。

[GitHub Pages 发布配置说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

