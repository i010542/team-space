const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createService } = require("../src/core.cjs");
const { projectById } = require("../src/projects.cjs");
const { runProcess, asText } = require("../src/core/process.cjs");

const gitPath = process.env.TEST_GIT_PATH || "git";
const ghPath = "fake-gh-for-core-tests";
const publicOrigin = "https://github.com/i010542/fva.git";
const prUrl = "https://github.com/i010542/fva/pull/41";
const fake = (stdout = "", code = 0) => ({ code, stdout, stderr: "" });

async function git(cwd, ...args) {
  const result = await runProcess(gitPath, ["-c", "commit.gpgSign=false", "-c", "core.autocrlf=false", ...args], { cwd, env: {
    ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(cwd, ".test-no-user-config"),
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.test",
  } });
  assert.equal(result.code, 0, asText(result.stderr));
  return asText(result.stdout).trim();
}

async function fixture(t, project) {
  const repo = project?.repo || "i010542/fva";
  const originUrl = "https://github.com/" + repo + ".git";
  const reviewUrl = "https://github.com/" + repo + "/pull/41";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "team-space-core-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "remote.git");
  const seed = path.join(dir, "seed");
  const root = path.join(dir, "workspaces");
  await fs.mkdir(seed);
  await git(dir, "init", "--bare", "--initial-branch=main", remote);
  await git(seed, "init", "--initial-branch=main", "--template=");
  await fs.writeFile(path.join(seed, "SKILL.md"), "base\n");
  await fs.writeFile(path.join(seed, "keep.md"), "keep original\n");
  await fs.writeFile(path.join(seed, "delete.md"), "delete original\n");
  await git(seed, "add", "--", "SKILL.md", "keep.md", "delete.md");
  await git(seed, "commit", "-m", "Initial");
  await git(seed, "remote", "add", "origin", remote);
  await git(seed, "push", "origin", "main");

  const fakeGh = { offline: false, loggedIn: true, authorized: true, login: "example-user", review: null, failCreate: 0, createCalls: 0, pushes: 0, failPush: 0, failClone: 0, failUpdateRef: 0, endReviewOnPush: null, pushedSha: null, switchLoginOnPush: null };
  const commands = [];
  const run = async (binary, args, options) => {
    commands.push(args.join(" "));
    if (binary === ghPath) {
      if (args[0] === "--version") return fake("gh version 2");
      if (fakeGh.offline) throw new Error("Simulated offline GitHub");
      if (args[0] === "auth" && args[1] === "status") return fake("", fakeGh.loggedIn ? 0 : 1);
      if (args[0] === "auth" && args[1] === "login") {
        options.onOutput("! First copy your one-time ", "stderr");
        options.onOutput("code: TEST-0001\n", "stderr");
        fakeGh.loggedIn = true;
        return fake();
      }
      if (args[0] === "auth" && args[1] === "token") return fake("synthetic-test-value\n");
      if (args[0] === "api" && args[3] === "user") return fake(JSON.stringify({ login: fakeGh.login, id: 123 }));
      if (args[0] === "api" && args[3] === "repos/" + repo) return fake(String(fakeGh.authorized));
      if (args[0] === "pr" && args[1] === "list") return fake(JSON.stringify(fakeGh.review ? [fakeGh.review] : []));
      if (args[0] === "pr" && args[1] === "create") {
        assert.equal(options.env.GH_TOKEN, "synthetic-test-value");
        fakeGh.createCalls++;
        if (fakeGh.failCreate-- > 0) return fake("", 1);
        fakeGh.review = { url: reviewUrl, number: 41, state: "OPEN", headRefName: args[args.indexOf("--head") + 1], headRefOid: fakeGh.pushedSha, isCrossRepository: false };
        return fake(reviewUrl);
      }
      throw new Error("Unexpected fake gh command");
    }
    if (args.includes("clone") && fakeGh.failClone-- > 0) return fake("", 1);
    if (args.includes("update-ref") && fakeGh.failUpdateRef-- > 0) return fake("", 1);
    if (args.includes("push")) {
      fakeGh.pushes++;
      if (fakeGh.failPush-- > 0) return fake("", 1);
    }
    if (args.some((arg) => ["clone", "push", "fetch"].includes(arg))) {
      assert.equal(options.env.GIT_CONFIG_COUNT, "1");
      options.env = { ...options.env,
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_1: "url." + pathToFileURL(remote).href + ".insteadOf",
        GIT_CONFIG_VALUE_1: originUrl,
      };
    }
    const result = await runProcess(binary, args, options);
    if (result.code === 0 && args.includes("push")) {
      fakeGh.pushedSha = args.find((arg) => arg.includes(":refs/heads/")).split(":")[0];
      if (fakeGh.switchLoginOnPush) fakeGh.login = fakeGh.switchLoginOnPush;
      if (fakeGh.review) {
        fakeGh.review.headRefOid = fakeGh.pushedSha;
        if (fakeGh.endReviewOnPush) fakeGh.review.state = fakeGh.endReviewOnPush;
      }
    }
    return result;
  };
  const makeService = (extra) => createService({ root, gitPath, ghPath, run, ...(project ? { project } : {}), ...extra });
  return { dir, seed, root, remote, fakeGh, makeService, commands, originUrl, repo, service: makeService() };
}

async function retryInput(service) {
  const { workspace } = await service.status();
  return { retry: true, workspaceId: workspace.id, pendingId: workspace.pendingId };
}

test("signs in, reports write permission, and binds the worktree to the fixed repository and user", async (t) => {
  const { service, fakeGh, root } = await fixture(t);
  fakeGh.loggedIn = false;
  assert.deepEqual(await service.status(), { tools: { git: true, gh: true }, authenticated: false, authorized: false, workspace: null });
  const codes = [];
  const result = await service.login((event) => codes.push(event));
  assert.equal(result.login, "example-user");
  assert.deepEqual(codes, [{ type: "device-code", code: "TEST-0001", url: "https://github.com/login/device" }]);
  fakeGh.authorized = false;
  await assert.rejects(service.startWorkspace(), /写入权限/);
  assert.deepEqual(await fs.readdir(root), [".state"]);
  fakeGh.authorized = true;
  const workspace = await service.startWorkspace();
  assert.match(workspace.branch, /^codex\/example-user\/[a-f0-9-]{36}$/);
  assert.equal(await service.openWorkspace(), workspace.path);
  assert.equal(await git(workspace.path, "remote", "get-url", "origin"), publicOrigin);
  fakeGh.login = "different-user";
  assert.equal((await service.status()).workspace, null);
});

