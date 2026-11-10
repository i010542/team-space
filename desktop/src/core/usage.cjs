const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { projectById } = require("../projects.cjs");
const { validText } = require("./files.cjs");

const titlePrefix = "[使用记录] ";
const textLimit = 50000;
const byteLimit = 200000;
const titleLimit = 80;
const bodyLimit = 65536;
const pageSize = 20;
const reconcilePages = 4;
const tools = new Set(["", "codex", "workbuddy", "other"]);
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const accountName = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const uncertain = "还不能确认是否已保存。内容已保留。再次点保存只会核对结果，请勿改写后重发。";

function usageRequest(project, input, fields) {
  if (projectById(project?.id) !== project || !input || typeof input !== "object" ||
      Array.isArray(input) || Object.keys(input).length !== fields.length + 1 ||
      !Object.hasOwn(input, "project") || input.project !== project.id ||
      fields.some((key) => !Object.hasOwn(input, key))) {
    throw new Error("使用记录请求与当前 Skill 不匹配。");
  }
}

function usageText(value) {
  if (typeof value !== "string" || !value.isWellFormed()) throw new Error("聊天内容必须是 UTF-8 文本。");
  if (value.length > textLimit) throw new Error("聊天内容最多 50000 字符。请先缩短内容，客户端不会截断。");
  const text = value.replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error("请输入聊天内容。");
  // Check for control characters and common credential formats without echoing content.
  validText(Buffer.from(text, "utf8"));
  return text;
}

function usageTitle(value) {
  if (typeof value !== "string" || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value) ||
      !value.trim() || value.trim().length > titleLimit) throw new Error("请输入 1–80 字符的单行标题。");
  const title = value.trim();
  validText(Buffer.from(title, "utf8"));
  return title;
}

function issueNumber(number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("使用记录编号不正确。");
  return number;
}

