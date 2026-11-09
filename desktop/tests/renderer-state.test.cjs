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

async function workbench() {
  const elements = new Map();
  const windowEvents = new Map();
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  const calls = { changes: 0, updates: 0, submit: [] };
  const overrides = {};
  const workspace = { id: "fixture", bound: true, path: "C:/test/FVA" };
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
    status: async () => ({ authenticated: true, authorized: true, tools: { git: true, gh: true }, workspace }),
    reviewStatus: async () => ({ state: "none" }),
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
  assert.equal(calls.changes, 1, "startup reads one initial snapshot");
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
