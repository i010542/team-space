const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { cleanEnvironment, runProcess, asText } = require("./core/process.cjs");
const { pathProblem, validText, worktreeFile, samePath, fileFingerprint, summaryDiff, limit, secretToken } = require("./core/files.cjs");

const repo = "i010542/fva";
const origin = "https://github.com/" + repo + ".git";
const main = "main";
const loginPattern = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const prPattern = /^https:\/\/github\.com\/i010542\/fva\/pull\/([1-9]\d*)$/;
const identityKey = (account) => account.login.toLowerCase();
const windowsPathKey = (name) => name.normalize("NFC").toUpperCase();

function createService({ root, gitPath, ghPath, run = runProcess }) {
  root = path.resolve(root);
  const stateDirectory = path.join(root, ".state");
  const noConfig = path.join(stateDirectory, "git-config");
  const noHooks = path.join(stateDirectory, "hooks");
  let latestPreview = null;
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

  async function gh(args, { cwd = root, onOutput, timeout, input, allowFailure = false } = {}) {
    const error = "GitHub 操作未完成，请检查网络和当前账号权限。";
    const env = { ...environment(), GIT_CONFIG_GLOBAL: path.join(stateDirectory, "gh-git-config") };
    const result = await command(ghPath, args, { cwd, env, onOutput, timeout, input }, error);
    if (result.code !== 0 && !allowFailure) throw new Error(error);
    return result;
  }

  async function git(args, { cwd = root, env: overrides, input, allowFailure = false, network = false, timeout } = {}) {
    const env = { ...environment(), ...overrides };
    if (network) {
      const token = asText((await gh(["auth", "token", "--hostname", "github.com", "--user", network.login])).stdout).trim();
      if (!/^[a-z0-9_-]{8,1024}$/i.test(token)) throw new Error("无法取得当前 GitHub 登录授权。");
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
    if (!(await permission())) throw new Error("当前 GitHub 账号缺少 FVA 仓库写入权限，或权限暂时无法核实。");
    return account;
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

  function publicWorkspace(state) {
    if (!state) return null;
    return {
      id: state.id, path: path.join(root, state.id), branch: state.branch, baseSha: state.baseSha,
      ...(state.prUrl && { prUrl: state.prUrl, prNumber: state.prNumber }),
      ...(state.pending && { pending: true, pendingId: state.pending.commit, pendingTitle: state.pending.title, pendingFiles: state.pending.files.map((file) => file.path) }),
    };
  }

  async function status() {
    const tools = await toolsAvailable();
    if (!tools.gh) return { tools, authenticated: false, authorized: false, workspace: null };
    const account = await readAccount();
    if (!account) return { tools, authenticated: false, authorized: false, workspace: null };
    const authorized = await permission();
    return { tools, authenticated: true, login: account.login, authorized, workspace: publicWorkspace(await readState(account)) };
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
    if (fetchUrl !== origin || pushUrl !== origin) throw new Error("工作区远程仓库与 FVA 不匹配。");
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
    if (previous) {
      if (previous.pending) throw new Error("上次提交尚未完成，请先重试提交。");
      const { cwd } = await validateWorkspace(previous);
      const review = await findReview(previous);
      if (review.state === "open" || review.state === "none") return publicWorkspace(previous);
      if ((await changedPaths(cwd)).length) throw new Error("现有工作区还有未提交的改动，请先处理后再开始新任务。");
    }
    const state = await cloneWorkspace(account);
    await saveState(account, state);
    latestPreview = null;
    return publicWorkspace(state);
  }

  async function cloneWorkspace(account) {
    const id = randomUUID();
    const state = { id, login: identityKey(account), branch: "codex/" + identityKey(account) + "/" + id };
    const cwd = path.join(root, id);
    await fs.mkdir(cwd, { mode: 0o700 });
    await git(["clone", "--template=", "--no-tags", "--single-branch", "--branch", main, "--", origin, cwd], { network: account, timeout: 240000 });
    state.baseSha = await gitText(["rev-parse", "HEAD"], { cwd });
    if (!shaPattern.test(state.baseSha)) throw new Error("无法确认下载版本。");
    state.head = state.baseSha;
    await git(["switch", "--no-guess", "-c", state.branch], { cwd });
    await validateWorkspace(state);
    return state;
  }

  async function recoverWorkspace() {
    const account = await requireAccount();
    const previous = await readState(account);
    if (!previous?.pending) throw new Error("当前没有需要恢复的待提交任务。");

    const state = await cloneWorkspace(account);
    const historyDirectory = path.join(stateDirectory, "history");
    await fs.mkdir(historyDirectory, { recursive: true, mode: 0o700 });
    await writeRecord(path.join(historyDirectory, previous.id + ".json"), previous);
    await saveState(account, state);
    latestPreview = null;
    return { workspace: publicWorkspace(state), previousPath: publicWorkspace(previous).path };
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

  async function snapshot(cwd, head, file, showDiff = false) {
    const problem = pathProblem(file);
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
    const working = await worktreeFile(cwd, file);
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

  async function changes() {
    const { state, cwd, head } = await getActive();
    const entries = await changedPaths(cwd);
    if (entries.length > 500) throw new Error("工作区的改动超过 500 个文件，请先整理后重新预览。");
    const files = [];
    const fingerprints = new Map();
    for (const entry of entries) {
      try {
        const change = await snapshot(cwd, head, entry.path, true);
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
      const live = await requireAccount();
      if (identityKey(live) !== identityKey(account)) throw new Error("GitHub 账号已切换，请重新登录原账号。");
      await assertIndexClear(cwd, paths, pending.parent);
      for (const file of pending.files) {
        const current = await snapshot(cwd, head, file.path);
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
    const live = await requireAccount();
    if (identityKey(live) !== identityKey(account)) throw new Error("GitHub 账号已切换，请重新登录原账号。");
    try {
      await git(["push", "--no-follow-tags", "origin", pending.commit + ":refs/heads/" + state.branch], { cwd, network: account });
    } catch {
      throw new Error("已保留本地提交。推送失败，请检查网络或远端分支后重试。");
    }
    let confirmed = await findReview(state);
    if (confirmed.state === "none") {
      await gh(["pr", "create", "--repo", "github.com/" + repo, "--head", state.branch, "--base", main,
        "--title=" + pending.title, "--body=通过团队共创空间提交，请审核所选文件。"], { cwd, allowFailure: true });
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
      throw new Error("请选择 1–100 个有效文件。");
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
    for (const file of files) {
      const current = await snapshot(cwd, head, file);
      if (preview.fingerprints.get(file) !== current.fingerprint) throw new Error("预览后的文件已变化，请重新检查改动。");
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
    return (await validateWorkspace(state)).cwd;
  }

  async function updateWorkspace() {
    const { account, state, cwd, head } = await getActive();
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

  return {
    status, changes, openWorkspace, reviewStatus,
    login: (onProgress) => serialize(() => login(onProgress)),
    startWorkspace: () => serialize(startWorkspace),
    recoverWorkspace: () => serialize(recoverWorkspace),
    submit: (input) => serialize(() => submit(input)),
    updateWorkspace: () => serialize(updateWorkspace),
  };
}

module.exports = { createService };

