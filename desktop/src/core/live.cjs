const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathProblem, samePath, validText, worktreeFile } = require("./files.cjs");
const { projects } = require("../projects.cjs");
const { spaced } = require("../text.cjs");

const maxEntries = 500;
const ignoredPart = /^(?:bin|node_modules|__pycache__|venv|\.venv|\.cache|\.codex|\.claude|\.agents|\.idea|\.vscode|\.npmrc|\.pypirc|\.netrc|\.ds_store|thumbs\.db|credentials\.json|secrets(?:\..*)?)$/i;

function isInside(parent, child) {
  const relation = path.relative(parent, child);
  return !relation || (!path.isAbsolute(relation) && relation !== ".." && !relation.startsWith(".." + path.sep));
}

function livePathProblem(name) {
  const problem = pathProblem(name);
  if (problem) return problem;
  if (name.split("/").some((part) => ignoredPart.test(part) || part.startsWith(".team-space-update-") || /\.local(?:\.|$)/i.test(part))) {
    return "客户端排除了本机缓存、工具目录与配置文件。";
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultSkillLabel() {
  return projects.find((item) => item.id === "fva")?.name || "Skill";
}

function skillNamePattern(skillName) {
  const token = escapeRegExp(skillName);
  return new RegExp("^name:[ \\t]*(?:" + token + "|\\x22" + token + "\\x22|'" + token + "')[ \\t]*(?:#[^\\r\\n]*)?$", "i");
}

function skillNameLines(block) {
  return block.split(/\r?\n/).filter((line) => /^name:/i.test(line));
}

function declaredSkillName(block) {
  const match = block.match(/^name:[ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))/im);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

async function overlapsBackend(location, blocked) {
  const real = await fs.realpath(blocked).catch(() => blocked);
  return samePath(location, real) || isInside(location, real) || isInside(real, location) ||
    samePath(location, blocked) || isInside(location, blocked) || isInside(blocked, location);
}

async function validateLiveDirectory(directory, backendRoot, options = {}) {
  const label = options.label || defaultSkillLabel();
  const forbiddenRoots = Array.isArray(options.forbiddenRoots) ? options.forbiddenRoots : [];
  if (typeof directory !== "string" || !path.isAbsolute(directory) || /^[\\/]{2}/.test(directory) || directory.includes("\0")) {
    throw new Error("请选择本机「" + label + "」的目录。");
  }
  const location = path.resolve(directory);
  const root = path.parse(location).root;
  if (samePath(location, root) || samePath(location, os.homedir())) {
    throw new Error("请选择「" + label + "」的具体目录，避开系统目录、用户主目录和客户端后台工作区。");
  }
  for (const blocked of [backendRoot, ...forbiddenRoots]) {
    if (await overlapsBackend(location, blocked)) {
      throw new Error("请选择「" + label + "」的具体目录，避开系统目录、用户主目录和客户端后台工作区。");
    }
  }
  let current = root;
  for (const segment of location.slice(root.length).split(path.sep)) {
    current = path.join(current, segment);
    const entry = await fs.lstat(current).catch(() => null);
    if (!entry?.isDirectory() || entry.isSymbolicLink()) throw new Error(spaced("", label, "使用目录不存在，或路径包含符号链接、联接点。"));
  }
  const real = await fs.realpath(location);
  if (!samePath(real, location)) throw new Error(spaced("", label, "使用目录的真实路径不匹配。"));
  return real;
}

async function verifySkill(directory, skillName = "fva") {
  let text;
  try {
    const skill = await worktreeFile(directory, "SKILL.md");
    if (skill) text = validText(skill.bytes);
  } catch {}
  const metadata = text?.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/);
  const expected = projects.find((item) => item.skillName === skillName);
  const expectedLabel = expected?.name || skillName;
  const lines = metadata ? skillNameLines(metadata[1]) : [];
  if (lines.length > 1) {
    throw new Error("SKILL.md 里有不止一行 name。请只保留一行，并写成 name: " + skillName + "。");
  }
  const actual = lines.length === 1 ? declaredSkillName(lines[0]) : "";
  const other = projects.find((item) => item.skillName !== skillName && item.skillName.toLowerCase() === actual.toLowerCase());
  const hint = other ? "这是「" + other.name + "」的 Skill，请先切换到「" + other.name + "」。" : "";
  if (!metadata || lines.length !== 1 || !skillNamePattern(skillName).test(lines[0])) {
    throw new Error("请选择「" + expectedLabel + "」的 SKILL.md（name: " + skillName + "）。" + hint);
  }
}

async function scanLive(directory, label = defaultSkillLabel()) {
  const files = new Map();
  let entries = 0;
  async function visit(location, parent = "") {
    if (!samePath(await fs.realpath(location), location)) throw new Error(spaced("", label, "目录扫描遇到路径链接，请检查后重试。"));
    const folder = await fs.opendir(location);
    for await (const entry of folder) {
      if (++entries > maxEntries) throw new Error(spaced("", label, "使用目录扫描上限为 500 项，请确认选择的是 Skill 目录。"));
      const name = parent + entry.name;
      if (livePathProblem(name)) continue;
      const fullPath = path.join(location, entry.name);
      const stat = await fs.lstat(fullPath).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        files.set(name, { path: name, reason: "不能读取符号链接或联接目录。" });
      } else if (stat.isDirectory()) {
        await visit(fullPath, name + "/");
      } else {
        files.set(name, stat.isFile() ? { path: name } : { path: name, reason: "只能提交普通文本文件。" });
      }
    }
    if (!samePath(await fs.realpath(location), location)) throw new Error(spaced("", label, "目录在扫描时发生变化，请重试。"));
  }
  await visit(directory);
  return files;
}

module.exports = { livePathProblem, validateLiveDirectory, verifySkill, scanLive, maxEntries };

