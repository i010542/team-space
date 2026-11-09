'use strict';

const api = window.teamSpace;
const id = (name) => document.getElementById(name);
const say = (name, value) => { id(name).textContent = value; };
const show = (name, visible) => { id(name).hidden = !visible; };
const disable = (name, disabled) => { id(name).disabled = disabled; };
const account = () => status?.workspace;
const ended = () => review?.state === 'merged' || review?.state === 'closed';
const canWork = () => status?.authorized && status.tools?.git && status.tools?.gh;
const externalButtons = [...document.querySelectorAll('[data-external]')];
const workButtons = [...document.querySelectorAll('[data-page]')];

let status;
let review;
let preview;
let busy = '';
let primary = '';
let selected = new Set();
let checkboxes = [];
let summaries = [];
let deviceOpening = false;

function message(target, value) {
  say(target, value);
  show(target, Boolean(value));
}
function notice(value) { message('notice', value); }
function displayError(error) {
  message('error', error?.message || '操作未完成，请检查网络后重试。');
}

function hero(tag, title, description, action, label, caption = '') {
  say('hero-status', tag);
  say('action-title', title);
  say('action-description', description);
  primary = action;
  say('primary-label', label);
  show('primary-action', Boolean(action));
  show('action-caption', Boolean(caption));
  say('action-caption', caption);
}

function render() {
  const workspace = account();
  const allowed = canWork();
  const pending = Boolean(workspace?.pending);
  const working = Boolean(busy);
  const finished = ended();
  const unavailable = !status?.tools?.git || !status?.tools?.gh;
  say('account-label', status?.authenticated
    ? ('@' + (status.login || 'GitHub') + (status.authorized ? '' : ' · 权限未确认'))
    : (busy === '检查工作台' ? '正在连接…' : 'GitHub 未登录'));
  id('account-badge').dataset.tone = status?.authenticated ? (status.authorized ? 'good' : 'warn') : 'neutral';
  show('permission-link', Boolean(status?.authenticated && !status.authorized));
  show('previous-folder', Boolean(workspace && (finished || !allowed)));
  show('onboarding', !workspace);
  show('workspace-panels', Boolean(workspace));
  show('pending-panel', pending);
  show('update-workspace', !finished);
  show('open-review', Boolean(review?.url || (!review && workspace?.prUrl)));

  if (!status) {
    hero('检查环境', working ? '正在读取工作台状态' : '暂时无法读取工作台',
      '检查 GitHub 账号和本机工作文件。', working ? '' : 'status', '重新检查');
  } else if (unavailable) {
    hero('组件未就绪', '需要完整安装客户端',
      '工作台未找到所需组件。请重新运行团队提供的安装程序。', 'status', '重新检查');
  } else if (busy === '连接 GitHub') {
    hero('正在连接', '连接 GitHub 账号', '等待 GitHub 验证完成。');
  } else if (!status.authenticated) {
    hero('第一次参与', '连接你的 GitHub 账号',
      '使用已有 FVA 项目权限的账号登录，就可以准备自己的工作文件。', 'login', 'GitHub 登录');
  } else if (!status.authorized) {
    hero('权限未确认', '请检查 FVA 项目权限',
      '确认登录的是团队授权的账号，或联系项目负责人开通写入权限。', 'login', '重新登录 GitHub',
      '刚获得权限？重新打开客户端即可重新检查。');
  } else if (!workspace) {
    hero('账号已连接', '准备你的工作文件',
      '把 FVA 项目下载到这个电脑上，为你的修改准备独立的工作文件夹。', 'start', '开始参与 FVA');
  } else if (finished) {
    hero('本轮审核已结束', '准备下一次修改',
      '开始新的工作会下载最新版本。当前文件夹及其中的文件会保留。', 'start', '开始下一次修改');
  } else {
    hero('工作文件已就绪', '继续你的 FVA 修改',
      '打开文件夹，用熟悉的工具修改文件。保存后回到这里刷新改动。', 'open', '打开文件夹');
  }

  say('workspace-path', workspace?.path || '');
  say('workspace-branch', workspace?.branch || '');
  const shownState = review?.state;
  const stateText = {
    none: ['还没有审核请求', '提交选中的修改后，团队就可以在 GitHub 审核。'],
    open: ['审核进行中', '可在 GitHub 查看反馈。需要补充修改时，再勾选文件并提交到同一次审核。'],
    merged: ['已合并', '修改已经合入团队的正式版本。'],
    closed: ['已关闭', '本次审核已结束，修改未合入正式版本。']
  };
  const [stateTitle, stateDescription] = stateText[shownState] ||
    ['尚未查询', workspace?.prNumber ? '点击「查看结果」获取 GitHub 上的最新进度。' : '提交审核后，可在这里查看团队的处理进度。'];
  say('review-status', stateTitle + (review?.number ? ' · #' + review.number : ''));
  say('review-description', stateDescription);
  id('review-status').closest('.review-state').dataset.tone = shownState === 'merged' ? 'good' : '';
  say('update-caption', finished
    ? '下一轮请点击「开始下一次修改」，从团队的最新版本准备新文件夹。'
    : shownState === 'open'
      ? '当前审核仍在进行。审核结束后，可从最新版本开始下一次修改。'
      : preview?.files.length
        ? '检测到本机还有改动。请先处理这些文件，再刷新改动和更新工作文件。'
        : '开始修改前，可把没有本机改动的工作文件更新到团队最新版本。');

  disable('primary-action', working || !api);
  disable('previous-folder', working || !api);
  disable('refresh-changes', working || !allowed);
  disable('check-review', working || !allowed);
  disable('update-workspace', working || !allowed || pending || shownState === 'open' || Boolean(preview?.files.length));
  disable('retry-submit', working || !allowed);
  disable('recover-workspace', working || !allowed || !pending || !api?.recoverWorkspace);
  for (const button of externalButtons) button.disabled = working || !api;
  for (const button of summaries) button.disabled = working;

  show('changes-form', Boolean(preview?.files.length));
  show('changes-empty', !preview?.files.length);
  if (preview && !preview.files.length) {
    say('changes-empty-title', '没有待提交的改动');
    say('changes-empty-description', '在工作文件夹中修改并保存后，再刷新查看。');
  } else {
    say('changes-empty-title', '先在工作文件夹里修改');
    say('changes-empty-description', '保存后，点右上角「刷新改动」查看待提交文件。');
  }
  updateSelection();
}

