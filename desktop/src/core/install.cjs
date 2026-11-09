const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { worktreeFile, samePath, validText, summaryDiff } = require("./files.cjs");
const { livePathProblem } = require("./live.cjs");

const sameBytes = (left, right) => left === null ? right === null : right !== null && left.equals(right);
const readBytes = async (root, name) => (await worktreeFile(root, name))?.bytes ?? null;

function artifact(name, backupId, index, stage) {
  const parent = path.posix.dirname(name);
  return (parent === "." ? "" : parent + "/") + ".team-space-update-" + backupId + "-" + index + "-" + stage;
}

async function safeParent(root, name, create) {
  let current = root;
  for (const segment of name.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    let entry = await fs.lstat(current).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (!entry && !create) return false;
    if (!entry) {
      await fs.mkdir(current).catch((error) => { if (error.code !== "EEXIST") throw error; });
      entry = await fs.lstat(current);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || path.resolve(await fs.realpath(current)) !== path.resolve(current)) {
      throw new Error("安装路径包含非目录或联接点。");
    }
  }
  if (!samePath(await fs.realpath(current), current)) throw new Error("安装路径已发生变化。");
  return true;
}

async function bytesAt(root, name) {
  if (!(await safeParent(root, name, false))) return null;
  const bytes = await readBytes(root, name);
  if (bytes !== null) {
    const target = path.join(root, name);
    if (path.resolve(await fs.realpath(target)) !== path.resolve(target)) {
      throw new Error("安装路径和本机已有名称的大小写或拼写不同。");
    }
  }
  return bytes;
}

function packOperations(operations) {
  return operations.map(({ path: name, before, after }) => ({
    path: name, before: before?.toString("base64") ?? null, after: after?.toString("base64") ?? null,
  }));
}

function unpackOperations(operations) {
  if (!Array.isArray(operations) || operations.length > 100) throw new Error("安装备份清单无效。");
  const seen = new Set();
  return operations.map((item) => {
    if (livePathProblem(item?.path)) throw new Error("安装备份路径无效。");
    const key = item.path.normalize("NFC").toUpperCase();
    if (seen.has(key)) throw new Error("安装备份包含重复路径。");
    seen.add(key);
    const bytes = (encoded) => {
      if (encoded === null) return null;
      if (typeof encoded !== "string" || encoded.length > 1398104) throw new Error("安装备份文件无效。");
      const value = Buffer.from(encoded, "base64");
      if (value.length > 1024 * 1024 || value.toString("base64") !== encoded) throw new Error("安装备份文件无效。");
      validText(value);
      return value;
    };
    return { path: item.path, before: bytes(item.before), after: bytes(item.after) };
  });
}

async function checkArtifacts(root, name, backupId, index) {
  for (const stage of ["old", "new", "restore-old", "restore-new"]) {
    if (await bytesAt(root, artifact(name, backupId, index, stage)) !== null) {
      throw new Error("检测到同名安装临时文件，请刷新后重试。");
    }
  }
}

async function replaceFile(root, name, expected, desired, backupId, index, restore = false) {
  if (!sameBytes(await bytesAt(root, name), expected)) throw new Error(name + " 已变化，请刷新后重试。");
  if (sameBytes(expected, desired)) return;
  if (!(await safeParent(root, name, desired !== null))) return;
  const target = path.join(root, name);
  const old = artifact(name, backupId, index, restore ? "restore-old" : "old");
  const stage = artifact(name, backupId, index, restore ? "restore-new" : "new");

  if (desired !== null) {
    const handle = await fs.open(path.join(root, stage), "wx", 0o600);
    try {
      await handle.writeFile(desired);
      await handle.sync();
    } finally { await handle.close(); }
  }
  if (expected !== null) {
    if (await bytesAt(root, old) !== null) throw new Error("安装备份临时文件已存在。");
    await safeParent(root, name, false);
    await fs.rename(target, path.join(root, old));
    if (!sameBytes(await bytesAt(root, old), expected)) {
      // An editor saved between the last read and the move. Put the newly
      // moved bytes back only if no one has recreated the destination.
      await fs.link(path.join(root, old), target).catch(() => {});
      throw new Error(name + " 在应用期间发生外部修改。");
    }
  }
  await safeParent(root, name, false);
  if (desired !== null) await fs.link(path.join(root, stage), target);
  else if (await bytesAt(root, name) !== null) throw new Error(name + " 在删除期间被重新创建。");
}