test("commits only selected additions, edits, and deletions while preserving unrelated staged work", async (t) => {
  const { service, fakeGh } = await fixture(t);
  const workspace = await service.startWorkspace();
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "new contents\n");
  await fs.writeFile(path.join(workspace.path, "keep.md"), "keep staged\n");
  await fs.writeFile(path.join(workspace.path, "new.md"), "new file\n");
  await fs.unlink(path.join(workspace.path, "delete.md"));
  await git(workspace.path, "add", "--", "keep.md");
  const preview = await service.changes();
  assert.deepEqual(preview.files.map(({ path: name, status, eligible }) => [name, status, eligible]), [
    ["SKILL.md", "modified", true], ["delete.md", "deleted", true], ["keep.md", "modified", false], ["new.md", "added", true],
  ]);
  assert.match(preview.files[0].diff, /\+new contents/);
  const submitted = await service.submit({ title: "Selected files", previewId: preview.previewId, files: ["SKILL.md", "delete.md", "new.md"] });
  assert.equal(submitted.prUrl, prUrl);
  assert.equal(fakeGh.createCalls, 1);
  assert.equal(await git(workspace.path, "show", "HEAD:SKILL.md"), "new contents");
  assert.equal(await git(workspace.path, "show", "HEAD:keep.md"), "keep original");
  assert.equal(await git(workspace.path, "diff", "--cached", "--name-only"), "keep.md");
  assert.equal(await git(workspace.path, "diff", "HEAD~1", "HEAD", "--name-status"), "M\tSKILL.md\nD\tdelete.md\nA\tnew.md");
  await fs.writeFile(path.join(workspace.path, "new.md"), "follow-up\n");
  const followup = await service.changes();
  assert.equal((await service.submit({ title: "Follow up", previewId: followup.previewId, files: ["new.md"] })).prUrl, prUrl);
  assert.equal(fakeGh.createCalls, 1);
  assert.equal((await service.reviewStatus()).state, "open");
});

test("rejects sensitive and nontext paths, and checks file fingerprints, branch and origin", async (t) => {
  const { service } = await fixture(t);
  const workspace = await service.startWorkspace();
  await fs.mkdir(path.join(workspace.path, ".github", "workflows"), { recursive: true });
  await fs.writeFile(path.join(workspace.path, ".github", "workflows", "job.yml"), "name: example");
  await fs.writeFile(path.join(workspace.path, ".env.local"), "PUBLIC_TEST=1");
  await fs.writeFile(path.join(workspace.path, "binary.dat"), Buffer.from([0, 255]));
  await fs.writeFile(path.join(workspace.path, "large.md"), Buffer.alloc(1024 * 1024 + 1, 65));
  await fs.writeFile(path.join(workspace.path, "secret.txt"), "-----BEGIN TEST PRIVATE KEY-----");
  await fs.writeFile(path.join(workspace.path, "token.txt"), "gh" + "p_" + "Synthetic".repeat(5));
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "preview content\n");
  const preview = await service.changes();
  assert.equal(preview.files.filter((file) => file.eligible).length, 1);
  assert.equal(preview.files.find((file) => file.eligible).path, "SKILL.md");
  assert.match(preview.files.find((file) => file.path === "token.txt").reason, /访问凭据/);
  await assert.rejects(service.submit({ title: "Escape", previewId: preview.previewId, files: ["../evil"] }), /有效的改动文件/);
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "changed after preview\n");
  await assert.rejects(service.submit({ title: "Stale", previewId: preview.previewId, files: ["SKILL.md"] }), /预览后的文件已变化/);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), workspace.baseSha);
  await git(workspace.path, "switch", "main");
  await assert.rejects(service.changes(), /个人分支/);
  await git(workspace.path, "switch", workspace.branch);
  await git(workspace.path, "remote", "set-url", "--push", "origin", "https://github.com/someone/other.git");
  await assert.rejects(service.changes(), /远程仓库/);
});

test("recovers failed push and PR creation across restarts without adding a duplicate commit", async (t) => {
  const { service, fakeGh, makeService } = await fixture(t);
  const workspace = await service.startWorkspace();
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "submitted once\n");
  const preview = await service.changes();
  fakeGh.failPush = 1;
  fakeGh.failCreate = 1;
  await assert.rejects(service.submit({ title: "Retry me", previewId: preview.previewId, files: ["SKILL.md"] }), /推送失败/);
  const originalCommit = await git(workspace.path, "rev-parse", "HEAD");
  assert.notEqual(originalCommit, workspace.baseSha);
  const restarted = makeService();
  assert.equal((await restarted.status()).workspace.pending, true);
  const retry = await retryInput(restarted);
  await assert.rejects(restarted.submit(retry), /审核请求未确认/);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), originalCommit);
  assert.equal((await restarted.submit(retry)).number, 41);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), originalCommit);
  assert.equal(fakeGh.createCalls, 2);
  assert.equal((await restarted.status()).workspace.pending, undefined);
});

test("updates clean branches only and refuses to merge a divergent default branch", async (t) => {
  const { service, seed, fakeGh } = await fixture(t);
  const workspace = await service.startWorkspace();
  await fs.writeFile(path.join(workspace.path, "scratch.md"), "pending local work");
  await assert.rejects(service.updateWorkspace(), /未提交/);
  await fs.unlink(path.join(workspace.path, "scratch.md"));
  await fs.writeFile(path.join(seed, "keep.md"), "upstream change\n");
  await git(seed, "commit", "-am", "Update upstream");
  await git(seed, "push", "origin", "main");
  const updated = await service.updateWorkspace();
  assert.notEqual(updated.baseSha, workspace.baseSha);
  assert.equal(await fs.readFile(path.join(workspace.path, "keep.md"), "utf8"), "upstream change\n");
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "local commit\n");
  const preview = await service.changes();
  await service.submit({ title: "Local change", previewId: preview.previewId, files: ["SKILL.md"] });
  const localHead = await git(workspace.path, "rev-parse", "HEAD");
  await fs.writeFile(path.join(seed, "keep.md"), "second upstream\n");
  await git(seed, "commit", "-am", "Second upstream");
  await git(seed, "push", "origin", "main");
  await assert.rejects(service.updateWorkspace(), /已经分叉/);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), localHead);
  assert.equal(await fs.readFile(path.join(workspace.path, "SKILL.md"), "utf8"), "local commit\n");
  fakeGh.review.state = "MERGED";
  await fs.writeFile(path.join(workspace.path, "scratch.md"), "unfinished local work");
  await assert.rejects(service.startWorkspace(), /未提交/);
  await fs.unlink(path.join(workspace.path, "scratch.md"));
  const next = await service.startWorkspace();
  assert.notEqual(next.id, workspace.id);
  assert.equal(await fs.readFile(path.join(workspace.path, "SKILL.md"), "utf8"), "local commit\n");
});