function updateSelection() {
  const blocked = Boolean(busy || !canWork() || ended() || account()?.pending);
  const count = selected.size;
  const hasEligible = preview?.files.some((file) => file.eligible);
  for (const [checkbox, file] of checkboxes) {
    checkbox.disabled = Boolean(blocked || !file.eligible || (!checkbox.checked && count >= 100));
  }
  disable('submit-title', blocked || !hasEligible);
  disable('submit-button', blocked || !preview || count === 0 || !id('submit-title').value.trim());
  say('selected-count', '已选 ' + count + ' 个文件' + (count === 100 ? ' · 已达本次上限' : ''));
  say('submit-hint', account()?.pending
    ? '请先继续上次提交。'
    : ended()
      ? '本轮审核已结束。请开始下一次修改。'
      : !hasEligible
        ? '当前没有可提交的文件。'
        : review?.state === 'open'
          ? '所选改动将追加到当前审核。'
          : '提交后，团队可以在 GitHub 审核所选改动。');
}

function setWorkspace(workspace) {
  const before = account();
  if (!status) return;
  status = { ...status, workspace };
  if (before?.id !== workspace?.id) {
    review = undefined;
    clearPreview();
    id('submit-title').value = '';
  }
  const pendingFiles = id('pending-files');
  pendingFiles.replaceChildren();
  if (workspace?.pending) {
    say('pending-description', workspace.pendingTitle
      ? '已保留上次的修改「' + workspace.pendingTitle + '」。重试时无需重新选择文件。'
      : '上次的修改已保留。重试时无需重新选择文件。');
    for (const path of workspace.pendingFiles || []) {
      const item = document.createElement('li');
      item.textContent = path;
      pendingFiles.append(item);
    }
  }
}