function fenceFor(text) {
  let ticks = 3, tildes = 3;
  for (const match of text.matchAll(/`+|~+/g)) {
    if (match[0][0] === "~") tildes = Math.max(tildes, match[0].length + 1);
    else ticks = Math.max(ticks, match[0].length + 1);
  }
  return tildes <= ticks ? "~".repeat(tildes) : "`".repeat(ticks);
}

function issueBody(project, request, tool, text) {
  const fence = fenceFor(text);
  const body = "<!-- team-space-usage:v1 project=" + project.id + " request=" + request +
    " tool=" + (tool || "none") + " -->\n\n" + fence + "\n" + text + "\n" + fence;
  if (body.length > bodyLimit || Buffer.byteLength(body, "utf8") > byteLimit) {
    throw new Error("加上记录格式后内容超过保存上限。请先缩短内容，客户端不会截断。");
  }
  return body;
}

function parseIssue(project, issue) {
  if (!issue || typeof issue !== "object" || Object.hasOwn(issue, "pull_request") ||
      !Number.isSafeInteger(issue.number) || issue.number < 1 ||
      issue.html_url !== "https://github.com/" + project.repo + "/issues/" + issue.number ||
      issue.repository_url !== "https://api.github.com/repos/" + project.repo ||
      !Number.isSafeInteger(issue.user?.id) || issue.user.id < 1 || !accountName.test(issue.user?.login || "") ||
      typeof issue.title !== "string" || !issue.title.startsWith(titlePrefix) ||
      typeof issue.body !== "string" || issue.body.length > bodyLimit || Buffer.byteLength(issue.body, "utf8") > byteLimit ||
      typeof issue.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(issue.created_at)) return null;
  const [header, blank, fence] = issue.body.split("\n", 3);
  const metadata = /^<!-- team-space-usage:v1 project=([a-z0-9-]+) request=([a-f0-9-]+) tool=(none|codex|workbuddy|other) -->$/.exec(header);
  if (!metadata || metadata[1] !== project.id || !uuid.test(metadata[2]) || blank !== "" ||
      !/^(?:~{3,}|`{3,})$/.test(fence || "") || !issue.body.endsWith("\n" + fence)) return null;
  try {
    const title = usageTitle(issue.title.slice(titlePrefix.length));
    const text = usageText(issue.body.slice(header.length + fence.length + 3, -fence.length - 1));
    return {
      request: metadata[2], authorId: issue.user.id, text,
      summary: { number: issue.number, title, tool: metadata[3] === "none" ? "" : metadata[3],
        author: issue.user.login, createdAt: issue.created_at },
    };
  } catch { return null; }
}

async function readUsageFile(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || !/\.(?:md|txt)$/i.test(filename)) {
    throw new Error("请选择 .md 或 .txt 文件。");
  }
  const before = await fs.lstat(filename).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()) throw new Error("请选择实际存在的文本文件，不能选择快捷链接。");
  if (before.size > byteLimit) throw new Error("文本文件太大。最多导入 50000 字符，不会截断。");
  let handle, data;
  try {
    handle = await fs.open(filename, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error();
    data = Buffer.alloc(byteLimit + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await fs.lstat(filename);
    if (after.isSymbolicLink() || after.ino !== before.ino || after.dev !== before.dev ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs || offset !== before.size) throw new Error();
    data = data.subarray(0, offset);
  } catch {
    throw new Error("无法读取所选文件。请确认文件未移动或修改，再重新选择。");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new Error("只支持 UTF-8 编码的 .md 或 .txt 文件。"); }
  return usageText(decoded);
}

async function readSmall(file) {
  const info = await fs.lstat(file).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > 96) throw new Error(uncertain);
  return fs.readFile(file, "utf8");
}

function createUsageRecords({ project, journalDir, getAccount, request }) {
  if (projectById(project?.id) !== project) throw new Error("未识别的 Skill。");
  const endpoint = "repos/" + project.repo;

  async function access(writing = false) {
    const account = await getAccount();
    const repo = await request(account, "GET", endpoint);
    if (repo?.full_name !== project.repo || repo.private !== true || repo.visibility !== "private" ||
        repo.has_issues !== true || repo.permissions?.pull !== true) {
      throw new Error("无法确认当前私有仓库和使用记录权限。请检查账号或联系项目负责人。");
    }
    if (writing && (repo.archived === true || repo.disabled === true)) {
      throw new Error("当前仓库已停止接受新的使用记录。");
    }
    return account;
  }

  async function issuePage(account, page) {
    const items = await request(account, "GET", endpoint + "/issues?state=all&sort=created&direction=desc&per_page=" + pageSize + "&page=" + page);
    if (!Array.isArray(items) || items.length > pageSize) throw new Error("无法读取团队使用记录。");
    return { items, hasNext: items.length === pageSize };
  }

  async function list(input) {
    usageRequest(project, input, ["page"]);
    if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 500) throw new Error("使用记录页码无效。");
    const account = await access();
    const { items, hasNext } = await issuePage(account, input.page);
    return { items: items.map((item) => parseIssue(project, item)).filter(Boolean).map((item) => item.summary),
      page: input.page, hasNext: hasNext && input.page < 500, viewer: account.login };
  }

  async function load(number, account) {
    const issue = parseIssue(project, await request(account, "GET", endpoint + "/issues/" + issueNumber(number)));
    if (!issue || issue.summary.number !== number) throw new Error("这不是当前 Skill 的使用记录，或记录已不可用。");
    return issue;
  }

  async function detail(input) {
    usageRequest(project, input, ["number"]);
    issueNumber(input.number);
    const account = await access();
    const issue = await load(input.number, account);
    return { ...issue.summary, text: issue.text, viewer: account.login };
  }

  async function link(input) {
    usageRequest(project, input, ["number"]);
    issueNumber(input.number);
    const issue = await load(input.number, await access());
    return "https://github.com/" + project.repo + "/issues/" + issue.summary.number;
  }

  async function findPrior(account, file, requestId) {
    const matching = (issue) => issue?.request === requestId && issue.authorId === account.id;
    const savedNumber = await readSmall(file + ".receipt");
    if (/^[1-9]\d{0,14}$/.test(savedNumber || "")) {
      const issue = await load(Number(savedNumber), account).catch(() => null);
      if (matching(issue)) return issue;
    }
    for (let page = 1; page <= reconcilePages; page++) {
      const { items, hasNext } = await issuePage(account, page);
      const match = items.map((item) => parseIssue(project, item)).find(matching);
      if (match) return match;
      if (!hasNext) break;
    }
    return null;
  }

  async function save(input) {
    usageRequest(project, input, ["title", "tool", "text"]);
    const title = usageTitle(input.title);
    const text = usageText(input.text);
    if (!tools.has(input.tool)) throw new Error("使用工具选项无效。");
    const tool = input.tool;
    const requestId = randomUUID();
    const body = issueBody(project, requestId, tool, text);
    const account = await access(true);
    const hash = createHash("sha256").update(JSON.stringify([project.id, account.id, title, tool, text])).digest("hex");
    const file = path.join(journalDir, hash + ".request");
    await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
    const directory = await fs.lstat(journalDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("无法保存本机发送记录，请联系项目负责人。");
    let journal;
    try { journal = await fs.open(file, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw new Error("无法保存本机发送记录，尚未发送。");
      try {
        const previous = await readSmall(file);
        if (uuid.test(previous || "")) {
          const match = await findPrior(account, file, previous);
          if (match && match.text === text && match.summary.title === title && match.summary.tool === tool) {
            return { ...match.summary, text: match.text, viewer: account.login, reconciled: true };
          }
        }
      } catch { /* The result is still unknown. Do not send again. */ }
      throw new Error(uncertain);
    }
    try {
      await journal.writeFile(requestId, "utf8");
      await journal.sync();
    } catch { throw new Error("无法保存本机发送记录，尚未发送。"); }
    finally { await journal.close(); }
    let issue;
    try {
      issue = parseIssue(project, await request(account, "POST", endpoint + "/issues", { title: titlePrefix + title, body }));
    } catch { throw new Error(uncertain); }
    if (!issue || issue.request !== requestId || issue.authorId !== account.id ||
        issue.summary.title !== title || issue.summary.tool !== tool || issue.text !== text) throw new Error(uncertain);
    await fs.writeFile(file + ".receipt", String(issue.summary.number), { flag: "wx", mode: 0o600 }).catch(() => {});
    return { ...issue.summary, text: issue.text, viewer: account.login, reconciled: false };
  }

  return { list, detail, save, link };
}

module.exports = { createUsageRecords, readUsageFile, usageRequest };