test("rejects repository filters, symlink escapes, revoked permission and app-external commits before any push", async (t) => {
  const { service, fakeGh, dir } = await fixture(t);
  const workspace = await service.startWorkspace();
  const external = path.join(dir, "external");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "secret.md"), "outside the workspace");
  await fs.symlink(external, path.join(workspace.path, "shortcut"), process.platform === "win32" ? "junction" : "dir");
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "safe proposed edit\n");
  const first = await service.changes();
  assert(first.files.some((file) => file.path.startsWith("shortcut") && !file.eligible));
  fakeGh.authorized = false;
  await assert.rejects(service.submit({ title: "Revoked", previewId: first.previewId, files: ["SKILL.md"] }), /写入权限/);
  fakeGh.authorized = true;
  await git(workspace.path, "config", "filter.local.clean", "invalid-command-for-test");
  await assert.rejects(service.changes(), /过滤器配置/);
  await git(workspace.path, "config", "--remove-section", "filter.local");
  await fs.writeFile(path.join(workspace.path, "staged-by-another-tool.md"), "Unreviewed file");
  await git(workspace.path, "add", "--", "staged-by-another-tool.md");
  await git(workspace.path, "commit", "-m", "Outside the app");
  await assert.rejects(service.changes(), /应用外变化/);
  await assert.rejects(service.submit({ title: "Approved file only", previewId: first.previewId, files: ["SKILL.md"] }), /应用外变化/);
  assert.equal(fakeGh.pushes, 0);
});


test("fast-forward refuses to overwrite an ignored local draft tracked by the new upstream", async (t) => {
  const { service, seed } = await fixture(t);
  await fs.writeFile(path.join(seed, ".gitignore"), "draft.md\n");
  await git(seed, "add", "--", ".gitignore");
  await git(seed, "commit", "-m", "Ignore local draft");
  await git(seed, "push", "origin", "main");
  const workspace = await service.startWorkspace();
  const localFile = path.join(workspace.path, "draft.md");
  const localBytes = Buffer.from("local ignored draft\r\n草稿\r\n", "utf8");
  await fs.writeFile(localFile, localBytes);
  assert.equal(await git(workspace.path, "check-ignore", "draft.md"), "draft.md");
  assert.equal(await git(workspace.path, "status", "--porcelain"), "");

  await fs.writeFile(path.join(seed, "draft.md"), "new upstream file\n");
  await git(seed, "add", "--force", "--", "draft.md");
  await git(seed, "commit", "-m", "Track upstream draft filename");
  await git(seed, "push", "origin", "main");

  await assert.rejects(service.updateWorkspace(), /本地文件是否与默认分支冲突/);
  assert.deepEqual(await fs.readFile(localFile), localBytes);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), workspace.baseSha);
  assert.equal((await service.status()).workspace.baseSha, workspace.baseSha);
});

test("archives a pending workspace when its PR closes and keeps local commits and files", async (t) => {
  const { service, fakeGh, root, seed } = await fixture(t);
  await assert.rejects(service.recoverWorkspace(), /没有需要恢复/);
  const workspace = await service.startWorkspace();
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "first approved content\n");
  let preview = await service.changes();
  await service.submit({ title: "Initial PR", previewId: preview.previewId, files: ["SKILL.md"] });
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "pending follow-up content\n");
  preview = await service.changes();
  fakeGh.failPush = 1;
  await assert.rejects(service.submit({ title: "Follow-up", previewId: preview.previewId, files: ["SKILL.md"] }), /推送失败/);
  const pendingHead = await git(workspace.path, "rev-parse", "HEAD");
  fakeGh.review.state = "CLOSED";
  await assert.rejects(service.submit(await retryInput(service)), /审核已结束/);
  await fs.writeFile(path.join(workspace.path, "scratch.md"), "draft after failed submit");
  await fs.writeFile(path.join(seed, "keep.md"), "new default branch version\n");
  await git(seed, "commit", "-am", "Advance main");
  await git(seed, "push", "origin", "main");

  fakeGh.failClone = 1;
  await assert.rejects(service.recoverWorkspace(), /本地 Git 操作未完成/);
  assert.equal((await service.status()).workspace.id, workspace.id);
  assert.equal((await service.status()).workspace.pending, true);
  await assert.rejects(fs.stat(path.join(root, ".state", "history", workspace.id + ".json")), { code: "ENOENT" });

  const pushesBefore = fakeGh.pushes;
  const { workspace: recovered, previousPath } = await service.recoverWorkspace();
  assert.equal(fakeGh.pushes, pushesBefore);
  assert.equal(fakeGh.createCalls, 1);
  assert.equal(previousPath, workspace.path);
  assert.notEqual(recovered.id, workspace.id);
  assert.equal(recovered.pending, undefined);
  assert.equal((await service.status()).workspace.id, recovered.id);
  assert.equal(await fs.readFile(path.join(recovered.path, "keep.md"), "utf8"), "new default branch version\n");
  assert.equal(await fs.readFile(path.join(recovered.path, "SKILL.md"), "utf8"), "base\n");
  await assert.rejects(fs.stat(path.join(recovered.path, "scratch.md")), { code: "ENOENT" });
  assert.equal(await git(previousPath, "rev-parse", "HEAD"), pendingHead);
  assert.equal(await fs.readFile(path.join(previousPath, "SKILL.md"), "utf8"), "pending follow-up content\n");
  assert.equal(await fs.readFile(path.join(previousPath, "scratch.md"), "utf8"), "draft after failed submit");
  const history = JSON.parse(await fs.readFile(path.join(root, ".state", "history", workspace.id + ".json"), "utf8"));
  assert.equal(history.pending.commit, pendingHead);
});

test("recovers an untouched HEAD with pending snapshots whose local file has since changed", async (t) => {
  const { service, fakeGh, root } = await fixture(t);
  const workspace = await service.startWorkspace();
  const file = path.join(workspace.path, "SKILL.md");
  await fs.writeFile(file, "snapshot\n");
  const preview = await service.changes();
  fakeGh.failUpdateRef = 1;
  await assert.rejects(service.submit({ title: "Unapplied", previewId: preview.previewId, files: ["SKILL.md"] }), /本地 Git 操作未完成/);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), workspace.baseSha);
  await fs.writeFile(file, "edited since snapshot\n");
  await assert.rejects(service.submit(await retryInput(service)), /文件已变化/);

  const { workspace: recovered, previousPath } = await service.recoverWorkspace();
  assert.notEqual(recovered.id, workspace.id);
  assert.equal(await git(previousPath, "rev-parse", "HEAD"), workspace.baseSha);
  assert.equal(await fs.readFile(file, "utf8"), "edited since snapshot\n");
  assert.equal(await fs.readFile(path.join(recovered.path, "SKILL.md"), "utf8"), "base\n");
  const history = JSON.parse(await fs.readFile(path.join(root, ".state", "history", workspace.id + ".json"), "utf8"));
  assert.equal(history.pending.parent, workspace.baseSha);
  assert.equal(await git(previousPath, "cat-file", "-t", history.pending.commit), "commit");
  assert.equal(fakeGh.pushes, 0);
  assert.equal(fakeGh.createCalls, 0);
});


