const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { externalUrl } = require("../src/links.cjs");
const { projectById, publicProject, rememberedId, chooseProject, projectDataRoot } = require("../src/projects.cjs");

const fva = projectById("fva");
const ad = projectById("ugc-reference-ad-workflow");

test("project ids and data directories stay exact and side by side", () => {
  assert.equal(projectById("FVA"), null);
  assert.equal(projectById("ugc-reference-ad-workflowx"), null);
  assert.equal(projectById("fva").dataDir, "workspaces");
  const userData = path.join("Team Space");
  const fvaRoot = projectDataRoot(userData, "fva");
  const adRoot = projectDataRoot(userData, "ugc-reference-ad-workflow");
  assert.equal(fvaRoot, path.join(userData, "workspaces"));
  assert.equal(adRoot, path.join(userData, "workspaces-ugc-reference-ad-workflow"));
  assert.equal(path.dirname(fvaRoot), path.dirname(adRoot));
  assert.equal(publicProject(fva).dataDir, undefined);
  assert.equal(publicProject(ad).repo, "i010542/ugc-reference-ad-workflow");
});

test("remembered and chosen projects fall back unless the id is exact and idle", () => {
  assert.equal(rememberedId(null), "fva");
  assert.equal(rememberedId("fva"), "fva");
  assert.equal(rememberedId({ id: "FVA" }), "fva");
  assert.equal(rememberedId({ id: "missing" }), "fva");
  assert.equal(rememberedId({ id: "ugc-reference-ad-workflow", extra: true }), "ugc-reference-ad-workflow");
  assert.equal(chooseProject("nope", false).ok, false);
  assert.equal(chooseProject("fva", true).ok, false);
  assert.match(chooseProject("ugc-reference-ad-workflow", true).error, /请稍候/);
  assert.equal(chooseProject("ugc-reference-ad-workflow", false).project.id, "ugc-reference-ad-workflow");
});

test("external links follow the active repository and reject unknown keys", () => {
  const repoKeys = ["repository", "branches", "pulls", "issues"];
  for (const key of repoKeys) {
    const fvaUrl = externalUrl(fva, key);
    const adUrl = externalUrl("ugc-reference-ad-workflow", key);
    assert.match(fvaUrl, /^https:\/\/github\.com\/i010542\/fva(\/|$)/);
    assert.match(adUrl, /^https:\/\/github\.com\/i010542\/ugc-reference-ad-workflow(\/|$)/);
    assert.doesNotMatch(adUrl, /i010542\/fva/);
    assert.doesNotMatch(fvaUrl, /ugc-reference-ad-workflow/);
  }
  assert.equal(externalUrl(fva, "skill"), "https://github.com/i010542/fva/blob/main/SKILL.md");
  assert.equal(externalUrl(fva, "changelog"), "https://github.com/i010542/fva/blob/main/CHANGELOG.md");
  assert.equal(externalUrl(ad, "skill"), "https://github.com/i010542/ugc-reference-ad-workflow/blob/main/SKILL.md");
  assert.equal(externalUrl(ad, "readme"), "https://github.com/i010542/ugc-reference-ad-workflow/blob/main/README.md");
  assert.equal(externalUrl(ad, "workflow"), "https://github.com/i010542/ugc-reference-ad-workflow/blob/main/references/workflow.md");
  assert.equal(externalUrl(ad, "templates"), "https://github.com/i010542/ugc-reference-ad-workflow/blob/main/references/templates.md");
  assert.equal(externalUrl(ad, "changelog"), null);
  assert.equal(externalUrl(fva, "portalProject"), "https://i010542.github.io/team-space/projects/fva/");
  assert.equal(externalUrl(ad, "portalProject"), "https://i010542.github.io/team-space/projects/ugc-reference-ad-workflow/");
  assert.equal(externalUrl(ad, "portalFva"), null);
  assert.equal(externalUrl(fva, "portalFva"), null);
  for (const key of ["device", "portal", "portalFiles", "portalVersions", "portalReviews", "portalSuggestions", "portalDocs"]) {
    assert.equal(externalUrl(fva, key), externalUrl(ad, key));
    assert.match(externalUrl(ad, key), /^https:\/\//);
  }
  const adPr = "https://github.com/i010542/ugc-reference-ad-workflow/pull/12";
  const fvaPr = "https://github.com/i010542/fva/pull/12";
  assert.equal(externalUrl(ad, "pr", adPr), adPr);
  assert.equal(externalUrl(ad, "pr", fvaPr), null);
  assert.equal(externalUrl(fva, "pr", fvaPr), fvaPr);
  assert.equal(externalUrl(fva, "pr", adPr), null);
  assert.equal(externalUrl(fva, "pr", fvaPr + "?x=1"), null);
  for (const key of ["https://example.test/", "nope", "", null]) assert.equal(externalUrl(fva, key), null);
  assert.equal(externalUrl({ id: "missing" }, "repository"), null);
});
