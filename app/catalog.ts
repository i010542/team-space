export const repo = "https://github.com/i010542/fva";
export const defaultBranch = "main";
export const websiteSource = "https://github.com/i010542/team-space";
export const desktopDownload = websiteSource + "/releases/download/desktop-v0.3.0/Team-Space-0.3.0-Setup.exe";

export const projects = [
  {
    id: "fva",
    title: "FVA",
    subtitle: "短视频创作 Skill",
    description: "从参考视频拆解到制作与复盘，把可复用的方法沉淀成一套工作流。",
    repo,
  },
];

export const categories = ["全部", "入门指南", "项目资料", "版本记录"] as const;

export const documents = [
  {
    id: "guide",
    title: "第一次参与 Skill 共创",
    description: "安装 Windows 客户端，在本地编辑并提交审核。",
    category: "入门指南",
    source: "站内指南",
    href: "/guide",
  },
  {
    id: "skill",
    title: "FVA Skill 说明",
    description: "了解 FVA 的定位、适用任务和工作流程。",
    category: "项目资料",
    source: "SKILL.md",
    href: repo + "/blob/main/SKILL.md",
  },
  {
    id: "install",
    title: "FVA 安装与接入",
    description: "从项目原文查看安装与接入说明。",
    category: "项目资料",
    source: "INSTALL.md",
    href: repo + "/blob/main/INSTALL.md",
  },
  {
    id: "structure",
    title: "FVA 仓库结构",
    description: "了解仓库目录与各部分的用途。",
    category: "项目资料",
    source: "STRUCTURE.md",
    href: repo + "/blob/main/STRUCTURE.md",
  },
  {
    id: "changelog",
    title: "FVA 变更记录",
    description: "在项目仓库中查看版本演进和历史变更。",
    category: "版本记录",
    source: "CHANGELOG.md",
    href: repo + "/blob/main/CHANGELOG.md",
  },
];

export type DocumentEntry = (typeof documents)[number];

export const steps = [
  { title: "安装并登录", short: "使用有仓库权限的账号", description: "下载并运行安装程序，打开客户端后登录 GitHub。请使用有 FVA 仓库写入权限的账号。" },
  { title: "绑定使用中的 FVA", short: "边使用边修改", description: "选择正在使用、直接包含 SKILL.md 的 FVA 文件夹。继续在 WorkBuddy、Codex 等工具中使用和修改原文件；绑定不会搬动或覆盖文件，个人分支在后台管理。" },
  { title: "选择改动并提交", short: "发送给项目维护者审核", description: "回到客户端刷新改动，查看差异并勾选本次要提交的文件，填写修改说明，然后点击「提交审核」。客户端将选中的改动推送到个人分支并创建 PR，由维护者审核合并。" },
];
