export const desktopVersion = "0.4.4";
export const desktopDownload = "https://github.com/i010542/team-space/releases/download/desktop-v" + desktopVersion + "/Team-Space-" + desktopVersion + "-Setup.exe";

export const desktopLinks = {
  workspace: "teamspace-app://project/fva",
  docs: "teamspace-app://project/fva/docs",
  updates: "teamspace-app://project/fva/updates",
} as const;

export const steps = [
  { title: "下载并安装", description: "运行 Windows 安装程序。安装后可以直接打开客户端，也可以从这里打开。" },
  { title: "选好你的 FVA 文件夹", description: "登录 GitHub 后，选择你平时正在使用的 FVA 文件夹。客户端会记住它的位置。" },
  { title: "照常修改，发给团队看", description: "继续用 WorkBuddy 或 Codex 修改。保存后，在客户端选好文件，发给团队审核。" },
];
