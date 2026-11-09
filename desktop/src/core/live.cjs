const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathProblem, samePath, validText, worktreeFile } = require("./files.cjs");

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

async function validateLiveDirectory(directory, backendRoot) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) || /^[\\/]{2}/.test(directory) || directory.includes("\0")) {
    throw new Error("请选择本机 FVA 的目录。");
  }
  const location = path.resolve(directory);
  const root = path.parse(location).root;
  const backend = await fs.realpath(backendRoot).catch(() => backendRoot);
  if (samePath(location, root) || samePath(location, os.homedir()) ||
      isInside(location, backend) || isInside(backend, location) ||
      isInside(location, backendRoot) || isInside(backendRoot, location)) {
    throw new Error("请选择 FVA 的具体目录，避开系统目录、用户主目录和客户端后台工作区。");
  }
  let current = root;
  for (const segment of location.slice(root.length).split(path.sep)) {
    current = path.join(current, segment);
    const entry = await fs.lstat(current).catch(() => null);
    if (!entry?.isDirectory() || entry.isSymbolicLink()) throw new Error("FVA 使用目录不存在，或路径包含符号链接、联接点。");
  }
  const real = await fs.realpath(location);
  if (!samePath(real, location)) throw new Error("FVA 使用目录的真实路径不匹配。");
  return real;
}

async function verifySkill(directory) {
  let text;
  try {
    const skill = await worktreeFile(directory, "SKILL.md");
    if (skill) text = validText(skill.bytes);
  } catch {}
  const metadata = text?.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/);
  if (!metadata || !/^name:[ \t]*(?:fva|"fva"|'fva')[ \t]*(?:#[^\r\n]*)?$/im.test(metadata[1])) {
    throw new Error("请选择根目录包含有效 SKILL.md（name: fva）的 FVA 使用目录。");
  }
}

async function scanLive(directory) {
  const files = new Map();
  let entries = 0;
  async function visit(location, parent = "") {
    if (!samePath(await fs.realpath(location), location)) throw new Error("FVA 目录扫描遇到路径链接，请检查后重试。");
    const folder = await fs.opendir(location);
    for await (const entry of folder) {
      if (++entries > maxEntries) throw new Error("FVA 使用目录扫描上限为 500 项，请确认选择的是 Skill 目录。");
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
    if (!samePath(await fs.realpath(location), location)) throw new Error("FVA 目录在扫描时发生变化，请重试。");
  }
  await visit(directory);
  return files;
}

module.exports = { livePathProblem, validateLiveDirectory, verifySkill, scanLive, maxEntries };

