const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { cleanEnvironment, runProcess, asText } = require("./core/process.cjs");
const { pathProblem, validText, worktreeFile, samePath, fileFingerprint, summaryDiff, limit, secretToken } = require("./core/files.cjs");

const { livePathProblem, validateLiveDirectory, verifySkill, scanLive, maxEntries } = require("./core/live.cjs");
const { projects, projectById } = require("./projects.cjs");
const { spaced } = require("./text.cjs");
const { createUsageRecords } = require("./core/usage.cjs");

const { sameBytes, bytesAt, packOperations, unpackOperations, applyOperations, restoreOperations, conflictEntry, updateDiff } = require("./core/install.cjs");

const maxSubmissionBytes = 10 * 1024 * 1024;
const main = "main";
const loginPattern = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const shaPattern = /^[a-f0-9]{40}$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const identityKey = (account) => account.login.toLowerCase();
const windowsPathKey = (name) => name.normalize("NFC").toUpperCase();
const installFingerprint = (bytes) => fileFingerprint(bytes === null ? "absent" : "file", bytes);

function siblingDataRoots(rootDir, project) {
  const resolved = path.resolve(rootDir);
  if (path.basename(resolved) !== project.dataDir) return [];
  const parent = path.dirname(resolved);
  return projects.filter((item) => item.dataDir !== project.dataDir).map((item) => path.join(parent, item.dataDir));
}