test("rejects an unselected parent deletion and preserves any staged parent changes", async (t) => {
  const { service, fakeGh } = await fixture(t);
  const workspace = await service.startWorkspace();
  const parent = path.join(workspace.path, "keep.md");
  await fs.writeFile(parent, "different staged parent\n");
  await git(workspace.path, "add", "--", "keep.md");
  await fs.unlink(parent);
  await fs.mkdir(parent);
  await fs.writeFile(path.join(parent, "child.md"), "selected child\n");

  const selected = "keep.md/child.md";
  let preview = await service.changes();
  assert.equal(preview.files.find((file) => file.path === selected).eligible, true);
  await assert.rejects(service.submit({ title: "Child only", previewId: preview.previewId, files: [selected] }), /相关路径已有暂存/);
  assert.equal(await git(workspace.path, "show", ":keep.md"), "different staged parent");
  assert.equal(await git(workspace.path, "show", "HEAD:keep.md"), "keep original");

  await git(workspace.path, "reset", "--quiet", "HEAD", "--", "keep.md");
  preview = await service.changes();
  await assert.rejects(service.submit({ title: "Child only", previewId: preview.previewId, files: [selected] }), /同时改变其他路径/);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), workspace.baseSha);
  assert.equal(await git(workspace.path, "show", ":keep.md"), "keep original");
  assert.equal(fakeGh.pushes, 0);
});

test("explains why files with content-transforming Git attributes cannot be committed", async (t) => {
  const { service, seed, fakeGh } = await fixture(t);
  await fs.writeFile(path.join(seed, ".gitattributes"), "SKILL.md text eol=crlf\n");
  await git(seed, "add", "--", ".gitattributes");
  await git(seed, "commit", "-m", "Set line ending rule");
  await git(seed, "push", "origin", "main");
  const workspace = await service.startWorkspace();
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "content change\r\n");
  const preview = await service.changes();
  const file = preview.files.find((item) => item.path === "SKILL.md");
  assert.equal(file.eligible, false);
  assert.match(file.reason, /转换内容的 Git 属性/);
  await assert.rejects(service.submit({ title: "Do not normalize silently", previewId: preview.previewId, files: ["SKILL.md"] }), /重新检查改动/);
  await fs.writeFile(path.join(workspace.path, ".gitattributes"), "# No local conversion rules\n");
  const unselectedAttributes = await service.changes();
  assert.equal(unselectedAttributes.files.find((item) => item.path === "SKILL.md").eligible, true);
  await assert.rejects(service.submit({ title: "Do not bypass committed attributes", previewId: unselectedAttributes.previewId, files: ["SKILL.md"] }), /转换内容的 Git 属性/);
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), workspace.baseSha);
  assert.equal(fakeGh.pushes, 0);
});

test("retains pending state if the existing review ends while pushing", async (t) => {
  const { service, fakeGh } = await fixture(t);
  const workspace = await service.startWorkspace();
  const file = path.join(workspace.path, "SKILL.md");
  await fs.writeFile(file, "review first version\n");
  let preview = await service.changes();
  await service.submit({ title: "First review", previewId: preview.previewId, files: ["SKILL.md"] });
  await fs.writeFile(file, "review second version\n");
  preview = await service.changes();
  fakeGh.endReviewOnPush = "MERGED";
  await assert.rejects(service.submit({ title: "Review race", previewId: preview.previewId, files: ["SKILL.md"] }), /审核请求未确认或已结束/);
  assert.equal((await service.status()).workspace.pending, true);
  assert.equal(fakeGh.createCalls, 1);
  assert.equal(fakeGh.pushes, 2);
});


test("only the exact explicitly confirmed workspace and pending commit can resume a submission", async (t) => {
  const { service, fakeGh } = await fixture(t);
  const workspace = await service.startWorkspace();
  await fs.writeFile(path.join(workspace.path, "SKILL.md"), "one confirmed snapshot\n");
  const preview = await service.changes();
  const normal = { title: "Confirmed original", previewId: preview.previewId, files: ["SKILL.md"] };
  fakeGh.failPush = 1;
  await assert.rejects(service.submit(normal), /推送失败/);
  const retry = await retryInput(service);
  assert.match(retry.pendingId, /^[a-f0-9]{40}$/);
  const pushes = fakeGh.pushes;
  await assert.rejects(service.submit(normal), /继续上次提交/);
  await assert.rejects(service.submit({ ...retry, workspaceId: "wrong" }), /重新确认/);
  await assert.rejects(service.submit({ ...retry, pendingId: "wrong" }), /重新确认/);
  assert.equal(fakeGh.pushes, pushes);
  assert.equal((await service.submit(retry)).number, 41);
});


test("rejects a Windows-equivalent tracked ancestor even when Git can store both names", async (t) => {
  const { service, seed, fakeGh } = await fixture(t);
  await fs.writeFile(path.join(seed, "Foo"), "existing tracked file\n");
  await git(seed, "add", "--", "Foo");
  await git(seed, "commit", "-m", "Track an upper-case path");
  await git(seed, "push", "origin", "main");
  const workspace = await service.startWorkspace();
  await fs.unlink(path.join(workspace.path, "Foo"));
  await fs.mkdir(path.join(workspace.path, "foo"));
  await fs.writeFile(path.join(workspace.path, "foo", "child"), "child\n");
  const preview = await service.changes();
  assert.equal(preview.files.find((file) => file.path === "foo/child").eligible, true);
  await assert.rejects(service.submit({ title: "Case-insensitive collision", previewId: preview.previewId, files: ["foo/child"] }), /大小写/);
  assert.equal(await git(workspace.path, "show", "HEAD:Foo"), "existing tracked file");
  assert.equal(await git(workspace.path, "rev-parse", "HEAD"), workspace.baseSha);
  assert.equal(fakeGh.pushes, 0);
});



const skillText = (body) => "---\nname: fva\n---\n" + body + "\n";

async function liveFixture(t) {
  const project = await fixture(t);
  const live = path.join(project.dir, "installed-fva");
  await fs.mkdir(live);
  await fs.writeFile(path.join(live, "SKILL.md"), skillText("already edited at bind time"));
  return { ...project, live };
}

