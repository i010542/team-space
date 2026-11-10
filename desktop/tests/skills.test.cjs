const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { verifySkill } = require("../src/core/live.cjs");
const { createService } = require("../src/core.cjs");
const { projectById } = require("../src/projects.cjs");

const frontmatter = (name) => "---\nname: " + name + "\n---\nbody\n";

async function skillDir(t, text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "team-space-skill-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "SKILL.md"), text);
  return dir;
}

test("verifySkill accepts only the exact skill name", async (t) => {
  const adName = "ugc-reference-ad-workflow";
  const ad = await skillDir(t, frontmatter(adName));
  const fva = await skillDir(t, frontmatter("fva"));
  const quoted = await skillDir(t, "---\nname: \"" + adName + "\"\n---\n");
  const noted = await skillDir(t, "---\nname: '" + adName + "' # 备注\n---\n");
  const fvaNote = await skillDir(t, "---\nname: fva # 备注\n---\n");
  await verifySkill(ad, adName);
  await verifySkill(quoted, adName);
  await verifySkill(noted, adName);
  await verifySkill(fva, "fva");
  await verifySkill(fvaNote, "fva");
  await assert.rejects(verifySkill(fva, adName), /请选择「广告制作」的 SKILL\.md（name: ugc-reference-ad-workflow）。/);
  await assert.rejects(verifySkill(fva, adName), /切换到「FVA」/);
  await assert.rejects(verifySkill(ad, "fva"), /请选择「FVA」的 SKILL\.md（name: fva）。/);
  await assert.rejects(verifySkill(ad, "fva"), /切换到「广告制作」/);
  const doubled = await skillDir(t, "---\nname: fva\nname: ugc-reference-ad-workflow\n---\n");
  await assert.rejects(verifySkill(doubled, "fva"), /不止一行 name/);
  await assert.rejects(verifySkill(doubled, adName), /不止一行 name/);
  for (const name of ["fva-extra", "ugc-reference-ad-workflowx"]) {
    const dir = await skillDir(t, frontmatter(name));
    await assert.rejects(verifySkill(dir, "fva"), (error) => {
      assert.match(error.message, /name: fva/);
      assert.doesNotMatch(error.message, /切换到/);
      return true;
    });
    await assert.rejects(verifySkill(dir, adName), (error) => {
      assert.match(error.message, /name: ugc-reference-ad-workflow/);
      assert.doesNotMatch(error.message, /切换到/);
      return true;
    });
  }
});

test("a folder already bound to another skill is refused before any clone", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "team-space-bind-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const live = path.join(dir, "shared");
  const root = path.join(dir, "workspaces");
  const other = path.join(dir, "workspaces-ugc-reference-ad-workflow");
  await fs.mkdir(live);
  await fs.mkdir(other);
  await fs.writeFile(path.join(live, "SKILL.md"), frontmatter("fva"));
  const run = async (_binary, args) => {
    if (args[0] === "auth" && args[1] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "api" && args[3] === "user") return { code: 0, stdout: JSON.stringify({ login: "example-user", id: 7 }), stderr: "" };
    if (args[0] === "api" && args[3] === "repos/i010542/fva") return { code: 0, stdout: "true", stderr: "" };
    throw new Error("unexpected " + args.join(" "));
  };
  const blocked = await fs.realpath(live);
  const service = createService({
    root, gitPath: "git", ghPath: "gh", run, project: projectById("fva"),
    bindings: async () => [{ name: "广告制作", path: blocked }],
  });
  await assert.rejects(service.bindWorkspace(live), /已经绑定给「广告制作」/);
  await assert.rejects(service.bindWorkspace(other), /具体目录/);
});
