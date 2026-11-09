export const repo = "https://github.com/i010542/fva";
export const defaultBranch = "main";
export const exampleBranch = "zhangsan/fva-shot-guide";

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
    description: "从认领改动、创建分支到发起和合并 PR。",
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
  { title: "创建分支", short: "从默认分支出发", code: "git switch main\ngit pull --ff-only\ngit switch -c zhangsan/fva-shot-guide" },
  { title: "提交改动", short: "保留清晰记录", code: "git status\ngit diff\ngit add SKILL.md\ngit commit -m \"Clarify shot guidance\"\ngit push -u origin zhangsan/fva-shot-guide" },
  { title: "发起 PR", short: "交给队友评审" },
  { title: "验证与修订", short: "记录实际结果" },
  { title: "审核后合并", short: "回到默认分支" },
];


