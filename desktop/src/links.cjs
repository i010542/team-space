const { projectById } = require("./projects.cjs");

const globalLinks = Object.freeze({
  device: "https://github.com/login/device",
  portal: "https://i010542.github.io/team-space/",
  portalFiles: "https://i010542.github.io/team-space/team/files/",
  portalVersions: "https://i010542.github.io/team-space/team/versions/",
  portalReviews: "https://i010542.github.io/team-space/team/reviews/",
  portalSuggestions: "https://i010542.github.io/team-space/team/suggestions/",
  portalDocs: "https://i010542.github.io/team-space/docs/",
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blobPath(filePath) {
  if (typeof filePath !== "string" || !filePath || /[\\?#]/.test(filePath)) return null;
  const parts = filePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function externalUrl(project, key, reviewUrl) {
  const current = projectById(typeof project === "string" ? project : project?.id);
  if (!current || typeof key !== "string" || !key) return null;
  if (Object.hasOwn(globalLinks, key)) return globalLinks[key];
  if (key === "portalProject") return "https://i010542.github.io/team-space/projects/" + current.id + "/";
  const repoBase = "https://github.com/" + current.repo;
  if (key === "repository") return repoBase;
  if (key === "branches") return repoBase + "/branches";
  if (key === "pulls") return repoBase + "/pulls";
  if (key === "issues") return repoBase + "/issues";
  if (key === "pr") {
    const pattern = new RegExp("^https://github\\.com/" + escapeRegExp(current.repo) + "/pull/[1-9]\\d*$");
    return pattern.test(reviewUrl || "") ? reviewUrl : null;
  }
  const doc = current.docs.find((item) => item.key === key);
  const pathName = doc && blobPath(doc.path);
  return pathName ? repoBase + "/blob/main/" + pathName : null;
}

module.exports = { externalUrl };