test("binding is read-only, previews existing edits, and commits just the selected installed files", async (t) => {
  const { service, makeService, fakeGh, live } = await liveFixture(t);
  await fs.writeFile(path.join(live, "keep.md"), "keep original\n");
  await fs.writeFile(path.join(live, "only-local.md"), "keep local");
  await fs.writeFile(path.join(live, ".env.local"), "SYNTHETIC_TEST_VALUE=1");
  await fs.mkdir(path.join(live, "bin"));
  await fs.writeFile(path.join(live, "bin", "tool.txt"), "synthetic local tool");
  const originalSkill = await fs.readFile(path.join(live, "SKILL.md"));
  const originalFiles = (await fs.readdir(live)).sort();

  const workspace = await service.bindWorkspace(live);
  assert.equal(workspace.bound, true);
  assert.equal(workspace.livePath, await fs.realpath(live));
  assert.equal(workspace.path, workspace.livePath);
  assert.notEqual(workspace.gitPath, workspace.livePath);
  assert.equal(await service.openWorkspace(), workspace.livePath);
  assert.equal((await service.bindWorkspace(live)).id, workspace.id);
  assert.deepEqual((await fs.readdir(live)).sort(), originalFiles);

  let preview = await service.changes();
  assert.deepEqual(new Map(preview.files.map((file) => [file.path, file.status])), new Map([
    ["SKILL.md", "modified"], ["only-local.md", "added"],
  ]));
  assert(preview.files.every((file) => file.eligible));
  await service.submit({ title: "Selected skill only", previewId: preview.previewId, files: ["SKILL.md"] });
  assert.deepEqual(await fs.readFile(path.join(live, "SKILL.md")), originalSkill);
  assert.equal(await fs.readFile(path.join(workspace.gitPath, "SKILL.md"), "utf8"), "base\n");
  assert.equal(await git(workspace.gitPath, "show", "HEAD:SKILL.md"), skillText("already edited at bind time").trimEnd());
  assert.equal(await git(workspace.gitPath, "show", "HEAD:delete.md"), "delete original");
  assert.deepEqual((await service.changes()).files.map((file) => file.path), ["only-local.md"]);

  await fs.unlink(path.join(live, "keep.md"));
  const restarted = makeService();
  preview = await restarted.changes();
  assert.deepEqual(new Map(preview.files.map((file) => [file.path, file.status])), new Map([
    ["keep.md", "deleted"], ["only-local.md", "added"],
  ]));
  await restarted.submit({ title: "Intentional deletion", previewId: preview.previewId, files: ["keep.md"] });
  assert.equal(await git(workspace.gitPath, "diff", "HEAD~1", "HEAD", "--name-status"), "D\tkeep.md");
  assert.equal(await git(workspace.gitPath, "show", "HEAD:delete.md"), "delete original");
  assert.equal(await fs.readFile(path.join(live, "only-local.md"), "utf8"), "keep local");
  assert.equal(fakeGh.createCalls, 1);
});

test("rejects invalid bind roots and ancestor links, and verifies installed-file snapshots before pushing", async (t) => {
  const { service, live, root, dir, fakeGh } = await liveFixture(t);
  await assert.rejects(service.bindWorkspace(path.parse(live).root), /具体目录/);
  await assert.rejects(service.bindWorkspace(os.homedir()), /具体目录/);
  await assert.rejects(service.bindWorkspace(dir), /具体目录/);
  await assert.rejects(service.bindWorkspace(root), /具体目录/);
  await assert.rejects(service.bindWorkspace(path.join(root, "nested")), /具体目录/);
  const otherData = path.join(dir, "workspaces-ugc-reference-ad-workflow");
  await fs.mkdir(path.join(otherData, "nested"), { recursive: true });
  await assert.rejects(service.bindWorkspace(otherData), /具体目录/);
  await assert.rejects(service.bindWorkspace(path.join(otherData, "nested")), /具体目录/);
  const invalid = path.join(dir, "another-skill");
  await fs.mkdir(invalid);
  await fs.writeFile(path.join(invalid, "SKILL.md"), "---\nname: other\n---\n");
  await assert.rejects(service.bindWorkspace(invalid), /name: fva/);

  const container = path.join(dir, "real-container");
  const actual = path.join(container, "valid-child");
  const linked = path.join(dir, "linked-container");
  await fs.mkdir(actual, { recursive: true });
  await fs.writeFile(path.join(actual, "SKILL.md"), skillText("external"));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(container, linked, linkType);
  await assert.rejects(service.bindWorkspace(path.join(linked, "valid-child")), /路径包含符号链接/);

  const workspace = await service.bindWorkspace(live);
  await fs.symlink(container, path.join(live, "link"), linkType);
  const preview = await service.changes();
  const link = preview.files.find((file) => file.path === "link");
  assert.equal(link.eligible, false);
  assert.match(link.reason, /符号链接/);
  assert(!preview.files.some((file) => file.path.startsWith("link/")));

  await fs.writeFile(path.join(live, "SKILL.md"), skillText("modified after preview"));
  await assert.rejects(service.submit({ title: "Stale", previewId: preview.previewId, files: ["SKILL.md"] }), /文件已变化/);
  assert.equal(fakeGh.pushes, 0);
  assert.equal(await git(workspace.gitPath, "rev-parse", "HEAD"), workspace.baseSha);
});

test("bound team updates are read-only and a completed task can reuse the installed directory", async (t) => {
  const { service, live, seed, fakeGh } = await liveFixture(t);
  const workspace = await service.bindWorkspace(live);
  const preview = await service.changes();
  await service.submit({ title: "Start collaboration", previewId: preview.previewId, files: ["SKILL.md"] });
  const head = await git(workspace.gitPath, "rev-parse", "HEAD");
  const localBytes = await fs.readFile(path.join(live, "SKILL.md"));
  await fs.writeFile(path.join(seed, "keep.md"), "team update\n");
  await fs.writeFile(path.join(seed, "team-added.md"), "team addition\n");
  await git(seed, "add", "--", "keep.md", "team-added.md");
  await git(seed, "commit", "-m", "New team files");
  await git(seed, "push", "origin", "main");
  const update = await service.updateWorkspace();
  assert.equal(update.readOnly, true);
  assert.match(update.message, /使用目录未修改/);
  assert.deepEqual(update.updates, [{ path: "keep.md", status: "modified" }, { path: "team-added.md", status: "added" }]);
  assert.deepEqual(await fs.readFile(path.join(live, "SKILL.md")), localBytes);
  assert.deepEqual(await fs.readdir(live), ["SKILL.md"]);
  assert.equal(await git(workspace.gitPath, "rev-parse", "HEAD"), head);

  fakeGh.review.state = "MERGED";
  await assert.rejects(service.startWorkspace(), /先在「团队更新」/);
  const afterReview = await service.previewUpdates();
  const { workspace: next } = await service.applyUpdates({ previewId: afterReview.previewId, resolutions: { "SKILL.md": "mine" } });
  assert.notEqual(next.id, workspace.id);
  assert.equal(next.path, workspace.path);
  assert.equal(await fs.readFile(path.join(next.gitPath, "keep.md"), "utf8"), "team update\n");
  assert.deepEqual(await fs.readFile(path.join(live, "SKILL.md")), localBytes);
});

