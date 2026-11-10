const path = require("node:path");

const idPattern = /^[a-z0-9-]+$/;

const projects = Object.freeze([
  Object.freeze({
    id: "fva",
    name: "FVA",
    fullName: "FVA 短视频创作",
    repo: "i010542/fva",
    skillName: "fva",
    dataDir: "workspaces",
    docs: Object.freeze([
      Object.freeze({ key: "skill", title: "FVA Skill 说明", summary: "了解 FVA 的用途、适用任务和工作流程。", path: "SKILL.md", category: "project" }),
      Object.freeze({ key: "install", title: "FVA 安装与接入", summary: "查看安装及接入说明。", path: "INSTALL.md", category: "guide" }),
      Object.freeze({ key: "structure", title: "FVA 项目结构", summary: "了解各个目录和文件的用途。", path: "STRUCTURE.md", category: "project" }),
      Object.freeze({ key: "changelog", title: "FVA 变更记录", summary: "查看正式版本的更新历史。", path: "CHANGELOG.md", category: "version" }),
    ]),
  }),
  Object.freeze({
    id: "ugc-reference-ad-workflow",
    name: "广告制作",
    fullName: "UGC 参考广告制作",
    repo: "i010542/ugc-reference-ad-workflow",
    skillName: "ugc-reference-ad-workflow",
    dataDir: "workspaces-ugc-reference-ad-workflow",
    docs: Object.freeze([
      Object.freeze({ key: "skill", title: "Skill 说明", summary: "了解这份广告制作 Skill 能做什么、按什么顺序做。", path: "SKILL.md", category: "project" }),
      Object.freeze({ key: "readme", title: "团队使用说明", summary: "查看团队成员怎么使用这份 Skill。", path: "README.md", category: "guide" }),
      Object.freeze({ key: "workflow", title: "流程与确认", summary: "查看制作流程，以及哪些步骤需要先确认。", path: "references/workflow.md", category: "guide" }),
      Object.freeze({ key: "templates", title: "工作模板", summary: "查看脚本、分镜和提示词可以用的模板。", path: "references/templates.md", category: "project" }),
    ]),
  }),
]);

function projectById(id) {
  if (typeof id !== "string" || !idPattern.test(id)) return null;
  return projects.find((project) => project.id === id) || null;
}

function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    fullName: project.fullName,
    repo: project.repo,
    skillName: project.skillName,
    docs: project.docs.map((doc) => ({
      key: doc.key, title: doc.title, summary: doc.summary, path: doc.path, category: doc.category,
    })),
  };
}

function rememberedId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "fva";
  return projectById(value.id)?.id || "fva";
}

function chooseProject(id, busy) {
  if (busy) return { ok: false, error: "正在处理上一项操作，请稍候再切换。" };
  const project = projectById(id);
  if (!project) return { ok: false, error: "没有这个 Skill。" };
  return { ok: true, project };
}

function projectDataRoot(userData, id) {
  const project = projectById(id);
  if (!project || typeof userData !== "string" || !userData) return null;
  return path.join(userData, project.dataDir);
}

module.exports = { projects, projectById, publicProject, rememberedId, chooseProject, projectDataRoot };
