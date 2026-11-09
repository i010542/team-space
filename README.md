# 团队共创空间

这里汇总团队的 Skill 项目、只读资料和 GitHub 协作指南。

## Windows 客户端

[下载 0.3.0 预览版](https://github.com/i010542/team-space/releases/download/desktop-v0.3.0/Team-Space-0.3.0-Setup.exe) · [客户端说明与源码](desktop/README.md)

成员可以直接使用客户端登录 GitHub、绑定正在使用的 FVA 文件夹、查看改动并提交审核，也可比较团队更新、处理冲突后备份并更新本机文件，不需要安装 GitHub Desktop 或输入命令。当前接入 FVA；安装包自带所需工具。下面的 Node.js 与构建步骤仅供维护网站的开发者使用。

- 在 `app/catalog.ts` 维护项目和资料索引。增添项目时，补充项目详情路由。
- FVA 的原始资料由私有 GitHub 仓库提供，查看原文需要仓库权限。
- 索引手动维护。分支、PR 和 Issues 的最新状态在 GitHub 查看。

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