test("recovering a pending bound task preserves both the live directory and the old backend", async (t) => {
  const { service, live, fakeGh, root } = await liveFixture(t);
  const workspace = await service.bindWorkspace(live);
  const file = path.join(live, "SKILL.md");
  const preview = await service.changes();
  fakeGh.failUpdateRef = 1;
  await assert.rejects(service.submit({ title: "Pending from live", previewId: preview.previewId, files: ["SKILL.md"] }), /本地 Git 操作未完成/);
  await fs.writeFile(file, skillText("new source edits while pending"));
  await assert.rejects(service.bindWorkspace(live), /继续提交/);
  const { workspace: recovered, previousPath } = await service.recoverWorkspace();
  assert.equal(previousPath, workspace.gitPath);
  assert.notEqual(recovered.gitPath, previousPath);
  assert.equal(recovered.path, workspace.path);
  assert.equal(await fs.readFile(file, "utf8"), skillText("new source edits while pending"));
  assert.equal(await git(previousPath, "rev-parse", "HEAD"), workspace.baseSha);
  const history = JSON.parse(await fs.readFile(path.join(root, ".state", "history", workspace.id + ".json"), "utf8"));
  assert.equal(history.livePath, workspace.livePath);
  assert.equal(await git(previousPath, "cat-file", "-t", history.pending.commit), "commit");
  assert.equal(fakeGh.pushes, 0);
  assert.match((await service.changes()).files[0].diff, /new source edits while pending/);
});

test("bound submission enforces file and batch size limits without touching installed files", async (t) => {
  const { service, live, fakeGh } = await liveFixture(t);
  const workspace = await service.bindWorkspace(live);
  const paths = Array.from({ length: 11 }, (_, index) => "chunk-" + index + ".txt");
  const payload = Buffer.alloc(1024 * 1024, 97);
  for (const name of paths) await fs.writeFile(path.join(live, name), payload);
  await fs.writeFile(path.join(live, "large.txt"), Buffer.alloc(payload.length + 1, 97));
  const preview = await service.changes();
  assert.equal(preview.files.find((file) => file.path === "large.txt").eligible, false);
  await assert.rejects(service.submit({ title: "Oversized batch", previewId: preview.previewId, files: paths }), /总大小超过 10 MB/);
  assert.equal(fakeGh.pushes, 0);
  assert.deepEqual(await fs.readFile(path.join(live, paths[0])), payload);
  assert.equal(await git(workspace.gitPath, "rev-parse", "HEAD"), workspace.baseSha);
});


test("a different active GitHub account cannot create a review after the confirmed account pushes", async (t) => {
  const { service, live, fakeGh } = await liveFixture(t);
  const workspace = await service.bindWorkspace(live);
  const preview = await service.changes();
  fakeGh.switchLoginOnPush = "different-user";
  await assert.rejects(service.submit({ title: "Stay with confirmed account", previewId: preview.previewId, files: ["SKILL.md"] }), /账号已切换/);
  assert.equal(fakeGh.pushes, 1);
  assert.equal(fakeGh.createCalls, 0);
  fakeGh.login = "example-user";
  fakeGh.switchLoginOnPush = null;
  const { workspace: pending } = await service.status();
  assert.equal(pending.id, workspace.id);
  assert.equal(pending.pending, true);
  assert.equal((await service.submit(await retryInput(service))).number, 41);
});

test("rebinding opens a separate backend and leaves both installed trees unchanged", async (t) => {
  const { service, live, dir, root } = await liveFixture(t);
  const first = await service.bindWorkspace(live);
  const other = path.join(dir, "second-installed-fva");
  await fs.mkdir(other);
  await fs.writeFile(path.join(other, "SKILL.md"), skillText("second live tree"));
  const next = await service.bindWorkspace(other);
  assert.notEqual(first.id, next.id);
  assert.equal(next.path, await fs.realpath(other));
  assert.equal(await fs.readFile(path.join(live, "SKILL.md"), "utf8"), skillText("already edited at bind time"));
  assert.equal(await fs.readFile(path.join(other, "SKILL.md"), "utf8"), skillText("second live tree"));
  assert.equal(await git(first.gitPath, "rev-parse", "HEAD"), first.baseSha);
  const history = JSON.parse(await fs.readFile(path.join(root, ".state", "history", first.id + ".json"), "utf8"));
  assert.equal(history.livePath, first.livePath);
});


async function installFixture(t) {
  const project = await fixture(t);
  const live = path.join(project.dir, "installed-fva");
  await fs.mkdir(live);
  const skill = skillText("installed FVA");
  await fs.writeFile(path.join(project.seed, "SKILL.md"), skill);
  await fs.writeFile(path.join(project.seed, "omitted.md"), "not installed\n");
  await git(project.seed, "add", "--", "SKILL.md", "omitted.md");
  await git(project.seed, "commit", "-m", "Installable FVA");
  await git(project.seed, "push", "origin", "main");
  await fs.writeFile(path.join(live, "SKILL.md"), skill);
  await fs.writeFile(path.join(live, "keep.md"), "keep original\n");
  return { ...project, live };
}

async function pushInstall(trees, files) {
  for (const [name, content] of Object.entries(files)) {
    const location = path.join(trees.seed, name);
    if (content === null) await fs.unlink(location);
    else {
      await fs.mkdir(path.dirname(location), { recursive: true });
      await fs.writeFile(location, content);
    }
  }
  await git(trees.seed, "add", "-A", "--", ...Object.keys(files));
  await git(trees.seed, "commit", "-m", "Team install update");
  await git(trees.seed, "push", "origin", "main");
}

test("installation previews older contents immediately and allows an explicitly reconciled mine", async (t) => {
  const trees = await installFixture(t);
  const { service, live } = trees;
  await fs.writeFile(path.join(live, "keep.md"), "older installation with personal content\n");
  const bound = await service.bindWorkspace(live);
  const first = await service.previewUpdates();
  assert.equal(first.targetSha, bound.baseSha);
  const conflict = first.files.find((file) => file.path === "keep.md");
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.mineText, "older installation with personal content\n");
  assert.equal(conflict.teamText, "keep original\n");
  assert(!first.files.some((file) => file.path === "omitted.md"));
  await assert.rejects(service.applyUpdates({ previewId: first.previewId, resolutions: {} }), /所有冲突/);

  const kept = await service.applyUpdates({ previewId: first.previewId, resolutions: { "keep.md": "mine" } });
  assert.notEqual(kept.workspace.id, bound.id);
  assert.equal((await service.changes()).files.find((file) => file.path === "keep.md").eligible, false);
  await fs.writeFile(path.join(live, "keep.md"), "keep original\npersonal content manually reapplied\n");
  const reconciled = await service.previewUpdates();
  assert.match(reconciled.files.find((file) => file.path === "keep.md").reason, /已手动修改/);
  await service.applyUpdates({ previewId: reconciled.previewId, resolutions: { "keep.md": "mine" } });
  const personal = (await service.changes()).files.find((file) => file.path === "keep.md");
  assert.equal(personal.eligible, true);
  assert.match(personal.diff, /\+personal content manually reapplied/);
});