function applyStatus(value) {
  const priorWorkspace = account();
  status = { ...value, workspace: priorWorkspace };
  setWorkspace(value.workspace);
}

function clearPreview() {
  preview = undefined;
  selected.clear();
  checkboxes = [];
  summaries = [];
  id('file-list').replaceChildren();
}

function element(tag, className, value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function renderFiles(next, retainSelection) {
  const previous = new Map(preview?.files.map((file) => [file.path, file]) || []);
  const oldSelection = selected;
  preview = next;
  selected = new Set();
  checkboxes = [];
  summaries = [];
  const fragment = document.createDocumentFragment();
  const labels = { added: '新增', modified: '修改', deleted: '删除' };

  next.files.forEach((file, i) => {
    const old = previous.get(file.path);
    if (retainSelection && file.eligible && oldSelection.has(file.path) &&
        old?.status === file.status && old?.diff === file.diff) selected.add(file.path);
    const row = element('li', 'file-row');
    const main = element('div', 'file-main');
    const selection = element('div', 'file-selection');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'file-select-' + i;
    checkbox.checked = selected.has(file.path);
    const label = element('label', '', file.path);
    label.htmlFor = checkbox.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(file.path);
      else selected.delete(file.path);
      updateSelection();
    });
    checkboxes.push([checkbox, file]);
    selection.append(checkbox, label);
    main.append(selection);
    const stateTag = element('span', 'file-state', file.eligible ? (labels[file.status] || '改动') : '不可提交');
    stateTag.dataset.status = file.eligible ? file.status : 'blocked';
    main.append(stateTag);
    row.append(main);

    if (!file.eligible) {
      const reason = element('p', 'file-reason', file.reason || '该文件不在项目允许提交的范围内。');
      reason.id = 'file-reason-' + i;
      checkbox.setAttribute('aria-describedby', reason.id);
      row.append(reason);
    } else {
      const toggle = element('button', 'button button-secondary summary-button', '查看摘要');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', '查看 ' + file.path + ' 的摘要');
      toggle.setAttribute('aria-expanded', 'false');
      const details = element('div', 'file-preview');
      details.id = 'file-preview-' + i;
      details.hidden = true;
      toggle.setAttribute('aria-controls', details.id);
      details.append(element('p', '', file.diff ? '以下是文件改动的只读预览。' : '这个文件没有可显示的文本摘要。'));
      if (file.diff) {
        const pre = element('pre', '', file.diff);
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', '文件改动预览');
        details.append(pre);
      }
      toggle.addEventListener('click', () => {
        const expanded = details.hidden;
        details.hidden = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? '收起摘要' : '查看摘要';
        toggle.setAttribute('aria-label', (expanded ? '收起 ' : '查看 ') + file.path + ' 的摘要');
      });
      summaries.push(toggle);
      main.append(toggle);
      row.append(details);
    }
    fragment.append(row);
  });
  id('file-list').replaceChildren(fragment);
}

async function fetchChanges(retainSelection) {
  let next;
  try { next = await api.changes(); }
  catch (error) {
    clearPreview();
    throw error;
  }
  setWorkspace(next.workspace);
  renderFiles(next, retainSelection);
}

async function optional(operation) {
  try { await operation(); }
  catch (error) { displayError(error); }
}

async function run(label, operation) {
  if (busy || !api) return;
  busy = label;
  message('error', '');
  notice(label + '中…');
  render();
  try {
    const success = await operation();
    notice(success || '');
  } catch (error) {
    notice('');
    displayError(error);
  } finally {
    busy = '';
    render();
  }
}

async function fetchStatus() {
  applyStatus(await api.status());
  if (canWork() && account()) await optional(async () => { review = await api.reviewStatus(); });
}

function connect() {
  run('连接 GitHub', async () => {
    try {
      applyStatus(await api.login());
      if (canWork() && account()) await optional(async () => { review = await api.reviewStatus(); });
      return status.authorized ? 'GitHub 已连接，可以参与 FVA。' : '';
    } finally {
      show('device-panel', false);
      id('device-code').value = '';
      say('device-feedback', '');
    }
  });
}

