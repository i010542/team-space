const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchActivation, secondActivation, createNavigationQueue } = require("../src/deep-link.cjs");

const exe = "C:\\Program Files\\Team Space\\Team Space.exe";
const base = "teamspace-app://project/fva";

test("recognizes only the fixed project routes and the installer option terminator", () => {
  assert.deepEqual(launchActivation([exe]), { focus: true, navigation: null });
  assert.deepEqual(launchActivation([exe, "--", base]), { focus: true, navigation: "workspace" });
  assert.deepEqual(launchActivation([exe, base + "/docs"]), { focus: true, navigation: "docs" });
  assert.deepEqual(launchActivation(["electron", ".", "--", base + "/updates"], true), { focus: true, navigation: "updates" });
});

test("rejects unknown locations, normalized aliases and extra launch arguments", () => {
  const invalid = [
    "teamspace://workspace/index.html", "teamspace-app://project/other",
    "teamspace-app://admin/fva", "teamspace-app://user@project/fva",
    "teamspace-app://project:1234/fva", "TEAMSPACE-APP://project/fva", "teamspace-app://PROJECT/fva",
    base + "/", base + "//docs", base + "/docs/", base + "/../fva", base + "/%64ocs",
    "teamspace-app://project/%66va", base + "?x=1", base + "?", base + "#", base + "#docs",
    base + "\\docs", base + " ", "\n" + base, '"' + base + '"', "https://example.test/" + base,
  ];
  const rejected = { focus: false, navigation: null };
  for (const url of invalid) assert.deepEqual(launchActivation([exe, "--", url]), rejected, url);
  for (const args of [
    [], [exe, "--"], [exe, base, base], [exe, "--flag", base],
    [exe, "--", "--", base], [exe, "--", base, "--remote-debugging-port=9222"],
  ]) assert.deepEqual(launchActivation(args), rejected);
  assert.deepEqual(launchActivation(["electron", "--flag", base], true), rejected);
});

test("warm activations accept only canonical additional data and never raw URLs", () => {
  assert.deepEqual(secondActivation({ focus: true, navigation: "updates" }), { focus: true, navigation: "updates" });
  assert.deepEqual(secondActivation({ focus: true, navigation: null }), { focus: true, navigation: null });
  for (const data of [
    null, {}, [true, "updates"], { focus: true, navigation: base },
    { focus: true, navigation: { view: "workspace", url: base } },
    { focus: false, navigation: "workspace" }, { focus: true, navigation: "workspace", path: "C:\\Temp" },
  ]) assert.equal(secondActivation(data), null);
});

test("queues only supported views, coalesces repeated clicks, and bounds early requests", () => {
  const queue = createNavigationQueue();
  assert.equal(queue.pending, false);
  assert.equal(queue.take(), null);
  queue.enqueue(base);
  queue.enqueue("docs");
  queue.enqueue("docs");
  queue.enqueue("updates");
  assert.deepEqual(queue.take(), { project: "fva", view: "docs" });
  assert.deepEqual(queue.take(), { project: "fva", view: "updates" });
  for (let index = 0; index < 20; index++) queue.enqueue(index % 2 ? "workspace" : "updates");
  const routes = [];
  while (queue.pending) routes.push(queue.take());
  assert.equal(routes.length, 8);
  assert.equal(routes.at(-1).view, "workspace");
});

test("accepts the second skill routes and rejects lookalikes", () => {
  const ad = "teamspace-app://project/ugc-reference-ad-workflow";
  assert.deepEqual(launchActivation([exe, ad]), { focus: true, navigation: { project: "ugc-reference-ad-workflow", view: "workspace" } });
  assert.deepEqual(launchActivation([exe, "--", ad + "/docs"]), { focus: true, navigation: { project: "ugc-reference-ad-workflow", view: "docs" } });
  assert.deepEqual(launchActivation([exe, ad + "/updates"]), { focus: true, navigation: { project: "ugc-reference-ad-workflow", view: "updates" } });
  const rejected = { focus: false, navigation: null };
  for (const url of [
    ad + "/docs/extra", ad + "/extra", ad + "?x=1", ad + "/", ad + "/docs/",
    "teamspace-app://project/UGC-reference-ad-workflow",
    "teamspace-app://project/ugc-reference-ad-workflowx",
    "teamspace-app://project/FVA", "teamspace-app://project/Fva/docs",
  ]) assert.deepEqual(launchActivation([exe, url]), rejected, url);
  assert.deepEqual(secondActivation({ focus: true, navigation: { project: "ugc-reference-ad-workflow", view: "docs" } }),
    { focus: true, navigation: { project: "ugc-reference-ad-workflow", view: "docs" } });
  assert.equal(secondActivation({ focus: true, navigation: { project: "nope", view: "docs" } }), null);
  assert.equal(secondActivation({ focus: true, navigation: { project: "FVA", view: "workspace" } }), null);
  const queue = createNavigationQueue();
  queue.enqueue({ project: "ugc-reference-ad-workflow", view: "updates" });
  queue.enqueue({ project: "missing", view: "docs" });
  queue.enqueue({ project: "ugc-reference-ad-workflow", view: "updates", extra: true });
  assert.deepEqual(queue.take(), { project: "ugc-reference-ad-workflow", view: "updates" });
  assert.equal(queue.take(), null);
});

test("NSIS explicitly installs the quoted external scheme and uninstalls only its own command", () => {
  const root = path.join(__dirname, "..");
  const { build } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const installer = fs.readFileSync(path.join(root, build.nsis.include), "utf8");
  const command = '$\\"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}$\\" -- $\\"%1$\\"';
  assert(installer.includes('WriteRegStr SHCTX "Software\\Classes\\teamspace-app" "URL Protocol" ""'));
  assert(installer.includes("'"+ command + "'"));
  assert(installer.includes("StrCmp $0 '" + command + "' 0 +2"));
  assert.match(installer, /!macro customUnInstall[\s\S]+DeleteRegKey SHCTX "Software\\Classes\\teamspace-app"/);
});