async function cleanupArtifact(root, name, expected, allowPartial = false, preserved) {
  const location = path.join(root, name);
  let bytes;
  try {
    bytes = await bytesAt(root, name);
  } catch (error) {
    const stat = await fs.lstat(location).catch(() => null);
    if (!preserved || !stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error("请先将安装临时文件另存并移出使用目录：" + location);
    }
  }
  if (bytes === null) return;
  const partial = allowPartial && expected !== null && bytes && bytes.length <= expected.length &&
    expected.subarray(0, bytes.length).equals(bytes);
  if (bytes === undefined || (!sameBytes(bytes, expected) && !partial)) {
    if (!preserved) throw new Error("安装临时文件含外部改动：" + location);
    const destination = path.join(path.dirname(location), ".team-space-update-preserved-" + randomUUID());
    await safeParent(root, name, false);
    await fs.link(location, destination);
    await fs.unlink(location);
    preserved.push(destination);
    return;
  }
  await fs.unlink(location);
}

async function cleanOperation(root, operation, id, index, preserved) {
  for (const [stage, bytes] of [["old", operation.before], ["new", operation.after],
    ["restore-old", operation.after], ["restore-new", operation.before]]) {
    await cleanupArtifact(root, artifact(operation.path, id, index, stage), bytes, stage.endsWith("new"), preserved);
  }
}

async function applyOperations(root, operations, id) {
  for (const [index, op] of operations.entries()) {
    if (!sameBytes(await bytesAt(root, op.path), op.before)) throw new Error(op.path + " 已变化，请刷新后重试。");
    await checkArtifacts(root, op.path, id, index);
  }
  for (const [index, op] of operations.entries()) {
    await replaceFile(root, op.path, op.before, op.after, id, index);
  }
  for (const [index, op] of operations.entries()) {
    if (!sameBytes(await bytesAt(root, op.path), op.after)) throw new Error(op.path + " 在应用期间被修改。");
    await cleanOperation(root, op, id, index);
  }
}

async function restoreOperations(root, operations, id, { bestEffort = false, preflightOnly = false } = {}) {
  const actions = [];
  const preserved = [];
  let failure;
  for (const [index, op] of operations.entries()) {
    try {
      const current = await bytesAt(root, op.path);
      if (sameBytes(current, op.before)) actions[index] = { current, restore: false };
      else if (sameBytes(current, op.after) || (current === null && (
        sameBytes(await bytesAt(root, artifact(op.path, id, index, "old")), op.before) ||
        sameBytes(await bytesAt(root, artifact(op.path, id, index, "restore-old")), op.after)))) {
        actions[index] = { current, restore: true };
      } else {
        throw new Error(op.path + " 在备份后发生修改，已保留该文件。请先手动保留新改动再重试恢复。");
      }
    } catch (error) {
      if (!bestEffort) throw error;
      failure ||= error;
    }
  }
  if (preflightOnly) return;
  for (let index = operations.length - 1; index >= 0; index--) {
    if (!actions[index]) continue;
    const op = operations[index];
    const { current, restore } = actions[index];
    try {
      if (restore) {
        const staged = artifact(op.path, id, index, "restore-new");
        await cleanupArtifact(root, staged, op.before, true, preserved);
        await replaceFile(root, op.path, current, op.before, id, index, true);
      }
      await cleanOperation(root, op, id, index, preserved);
    } catch (error) {
      if (!bestEffort) throw error;
      failure ||= error;
    }
  }
  if (failure) throw failure;
  return preserved;
}

function previewText(bytes) {
  if (bytes === null) return { text: null, truncated: false };
  const limit = 8192;
  return { text: bytes.subarray(0, limit).toString("utf8"), truncated: bytes.length > limit };
}

function conflictEntry(name, reason, before, team) {
  const mine = previewText(before);
  const theirs = previewText(team);
  return {
    path: name, status: "conflict", reason, mineText: mine.text, teamText: theirs.text,
    ...(mine.truncated || theirs.truncated ? { textTruncated: true } : {}),
  };
}

function updateDiff(before, after) {
  return summaryDiff(before === null ? null : validText(before), after === null ? null : validText(after));
}

module.exports = {
  sameBytes, bytesAt, packOperations, unpackOperations, applyOperations, restoreOperations, conflictEntry, updateDiff,
};