test("installation applies safe additions, edits, and deletions, and restores files and task after restart", async (t) => {
  const trees = await installFixture(t);
  const { service, makeService, live, fakeGh } = trees;
  await fs.writeFile(path.join(live, "delete.md"), "delete original\n");
  const bound = await service.bindWorkspace(live);
  await pushInstall(trees, { "keep.md": "team modified\n", "delete.md": null, "sub/new.md": "new team file\n", "omitted.md": "team edit to omitted file\n" });
  const plan = await service.previewUpdates();
  assert.equal(plan.canApply, true);
  assert.deepEqual(new Map(plan.files.map((file) => [file.path, file.status])), new Map([
    ["SKILL.md", "skipped"], ["delete.md", "deleted"], ["keep.md", "modified"], ["omitted.md", "skipped"], ["sub/new.md", "added"],
  ]));
  const result = await service.applyUpdates({ previewId: plan.previewId, resolutions: {} });
  assert.equal(await fs.readFile(path.join(live, "keep.md"), "utf8"), "team modified\n");
  assert.equal(await fs.readFile(path.join(live, "sub", "new.md"), "utf8"), "new team file\n");
  await assert.rejects(fs.stat(path.join(live, "delete.md")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(live, "omitted.md")), { code: "ENOENT" });
  assert.equal(await git(bound.gitPath, "rev-parse", "HEAD"), bound.baseSha);
  assert.equal(await git(result.workspace.gitPath, "rev-parse", "HEAD"), plan.targetSha);
  assert.deepEqual((await service.changes()).files, []);
  const restarted = makeService();
  assert.equal((await restarted.status()).lastBackup.id, result.backupId);
  await restarted.restoreUpdate({ backupId: result.backupId });
  assert.equal((await restarted.status()).workspace.id, bound.id);
  assert.equal((await restarted.status()).lastBackup, undefined);
  assert.equal(await fs.readFile(path.join(live, "keep.md"), "utf8"), "keep original\n");
  assert.equal(await fs.readFile(path.join(live, "delete.md"), "utf8"), "delete original\n");
  await assert.rejects(fs.stat(path.join(live, "sub", "new.md")), { code: "ENOENT" });
  assert.equal(fakeGh.pushes, 0);
});

test("installation three-way merges non-overlapping known edits and preserves the personal diff", async (t) => {
  const trees = await installFixture(t);
  const { service, live } = trees;
  await service.bindWorkspace(live);
  const base = "one\nunchanged a\nunchanged b\nunchanged c\nfive\n";
  await pushInstall(trees, { "keep.md": base });
  const first = await service.previewUpdates();
  await service.applyUpdates({ previewId: first.previewId, resolutions: {} });
  await fs.writeFile(path.join(live, "keep.md"), base.replace("one", "mine"));
  await pushInstall(trees, { "keep.md": base.replace("five", "team") });
  const plan = await service.previewUpdates();
  assert.equal(plan.files.find((file) => file.path === "keep.md").status, "merged");
  await service.applyUpdates({ previewId: plan.previewId, resolutions: {} });
  assert.equal(await fs.readFile(path.join(live, "keep.md"), "utf8"), base.replace("one", "mine").replace("five", "team"));
  const file = (await service.changes()).files.find((item) => item.path === "keep.md");
  assert.equal(file.eligible, true);
  assert.match(file.diff, /\+mine/);
  assert.doesNotMatch(file.diff, /\+team/);
});

test("installation rejects stale previews and does not overwrite later external edits during restore", async (t) => {
  const trees = await installFixture(t);
  const { service, live } = trees;
  const file = path.join(live, "keep.md");
  await service.bindWorkspace(live);
  await pushInstall(trees, { "keep.md": "team first\n" });
  let plan = await service.previewUpdates();
  await fs.writeFile(file, "external after preview\n");
  await assert.rejects(service.applyUpdates({ previewId: plan.previewId, resolutions: {} }), /预览后发生修改/);
  assert.equal((await service.status()).lastBackup, undefined);
  await fs.writeFile(file, "keep original\n");
  plan = await service.previewUpdates();
  await pushInstall(trees, { "keep.md": "team newer\n" });
  await assert.rejects(service.applyUpdates({ previewId: plan.previewId, resolutions: {} }), /团队版本已变化/);
  plan = await service.previewUpdates();
  const result = await service.applyUpdates({ previewId: plan.previewId, resolutions: {} });
  await fs.writeFile(file, "external after installation\n");
  await assert.rejects(service.restoreUpdate({ backupId: result.backupId }), /备份后发生修改/);
  assert.equal(await fs.readFile(file, "utf8"), "external after installation\n");
  assert.equal((await service.status()).recoveryRequired, false);
});

test("installation can recover a persisted interrupted batch with a partially written stage", async (t) => {
  const trees = await installFixture(t);
  const { service, makeService, live, root, fakeGh } = trees;
  await fs.writeFile(path.join(live, "delete.md"), "delete original\n");
  const initial = await service.bindWorkspace(live);
  await pushInstall(trees, { "delete.md": "updated first\n", "keep.md": "updated second\n" });
  const plan = await service.previewUpdates();
  const { backupId } = await service.applyUpdates({ previewId: plan.previewId, resolutions: {} });
  const stateFile = path.join(root, ".state", "example-user.json");
  const manifest = JSON.parse(await fs.readFile(path.join(root, ".state", "install-backups", "example-user", backupId + ".json"), "utf8"));
  await fs.writeFile(stateFile, JSON.stringify({
    ...manifest.previous, updateBackup: { id: backupId, createdAt: manifest.createdAt, interrupted: true },
  }));
  await fs.writeFile(path.join(root, ".state", "install-recovery.json"), JSON.stringify({
    login: "example-user", id: backupId, workspaceId: initial.id,
  }));
  const second = manifest.operations.findIndex((file) => file.path === "keep.md");
  const partial = path.join(live, ".team-space-update-" + backupId + "-" + second + "-new");
  await fs.writeFile(path.join(live, "keep.md"), "keep original\n");
  await fs.writeFile(partial, "updat");
  await fs.writeFile(path.join(live, ".team-space-update-" + backupId + "-" + second + "-old"), "external editor saved here\n");

  const restarted = makeService();
  assert.equal((await restarted.status()).recoveryRequired, true);
  await assert.rejects(restarted.changes(), /恢复备份/);
  fakeGh.offline = true;
  const offline = await restarted.status();
  assert.equal(offline.localRecoveryAvailable, true);
  assert.equal(offline.lastBackup.id, backupId);
  assert.equal(offline.authorized, false);
  const restored = await restarted.restoreUpdate({ backupId });
  const archived = (await fs.readdir(live)).find((name) => name.startsWith(".team-space-update-preserved-"));
  assert(archived);
  assert(restored.message.includes(path.join(live, archived)));
  assert.equal(await fs.readFile(path.join(live, archived), "utf8"), "external editor saved here\n");
  fakeGh.offline = false;
  assert.equal((await restarted.status()).recoveryRequired, false);
  assert.equal((await restarted.status()).workspace.id, initial.id);
  assert.equal(await fs.readFile(path.join(live, "delete.md"), "utf8"), "delete original\n");
  assert.equal(await fs.readFile(path.join(live, "keep.md"), "utf8"), "keep original\n");
  await assert.rejects(fs.stat(partial), { code: "ENOENT" });
});