function startWorkspace() {
  run('准备工作文件', async () => {
    const before = account()?.id;
    setWorkspace(await api.startWorkspace());
    if (before !== account()?.id) review = { state: 'none' };
    await optional(fetchStatus);
    return '工作文件夹已就绪，可以打开文件开始修改。';
  });
}

function openWorkspace() { run('打开文件夹', async () => { await api.openWorkspace(); }); }

function submit(input) {
  run(input.retry ? '继续上次提交' : '提交审核', async () => {
    let result;
    try { result = await api.submit(input); }
    catch (error) {
      // A push failure can leave a resumable local submission. Check the real
      // workspace status, preserving the failure message from the submission.
      if (!error?.message?.startsWith('已取消提交')) {
        clearPreview();
        await optional(fetchStatus);
      }
      throw error;
    }
    setWorkspace(result.workspace);
    review = { state: 'open', url: result.prUrl, number: result.number };
    id('submit-title').value = '';
    clearPreview();
    await optional(() => fetchChanges(false));
    return '已提交审核 #' + result.number + '。可在下方查看审核进度。';
  });
}

function navigate(page, label) {
  for (const button of workButtons) {
    const active = button.dataset.page === page;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    show(button.dataset.page + '-page', active);
  }
  say('current-page', label);
  id(page + '-heading').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

id('primary-action').addEventListener('click', () => {
  if (primary === 'status') run('检查工作台', fetchStatus);
  if (primary === 'login') connect();
  if (primary === 'start') startWorkspace();
  if (primary === 'open') openWorkspace();
});
id('previous-folder').addEventListener('click', openWorkspace);
id('refresh-changes').addEventListener('click', () => run('读取本机改动', () => fetchChanges(true)));
id('submit-title').addEventListener('input', updateSelection);
id('submit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (id('submit-button').disabled) return;
  submit({ title: id('submit-title').value.trim(), files: [...selected], previewId: preview.previewId });
});
id('retry-submit').addEventListener('click', () => submit({ retry: true }));
id('recover-workspace').addEventListener('click', () => run('准备新工作文件', async () => {
  const { workspace, previousPath } = await api.recoverWorkspace();
  setWorkspace(workspace);
  await optional(fetchStatus);
  return '新工作文件已准备。旧文件保留在 ' + previousPath + '。需要的修改请从旧文件夹复制到新文件夹。';
}));
id('check-review').addEventListener('click', () => run('查询审核结果', async () => {
  review = await api.reviewStatus();
  return '已查询 GitHub 上的审核状态。';
}));
id('update-workspace').addEventListener('click', () => run('更新工作文件', async () => {
  setWorkspace(await api.updateWorkspace());
  clearPreview();
  await optional(fetchStatus);
  return '工作文件已更新到团队最新版本。';
}));
for (const button of externalButtons) {
  button.addEventListener('click', () => run('打开浏览器', () => api.openExternal(button.dataset.external).then(() => '')));
}
for (const button of workButtons) {
  button.addEventListener('click', () => navigate(button.dataset.page, button.textContent.trim()));
}
id('device-code').addEventListener('focus', (event) => event.target.select());
id('device-open').addEventListener('click', async () => {
  if (deviceOpening || busy !== '连接 GitHub') return;
  deviceOpening = true;
  disable('device-open', true);
  try {
    await api.openExternal('device');
    if (busy === '连接 GitHub') say('device-feedback', '请在浏览器中输入验证码。');
  } catch (error) {
    if (busy === '连接 GitHub') say('device-feedback', error?.message || '暂时无法打开 GitHub 验证页。');
  } finally {
    deviceOpening = false;
    disable('device-open', false);
  }
});

if (api) {
  const unsubscribe = api.onProgress((progress) => {
    if (busy !== '连接 GitHub' || progress?.type !== 'device-code' ||
        typeof progress.code !== 'string' || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(progress.code)) return;
    id('device-code').value = progress.code;
    show('device-panel', true);
    notice('已取得验证码，请在浏览器完成授权。');
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
  run('检查工作台', fetchStatus);
} else {
  render();
  displayError(new Error('请从已安装的 Windows 客户端打开工作台。'));
}
