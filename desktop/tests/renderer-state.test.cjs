const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
const settled = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function workbench({ authenticated = true, authorized = true, bound = true, project, projects, pauseProjects, pauseStatus, navigation } = {}) {
  const elements = new Map();
  const windowEvents = new Map();
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  const calls = { changes: 0, updates: 0, submit: [], selected: [], navigationTakes: [] };
  let activeProject = project ? { id: project.id, name: project.name } : null;
  const overrides = {};
  const workspace = { id: "fixture", bound, path: "C:/test/FVA" };
  const change = { path: "SKILL.md", status: "modified", eligible: true, diff: "+ note" };
  const snapshot = () => ({ workspace, previewId: "preview-" + calls.changes, files: [change] });

  class Element {
    constructor(tagName = "") {
      this.tagName = tagName;
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.textContent = "";
      this.attributes = new Map();
      this.handlers = new Map();
      this.children = [];
      this.values = {};
      this.renderFailures = 0;
      this.replaceFailures = 0;
    }
    set innerHTML(_) { throw new Error("diff text must not be rendered as HTML"); }
    get dataset() {
      if (this.renderFailures > 0) {
        this.renderFailures--;
        throw new Error("simulated renderer exception");
      }
      return this.values;
    }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) {
      if (this.replaceFailures > 0) {
        this.replaceFailures--;
        throw new Error("simulated file list drawing failure");
      }
      this.children = nodes;
    }
    closest() { return element("review-state"); }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    querySelectorAll() { return []; }
    get classList() {
      if (!this._classList) {
        const names = new Set();
        this._classList = {
          contains: (name) => names.has(name),
          add: (name) => names.add(name),
          remove: (name) => names.delete(name),
          toggle: (name, force) => {
            const on = force === undefined ? !names.has(name) : Boolean(force);
            if (on) names.add(name);
            else names.delete(name);
            return on;
          },
        };
      }
      return this._classList;
    }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
  }

  function element(name) {
    if (!elements.has(name)) elements.set(name, new Element());
    return elements.get(name);
  }

  const tabs = [
    ["changes", "changes-card"],
    ["review", "review-card"],
    ["updates", "team-updates-card"],
  ].map(([name, panel]) => {
    const tab = element("tab-" + name);
    tab.dataset.workTab = name;
    tab.setAttribute("aria-controls", panel);
    return tab;
  });

  const api = {
    status: async () => {
      if (pauseStatus) await pauseStatus.promise;
      if (overrides.status) return overrides.status();
      const value = { authenticated, authorized, tools: { git: true, gh: true }, workspace };
      if (activeProject) value.project = { ...activeProject };
      return value;
    },
    reviewStatus: async () => overrides.reviewStatus ? overrides.reviewStatus() : { state: "none" },
    changes: async () => {
      calls.changes++;
      return overrides.changes ? overrides.changes() : snapshot();
    },
    submit: async (input) => {
      calls.submit.push(input);
      return overrides.submit();
    },
    updateWorkspace: async () => {
      calls.updates++;
      return overrides.updateWorkspace();
    },
    applyUpdates: async () => { assert.fail("changing tabs must not install an update"); },
    onProgress: () => () => {},
  };
  if (projects) {
    api.projects = async () => {
      if (pauseProjects) await pauseProjects.promise;
      return { projects, activeProject: activeProject?.id || "fva" };
    };
    api.selectProject = async (id) => {
      calls.selected.push(id);
      if (overrides.selectProject) return overrides.selectProject(id);
      const found = projects.find((item) => item.id === id);
      if (!found) throw new Error("没有这个 Skill。");
      activeProject = { id: found.id, name: found.name };
      return activeProject;
    };
  }
  if (navigation) {
    const queue = [];
    api.takeNavigation = async () => {
      const route = queue.shift() || null;
      calls.navigationTakes.push(route);
      return route;
    };
    api.onNavigation = (callback) => {
      calls.signalNavigation = callback;
      return () => {};
    };
    calls.queueNavigation = (route) => queue.push(route);
  }
  const document = {
    activeElement: null,
    getElementById: element,
    querySelectorAll: (selector) => selector === "[data-work-tab]" ? tabs : [],
    createElement: (tagName) => new Element(tagName),
    createTextNode: (value) => Object.assign(new Element("#text"), { textContent: value }),
    createDocumentFragment: () => new Element(),
  };
  const window = {
    teamSpace: api,
    addEventListener: (name, handler) => windowEvents.set(name, handler),
    scrollTo() {},
  };
  const context = vm.createContext({
    document, window,
    setTimeout(handler, delay) {
      const id = ++timerId;
      timers.set(id, { handler, deadline: clock + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context, { filename: "renderer.js" });
  await settled();
  if (!pauseProjects && !pauseStatus) assert.equal(calls.changes, authorized && bound ? 1 : 0, "startup reads one initial snapshot");
  return {
    element, calls, snapshot, overrides,
    activeElement: () => document.activeElement,
    click(name) {
      const target = element(name);
      if (!target.disabled) return target.handlers.get("click")?.();
    },
    key(name, key) {
      const target = element(name);
      let prevented = false;
      target.handlers.get("keydown")({ key, preventDefault() { prevented = true; } });
      return prevented;
    },
    fillTitle(value) {
      element("submit-title").value = value;
      element("submit-title").handlers.get("input")();
    },
    submit() {
      element("submit-form").handlers.get("submit")({ preventDefault() {} });
    },
    focus() { windowEvents.get("focus")(); },
    advance(ms) {
      clock += ms;
      for (const [id, timer] of timers) {
        if (timer.deadline > clock) continue;
        timers.delete(id);
        timer.handler();
      }
    },
  };
}

test("repeated focus only marks changes for manual refresh and keeps the draft", async () => {
  const view = await workbench();
  for (let n = 0; n < 6; n++) view.focus();
  view.advance(400);
  await settled();
  assert.equal(view.calls.changes, 1);
  assert.equal(view.element("refresh-reminder").hidden, false);
  assert.equal(view.element("refresh-changes").disabled, false);
  view.fillTitle("保留这份说明");
  assert.equal(view.element("submit-button").disabled, true);
  await view.click("refresh-changes");
  assert.equal(view.calls.changes, 2);
  assert.equal(view.element("refresh-reminder").hidden, true);
  assert.equal(view.element("submit-title").value, "保留这份说明");
  assert.equal(view.element("submit-button").disabled, false);
});

test("a slow read explains the wait and keeps controls locked until the API settles", async () => {
  const view = await workbench();
  const pending = deferred();
  view.overrides.changes = () => pending.promise;
  const read = view.click("refresh-changes");
  view.advance(14999);
  assert.doesNotMatch(view.element("notice").textContent, /仍在等待/);
  view.advance(1);
  assert.match(view.element("notice").textContent, /仍在等待读取结果/);
  assert.equal(view.element("refresh-changes").disabled, true);
  view.focus();
  view.advance(20000);
  assert.equal(view.calls.changes, 2, "no second read begins while the first is pending");
  assert.equal(view.element("refresh-changes").disabled, true);
  pending.resolve(view.snapshot());
  await read;
  assert.equal(view.element("notice").hidden, true);
  assert.equal(view.element("refresh-changes").disabled, false);
});

test("a render exception before an operation leaves the controls available for retry", async () => {
  const view = await workbench();
  view.element("account-badge").renderFailures = 1;
  await view.click("refresh-changes");
  assert.equal(view.calls.changes, 1, "the read never started");
  assert.equal(view.element("notice").hidden, true);
  assert.match(view.element("error").textContent, /界面未能刷新/);
  assert.equal(view.element("refresh-changes").disabled, false);
  await view.click("refresh-changes");
  assert.equal(view.calls.changes, 2);
});

test("an undisplayed change list cannot be submitted after the read succeeds", async () => {
  const view = await workbench();
  view.fillTitle("保留这份说明");
  assert.equal(view.element("submit-button").disabled, false);
  view.element("file-list").replaceFailures = 1;
  await view.click("refresh-changes");
  assert.equal(view.calls.changes, 2);
  assert.equal(view.element("changes-form").hidden, true);
  assert.equal(view.element("submit-button").disabled, true);
  assert.equal(view.element("submit-title").value, "保留这份说明");
  view.submit();
  assert.equal(view.calls.submit.length, 0);
  await view.click("refresh-changes");
  assert.equal(view.calls.changes, 3);
  assert.equal(view.element("submit-button").disabled, false);
});

test("pending submission stays locked, and cancelling after native focus retains its draft", async () => {
  const view = await workbench();
  const pending = deferred();
  view.overrides.submit = () => pending.promise;
  view.fillTitle("整批改动");
  view.submit();
  assert.equal(view.calls.submit.length, 1);
  assert.deepEqual([...view.calls.submit[0].files], ["SKILL.md"]);
  assert.equal(view.element("submit-button").disabled, true);
  assert.equal(view.element("refresh-changes").disabled, true);
  for (let n = 0; n < 6; n++) view.focus();
  await settled();
  assert.equal(view.calls.changes, 1);
  assert.equal(view.element("submit-button").disabled, true);
  view.element("account-badge").renderFailures = 1;
  pending.reject(new Error("已取消提交，文件保持原样。"));
  await settled();
  assert.equal(view.calls.changes, 1);
  assert.equal(view.element("refresh-reminder").hidden, true);
  assert.equal(view.element("submit-title").value, "整批改动");
  assert.equal(view.element("submit-button").disabled, false);
  assert.match(view.element("error").textContent, /已取消提交/);
});

test("opening a diff preserves each line as text and classifies its visible prefix", async () => {
  const view = await workbench();
  const lines = [
    "@@ -1,2 +1,3 @@",
    " unchanged text",
    "",
    "-",
    "-<script>alert(1)</script>",
    "+",
    "+++ Text beginning with two plus signs",
    "+<img src=x onerror=alert(1)>",
    "… 差异已截断",
  ];
  const kinds = ["hunk", "context", "context", "deleted", "deleted", "added", "added", "added", "note"];
  view.overrides.changes = () => {
    const data = view.snapshot();
    return { ...data, files: [{ ...data.files[0], diff: lines.join("\n") }] };
  };
  await view.click("refresh-changes");
  const row = view.element("file-list").children[0].children[0];
  const toggle = row.children[0].children.find((child) => child.tagName === "button");
  const details = row.children[1];
  assert.equal(details.children.length, 1, "hidden previews do not create line elements");
  toggle.handlers.get("click")();
  const preview = details.children[1];
  assert.equal(preview.tagName, "pre");
  assert.equal(preview.className, "diff-preview");
  const rows = preview.children[0].children;
  assert.deepEqual(rows.map((line) => line.tagName), lines.map(() => "span"));
  assert.deepEqual(rows.map((line) => line.className), kinds.map((kind) => "diff-line diff-" + kind));
  assert.equal(rows.map((line) => line.textContent).join(""), lines.join("\n"));
  assert.ok(rows.every((line) => line.children.length === 0), "markup-looking content is plain text");
  toggle.handlers.get("click")();
  toggle.handlers.get("click")();
  assert.equal(details.children.length, 2, "reopening reuses the preview");
});

test("workspace tabs keep the description, open diff, and update choice without refetching", async () => {
  const view = await workbench();
  const visible = () => ["changes-card", "review-card", "team-updates-card"].filter((name) => !view.element(name).hidden);
  assert.deepEqual(visible(), ["changes-card"]);
  view.fillTitle("保留这份说明");
  const row = view.element("file-list").children[0].children[0];
  row.children[0].children.find((child) => child.tagName === "button").handlers.get("click")();
  const expandedDiff = row.children[1];
  assert.equal(expandedDiff.hidden, false);

  view.click("tab-updates");
  assert.deepEqual(visible(), ["team-updates-card"]);
  view.overrides.updateWorkspace = () => ({
    workspace: view.snapshot().workspace,
    readOnly: true,
    canApply: true,
    previewId: "updates-1",
    files: [{ path: "SKILL.md", status: "conflict", mineText: "本机版", teamText: "团队版" }],
  });
  await view.click("update-workspace");
  assert.equal(view.element("apply-update").disabled, true);
  const updateRow = view.element("updates-files").children[0].children[0];
  const option = updateRow.children.find((child) => child.tagName === "fieldset").children[1].children[0];
  option.checked = true;
  option.handlers.get("change")();
  assert.equal(view.element("apply-update").disabled, false);

  assert.equal(view.key("tab-updates", "Home"), true);
  assert.equal(view.activeElement(), view.element("tab-changes"));
  assert.deepEqual(visible(), ["changes-card"]);
  assert.equal(expandedDiff.hidden, false);
  assert.equal(view.element("file-list").children[0].children[0].children[1], expandedDiff);
  assert.equal(view.element("submit-title").value, "保留这份说明");
  assert.equal(view.key("tab-changes", "ArrowRight"), true);
  assert.deepEqual(visible(), ["review-card"]);
  assert.equal(view.key("tab-review", "End"), true);
  assert.deepEqual(visible(), ["team-updates-card"]);
  assert.equal(view.element("tab-updates").getAttribute("aria-selected"), "true");
  assert.equal(view.element("tab-updates").tabIndex, 0);
  assert.equal(view.element("tab-changes").tabIndex, -1);
  assert.equal(option.checked, true);
  assert.equal(view.element("apply-update").disabled, false);

  view.focus();
  assert.deepEqual(visible(), ["team-updates-card"], "a render does not expose the other panels");
  assert.equal(view.calls.changes, 1);
  assert.equal(view.calls.updates, 1);
  assert.equal(view.calls.submit.length, 0);
});

test("a bound workspace compacts the steps and the explanation toggle keeps the draft", async () => {
  const view = await workbench();
  assert.equal(view.element("step-login").dataset.state, "done");
  assert.equal(view.element("step-folder").dataset.state, "done");
  assert.equal(view.element("step-review").dataset.state, "current");
  assert.equal(view.element("step-login-state").textContent, "已完成");
  assert.equal(view.element("step-folder-state").textContent, "已完成");
  assert.equal(view.element("step-review-state").textContent, "当前这一步");
  assert.equal(view.element("onboarding").classList.contains("is-compact"), true);
  assert.equal(view.element("flow-toggle").hidden, false);
  assert.equal(view.element("flow-toggle").getAttribute("aria-expanded"), "false");
  view.fillTitle("保留这份说明");
  view.click("flow-toggle");
  assert.equal(view.element("onboarding").classList.contains("is-compact"), false);
  assert.equal(view.element("flow-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(view.element("flow-toggle").textContent, "收起说明");
  view.click("flow-toggle");
  assert.equal(view.element("onboarding").classList.contains("is-compact"), true);
  assert.equal(view.element("flow-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(view.element("flow-toggle").textContent, "查看三步说明");
  assert.equal(view.calls.changes, 1);
  assert.equal(view.calls.submit.length, 0);
  assert.equal(view.element("submit-title").value, "保留这份说明");
});

test("an authorized account without a skill file points at step two", async () => {
  const view = await workbench({ bound: false });
  assert.equal(view.element("step-login").dataset.state, "done");
  assert.equal(view.element("step-folder").dataset.state, "current");
  assert.equal(view.element("step-review").dataset.state, "todo");
  assert.equal(view.element("primary-action").hidden, true);
  assert.equal(view.element("flow-toggle").hidden, true);
  assert.equal(view.element("onboarding").classList.contains("is-compact"), false);
  assert.equal(view.element("step-review-label").textContent, "完成第 2 步后可用");
});

test("a signed-out workspace starts at login and hides the duplicate action", async () => {
  const view = await workbench({ authenticated: false, bound: false });
  assert.equal(view.element("step-login").dataset.state, "current");
  assert.equal(view.element("step-folder").dataset.state, "todo");
  assert.equal(view.element("step-review").dataset.state, "todo");
  assert.equal(view.element("primary-action").hidden, true);
  assert.equal(view.element("sidebar-account-title").textContent, "GitHub 未登录");
});

test("a signed-in account without access keeps the GitHub login button", async () => {
  const view = await workbench({ authorized: false });
  assert.equal(view.element("primary-action").hidden, false);
  assert.equal(view.element("primary-label").textContent, "重新登录 GitHub");
  assert.equal(view.element("sidebar-account-title").textContent, "权限未确认");
});

test("an authorized GitHub login shows a good sidebar status", async () => {
  const view = await workbench();
  assert.equal(view.element("sidebar-account-title").textContent, "已登录 GitHub");
  assert.equal(view.element("sidebar-account").dataset.tone, "good");
  assert.equal(view.element("sidebar-account-text").textContent, "@GitHub");
});

const skillCatalog = [
  { id: "fva", name: "FVA", fullName: "FVA 短视频创作", docs: [{ key: "skill", title: "FVA Skill 说明", summary: "了解 FVA 的用途、适用任务和工作流程。", path: "SKILL.md", category: "project" }] },
  { id: "ugc-reference-ad-workflow", name: "广告制作", fullName: "UGC 参考广告制作", docs: [{ key: "workflow", title: "流程与确认", summary: "查看制作流程。", path: "references/workflow.md", category: "guide" }] },
];

function skillButton(view, projectId) {
  return [...view.element("skill-switch").children].find((button) => button.dataset.projectId === projectId);
}

function collectedText(node) {
  return [node.textContent || "", ...(node.children || []).map(collectedText)].join("\n");
}

test("skill titles use the current project name", async () => {
  const fva = await workbench({ project: skillCatalog[0], projects: skillCatalog });
  assert.equal(fva.element("work-heading").textContent, "FVA 共创工作台");
  assert.equal(fva.element("work-eyebrow").textContent, "我的 FVA");
  assert.equal(fva.element("footer-skill").textContent, "FVA 短视频创作 Skill");
  assert.equal(skillButton(fva, "fva").getAttribute("aria-pressed"), "true");
  const ad = await workbench({ project: skillCatalog[1], projects: skillCatalog });
  assert.equal(ad.element("work-heading").textContent, "广告制作共创工作台");
  assert.equal(ad.element("work-eyebrow").textContent, "我的广告制作");
  assert.equal(ad.element("team-eyebrow").textContent, "广告制作 · 团队项目");
  assert.equal(ad.element("footer-skill").textContent, "UGC 参考广告制作 Skill");
  assert.match(collectedText(ad.element("doc-list")), /流程与确认/);
  assert.doesNotMatch(collectedText(ad.element("doc-list")), /FVA Skill 说明/);
});

test("switching skills confirms a draft, then clears it and rereads", async () => {
  const view = await workbench({ project: skillCatalog[0], projects: skillCatalog });
  view.fillTitle("保留这份说明");
  skillButton(view, "ugc-reference-ad-workflow").handlers.get("click")();
  assert.equal(view.calls.selected.length, 0);
  assert.equal(view.element("submit-title").value, "保留这份说明");
  assert.equal(view.element("project-switch-request").hidden, false);
  assert.equal(view.element("project-switch-message").textContent, "切换到「广告制作」后，当前写的修改说明和更新预览不会保留。");
  view.click("dismiss-project-switch");
  assert.equal(view.element("project-switch-request").hidden, true);
  assert.equal(view.element("submit-title").value, "保留这份说明");
  skillButton(view, "ugc-reference-ad-workflow").handlers.get("click")();
  await view.click("accept-project-switch");
  assert.deepEqual(view.calls.selected, ["ugc-reference-ad-workflow"]);
  assert.equal(view.element("submit-title").value, "");
  assert.equal(view.element("work-heading").textContent, "广告制作共创工作台");
  assert.ok(view.calls.changes > 1);
});

test("a snapshot from the previous skill is ignored after switching", async () => {
  const view = await workbench({ project: skillCatalog[0], projects: skillCatalog });
  view.overrides.changes = () => ({
    project: "fva",
    workspace: view.snapshot().workspace,
    previewId: "stale",
    files: [{ path: "OLD.md", status: "modified", eligible: true, diff: "+ old" }],
  });
  await skillButton(view, "ugc-reference-ad-workflow").handlers.get("click")();
  assert.equal(view.calls.selected[0], "ugc-reference-ad-workflow");
  assert.doesNotMatch(collectedText(view.element("file-list")), /OLD\.md/);
  assert.equal(view.element("work-heading").textContent, "广告制作共创工作台");
});

test("a busy workspace ignores skill switching", async () => {
  const view = await workbench({ project: skillCatalog[0], projects: skillCatalog });
  const pending = deferred();
  view.overrides.changes = () => pending.promise;
  const reading = view.click("refresh-changes");
  const button = skillButton(view, "ugc-reference-ad-workflow");
  assert.equal(button.disabled, true);
  button.handlers.get("click")();
  assert.equal(view.calls.selected.length, 0);
  assert.match(collectedText(view.element("file-list")), /SKILL\.md/);
  pending.resolve(view.snapshot());
  await reading;
  assert.equal(view.calls.selected.length, 0);
});

test("titles stay neutral until the skill list arrives", async () => {
  const gate = deferred();
  const view = await workbench({ project: skillCatalog[1], projects: skillCatalog, pauseProjects: gate });
  assert.equal(view.element("work-heading").textContent, "共创工作台");
  assert.equal(view.element("work-eyebrow").textContent, "你的 Skill");
  assert.equal(view.element("footer-skill").textContent, "你的 Skill");
  assert.doesNotMatch(view.element("work-heading").textContent, /FVA/);
  assert.doesNotMatch(view.element("work-eyebrow").textContent, /FVA/);
  assert.doesNotMatch(view.element("footer-skill").textContent, /FVA/);
  assert.equal(view.element("skill-switch").children.length, 0);
  gate.resolve();
  await settled();
  await settled();
  assert.equal(view.element("work-heading").textContent, "广告制作共创工作台");
  assert.equal(skillButton(view, "ugc-reference-ad-workflow").disabled, false);
});

test("a deep link to another skill waits until startup can switch", async () => {
  const gate = deferred();
  const view = await workbench({ project: skillCatalog[0], projects: skillCatalog, pauseStatus: gate, navigation: true });
  view.calls.queueNavigation({ project: "ugc-reference-ad-workflow", view: "docs" });
  view.calls.signalNavigation();
  await settled();
  assert.equal(view.calls.navigationTakes.length, 0);
  assert.equal(view.calls.selected.length, 0);
  gate.resolve();
  await settled();
  await settled();
  assert.equal(view.calls.navigationTakes[0]?.project, "ugc-reference-ad-workflow");
  assert.equal(view.calls.navigationTakes[0]?.view, "docs");
  assert.deepEqual(view.calls.selected, ["ugc-reference-ad-workflow"]);
  assert.equal(view.element("current-page").textContent, "项目资料");
});

test("a late review for the previous skill is ignored after switching", async () => {
  const view = await workbench({ project: skillCatalog[0], projects: skillCatalog });
  view.overrides.reviewStatus = () => ({ state: "open", number: 41, project: "fva" });
  await skillButton(view, "ugc-reference-ad-workflow").handlers.get("click")();
  assert.doesNotMatch(view.element("review-status").textContent, /#41/);
  assert.equal(view.element("work-heading").textContent, "广告制作共创工作台");
});

test("a late team-update preview for the previous skill is ignored", async () => {
  const view = await workbench({ project: skillCatalog[0], projects: skillCatalog });
  await skillButton(view, "ugc-reference-ad-workflow").handlers.get("click")();
  view.overrides.updateWorkspace = () => ({
    project: "fva",
    readOnly: true,
    canApply: true,
    previewId: "stale-update",
    workspace: { id: "old", bound: true, path: "C:/old" },
    files: [{ path: "OLD-UPDATE.md", status: "modified", diff: "+ old" }],
  });
  await view.click("update-workspace");
  assert.equal(view.element("updates-panel").hidden, true);
  assert.doesNotMatch(collectedText(view.element("updates-files")), /OLD-UPDATE\.md/);
  assert.equal(view.element("work-heading").textContent, "广告制作共创工作台");
});
