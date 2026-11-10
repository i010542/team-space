const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectById } = require("../src/projects.cjs");
const { createUsageRecords, readUsageFile } = require("../src/core/usage.cjs");

async function fixture(t, id = "fva") {
  const project = projectById(id);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "team-space-usage-test-"));
  t.after(() => {
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.match(path.basename(target), /^team-space-usage-test-[A-Za-z0-9]+$/);
    return fs.rm(target, { recursive: true, force: true });
  });
  const repo = { full_name: project.repo, private: true, visibility: "private", has_issues: true,
    permissions: { pull: true, push: false }, archived: false };
  const account = { id: 12345, login: "fixture-member" };
  const endpoint = "repos/" + project.repo;
  const issues = [];
  const calls = [];
  let mode = "success";
  let loggedIn = true;
  let number = 1;

  function makeIssue(title, body) {
    const id = number++;
    return { number: id, title, body, user: account, created_at: "2026-11-10T00:00:00Z",
      html_url: "https://github.com/" + project.repo + "/issues/" + id,
      repository_url: "https://api.github.com/repos/" + project.repo };
  }

  const makeService = () => createUsageRecords({
    project, journalDir: path.join(dir, "journal"),
    async getAccount() {
      if (!loggedIn) throw new Error("请先登录 GitHub。");
      return account;
    },
    async request(user, method, target, body) {
      assert.equal(user, account);
      calls.push({ method, target, body });
      if (target === endpoint) return repo;
      if (method === "POST") {
        assert.equal(target, endpoint + "/issues");
        if (mode === "missing") throw new Error("timeout");
        const issue = makeIssue(body.title, body.body);
        issues.unshift(issue);
        if (mode === "lost-receipt") throw new Error("timeout");
        return issue;
      }
      if (target.startsWith(endpoint + "/issues?")) {
        const page = Number(new URL("https://api.github.com/" + target).searchParams.get("page"));
        return issues.slice((page - 1) * 20, page * 20);
      }
      const found = issues.find((issue) => target === endpoint + "/issues/" + issue.number);
      if (found) return found;
      throw new Error("not found");
    },
  });

  return { project, dir, repo, issues, calls, account, makeIssue, makeService,
    mode: (value) => { mode = value; }, logOut: () => { loggedIn = false; },
    postCount: () => calls.filter(({ method }) => method === "POST").length,
    draft: { project: id, title: "示例聊天", tool: "codex", text: "你好。\n这是聊天里的内容。" } };
}

test("a private project member can save without a bound folder and read fenced plain text", async (t) => {
  const f = await fixture(t);
  const service = f.makeService();
  const input = { ...f.draft, text: "~~~\r\n```\r\n@someone <img src=x onerror=alert(1)>\r\n" };
  const saved = await service.save(input);
  assert.equal(f.postCount(), 1);
  assert.equal(saved.text, input.text.replaceAll("\r\n", "\n"));
  assert.equal(saved.viewer, f.account.login);
  assert.equal(saved.reconciled, false);
  assert.match(f.issues[0].body, /^<!-- team-space-usage:v1 project=fva request=[a-f0-9-]+ tool=codex -->\n\n~~~~\n/);
  const results = await service.list({ project: "fva", page: 1 });
  assert.deepEqual(results.items, [{ number: 1, title: input.title, tool: "codex", author: f.account.login, createdAt: f.issues[0].created_at }]);
  assert.equal((await service.detail({ project: "fva", number: 1 })).text, saved.text);
  assert.equal(await service.link({ project: "fva", number: 1 }), f.issues[0].html_url);
  const journal = path.join(f.dir, "journal");
  for (const file of await fs.readdir(journal)) {
    assert.doesNotMatch(await fs.readFile(path.join(journal, file), "utf8"), /示例聊天|@someone/);
  }
});