test("installation remains preview-only while the active workspace has an open PR", async (t) => {
  const trees = await installFixture(t);
  const { service, live } = trees;
  await service.bindWorkspace(live);
  await fs.writeFile(path.join(live, "personal.md"), "pending review\n");
  const changes = await service.changes();
  await service.submit({ title: "Open review", previewId: changes.previewId, files: ["personal.md"] });
  await pushInstall(trees, { "keep.md": "team update\n" });
  const plan = await service.previewUpdates();
  assert.equal(plan.canApply, false);
  assert.match(plan.blockedReason, /审核仍在进行/);
  await assert.rejects(service.applyUpdates({ previewId: plan.previewId, resolutions: {} }), /审核结束/);
  assert.equal(await fs.readFile(path.join(live, "keep.md"), "utf8"), "keep original\n");
});


test("installation recognizes a historically removed team file in an older installation", async (t) => {
  const trees = await installFixture(t);
  const { service, live } = trees;
  await pushInstall(trees, { "delete.md": null });
  await fs.writeFile(path.join(live, "delete.md"), "delete original\n");
  await fs.writeFile(path.join(live, "personal.md"), "new local contribution\n");
  const workspace = await service.bindWorkspace(live);
  const plan = await service.previewUpdates();
  assert.equal(plan.targetSha, workspace.baseSha);
  assert.equal(plan.files.find((file) => file.path === "delete.md").status, "conflict");
  assert(!plan.files.some((file) => file.path === "personal.md"));
  await service.applyUpdates({ previewId: plan.previewId, resolutions: { "delete.md": "mine" } });
  const preview = await service.changes();
  assert.equal(preview.files.find((file) => file.path === "delete.md").eligible, false);
  assert.equal(preview.files.find((file) => file.path === "personal.md").eligible, true);
});


test("installation advances the backend without changing files when a personal contribution has already merged", async (t) => {
  const trees = await installFixture(t);
  const { service, live, fakeGh } = trees;
  await service.bindWorkspace(live);
  await pushInstall(trees, { "keep.md": "team baseline\n" });
  const first = await service.previewUpdates();
  await service.applyUpdates({ previewId: first.previewId, resolutions: {} });
  const file = path.join(live, "keep.md");
  await fs.writeFile(file, "already merged personal change\n");
  const changes = await service.changes();
  await service.submit({ title: "Personal contribution", previewId: changes.previewId, files: ["keep.md"] });
  await pushInstall(trees, { "keep.md": "already merged personal change\n" });
  fakeGh.review.state = "MERGED";
  await assert.rejects(service.startWorkspace(), /先在「团队更新」/);
  const preview = await service.previewUpdates();
  assert.equal(preview.canApply, true);
  assert(preview.files.every((item) => item.status === "skipped"));
  await service.applyUpdates({ previewId: preview.previewId, resolutions: {} });
  assert.equal(await fs.readFile(file, "utf8"), "already merged personal change\n");
  assert.deepEqual((await service.changes()).files, []);
});

test("installation does not write through a differently spelled Windows directory", { skip: process.platform !== "win32" }, async (t) => {
  const trees = await installFixture(t);
  const { service, live } = trees;
  await fs.mkdir(path.join(live, "Foo"));
  await fs.writeFile(path.join(live, "Foo", "personal.md"), "local text\n");
  await service.bindWorkspace(live);
  await pushInstall(trees, { "foo/new.md": "team text\n" });
  const preview = await service.previewUpdates();
  const file = preview.files.find((item) => item.path === "foo/new.md");
  assert.equal(file.status, "skipped");
  await service.applyUpdates({ previewId: preview.previewId, resolutions: {} });
  assert.deepEqual(await fs.readdir(path.join(live, "Foo")), ["personal.md"]);
  assert.equal(await fs.readFile(path.join(live, "Foo", "personal.md"), "utf8"), "local text\n");
});

test("each skill service targets only its own repository", async (t) => {
  const ad = projectById("ugc-reference-ad-workflow");
  const cases = [
    [undefined, "i010542/ugc-reference-ad-workflow"],
    [ad, "i010542/fva"],
  ];
  for (const [project, other] of cases) {
    const repo = project?.repo || "i010542/fva";
    const { service, commands, fakeGh, dir, originUrl } = await fixture(t, project);
    const live = path.join(dir, "installed-skill");
    await fs.mkdir(live);
    const skillName = project?.skillName || "fva";
    await fs.writeFile(path.join(live, "SKILL.md"), "---\nname: " + skillName + "\n---\ninstalled\n");
    const workspace = await service.bindWorkspace(live);
    await service.updateWorkspace().catch(() => {});
    fakeGh.review = {
      url: "https://github.com/" + other + "/pull/9", number: 9, state: "OPEN",
      headRefName: workspace.branch, headRefOid: workspace.baseSha, isCrossRepository: false,
    };
    assert.deepEqual(await service.reviewStatus(), { state: "none" });
    fakeGh.review = null;
    await fs.writeFile(path.join(live, "SKILL.md"), "---\nname: " + skillName + "\n---\nchanged\n");
    const preview = await service.changes();
    const submitted = await service.submit({ title: "隔离检查", previewId: preview.previewId, files: ["SKILL.md"] });
    const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(submitted.prUrl, new RegExp("https://github.com/" + escaped(repo) + "/pull/"));
    const log = commands.join("\n");
    assert.match(log, new RegExp("repos/" + escaped(repo)));
    assert.match(log, new RegExp(escaped(originUrl)));
    assert.match(log, /\bfetch\b/);
    assert.match(log, /\bpush\b/);
    assert.match(log, /pr create/);
    assert.doesNotMatch(log, new RegExp(escaped(other)));
    assert.equal(await git(workspace.gitPath, "remote", "get-url", "origin"), originUrl);
    if (!project) {
      assert.equal(path.basename(path.dirname(workspace.gitPath)), "workspaces");
      const stateFile = path.join(path.dirname(workspace.gitPath), ".state", "example-user.json");
      assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).branch, workspace.branch);
    }
  }
});
