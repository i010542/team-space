const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createService } = require("../src/core.cjs");
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

async function fixture(t) {
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

  const fakeGh = { loggedIn: true, authorized: true, login: "example-user", review: null, failCreate: 0, createCalls: 0, pushes: 0, failPush: 0, failClone: 0, failUpdateRef: 0, endReviewOnPush: null, pushedSha: null };
  const run = async (binary, args, options) => {
    if (binary === ghPath) {
      if (args[0] === "--version") return fake("gh version 2");
      if (args[0] === "auth" && args[1] === "status") return fake("", fakeGh.loggedIn ? 0 : 1);
      if (args[0] === "auth" && args[1] === "login") {
        options.onOutput("! First copy your one-time ", "stderr");
        options.onOutput("code: TEST-0001\n", "stderr");
        fakeGh.loggedIn = true;
        return fake();
      }
      if (args[0] === "auth" && args[1] === "token") return fake("synthetic-test-value\n");
      if (args[0] === "api" && args[3] === "user") return fake(JSON.stringify({ login: fakeGh.login, id: 123 }));
      if (args[0] === "api" && args[3] === "repos/i010542/fva") return fake(String(fakeGh.authorized));
      if (args[0] === "pr" && args[1] === "list") return fake(JSON.stringify(fakeGh.review ? [fakeGh.review] : []));
      if (args[0] === "pr" && args[1] === "create") {
        fakeGh.createCalls++;
        if (fakeGh.failCreate-- > 0) return fake("", 1);
        fakeGh.review = { url: prUrl, number: 41, state: "OPEN", headRefName: args[args.indexOf("--head") + 1], headRefOid: fakeGh.pushedSha, isCrossRepository: false };
        return fake(prUrl);
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
        GIT_CONFIG_VALUE_1: publicOrigin,
      };
    }
    const result = await runProcess(binary, args, options);
    if (result.code === 0 && args.includes("push")) {
      fakeGh.pushedSha = args.find((arg) => arg.includes(":refs/heads/")).split(":")[0];
      if (fakeGh.review) {
        fakeGh.review.headRefOid = fakeGh.pushedSha;
        if (fakeGh.endReviewOnPush) fakeGh.review.state = fakeGh.endReviewOnPush;
      }
    }
    return result;
  };
  const makeService = () => createService({ root, gitPath, ghPath, run });
  return { dir, seed, root, remote, fakeGh, makeService, service: makeService() };
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
  await assert.rejects(service.submit({ title: "Escape", previewId: preview.previewId, files: ["../evil"] }), /有效文件/);
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