function createService({ root, gitPath, ghPath, run = runProcess, project, forbiddenRoots = [], bindings = async () => [] } = {}) {
  project = project || projectById("fva");
  root = path.resolve(root);
  const repo = project.repo;
  const origin = "https://github.com/" + repo + ".git";
  const prPattern = new RegExp("^https://github\\.com/" + escapeRegExp(repo) + "/pull/([1-9]\\d*)$");
  const skillLabel = project.name;
  const say = (before, after = "") => spaced(before, skillLabel, after);
  const liveOptions = { label: skillLabel, forbiddenRoots: [...forbiddenRoots, ...siblingDataRoots(root, project)] };
  const checkLive = (directory) => validateLiveDirectory(directory, root, liveOptions);
  const readSkill = (directory) => verifySkill(directory, project.skillName);
  const scan = (directory) => scanLive(directory, skillLabel);
  const stateDirectory = path.join(root, ".state");
  const noConfig = path.join(stateDirectory, "git-config");
  const noHooks = path.join(stateDirectory, "hooks");
  let latestPreview = null;
  let latestUpdatePlan = null;
  let queue = Promise.resolve();

  function serialize(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }

  async function prepare() {
    await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(noHooks, { recursive: true, mode: 0o700 });
  }

  async function command(binary, args, options, message) {
    try { return await run(binary, args, options); }
    catch { throw new Error(message); }
  }

  function environment() {
    return {
      ...cleanEnvironment(),
      GH_HOST: "github.com",
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: noConfig,
    };
  }

  async function gh(args, { cwd = root, onOutput, timeout, input, allowFailure = false, account } = {}) {
    const error = "GitHub 操作未完成，请检查网络和当前账号权限。";
    const env = { ...environment(), GIT_CONFIG_GLOBAL: path.join(stateDirectory, "gh-git-config") };
    if (account) env.GH_TOKEN = await githubToken(account);
    const result = await command(ghPath, args, { cwd, env, onOutput, timeout, input }, error);
    if (result.code !== 0 && !allowFailure) throw new Error(error);
    return result;
  }

  async function githubToken(account) {
    const token = asText((await gh(["auth", "token", "--hostname", "github.com", "--user", account.login])).stdout).trim();
    if (!/^[a-z0-9_-]{8,1024}$/i.test(token)) throw new Error("无法取得当前 GitHub 登录授权。");
    return token;
  }

  async function git(args, { cwd = root, env: overrides, input, allowFailure = false, network = false, timeout } = {}) {
    const env = { ...environment(), ...overrides };
    if (network) {
      const token = await githubToken(network);
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
      env.GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic " + Buffer.from("x-access-token:" + token).toString("base64");
    }
    const argsWithSafety = [
      "--literal-pathspecs", "-c", "core.hooksPath=" + noHooks, "-c", "core.fsmonitor=false",
      "-c", "commit.gpgSign=false", "-c", "credential.helper=", "-c", "submodule.recurse=false",
      "-c", "core.autocrlf=false", "-c", "http.followRedirects=false", "-c", "core.protectNTFS=true",
      "-c", "core.attributesFile=" + path.join(stateDirectory, "git-attributes"), "--no-replace-objects",
      ...args,
    ];
    const error = "本地 Git 操作未完成。请检查工作区后重试。";
    const result = await command(gitPath, argsWithSafety, { cwd, env, input, timeout }, error);
    if (result.code !== 0 && !allowFailure) throw new Error(error);
    return result;
  }

  async function gitText(args, options) {
    return asText((await git(args, options)).stdout).trim();
  }

  async function toolsAvailable() {
    await prepare();
    const [gitResult, ghResult] = await Promise.all([
      command(gitPath, ["--version"], { cwd: root, env: environment(), timeout: 5000 }, "找不到 Git。").catch(() => null),
      command(ghPath, ["--version"], { cwd: root, env: environment(), timeout: 5000 }, "找不到 GitHub CLI。").catch(() => null),
    ]);
    return { git: gitResult?.code === 0, gh: ghResult?.code === 0 };
  }

  async function readAccount() {
    const auth = await gh(["auth", "status", "--hostname", "github.com", "--active"], { allowFailure: true });
    if (auth.code !== 0) return null;
    const output = await gh(["api", "--hostname", "github.com", "user", "--jq", "{login,id}"]);
    let account;
    try { account = JSON.parse(asText(output.stdout)); }
    catch { throw new Error("无法读取当前 GitHub 账号。"); }
    if (!loginPattern.test(account?.login) || !Number.isSafeInteger(account.id) || account.id < 1) {
      throw new Error("无法读取当前 GitHub 账号。");
    }
    return account;
  }

  async function permission() {
    const result = await gh(["api", "--hostname", "github.com", "repos/" + repo, "--jq", ".permissions.push"], { allowFailure: true });
    return result.code === 0 && asText(result.stdout).trim() === "true";
  }

  async function requireAccount() {
    await prepare();
    const account = await readAccount();
    if (!account) throw new Error("请先登录 GitHub。");
    if (!(await permission())) throw new Error(say("当前 GitHub 账号缺少", "仓库写入权限，或权限暂时无法核实。"));
    return account;
  }

  async function requireSameAccount(account) {
    const live = await requireAccount();
    if (live.id !== account.id || identityKey(live) !== identityKey(account)) {
      throw new Error("GitHub 账号已切换，请重新登录原账号。");
    }
  }

  const statePath = (account) => path.join(stateDirectory, identityKey(account) + ".json");

  async function readState(account) {
    const data = await fs.readFile(statePath(account), "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (data === null) return null;
    let state;
    try { state = JSON.parse(data); }
    catch { throw new Error("无法读取工作区记录。"); }
    if (state.login !== identityKey(account) || !uuidPattern.test(state.id) ||
        state.branch !== "codex/" + state.login + "/" + state.id || !shaPattern.test(state.baseSha) || !shaPattern.test(state.head)) {
      throw new Error("工作区记录有误。");
    }
    if (state.livePath !== undefined && (typeof state.livePath !== "string" || !Array.isArray(state.seenPaths) ||
        state.seenPaths.length > maxEntries || state.seenPaths.some(livePathProblem))) {
      throw new Error(say("", "使用目录记录有误，请重新绑定。"));
    }
    return state;
  }

  async function writeRecord(destination, state) {
    const temp = destination + "." + randomUUID() + ".tmp";
    await fs.writeFile(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    try { await fs.rename(temp, destination); }
    finally { await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }

  function saveState(account, state) {
    return writeRecord(statePath(account), state);
  }

  function archiveWorkspace(state) {
    const historyDirectory = path.join(stateDirectory, "history");
    return fs.mkdir(historyDirectory, { recursive: true, mode: 0o700 })
      .then(() => writeRecord(path.join(historyDirectory, state.id + ".json"), state));
  }

  function publicWorkspace(state) {
    if (!state) return null;
    const gitPath = path.join(root, state.id);
    return {
      id: state.id, path: state.livePath || gitPath, branch: state.branch, baseSha: state.baseSha,
      ...(state.livePath && { bound: true, livePath: state.livePath, gitPath }),
      ...(state.prUrl && { prUrl: state.prUrl, prNumber: state.prNumber }),
      ...(state.pending && { pending: true, pendingId: state.pending.commit, pendingTitle: state.pending.title, pendingFiles: state.pending.files.map((file) => file.path) }),
    };
  }

  const localRecoveryPath = path.join(stateDirectory, "install-recovery.json");

  async function readLocalRecovery() {
    const raw = await fs.readFile(localRecoveryPath, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (raw === null) return null;
    let marker;
    try { marker = JSON.parse(raw); } catch { return null; }
    if (!loginPattern.test(marker?.login) || !uuidPattern.test(marker?.id) || !uuidPattern.test(marker?.workspaceId)) return null;
    const account = { login: marker.login };
    const state = await readState(account);
    if (!state?.livePath || state.id !== marker.workspaceId ||
        !state.updateBackup?.interrupted || state.updateBackup.id !== marker.id) return null;
    return { account, state };
  }

  async function beginInstallRecovery(account, state, backup) {
    await writeRecord(localRecoveryPath, { login: identityKey(account), id: backup.id, workspaceId: state.id });
    await saveState(account, { ...state, updateBackup: { ...backup, interrupted: true } });
  }

  async function status() {
    const tools = await toolsAvailable();
    const interrupted = await readLocalRecovery();
    if (interrupted) {
      return { tools, authenticated: false, authorized: false, login: interrupted.account.login,
        workspace: publicWorkspace(interrupted.state), recoveryRequired: true, localRecoveryAvailable: true,
        lastBackup: interrupted.state.updateBackup };
    }
    if (!tools.gh) return { tools, authenticated: false, authorized: false, workspace: null };
    const account = await readAccount();
    if (!account) return { tools, authenticated: false, authorized: false, workspace: null };
    const authorized = await permission();
    const state = await readState(account);
    const lastBackup = state?.updateBackup;
    return { tools, authenticated: true, login: account.login, authorized, workspace: publicWorkspace(state),
      recoveryRequired: lastBackup?.interrupted === true, ...(lastBackup && { lastBackup }) };
  }

  async function login(onProgress) {
    await prepare();
    let reported = false;
    const tails = { stdout: "", stderr: "" };
    const onOutput = (text, stream) => {
      if (reported) return;
      tails[stream] = (tails[stream] + text).slice(-1024);
      const match = tails[stream].match(/(?:one.time (?:OAuth )?code|device code):\s*([A-Z0-9]{4}-[A-Z0-9]{4})\b/i);
      if (match) {
        reported = true;
        onProgress?.({ type: "device-code", code: match[1].toUpperCase(), url: "https://github.com/login/device" });
      }
    };
    await gh(["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https"], {
      onOutput, timeout: 300000, input: "\n",
    });
    return status();
  }

  async function validateWorkspace(state) {
    const cwd = path.join(root, state.id);
    const dir = await fs.lstat(cwd).catch(() => null);
    const gitDir = await fs.lstat(path.join(cwd, ".git")).catch(() => null);
    if (!dir?.isDirectory() || dir.isSymbolicLink() || !gitDir?.isDirectory() || gitDir.isSymbolicLink() ||
        !samePath(await fs.realpath(cwd), path.join(await fs.realpath(root), state.id))) {
      throw new Error("工作区目录已移动、不可用或使用了链接。");
    }
    const top = await gitText(["rev-parse", "--show-toplevel"], { cwd });
    const actualGitDir = await gitText(["rev-parse", "--absolute-git-dir"], { cwd });
    const commonDir = await gitText(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
    if (!samePath(top, cwd) || !samePath(actualGitDir, path.join(cwd, ".git")) || !samePath(commonDir, actualGitDir)) {
      throw new Error("工作区 Git 目录不匹配。");
    }
    const branch = await gitText(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd, allowFailure: true });
    if (branch !== state.branch) throw new Error("请切回该工作区的个人分支。");
    const fetchUrl = await gitText(["remote", "get-url", "--all", "origin"], { cwd });
    const pushUrl = await gitText(["remote", "get-url", "--all", "--push", "origin"], { cwd });
    if (fetchUrl !== origin || pushUrl !== origin) throw new Error(say("工作区远程仓库与", "不匹配。"));
    const head = await gitText(["rev-parse", "HEAD"], { cwd });
    if (!shaPattern.test(head)) throw new Error("无法确认工作区版本。");
    if (head !== state.head && head !== state.pending?.commit) throw new Error("工作区的 Git 版本已在应用外变化，请检查个人分支。");
    const filters = await git(["config", "--get-regexp", "^filter\\."], { cwd, allowFailure: true });
    if (filters.code !== 1) throw new Error("检测到本地 Git 过滤器配置，无法安全读取或更新工作区。");
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply", "rebase-merge", "sequencer", "info/grafts", "objects/info/alternates"]) {
      const active = await fs.lstat(path.join(actualGitDir, marker)).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
      if (active) throw new Error("工作区有未完成的 Git 操作或外部对象引用。");
    }
    return { cwd, head };
  }

  async function findReview(state) {
    const result = await gh(["pr", "list", "--repo", "github.com/" + repo, "--head", state.branch, "--base", main,
      "--state", "all", "--limit", "30", "--json", "state,url,number,headRefName,headRefOid,isCrossRepository"]);
    let list;
    try { list = JSON.parse(asText(result.stdout)); }
    catch { throw new Error("无法读取 GitHub 审核状态。"); }
    if (!Array.isArray(list)) throw new Error("无法读取 GitHub 审核状态。");
    const reviews = list.filter((item) => item.headRefName === state.branch && item.isCrossRepository === false &&
      prPattern.test(item.url) && ["OPEN", "MERGED", "CLOSED"].includes(item.state) &&
      Number(prPattern.exec(item.url)[1]) === item.number);
    const item = reviews.find((entry) => entry.state === "OPEN") || reviews[0];
    return item ? { state: item.state.toLowerCase(), url: item.url, number: item.number, headRefOid: item.headRefOid } : { state: "none" };
  }

  async function startWorkspace() {
    const account = await requireAccount();
    const previous = await readState(account);
    ensureNoInterruptedInstall(previous);
    if (previous) {
      if (previous.pending) throw new Error("上次提交尚未完成，请先重试提交。");
      const { cwd } = await validateWorkspace(previous);
      const review = await findReview(previous);
      if (review.state === "open" || review.state === "none") return publicWorkspace(previous);
      if (previous.livePath) {
        const teamHead = await fetchTeam(cwd, account);
        if (teamHead !== (previous.installBaseSha || previous.baseSha) ||
            (review.state === "merged" && previous.head !== previous.baseSha)) {
          throw new Error("请先在「团队更新」中对齐已合并的版本，再开始新一轮。");
        }
      }
      if (!previous.livePath && (await changedPaths(cwd)).length) throw new Error("现有工作区还有未提交的改动，请先处理后再开始新任务。");
    }
    if (previous?.livePath) await checkLive(previous.livePath);
    const state = await cloneWorkspace(account, previous?.installBaseSha);
    if (previous?.livePath) {
      copyInstallation(previous, state);
      await archiveWorkspace(previous);
    }
    await saveState(account, state);
    latestPreview = null;
    return publicWorkspace(state);
  }

  async function bindWorkspace(directory) {
    const account = await requireAccount();
    const previous = await readState(account);
    ensureNoInterruptedInstall(previous);
    if (previous?.pending) throw new Error("请先继续提交或保留旧文件另开任务，再绑定目录。");

    const livePath = await checkLive(directory);
    const taken = await bindings(account);
    if (Array.isArray(taken)) {
      for (const item of taken) {
        if (item?.path && samePath(item.path, livePath)) {
          throw new Error("这个文件夹已经绑定给「" + (item.name || "另一个 Skill") + "」。同一个文件夹不能同时用于两个 Skill。");
        }
      }
    }
    await readSkill(livePath);
    if (previous?.livePath && samePath(livePath, previous.livePath)) {
      await validateWorkspace(previous);
      return publicWorkspace(previous);
    }

    const liveFiles = await scan(livePath);
    const state = await cloneWorkspace(account);
    await checkLive(livePath);
    await readSkill(livePath);
    state.livePath = livePath;
    state.seenPaths = [...liveFiles.values()].filter((file) => !file.reason).map((file) => file.path).sort();
    if (previous) await archiveWorkspace(previous);
    await saveState(account, state);
    latestPreview = null;
    return publicWorkspace(state);
  }

  function copyInstallation(previous, next) {
    next.livePath = previous.livePath;
    next.seenPaths = previous.seenPaths;
    for (const key of ["installBaseSha", "installKnown", "installHeld", "installHeldFingerprints"]) {
      if (previous[key] !== undefined) next[key] = previous[key];
    }
  }

  async function cloneWorkspace(account, atTeamSha) {
    const id = randomUUID();
    const state = { id, login: identityKey(account), branch: "codex/" + identityKey(account) + "/" + id };
    const cwd = path.join(root, id);
    await fs.mkdir(cwd, { mode: 0o700 });
    await git(["clone", "--template=", "--no-tags", "--single-branch", "--branch", main, "--", origin, cwd], { network: account, timeout: 240000 });
    state.baseSha = await gitText(["rev-parse", "HEAD"], { cwd });
    if (atTeamSha) {
      if (!shaPattern.test(atTeamSha) ||
          (await git(["merge-base", "--is-ancestor", atTeamSha, state.baseSha], { cwd, allowFailure: true })).code !== 0) {
        throw new Error("团队已改写该安装版本，请重新查看更新。");
      }
      state.baseSha = atTeamSha;
    }
    if (!shaPattern.test(state.baseSha)) throw new Error("无法确认下载版本。");
    state.head = state.baseSha;
    await git(["switch", "--no-guess", "-c", state.branch, state.baseSha], { cwd });
    await validateWorkspace(state);
    return state;
  }

  async function recoverWorkspace() {
    const account = await requireAccount();
    const previous = await readState(account);
    ensureNoInterruptedInstall(previous);
    if (!previous?.pending) throw new Error("当前没有需要恢复的待提交任务。");

    const state = await cloneWorkspace(account, previous.installBaseSha);
    if (previous.livePath) copyInstallation(previous, state);
    await archiveWorkspace(previous);
    await saveState(account, state);
    latestPreview = null;
    return { workspace: publicWorkspace(state), previousPath: path.join(root, previous.id) };
  }

  async function getActive() {
    const account = await requireAccount();
    const state = await readState(account);
    if (!state) throw new Error("请先开始一个工作区。");
    return { account, state, ...await validateWorkspace(state) };
  }

  async function assertTextAttributes(cwd, paths, env) {
    if (!paths.length) return;
    const attrs = ["text", "eol", "working-tree-encoding", "filter", "ident"];
    const output = asText((await git(["check-attr", "-z", ...(env ? ["--cached"] : []), ...attrs, "--", ...paths],
      { cwd, env })).stdout).split("\0");
    const stride = attrs.length * 3;
    if (output.length !== paths.length * stride + 1 || paths.some((file, index) => attrs.some((attr, i) => {
      const offset = index * stride + i * 3;
      return output[offset] !== file || output[offset + 1] !== attr ||
        !["unspecified", "unset"].includes(output[offset + 2]);
    }))) throw new Error("此文件使用会转换内容的 Git 属性，请联系维护者提交。");
  }

  async function snapshot(cwd, head, file, { showDiff = false, source = cwd, workingFile } = {}) {
    const problem = (source === cwd ? pathProblem : livePathProblem)(file);
    if (problem) throw new Error(problem);
    const entry = asText((await git(["ls-tree", "-z", head, "--", file], { cwd })).stdout);
    const old = entry ? /^(100644|100755) blob ([a-f0-9]{40})\t/.exec(entry) : null;
    if (entry && !old) throw new Error("不能提交符号链接、子模块或目录。");
    let before = null;
    let beforeBytes = null;
    if (old) {
      const size = Number(await gitText(["cat-file", "-s", old[2]], { cwd }));
      if (!Number.isSafeInteger(size) || size > limit) throw new Error("原文件超过 1 MB。");
      const result = await git(["cat-file", "blob", old[2]], { cwd });
      beforeBytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(asText(result.stdout));
      before = validText(beforeBytes);
    }
    const working = workingFile === undefined ? await worktreeFile(source, file) : workingFile;
    if (working) await assertTextAttributes(cwd, [file]);
    const after = working ? validText(working.bytes) : null;
    const mode = working ? (process.platform === "win32" ? old?.[1] || "100644" : working.executable ? "100755" : "100644") : "deleted";
    if ((!working && !old) || (working && beforeBytes?.equals(working.bytes) && old[1] === mode)) {
      throw new Error("磁盘文件相对当前版本没有变化。");
    }
    return {
      path: file, mode, bytes: working?.bytes, fingerprint: fileFingerprint(mode, working?.bytes),
      status: old ? (working ? "modified" : "deleted") : "added",
      ...(showDiff && { diff: summaryDiff(before, after) }),
    };
  }

  async function changedPaths(cwd) {
    const args = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
    const result = asText((await git(args, { cwd })).stdout);
    return result.split("\0").filter(Boolean).map((record) => ({ flags: record.slice(0, 2), path: record.slice(3) }));
  }

  function fileStatus(flags) {
    return flags.includes("D") ? "deleted" : flags.includes("A") || flags === "??" ? "added" : "modified";
  }

  async function liveChanges(account, state, cwd, head) {
    const source = await checkLive(state.livePath);
    const entries = await scan(source);
    const oldEntries = asText((await git(["ls-tree", "-r", "-z", head], { cwd })).stdout).split("\0").filter(Boolean);
    const tracked = new Map(oldEntries.map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, kind, sha] = entry.slice(0, tab).split(" ");
      return [entry.slice(tab + 1), { mode, kind, sha }];
    }));
    const seen = new Set([...entries.values()].filter((file) => !file.reason).map((file) => file.path));
    for (const name of state.seenPaths) {
      if (!tracked.has(name) || livePathProblem(name)) continue;
      seen.add(name);
      if (!entries.has(name)) entries.set(name, { path: name, missing: true });
    }
    if (entries.size > maxEntries || seen.size > maxEntries) {
      throw new Error(say("", "使用目录与已见路径超过 500 项，请缩小使用目录后再检查改动。"));
    }

    const files = [];
    const fingerprints = new Map();
    const nameCounts = new Map();
    const heldKeys = new Set((state.installHeld || []).map(windowsPathKey));
    for (const name of entries.keys()) {
      const key = windowsPathKey(name);
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    for (const file of [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))) {
      const name = file.path;
      const old = tracked.get(name);
      const status = file.missing ? "deleted" : old ? "modified" : "added";
      try {
        if (file.reason) throw new Error(file.reason);
        if (nameCounts.get(windowsPathKey(name)) > 1) throw new Error("路径大小写或 Unicode 名称存在冲突。");
        const workingFile = await worktreeFile(source, name);
        if ((workingFile === null) !== (file.missing === true)) throw new Error("文件在扫描期间变化，请刷新改动。");
        if (workingFile && old?.kind === "blob" && /^(100644|100755)$/.test(old.mode)) {
          const bytes = workingFile.bytes;
          const hash = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
          const mode = process.platform === "win32" ? old.mode : workingFile.executable ? "100755" : "100644";
          if (hash === old.sha && mode === old.mode) continue;
        }
        if (heldKeys.has(windowsPathKey(name))) throw new Error("此文件保留了不同的本机安装版本，请先在团队更新中处理后再提交。");
        const change = await snapshot(cwd, head, name, { source, workingFile, showDiff: true });
        fingerprints.set(name, change.fingerprint);
        files.push({ path: name, status: change.status, diff: change.diff, eligible: true });
      } catch (error) {
        files.push({ path: name, status, eligible: false, reason: error.message });
      }
    }
    const seenPaths = [...seen].sort();
    if (JSON.stringify(seenPaths) !== JSON.stringify(state.seenPaths)) {
      state.seenPaths = seenPaths;
      await saveState(account, state);
    }
    return { files, fingerprints };
  }

  async function changes() {
    const { account, state, cwd, head } = await getActive();
    ensureNoInterruptedInstall(state);
    if (state.livePath) {
      const { files, fingerprints } = await liveChanges(account, state, cwd, head);
      const previewId = randomUUID();
      latestPreview = { previewId, id: state.id, head, fingerprints };
      return { workspace: publicWorkspace(state), previewId, files };
    }
    const entries = await changedPaths(cwd);
    if (entries.length > 500) throw new Error("工作区的改动超过 500 个文件，请先整理后重新预览。");
    const files = [];
    const fingerprints = new Map();
    for (const entry of entries) {
      try {
        const change = await snapshot(cwd, head, entry.path, { showDiff: true });
        if (entry.flags[0] !== " " && entry.flags !== "??") throw new Error("此文件已有暂存改动，请先在本地处理暂存。");
        fingerprints.set(entry.path, change.fingerprint);
        files.push({ path: entry.path, status: change.status, diff: change.diff, eligible: true });
      } catch (error) {
        files.push({ path: secretToken.test(entry.path) ? "（已隐藏疑似凭据文件名）" : entry.path, status: fileStatus(entry.flags), eligible: false, reason: error.message });
      }
    }
    const previewId = randomUUID();
    latestPreview = { previewId, id: state.id, head, fingerprints };
    return { workspace: publicWorkspace(state), previewId, files };
  }

  async function indexChanges(cwd, paths, reference) {
    const keys = paths.map(windowsPathKey);
    const scope = new Set(keys);
    for (const key of keys) {
      for (let boundary = key.indexOf("/"); boundary !== -1; boundary = key.indexOf("/", boundary + 1)) {
        scope.add(key.slice(0, boundary));
      }
    }
    const staged = asText((await git(["diff", "--cached", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-textconv",
      reference, "--"], { cwd })).stdout).split("\0").filter(Boolean);
    return staged.filter((name) => {
      const key = windowsPathKey(name);
      return scope.has(key) || keys.some((file) => key.startsWith(file + "/"));
    });
  }

  async function assertIndexClear(cwd, paths, reference) {
    if ((await indexChanges(cwd, paths, reference)).length) {
      throw new Error("所选文件或相关路径已有暂存改动，请先处理暂存内容。");
    }
  }

  async function assertWindowsPaths(cwd, tree, changedPaths) {
    if (!changedPaths.length) return;
    const spellings = new Map();
    for (const name of changedPaths) {
      const parts = name.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const node = parts.slice(0, i).join("/");
        const key = windowsPathKey(node);
        if (spellings.has(key) && spellings.get(key) !== node) {
          throw new Error("所选文件的路径大小写或 Unicode 名称在 Windows 上冲突。");
        }
        spellings.set(key, node);
      }
    }
    const entries = asText((await git(["ls-tree", "-r", "-t", "--name-only", "-z", tree], { cwd })).stdout)
      .split("\0").filter(Boolean);
    if (entries.some((name) => {
      const selectedName = spellings.get(windowsPathKey(name));
      return selectedName !== undefined && name !== selectedName;
    })) throw new Error("所选文件与仓库中的路径在 Windows 上发生大小写或 Unicode 名称冲突。");
  }

  async function buildCommit(cwd, head, account, title, snapshots) {
    const tmp = await fs.mkdtemp(path.join(stateDirectory, "index-"));
    const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
    try {
      await git(["read-tree", head], { cwd, env });
      const indexInfo = [];
      for (const file of snapshots) {
        if (file.mode === "deleted") {
          indexInfo.push("0 " + "0".repeat(40) + "\t" + file.path + "\0");
        } else {
          const blob = await gitText(["hash-object", "-w", "--no-filters", "--stdin"], { cwd, input: file.bytes });
          if (!shaPattern.test(blob)) throw new Error("无法确认文件快照。");
          indexInfo.push(file.mode + " " + blob + "\t" + file.path + "\0");
        }
      }
      await git(["update-index", "-z", "--index-info"], { cwd, env, input: indexInfo.join("") });
      const written = snapshots.filter((file) => file.mode !== "deleted").map((file) => file.path);
      await assertTextAttributes(cwd, written, env);
      const tree = await gitText(["write-tree"], { cwd, env });
      const parentTree = await gitText(["rev-parse", head + "^{tree}"], { cwd });
      if (tree === parentTree) throw new Error("所选文件没有可提交的改动。");
      const selected = new Set(snapshots.map((file) => file.path));
      const actual = asText((await git(["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z",
        parentTree, tree, "--"], { cwd })).stdout).split("\0").filter(Boolean);
      if (actual.length !== selected.size || actual.some((file) => !selected.has(file))) {
        throw new Error("所选文件会同时改变其他路径，请重新检查并选择完整的改动。");
      }
      await assertWindowsPaths(cwd, tree, written);
      const email = account.id + "+" + account.login + "@users.noreply.github.com";
      const commit = await gitText(["commit-tree", tree, "-p", head, "-F", "-"], {
        cwd, input: title + "\n",
        env: { GIT_AUTHOR_NAME: account.login, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: account.login, GIT_COMMITTER_EMAIL: email },
      });
      if (!shaPattern.test(commit)) throw new Error("无法确认本地提交。");
      return commit;
    } finally {
      await fs.unlink(path.join(tmp, "index")).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await fs.rmdir(tmp);
    }
  }

  async function resumePending(account, state) {
    const { cwd, head } = await validateWorkspace(state);
    const pending = state.pending;
    if (!shaPattern.test(pending.commit) || !shaPattern.test(pending.parent) ||
        !Array.isArray(pending.files) || pending.files.length < 1 || pending.files.length > 100 ||
        pending.files.some((file) => pathProblem(file.path))) throw new Error("本地提交恢复记录无效。");
    const paths = pending.files.map((file) => file.path);
    if (head === pending.parent) {
      await requireSameAccount(account);
      await assertIndexClear(cwd, paths, pending.parent);
      const source = state.livePath ? await checkLive(state.livePath) : cwd;
      for (const file of pending.files) {
        const current = await snapshot(cwd, head, file.path, { source });
        if (current.fingerprint !== file.fingerprint) throw new Error("文件已变化，请恢复到预览版本后重试。");
      }
      const review = await findReview(state);
      if (review.state === "merged" || review.state === "closed") throw new Error("这项审核已结束，请创建新工作区。");
      await git(["update-ref", "refs/heads/" + state.branch, pending.commit, pending.parent], { cwd });
    } else if (head !== pending.commit) {
      throw new Error("个人分支已变化，请检查待推送提交。");
    }
    if (!pending.indexUpdated) {
      if ((await indexChanges(cwd, paths, pending.parent)).length) await assertIndexClear(cwd, paths, pending.commit);
      else await git(["reset", "--quiet", "--no-refresh", pending.commit, "--", ...paths], { cwd });
      pending.indexUpdated = true;
      await saveState(account, state);
    }
    const review = await findReview(state);
    if (review.state === "merged" || review.state === "closed") throw new Error("这项审核已结束，未推送待提交内容。");
    const verified = await validateWorkspace(state);
    if (verified.head !== pending.commit) throw new Error("个人分支已变化，请检查待推送提交。");
    await requireSameAccount(account);
    try {
      await git(["push", "--no-follow-tags", "origin", pending.commit + ":refs/heads/" + state.branch], { cwd, network: account });
    } catch {
      throw new Error("已保留本地提交。推送失败，请检查网络或远端分支后重试。");
    }
    await requireSameAccount(account);
    let confirmed = await findReview(state);
    if (confirmed.state === "none") {
      await gh(["pr", "create", "--repo", "github.com/" + repo, "--head", state.branch, "--base", main,
        "--title=" + pending.title, "--body=通过团队共创空间提交，请审核所选文件。"], { cwd, allowFailure: true, account });
      confirmed = await findReview(state);
    }
    if (confirmed.state !== "open" || confirmed.headRefOid !== pending.commit) {
      throw new Error("已推送个人分支。审核请求未确认或已结束，请重试或保留旧文件另开任务。");
    }
    const { url, number } = confirmed;
    state.prUrl = url;
    state.prNumber = number;
    state.head = pending.commit;
    delete state.pending;
    await saveState(account, state);
    latestPreview = null;
    return { workspace: publicWorkspace(state), prUrl: url, number };
  }

  async function submit({ title, files, previewId, retry, workspaceId, pendingId } = {}) {
    const { account, state, cwd, head } = await getActive();
    ensureNoInterruptedInstall(state);
    if (retry === true) {
      if (!state.pending || state.id !== workspaceId || state.pending.commit !== pendingId) {
        throw new Error("待提交任务已变化，请刷新后重新确认。");
      }
      return resumePending(account, state);
    }
    if (state.pending) throw new Error("有一项待提交任务，请选择继续上次提交。");
    if (typeof title !== "string" || title.trim().length < 1 || title.length > 120 || /[\x00-\x1f\x7f]/.test(title)) {
      throw new Error("请输入 1–120 个字符的审核标题。");
    }
    if (!Array.isArray(files) || files.length < 1 || files.length > 100 || files.some((file) => pathProblem(file))) {
      throw new Error("本次发送需要包含 1–100 个有效的改动文件，请刷新改动后重试。");
    }
    if (new Set(files.map(windowsPathKey)).size !== files.length) {
      throw new Error("不能重复选择同一路径。");
    }
    const preview = latestPreview;
    if (!preview || preview.previewId !== previewId || preview.id !== state.id || preview.head !== head ||
        files.some((file) => !preview.fingerprints.has(file))) throw new Error("预览已过期，请重新检查改动。");
    const review = await findReview(state);
    if (review.state === "merged" || review.state === "closed") throw new Error("这项审核已结束，请创建新工作区。");
    await assertIndexClear(cwd, files, head);
    const snapshots = [];
    const source = state.livePath ? await checkLive(state.livePath) : cwd;
    let submissionBytes = 0;
    for (const file of files) {
      const current = await snapshot(cwd, head, file, { source });
      if (preview.fingerprints.get(file) !== current.fingerprint) throw new Error("预览后的文件已变化，请重新检查改动。");
      submissionBytes += current.bytes?.length ?? 0;
      if (submissionBytes > maxSubmissionBytes) throw new Error("本次改动总大小超过 10 MB，暂时无法全部发送。请联系项目负责人处理。");
      snapshots.push(current);
    }
    const commit = await buildCommit(cwd, head, account, title.trim(), snapshots);
    state.pending = {
      title: title.trim(), commit, parent: head, indexUpdated: false,
      files: snapshots.map(({ path: filePath, fingerprint }) => ({ path: filePath, fingerprint })),
    };
    await saveState(account, state);
    return resumePending(account, state);
  }

  async function openWorkspace() {
    await prepare();
    const account = await readAccount();
    if (!account) throw new Error("请先登录 GitHub。");
    const state = await readState(account);
    if (!state) throw new Error("没有已创建的工作区。");
    if (state.livePath) return checkLive(state.livePath);
    return (await validateWorkspace(state)).cwd;
  }

  async function teamBlob(cwd, sha, name) {
    const output = asText((await git(["ls-tree", "-z", sha, "--", name], { cwd })).stdout);
    if (!output) return null;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t/.exec(output);
    if (!match) throw new Error("团队路径不是普通文本文件。");
    const size = Number(await gitText(["cat-file", "-s", match[2]], { cwd }));
    if (!Number.isSafeInteger(size) || size > limit) throw new Error("团队文件超过 1 MB。");
    const raw = (await git(["cat-file", "blob", match[2]], { cwd })).stdout;
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(asText(raw));
    validText(bytes);
    return bytes;
  }

  async function mergeInstalled(cwd, before, base, team) {
    const tmp = await fs.mkdtemp(path.join(stateDirectory, "merge-"));
    const inputs = ["mine", "base", "team"].map((name) => path.join(tmp, name));
    try {
      for (const [index, data] of [before, base, team].entries()) await fs.writeFile(inputs[index], data, { mode: 0o600 });
      const result = await git(["merge-file", "--stdout", "--", ...inputs], { cwd, allowFailure: true });
      if (result.code !== 0) return null;
      const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(asText(result.stdout));
      if (bytes.length > limit) return null;
      validText(bytes);
      return bytes;
    } finally {
      for (const file of inputs) await fs.unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await fs.rmdir(tmp);
    }
  }

  async function fetchTeam(cwd, account) {
    await git(["fetch", "--no-tags", "origin", "+refs/heads/" + main + ":refs/remotes/origin/" + main], { cwd, network: account });
    const head = await gitText(["rev-parse", "refs/remotes/origin/" + main], { cwd });
    if (!shaPattern.test(head)) throw new Error("无法确认团队版本。");
    return head;
  }

  async function installPlan(account, state, cwd, head) {
    if (!state.livePath) throw new Error(say("请先绑定", "使用目录。"));
    if (state.updateBackup?.interrupted) throw new Error("上次安装尚未恢复，请先恢复备份。");
    const source = await checkLive(state.livePath);
    const targetSha = await fetchTeam(cwd, account);
    const baseSha = state.installBaseSha || state.baseSha;
    const output = asText((await git(["diff", "--name-status", "--no-renames", "--no-ext-diff", "-z", baseSha, targetSha, "--"], { cwd })).stdout);
    const fields = output ? output.slice(0, -1).split("\0") : [];
    const updates = [];
    const targets = new Set(state.installHeld || []);
    for (let index = 0; index < fields.length; index += 2) {
      const name = fields[index + 1];
      if (livePathProblem(name)) continue;
      updates.push({ path: name, status: fileStatus(fields[index]) });
      targets.add(name);
    }
    if (!state.installBaseSha) {
      const installed = new Set([...state.seenPaths, ...(await scan(source)).keys()]);
      const names = asText((await git(["ls-tree", "-r", "--name-only", "-z", targetSha], { cwd })).stdout);
      const tracked = new Set(names.split("\0"));
      for (const name of installed) {
        if (tracked.has(name) && !livePathProblem(name)) targets.add(name);
      }
      const localOnly = [...installed].filter((name) => !tracked.has(name) && !targets.has(name) && !livePathProblem(name));
      for (let start = 0; start < localOnly.length; start += 32) {
        const paths = localOnly.slice(start, start + 32);
        const history = asText((await git(["log", "--format=", "--name-only", "--no-renames", "-z", targetSha, "--", ...paths], { cwd })).stdout);
        const historical = new Set(history.split("\0").map((name) => name.replace(/^\n+/, "")));
        for (const name of paths) {
          if (historical.has(name)) targets.add(name);
        }
      }
    }
    if (targets.size > maxEntries) throw new Error("团队更新超过 500 项，请联系维护者处理。");
    const known = new Set(state.installKnown || []);
    const seen = new Set(state.seenPaths);
    const held = new Set(state.installHeld || []);
    const heldFingerprints = new Map(state.installHeldFingerprints || []);
    const entries = [];
    let bytes = 0;
    for (const name of [...targets].sort()) {
      let before, base, team, after, status, reason;
      try {
        before = await bytesAt(source, name);
        if (before !== null) validText(before);
        base = await teamBlob(cwd, baseSha, name);
        team = await teamBlob(cwd, targetSha, name);
      } catch (error) {
        entries.push({ view: { path: name, status: "skipped", reason: error.message }, hold: true });
        continue;
      }
      if (sameBytes(before, team)) {
        if (held.has(name)) {
          entries.push({ view: { path: name, status: "modified", reason: "使用目录已与团队版本一致。确认后即可解除暂缓。" },
            before, team, after: team });
        } else {
          entries.push({ view: { path: name, status: "skipped", reason: "使用目录已与团队版本一致。" }, before, team, known: true });
        }
        continue;
      }
      if (before === null && base !== null && !seen.has(name)) {
        entries.push({ view: { path: name, status: "skipped", reason: "此文件从未在使用目录中出现，保留缺失状态。" }, before, team });
        continue;
      }
      if (!held.has(name) && sameBytes(before, base)) {
        after = team;
        status = before === null ? "added" : team === null ? "deleted" : "modified";
      } else if (!held.has(name) && known.has(name) && before !== null && base !== null && team !== null) {
        after = await mergeInstalled(cwd, before, base, team);
        if (after !== null) status = "merged";
      }
      bytes += (before?.length ?? 0) + (team?.length ?? 0) + (after && after !== team ? after.length : 0);
      if (bytes > 20 * 1024 * 1024) throw new Error("团队更新的预览内容过大，请联系维护者分批处理。");
      if (!status) {
        const manuallyReconciled = held.has(name) && baseSha === targetSha && heldFingerprints.has(name) &&
          heldFingerprints.get(name) !== installFingerprint(before);
        reason = manuallyReconciled ? "本机文件已手动修改。确认已合并需要的团队内容后，选择保留本机即可继续提交。" :
          before === null ? "此文件曾在本机出现，但当前缺失。请选择保留缺失或恢复团队版本。" :
          team === null ? "团队删除了此文件，本机仍有不同内容。" :
          held.has(name) || !known.has(name) ? "无法确认本机原始版本，请选择保留本机或采用团队版本。" :
          "本机和团队修改了重叠内容。";
        entries.push({ view: conflictEntry(name, reason, before, team), before, team, manuallyReconciled });
      } else {
        entries.push({ view: { path: name, status, diff: updateDiff(before, after) }, before, team, after });
      }
    }
    const review = await findReview(state);
    const hasChanges = targetSha !== baseSha || entries.some((entry) => entry.view.status !== "skipped");
    const blockedReason = state.pending ? "请先处理待提交任务，再安装团队更新。" :
      review.state === "open" ? "当前审核仍在进行，请在审核结束后安装更新。" :
      !hasChanges ? "没有可以应用的团队文件更新。" : undefined;
    const previewId = randomUUID();
    latestUpdatePlan = { id: state.id, head, previewId, targetSha, source, entries, hasChanges };
    return {
      workspace: publicWorkspace(state), readOnly: true, previewId, targetSha, canApply: !blockedReason,
      ...(blockedReason && { blockedReason }),
      files: entries.map((entry) => entry.view), updates, message: "团队更新已查到，使用目录未修改。",
    };
  }

  async function previewUpdates() {
    const { account, state, cwd, head } = await getActive();
    return installPlan(account, state, cwd, head);
  }

  function backupPath(account, id) {
    if (typeof id !== "string" || !uuidPattern.test(id)) throw new Error("安装备份编号无效。");
    return path.join(stateDirectory, "install-backups", identityKey(account), id + ".json");
  }

  function ensureNoInterruptedInstall(state) {
    if (state?.updateBackup?.interrupted) throw new Error("上次安装中断，请先恢复备份。");
  }

  async function applyUpdates({ previewId, resolutions } = {}) {
    if (await readLocalRecovery()) throw new Error("上次安装中断，请先恢复备份。");
    const { account, state, cwd, head } = await getActive();
    ensureNoInterruptedInstall(state);
    const plan = latestUpdatePlan;
    if (!plan || plan.previewId !== previewId || plan.id !== state.id || plan.head !== head) {
      throw new Error("团队更新预览已过期，请重新查看。");
    }
    if (state.pending || (await findReview(state)).state === "open") throw new Error("请在当前审核结束后安装更新。");
    const conflicts = new Set(plan.entries.filter((entry) => entry.view.status === "conflict").map((entry) => entry.view.path));
    if (!resolutions || typeof resolutions !== "object" || Array.isArray(resolutions) ||
        Object.keys(resolutions).length !== conflicts.size ||
        Object.entries(resolutions).some(([name, choice]) => !conflicts.has(name) || !["mine", "team"].includes(choice))) {
      throw new Error("请明确选择所有冲突文件的保留方式。");
    }
    if (!plan.hasChanges) throw new Error("没有可以应用的团队文件更新。");

    const source = await checkLive(state.livePath);
    if (!samePath(source, plan.source)) throw new Error("使用目录已变化，请重新查看更新。");
    if (await fetchTeam(cwd, account) !== plan.targetSha) throw new Error("团队版本已变化，请重新查看更新。");
    const operations = [];
    const known = new Set(state.installKnown || []);
    const held = new Set(state.installHeld || []);
    const heldFingerprints = new Map(state.installHeldFingerprints || []);
    const seen = new Set(state.seenPaths);
    const planPaths = new Set();
    let beforeSize = 0, afterSize = 0;
    for (const entry of plan.entries) {
      const name = entry.view.path;
      const key = windowsPathKey(name);
      if (planPaths.has(key)) throw new Error("团队文件在 Windows 上发生路径冲突。");
      planPaths.add(key);
      if (entry.before !== undefined && !sameBytes(await bytesAt(source, name), entry.before)) {
        throw new Error(name + " 在预览后发生修改，请重新查看更新。");
      }
      if (entry.view.status === "skipped") {
        if (entry.known) { known.add(name); held.delete(name); heldFingerprints.delete(name); }
        if (entry.hold) { known.delete(name); held.add(name); heldFingerprints.delete(name); }
        continue;
      }
      if (entry.view.status === "conflict" && resolutions[name] === "mine" && !entry.manuallyReconciled) {
        known.delete(name);
        held.add(name);
        heldFingerprints.set(name, installFingerprint(entry.before));
        continue;
      }
      const after = entry.view.status === "conflict" ? (resolutions[name] === "mine" ? entry.before : entry.team) : entry.after;
      if (!sameBytes(entry.before, after)) operations.push({ path: name, before: entry.before, after });
      beforeSize += entry.before?.length ?? 0;
      afterSize += after?.length ?? 0;
      known.add(name);
      held.delete(name);
      heldFingerprints.delete(name);
      if (after !== null) seen.add(name);
    }
    if (operations.length > 100 || beforeSize > maxSubmissionBytes || afterSize > maxSubmissionBytes ||
        seen.size > maxEntries || known.size > maxEntries || held.size > maxEntries) {
      throw new Error("安装更新超过单批文件或大小限制，请联系维护者分批处理。");
    }

    const next = await cloneWorkspace(account, plan.targetSha);
    await requireSameAccount(account);
    const verified = await validateWorkspace(state);
    if (verified.head !== head || (await findReview(state)).state === "open") throw new Error("当前任务已变化，请重新查看团队更新。");
    await checkLive(source);
    for (const entry of plan.entries) {
      if (entry.before !== undefined && !sameBytes(await bytesAt(source, entry.view.path), entry.before)) {
        throw new Error(entry.view.path + " 在预览后发生修改，请重新查看更新。");
      }
    }
    next.livePath = state.livePath;
    next.seenPaths = [...seen].sort();
    next.installBaseSha = plan.targetSha;
    next.installKnown = [...known].sort();
    next.installHeld = [...held].sort();
    next.installHeldFingerprints = [...heldFingerprints].sort();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const destination = backupPath(account, id);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeRecord(destination, { id, createdAt, login: identityKey(account), previous: state, next, operations: packOperations(operations) });
    await archiveWorkspace(state);
    await beginInstallRecovery(account, state, { id, createdAt });
    try {
      await applyOperations(source, operations, id);
      next.updateBackup = { id, createdAt, interrupted: false };
      await saveState(account, next);
    } catch (error) {
      let preserved;
      try {
        preserved = await restoreOperations(source, operations, id, { bestEffort: true });
        await saveState(account, state);
      } catch {
        throw new Error("安装中断，检测到无法自动恢复的文件。请使用「恢复备份」检查，外部改动已保留。");
      }
      const detail = preserved.length ? "另存的外部改动：" + preserved.join("、") : error.message;
      throw new Error("更新未完成，已恢复更新前的文件。" + detail);
    }
    latestPreview = null;
    latestUpdatePlan = null;
    return { workspace: publicWorkspace(next), backupId: id, message: operations.length ? say("团队更新已应用到", "使用目录。") : "已确认团队版本，使用目录的文件保持原样。" };
  }

  async function restoreUpdate({ backupId } = {}) {
    const local = await readLocalRecovery();
    const { account, state } = local || await getActive();
    const backup = state.updateBackup;
    if (!backup || backup.id !== backupId) throw new Error("安装备份已变化，请刷新后重新选择。");
    const raw = await fs.readFile(backupPath(account, backupId), "utf8");
    let record;
    try { record = JSON.parse(raw); }
    catch { throw new Error("无法读取安装备份。"); }
    if (record.id !== backupId || record.login !== identityKey(account) ||
        record.previous?.login !== record.login || record.next?.login !== record.login ||
        !uuidPattern.test(record.previous?.id) || !uuidPattern.test(record.next?.id) ||
        record.previous.livePath !== state.livePath || record.next.livePath !== state.livePath ||
        (state.id !== record.next.id && (!backup.interrupted || state.id !== record.previous.id))) {
      throw new Error("安装备份与当前账号或使用目录不匹配。");
    }
    if (!backup.interrupted && (state.pending || state.head !== record.next.head || (await findReview(state)).state !== "none")) {
      throw new Error("安装后的工作区已有提交或审核，请先保留该工作区再联系维护者恢复。");
    }
    await validateWorkspace(record.previous);
    const source = await checkLive(state.livePath);
    const operations = unpackOperations(record.operations);
    await restoreOperations(source, operations, backupId, { preflightOnly: true });
    await beginInstallRecovery(account, state, backup);
    const preserved = await restoreOperations(source, operations, backupId);
    await saveState(account, record.previous);
    latestPreview = null;
    latestUpdatePlan = null;
    return { workspace: publicWorkspace(record.previous), backupId,
      message: say("已恢复安装前的", "文件及协作工作区。") + (preserved.length ? "另存的外部改动：" + preserved.join("、") : "") };
  }

  async function updateWorkspace() {
    const { account, state, cwd, head } = await getActive();
    if (state.livePath) return installPlan(account, state, cwd, head);
    if (state.pending) throw new Error("上次提交尚未完成，请先重试提交。");
    const review = await findReview(state);
    if (review.state === "merged" || review.state === "closed") throw new Error("这项审核已结束，请创建新工作区。");
    if ((await changedPaths(cwd)).length) throw new Error("工作区有未提交的改动，请先处理再更新。");
    await git(["fetch", "--no-tags", "origin", "+refs/heads/" + main + ":refs/remotes/origin/" + main], { cwd, network: account });
    const upstream = await gitText(["rev-parse", "refs/remotes/origin/" + main], { cwd });
    const verified = await validateWorkspace(state);
    if (verified.head !== head || (await changedPaths(cwd)).length) throw new Error("更新期间工作区已变化，请重试。");
    if ((await git(["merge-base", "--is-ancestor", head, upstream], { cwd, allowFailure: true })).code !== 0) {
      throw new Error("个人分支与默认分支已经分叉，无法快进更新。现有改动已保留。");
    }
    const merged = await git(["merge", "--ff-only", "--no-edit", "--no-autostash", "--no-overwrite-ignore", upstream],
      { cwd, allowFailure: true });
    if (merged.code !== 0) throw new Error("无法快进更新，请检查本地文件是否与默认分支冲突。");
    state.baseSha = upstream;
    state.head = upstream;
    await saveState(account, state);
    latestPreview = null;
    return publicWorkspace(state);
  }

  async function reviewStatus() {
    const { state } = await getActive();
    return findReview(state);
  }

  async function binding(account) {
    const names = account ? [identityKey(account) + ".json"]
      : await fs.readdir(stateDirectory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const paths = [];
    for (const name of names) {
      if (!/^[a-z0-9][a-z0-9-]{0,38}\.json$/i.test(name)) continue;
      const raw = await fs.readFile(path.join(stateDirectory, name), "utf8").catch(() => "");
      let state;
      try { state = JSON.parse(raw); } catch { continue; }
      if (typeof state?.livePath === "string" && state.livePath) paths.push(state.livePath);
    }
    return paths;
  }

  const usage = createUsageRecords({
    project,
    journalDir: path.join(stateDirectory, "usage-journal"),
    async getAccount() {
      await prepare();
      const account = await readAccount();
      if (!account) throw new Error("请先登录 GitHub。");
      return account;
    },
    async request(account, method, endpoint, body) {
      const args = ["api", "--hostname", "github.com", "--method", method, endpoint];
      if (body) args.push("--input", "-");
      const result = await gh(args, { account, timeout: 35000, input: body ? JSON.stringify(body) : undefined });
      try { return JSON.parse(asText(result.stdout)); }
      catch { throw new Error("GitHub 未返回可核对的使用记录。"); }
    },
  });

  return {
    status, changes: () => serialize(changes), openWorkspace, reviewStatus, binding,
    bindWorkspace: (directory) => serialize(() => bindWorkspace(directory)),
    login: (onProgress) => serialize(() => login(onProgress)),
    startWorkspace: () => serialize(startWorkspace),
    recoverWorkspace: () => serialize(recoverWorkspace),
    submit: (input) => serialize(() => submit(input)),
    updateWorkspace: () => serialize(updateWorkspace),
    previewUpdates: () => serialize(previewUpdates),
    applyUpdates: (input) => serialize(() => applyUpdates(input)),
    restoreUpdate: (input) => serialize(() => restoreUpdate(input)),
    usageList: (input) => serialize(() => usage.list(input)),
    usageDetail: (input) => serialize(() => usage.detail(input)),
    usageSave: (input) => serialize(() => usage.save(input)),
    usageOpen: (input) => serialize(() => usage.link(input)),
  };
}

module.exports = { createService };
