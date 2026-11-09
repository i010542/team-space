export const desktopVersion = "0.4.0";
export const desktopDownload = "https://github.com/i010542/team-space/releases/download/desktop-v" + desktopVersion + "/Team-Space-" + desktopVersion + "-Setup.exe";

export const desktopLinks = {
  workspace: "teamspace-app://project/fva",
  docs: "teamspace-app://project/fva/docs",
  updates: "teamspace-app://project/fva/updates",
} as const;

export const steps = [
  { title: "下载并安装", description: "运行 Windows 安装程序。安装后可以直接打开客户端，也可以从这里打开。" },
  { title: "登录并绑定 FVA", description: "用团队授权的 GitHub 账号登录，选择直接包含 SKILL.md 的现有文件夹。" },
  { title: "在原目录修改", description: "继续用 WorkBuddy 或 Codex 编辑。保存后，在客户端检查改动并提交审核。" },
];