test("validation and verified private access precede any request journal or write", async (t) => {
  const f = await fixture(t);
  const service = f.makeService();
  for (const draft of [
    { ...f.draft, project: "ugc-reference-ad-workflow" },
    { ...f.draft, repo: "attacker/other" },
    { ...f.draft, tool: "custom" },
    { ...f.draft, text: "甲".repeat(50001) },
    { ...f.draft, text: "\ud800" },
    { ...f.draft, text: "ghp_" + "a".repeat(28) },
    { ...f.draft, title: "不允许\n多行" },
  ]) await assert.rejects(service.save(draft));
  await assert.rejects(service.list({ project: "fva", page: 501 }), /页码/);
  await assert.rejects(service.detail({ project: "fva", number: "1" }), /编号/);
  assert.equal(f.calls.length, 0);
  f.repo.private = false;
  await assert.rejects(service.save(f.draft), /私有仓库/);
  await assert.rejects(service.list({ project: "fva", page: 1 }), /私有仓库/);
  f.repo.private = true;
  f.repo.visibility = "internal";
  await assert.rejects(service.save(f.draft), /私有仓库/);
  f.repo.visibility = "private";
  f.repo.permissions.pull = false;
  await assert.rejects(service.save(f.draft), /权限/);
  f.repo.permissions.pull = true;
  f.repo.archived = true;
  await assert.rejects(service.save(f.draft), /停止接受/);
  f.logOut();
  await assert.rejects(service.save(f.draft), /先登录/);
  assert.equal(f.postCount(), 0);
  await assert.rejects(fs.access(path.join(f.dir, "journal")), { code: "ENOENT" });
});

test("a lost create response is reconciled across service restarts without another POST", async (t) => {
  const f = await fixture(t);
  f.mode("lost-receipt");
  await assert.rejects(f.makeService().save(f.draft), /不能确认.*只会核对结果/);
  const recovered = await f.makeService().save(f.draft);
  assert.equal(recovered.number, 1);
  assert.equal(recovered.reconciled, true);
  assert.equal(recovered.text, f.draft.text);
  assert.equal(f.postCount(), 1);
});

test("an unconfirmed request stays blocked after a restart even if no issue is found", async (t) => {
  const f = await fixture(t);
  f.mode("missing");
  await assert.rejects(f.makeService().save(f.draft), /不能确认/);
  f.mode("success");
  await assert.rejects(f.makeService().save(f.draft), /只会核对结果/);
  assert.equal(f.postCount(), 1);
  assert.equal(f.issues.length, 0);
});

test("pagination retains empty filtered pages and rejects PRs, foreign markers and foreign URLs", async (t) => {
  const f = await fixture(t, "ugc-reference-ad-workflow");
  const service = f.makeService();
  const draft = { ...f.draft, tool: "" };
  await service.save(draft);
  const saved = f.issues[0];
  f.issues.unshift(
    { ...f.makeIssue(saved.title, saved.body), pull_request: {} },
    f.makeIssue(saved.title, saved.body.replace("project=ugc-reference-ad-workflow", "project=fva")),
    { ...f.makeIssue(saved.title, saved.body), html_url: "https://github.com/other/repo/issues/4" },
  );
  for (let i = 0; i < 17; i++) f.issues.unshift(f.makeIssue("ordinary issue", "text"));
  const first = await service.list({ project: f.project.id, page: 1 });
  assert.deepEqual(first.items, []);
  assert.equal(first.hasNext, true);
  const second = await service.list({ project: f.project.id, page: 2 });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].number, 1);
  assert.equal(second.hasNext, false);
  for (const number of [2, 3, 4]) {
    await assert.rejects(service.link({ project: f.project.id, number }), /不是当前 Skill/);
  }
  await assert.rejects(service.detail({ project: "fva", number: 1 }), /不匹配/);
});

test("native file reads return complete UTF-8 only and refuse oversized or other files", async (t) => {
  const f = await fixture(t);
  const good = path.join(f.dir, "chat.MD");
  const bad = path.join(f.dir, "broken.txt");
  const big = path.join(f.dir, "big.txt");
  await fs.writeFile(good, "\ufeff甲\r\n乙", "utf8");
  await fs.writeFile(bad, Buffer.from([0xc3, 0x28]));
  await fs.writeFile(big, "甲".repeat(50001), "utf8");
  assert.equal(await readUsageFile(good), "甲\n乙");
  await assert.rejects(readUsageFile(bad), /UTF-8/);
  await assert.rejects(readUsageFile(big), /50000.*不会截断/);
  await assert.rejects(readUsageFile(path.join(f.dir, "chat.json")), /\.md 或 \.txt/);
  await assert.rejects(readUsageFile("chat.txt"), /\.md 或 \.txt/);
  assert.equal(f.postCount(), 0);
});
