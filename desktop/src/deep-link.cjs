const viewsByUrl = new Map([
  ["teamspace-app://project/fva", "workspace"],
  ["teamspace-app://project/fva/docs", "docs"],
  ["teamspace-app://project/fva/updates", "updates"],
]);
const views = new Set(viewsByUrl.values());

function launchActivation(argv, defaultApp = false) {
  const ignored = { focus: false, navigation: null };
  if (!Array.isArray(argv) || typeof argv[0] !== "string" || !argv[0]) return ignored;
  if (defaultApp && (typeof argv[1] !== "string" || !argv[1] || argv[1].startsWith("-"))) return ignored;
  const args = argv.slice(defaultApp ? 2 : 1);
  if (!args.length) return { focus: true, navigation: null };
  // The NSIS open command inserts a single option terminator before the URL.
  const url = args.length === 1 ? args[0] : args.length === 2 && args[0] === "--" ? args[1] : null;
  const navigation = viewsByUrl.get(url);
  return navigation ? { focus: true, navigation } : ignored;
}

function secondActivation(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 2 ||
      !Object.hasOwn(data, "focus") || !Object.hasOwn(data, "navigation") || data.focus !== true) return null;
  if (data.navigation !== null && !views.has(data.navigation)) return null;
  return { focus: true, navigation: data.navigation };
}

function createNavigationQueue() {
  const pending = [];
  return {
    enqueue(view) {
      if (!views.has(view) || pending.at(-1) === view) return;
      if (pending.length === 8) pending.shift();
      pending.push(view);
    },
    get pending() { return pending.length > 0; },
    take() {
      const view = pending.shift();
      return view ? { project: "fva", view } : null;
    },
  };
}

module.exports = { launchActivation, secondActivation, createNavigationQueue };

