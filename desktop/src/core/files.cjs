const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const limit = 1024 * 1024;
const secretName = /^(?:\.git|\.github|node_modules|\.env.*|id_(?:rsa|dsa|ecdsa|ed25519))$/i;
const secretToken = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/;

function pathProblem(name) {
  if (typeof name !== "string" || !name || name.length > 512 || /[\\:\x00-\x1f\x7f\ufffd]/.test(name)) {
    return "文件路径无效。";
  }
  for (const part of name.split("/")) {
    if (!part || part === "." || part === ".." || /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) return "文件路径无效。";
    if (secretName.test(part) || secretToken.test(part) || /\.(?:pem|key|p12|pfx|ppk)$/i.test(part)) return "此路径属于受保护的配置或凭据。";
  }
  return null;
}

function validText(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("只支持 UTF-8 文本。"); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error("只支持 UTF-8 文本。");
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(text)) throw new Error("文件含私钥，不能提交。");
  if (secretToken.test(text)) throw new Error("文件中检测到疑似访问凭据，不能提交。");
  return text;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function worktreeFile(directory, name) {
  let location = directory;
  const segments = name.split("/");
  for (const [index, segment] of segments.entries()) {
    location = path.join(location, segment);
    const stat = await fs.lstat(location).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw new Error("不能提交符号链接或链接目录。");
    if (index < segments.length - 1 && !stat.isDirectory()) return null;
    if (index === segments.length - 1 && !stat.isFile()) throw new Error("只能提交普通文本文件。");
  }
  if (!samePath(await fs.realpath(location), location)) throw new Error("文件必须位于当前工作区内。");
  const handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw new Error("单个文件最大 1 MB。");
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await fs.lstat(location);
    if (bytesRead > limit) throw new Error("单个文件最大 1 MB。");
    if (bytesRead !== before.size || after.isSymbolicLink() || after.ino !== before.ino ||
        after.dev !== before.dev || after.mtimeMs !== before.mtimeMs || after.size !== before.size ||
        !samePath(await fs.realpath(location), location)) throw new Error("文件正在变化，请重新预览。");
    return { bytes: buffer.subarray(0, bytesRead), executable: !!(before.mode & 0o111) };
  } finally {
    await handle.close();
  }
}

function fileFingerprint(mode, bytes) {
  return createHash("sha256").update(mode).update("\0").update(bytes ?? Buffer.alloc(0)).digest("hex");
}

function summaryDiff(before, after) {
  const a = before === null ? [] : before.split("\n");
  const b = after === null ? [] : after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  if (start === endA && start === endB) return "";
  const lines = ["@@ -" + (start + 1) + "," + (endA - start) + " +" + (start + 1) + "," + (endB - start) + " @@"];
  let size = lines[0].length + 1;
  for (const [source, end, prefix] of [[a, endA, "-"], [b, endB, "+"]]) {
    for (let i = start; i < end; i++) {
      const line = prefix + source[i];
      if (size + Buffer.byteLength(line) + 1 > 32732) {
        const available = 32732 - size - 1;
        if (available > 0) lines.push(Buffer.from(line).subarray(0, available).toString("utf8"));
        return lines.join("\n") + "\n… 差异已截断";
      }
      lines.push(line);
      size += Buffer.byteLength(line) + 1;
    }
  }
  return lines.join("\n");
}

module.exports = { pathProblem, validText, worktreeFile, samePath, fileFingerprint, summaryDiff, limit, secretToken };

