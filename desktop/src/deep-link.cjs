const { projectById, projects } = require("./projects.cjs");

const viewNames = new Set(["workspace", "docs", "updates"]);

function routeFromUrl(url) {
  if (typeof url !== "string" || !url.startsWith("teamspace-app://project/")) return null;
  const rest = url.slice("teamspace-app://project/".length);
  for (const project of projects) {
    if (rest === project.id) return { project: project.id, view: "workspace" };
    if (rest === project.id + "/docs") return { project: project.id, view: "docs" };
    if (rest === project.id + "/updates") return { project: project.id, view: "updates" };
  }
  return null;
}

function asRoute(value) {
  if (typeof value === "string" && viewNames.has(value)) return { project: "fva", view: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !Object.hasOwn(value, "project") || !Object.hasOwn(value, "view")) return null;
  if (!viewNames.has(value.view) || !projectById(value.project)) return null;
  return { project: value.project, view: value.view };
}

function launchActivation(argv, defaultApp = false) {
  const ignored = { focus: false, navigation: null };
  if (!Array.isArray(argv) || typeof argv[0] !== "string" || !argv[0]) return ignored;
  if (defaultApp && (typeof argv[1] !== "string" || !argv[1] || argv[1].startsWith("-"))) return ignored;
  const args = argv.slice(defaultApp ? 2 : 1);
  if (!args.length) return { focus: true, navigation: null };
  // The NSIS open command inserts a single option terminator before the URL.
  const url = args.length === 1 ? args[0] : args.length === 2 && args[0] === "--" ? args[1] : null;
  const route = routeFromUrl(url);
  if (!route) return ignored;
  if (route.project === "fva") return { focus: true, navigation: route.view };
  return { focus: true, navigation: { project: route.project, view: route.view } };
}

function secondActivation(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 2 ||
      !Object.hasOwn(data, "focus") || !Object.hasOwn(data, "navigation") || data.focus !== true) return null;
  if (data.navigation === null) return { focus: true, navigation: null };
  if (typeof data.navigation === "string") {
    if (!viewNames.has(data.navigation)) return null;
    return { focus: true, navigation: data.navigation };
  }
  const route = asRoute(data.navigation);
  return route ? { focus: true, navigation: route } : null;
}

function createNavigationQueue() {
  const pending = [];
  return {
    enqueue(value) {
      const route = asRoute(value);
      if (!route) return;
      const last = pending.at(-1);
      if (last && last.project === route.project && last.view === route.view) return;
      if (pending.length === 8) pending.shift();
      pending.push(route);
    },
    get pending() { return pending.length > 0; },
    take() {
      return pending.shift() || null;
    },
  };
}

module.exports = { launchActivation, secondActivation, createNavigationQueue };
