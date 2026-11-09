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
const docFilters = [...document.querySelectorAll('[data-doc-filter]')];
const docRows = [...document.querySelectorAll('[data-doc-category]')];
const changeLabels = { added: '新增', modified: '修改', deleted: '删除', A: '新增', M: '修改', D: '删除' };
const updateLabels = { added: '新增', modified: '更新', deleted: '移除', merged: '两边改动都保留', conflict: '需要选择版本', skipped: '保留原样' };
const navigationLabels = { workspace: 'FVA 工作台', docs: 'FVA 项目资料', updates: 'FVA 团队更新' };
const progressMessages = {
  '绑定 FVA 文件夹': '正在选择 SKILL.md…',
  '提交审核': '正在处理发送请求…',
  '继续上次提交': '正在继续发送改动…',
};

let status;
let review;
let preview;
let busy = '';
let primary = '';
let selected = new Set();
let summaries = [];
let deviceOpening = false;
let focusTimer;
let needsRefresh = false;
let updatePreview;
let updateStale = false;
let updateChoices = new Map();
let navigationReady = false;
let initializing = true;
let waitingForUpdateSection = false;
let navigationRequested = false;
let navigationNeedsConfirmation = false;
let readingNavigation = false;
let pendingNavigation;
let docCategory = 'all';

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
  const bound = Boolean(workspace?.bound);
  const allowed = canWork();
  const pending = Boolean(workspace?.pending);
  const working = Boolean(busy);
  const recovering = Boolean(status?.recoveryRequired);
  const finished = ended();
  const unavailable = !status?.tools?.git || !status?.tools?.gh;
  say('account-label', status?.localRecoveryAvailable
    ? '本机恢复' + (status.login ? ' · @' + status.login : '')
    : status?.authenticated
    ? ('@' + (status.login || 'GitHub') + (status.authorized ? '' : ' · 权限未确认'))
    : (busy === '检查工作台' ? '正在连接…' : 'GitHub 未登录'));
  id('account-badge').dataset.tone = status?.authenticated ? (status.authorized ? 'good' : 'warn') : 'neutral';
  show('permission-link', Boolean(status?.authenticated && !status.authorized));
  show('previous-folder', bound && !recovering && (finished || !allowed));
  show('rebind-workspace', bound && !recovering);
  show('workspace-panels', bound || pending);
  show('changes-card', bound && !recovering);
  show('review-card', bound && !recovering);
  show('team-updates-card', bound);
  show('workspace-details', bound);
  show('pending-panel', pending && !recovering);
  show('open-review', Boolean(review?.url || (!review && workspace?.prUrl)));
  show('refresh-reminder', needsRefresh);
  if (bound) message('updates-entry-notice', '');

  if (!status) {
    hero('正在检查', working ? '正在打开工作台' : '暂时打不开工作台',
      '查看登录状态和 FVA 文件夹。', working ? '' : 'status', '重新检查');
  } else if (recovering) {
    hero('本机恢复', '上次更新未完成',
      '请先恢复更新前的文件，再继续修改或发给团队。', 'restore', '恢复更新前版本',
      status.localRecoveryAvailable ? '可以在本机恢复，无需登录 GitHub。' : '');
  } else if (unavailable) {
    hero('需要重新安装', '客户端缺少必要文件',
      '请重新运行团队提供的安装程序。', 'status', '重新检查');
  } else if (busy === '连接 GitHub') {
    hero('正在登录', '在浏览器登录 GitHub', '按浏览器提示操作，完成后回到这里。');
  } else if (!status.authenticated) {
    hero('第一步', '用团队账号登录',
      '登录 GitHub 后，就可以选择现在用的 SKILL.md。', 'login', '登录 GitHub');
  } else if (!status.authorized) {
    hero('需要项目权限', '请确认账号能访问 FVA',
      '用团队已开通权限的账号登录。需要权限时请联系项目负责人。', 'login', '重新登录 GitHub');
  } else if (!bound && pending) {
    hero('还有改动没发完', '先处理上次的改动',
      '在下方继续发送，或保留文件再开始新一轮。然后选择现在用的 SKILL.md。');
  } else if (!bound) {
    hero('第二步', '选择现在用的 SKILL.md',
      '选正在使用的那份 SKILL.md，客户端会自动记住它所在的文件夹。', 'bind', '选择 SKILL.md',
      workspace ? '升级前的工作文件夹会保留在原处。' : '以后照常在原处用 WorkBuddy 或 Codex 修改。');
  } else if (finished && !pending) {
    hero('本轮审核已结束', '准备下一轮修改',
      '还是用同一个 FVA 文件夹。改好后，再发给团队审核。', 'start', '开始下一轮修改');
  } else {
    hero('已记住 FVA 文件夹', '在原处修改 FVA',
      '用 WorkBuddy 或 Codex 改好并保存。回到这里查看全部改动，再发给团队审核。', 'open', '打开 FVA 文件夹',
      pending ? '更换 SKILL.md 前，请先继续发送，或保留文件再开始新一轮。' : '');
  }

  const directory = workspace?.path || '';
  message('location', directory ? (bound ? 'FVA 文件夹 · ' : '以前的文件夹 · ') + directory : '');
  say('workspace-path', bound ? directory : '');
  say('workspace-branch', workspace?.branch || '');
  const shownState = review?.state;
  const stateText = {
    none: ['还没有发给团队审核', '发送后，可以在这里查看审核进度。'],
    open: ['审核中', '可以在浏览器查看留言。需要补充时，改好原文件，再发给团队。'],
    merged: ['已采用', '这次改动已经进入团队正式版本。'],
    closed: ['审核已结束', '这次改动未进入团队正式版本。']
  };
  const [stateTitle, stateDescription] = stateText[shownState] ||
    ['尚未查看', workspace?.prNumber ? '点「刷新审核进度」查看最新结果。' : '发给团队后，可以在这里查看审核进度。'];
  say('review-status', stateTitle + (review?.number ? ' · #' + review.number : ''));
  say('review-description', stateDescription);
  id('review-status').closest('.review-state').dataset.tone = shownState === 'merged' ? 'good' : '';

  disable('primary-action', working || !api || (primary === 'bind' && !api.bindWorkspace) ||
    (primary === 'restore' && !canRestoreUpdate()) ||
    (primary === 'start' && Boolean(updatePreview || status?.recoveryRequired)));
  disable('previous-folder', working || !api);
  disable('rebind-workspace', working || !allowed || pending || !api?.bindWorkspace || Boolean(updatePreview || status?.recoveryRequired));
  disable('refresh-changes', working || !allowed || !bound || Boolean(updatePreview || status?.recoveryRequired));
  disable('check-review', working || !allowed || !bound);
  disable('retry-submit', working || !allowed || Boolean(updatePreview || status?.recoveryRequired));
  disable('recover-workspace', working || !allowed || !pending || !api?.recoverWorkspace || Boolean(updatePreview || status?.recoveryRequired));
  for (const button of externalButtons) button.disabled = working || !api;
  for (const button of summaries) button.disabled = working;

  show('changes-form', Boolean(preview?.files.length));
  show('changes-empty', !preview?.files.length);
  if (preview && !preview.files.length) {
    say('changes-empty-title', '暂时没有改动');
    say('changes-empty-description', '在原来的 FVA 文件夹里改好并保存，再回来刷新。');
  } else {
    say('changes-empty-title', '查看你的改动');
    say('changes-empty-description', '点「刷新改动」查看可以发给团队的文件。');
  }
  renderSubmissionControls();
  renderWorkflow();
  renderUpdateControls();
  renderNavigation();
}

function renderWorkflow() {
  const authenticated = Boolean(status?.authenticated);
  const workspace = account();
  const blocked = Boolean(!api || !status || busy || status?.recoveryRequired);
  const accessLabel = !authenticated ? '先登录' : !canWork() ? '查看权限' : '';
  say('flow-label', workspace?.bound ? '日常协作' : '第一次参与');
  say('step-login-label', authenticated ? '已登录 · 查看状态' : '登录 GitHub');
  say('step-folder-label', accessLabel || (workspace?.pending ? '先处理上次改动'
    : updatePreview ? '先关闭更新预览' : workspace?.bound ? '已选择 · 更换 SKILL.md' : '选择 SKILL.md'));
  say('step-review-label', accessLabel || (workspace?.pending ? '先处理上次改动'
    : workspace?.bound ? '前往查看改动' : '先选 SKILL.md'));
  for (const step of ['step-login', 'step-folder', 'step-review']) disable(step, blocked);
}

function focusWorkflowTarget(target) {
  clearTimeout(focusTimer);
  const destination = id(target);
  destination.focus({ preventScroll: true });
  destination.scrollIntoView({ block: 'start' });
}

function focusWorkflowHero() {
  const button = id('primary-action');
  focusWorkflowTarget(button.hidden || button.disabled ? 'action-title' : 'primary-action');
}

function canUseWorkflow() {
  return Boolean(api && status && !busy && !status.recoveryRequired);
}

function guideWorkflowAccess() {
  if (canWork()) return true;
  if (!status.tools?.git || !status.tools?.gh) notice('请先重新安装客户端，再继续。');
  else if (!status.authenticated) notice('请先用团队已开通权限的账号登录 GitHub。');
  else notice('请用团队已开通权限的账号重新登录，或联系项目负责人。');
  focusWorkflowHero();
  return false;
}

function guidePendingWork() {
  if (!account()?.pending) return false;
  notice('上次的改动还没发完。请先继续发送，或保留文件开始新一轮。');
  focusWorkflowTarget('pending-title');
  return true;
}

function renderSubmissionControls() {
  const blocked = Boolean(busy || !canWork() || ended() || account()?.pending || updatePreview || status?.recoveryRequired);
  const files = preview?.files || [];
  const count = files.length;
  const cannotSend = count - selected.size;
  const deletions = files.filter((file) => file.status === 'deleted' || file.status === 'D').length;
  disable('submit-title', blocked || count === 0);
  disable('submit-button', blocked || needsRefresh || count === 0 || count > 100 || cannotSend > 0 || !id('submit-title').value.trim());
  say('batch-count', count + ' 个文件' + (deletions ? ' · ' + deletions + ' 个已删除' : '') +
    (cannotSend ? ' · ' + cannotSend + ' 个暂不能发送' : ''));
  let hint = '全部改动会一并发送，包括删除。团队采用后才进入正式版本。';
  if (status?.recoveryRequired) hint = '请先恢复更新前版本。';
  else if (updatePreview) hint = '请先完成或关闭团队更新预览。';
  else if (account()?.pending) hint = '请先处理上次没发完的改动。';
  else if (ended()) hint = '本轮审核已结束。请开始下一轮修改。';
  else if (needsRefresh) hint = '请先刷新并重新查看本次全部改动。';
  else if (count > 100) hint = '本次有 ' + count + ' 个改动文件，超过 100 个上限，整批暂不能发送。请整理后刷新。';
  else if (cannotSend) hint = '有 ' + cannotSend + ' 个文件暂不能发送，整批会暂停。请按清单中的原因处理后再刷新。';
  else if (count === 0) hint = '暂时没有要发送的改动。';
  else if (review?.state === 'open') hint = '全部改动会一并发到当前审核，包括删除。';
  say('submit-hint', hint);
}

function setWorkspace(workspace) {
  const before = account();
  if (!status) return;
  status = { ...status, workspace };
  if (before?.id !== workspace?.id || before?.bound !== workspace?.bound || before?.path !== workspace?.path) {
    review = undefined;
    clearPreview();
    clearUpdatePreview();
    id('submit-title').value = '';
  }
  const pendingFiles = id('pending-files');
  pendingFiles.replaceChildren();
  if (workspace?.pending) {
    say('pending-description', workspace.pendingTitle
      ? '上次的改动「' + workspace.pendingTitle + '」已保留。继续发送时沿用上次的文件清单。'
      : '上次的改动已保留。继续发送时沿用上次的文件清单。');
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
  needsRefresh = false;
  selected.clear();
  summaries = [];
  id('file-list').replaceChildren();
}

function element(tag, className, value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function renderFiles(next) {
  preview = next;
  needsRefresh = false;
  selected = new Set(next.files.filter((file) => file.eligible).map((file) => file.path));
  summaries = [];
  const fragment = document.createDocumentFragment();

  next.files.forEach((file, i) => {
    const row = element('li', 'file-row');
    const main = element('div', 'file-main');
    main.append(element('code', 'file-name', file.path));
    const stateTag = element('span', 'file-state', file.eligible ? (changeLabels[file.status] || '改动') : '暂不能发送');
    stateTag.dataset.status = file.eligible ? file.status : 'blocked';
    main.append(stateTag);
    row.append(main);

    if (!file.eligible) {
      const reason = element('p', 'file-reason', file.reason || '这个文件不在团队接收的范围内。');
      reason.id = 'file-reason-' + i;
      row.setAttribute('aria-describedby', reason.id);
      row.append(reason);
    } else {
      const toggle = element('button', 'button button-secondary summary-button', '看看改了什么');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', '查看 ' + file.path + ' 改了什么');
      toggle.setAttribute('aria-expanded', 'false');
      const details = element('div', 'file-preview');
      details.id = 'file-preview-' + i;
      details.hidden = true;
      toggle.setAttribute('aria-controls', details.id);
      details.append(element('p', '', file.diff ? '下面列出这个文件的改动。要修改，请回到原文件。' : '这个文件没有可显示的文字改动。'));
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
        toggle.textContent = expanded ? '收起改动' : '看看改了什么';
        toggle.setAttribute('aria-label', (expanded ? '收起 ' : '查看 ') + file.path + ' 的改动');
      });
      summaries.push(toggle);
      main.append(toggle);
      row.append(details);
    }
    fragment.append(row);
  });
  id('file-list').replaceChildren(fragment);
}

async function fetchChanges() {
  let next;
  try { next = await api.changes(); }
  catch (error) {
    clearPreview();
    throw error;
  }
  setWorkspace(next.workspace);
  renderFiles(next);
}

async function optional(operation) {
  try { await operation(); }
  catch (error) { displayError(error); }
}

async function run(label, operation) {
  if (busy || !api) return;
  clearTimeout(focusTimer);
  busy = label;
  message('error', '');
  notice(progressMessages[label] || label + '中…');
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
    void receiveNavigation();
  }
}

async function fetchStatus() {
  applyStatus(await api.status());
  if (canWork() && account()?.bound && !status?.recoveryRequired) await optional(async () => { review = await api.reviewStatus(); });
}

function connect() {
  run('连接 GitHub', async () => {
    try {
      applyStatus(await api.login());
      if (canWork() && account()?.bound && !status?.recoveryRequired) {
        await optional(async () => { review = await api.reviewStatus(); });
        if (!account()?.pending && !status?.recoveryRequired) await optional(fetchChanges);
      }
      return status.authorized ? '已登录 GitHub，可以继续。' : '';
    } finally {
      show('device-panel', false);
      id('device-code').value = '';
      say('device-feedback', '');
    }
  });
}

function bindWorkspace() {
  run('绑定 FVA 文件夹', async () => {
    const workspace = await api.bindWorkspace();
    if (!workspace) return;
    if (!workspace.bound) throw new Error('没能记住 SKILL.md 所在的文件夹，请重新选择。');
    setWorkspace(workspace);
    await optional(fetchStatus);
    if (!account()?.bound) throw new Error('当前账号还没有选择 SKILL.md。请重新选择。');
    await optional(fetchChanges);
    return '已记住 SKILL.md 所在的文件夹。继续在原处改文件即可。';
  });
}

function startWorkspace() {
  run('开始下一次修改', async () => {
    const before = account()?.id;
    setWorkspace(await api.startWorkspace());
    const isNew = before !== account()?.id;
    if (isNew) review = { state: 'none' };
    await optional(fetchStatus);
    if (!isNew) return '这轮审核还没结束，请查看审核进度。';
    if (account()?.bound) await optional(fetchChanges);
    return '可以开始下一轮了。继续用原来的 FVA 文件夹。';
  });
}

function openWorkspace() { run('打开 FVA 文件夹', async () => { await api.openWorkspace(); }); }

function clearUpdatePreview() {
  updatePreview = undefined;
  updateStale = false;
  updateChoices.clear();
  id('updates-files').replaceChildren();
  show('updates-panel', false);
}

function canRestoreUpdate() {
  const recovering = Boolean(status?.recoveryRequired);
  const offline = recovering && status?.localRecoveryAvailable;
  return Boolean(!busy && account()?.bound && status?.lastBackup?.id && api?.restoreUpdate &&
    !updatePreview && (offline || canWork()) && (recovering || (!account()?.pending && review?.state !== 'open')));
}

function renderUpdateControls() {
  const bound = Boolean(account()?.bound);
  const allowed = Boolean(bound && canWork());
  const pending = Boolean(account()?.pending);
  const recovering = Boolean(status?.recoveryRequired);
  const reviewing = review?.state === 'open';
  const working = Boolean(busy);
  const lastBackup = status?.lastBackup;
  const remaining = updatePreview
    ? updatePreview.files.filter((file) => file.status === 'conflict' && !updateChoices.has(file.path)).length
    : 0;
  const blockedReason = updateStale
    ? '情况有变化，请重新检查团队更新。'
    : updatePreview?.blockedReason || '';
  let availability = '';
  if (recovering) availability = '上次更新未完成。请先恢复更新前版本。';
  else if (pending) availability = '可以先看更新内容。更新前，请先处理上次没发完的改动。';
  else if (reviewing) availability = '可以先看更新内容。等本轮审核结束后再更新。';
  message('update-availability', availability);
  show('backup-panel', bound && Boolean(lastBackup?.id));
  say('backup-description', lastBackup?.interrupted || recovering
    ? '上次更新中断。可把受影响的文件恢复到更新前的版本。'
    : '可把最近一次更新影响的文件恢复到更新前的版本。');
  disable('update-workspace', working || !allowed || recovering || !api?.updateWorkspace);
  disable('close-update', working);
  disable('apply-update', working || !allowed || pending || reviewing || recovering || updateStale ||
    !updatePreview?.canApply || remaining > 0 || !api?.applyUpdates);
  disable('restore-update', !canRestoreUpdate());
  for (const input of id('updates-files').querySelectorAll('input')) {
    input.disabled = working || !allowed || pending || reviewing || updateStale || recovering || !updatePreview?.canApply;
  }
  say('update-decisions', blockedReason || (remaining
    ? '还有 ' + remaining + ' 个文件需要你选择版本。'
    : updatePreview?.canApply ? '确认后先备份，再更新原文件夹。' : '暂时没有可以安装的更新。'));
}

function fileText(label, value) {
  const pane = element('div');
  const heading = element('h4', '', label);
  const content = element('pre', '', value === null ? '这份版本没有此文件。' : value || '（空文件）');
  content.tabIndex = 0;
  content.setAttribute('aria-label', label);
  pane.append(heading, content);
  return pane;
}

function conflictChoices(change, index) {
  const field = element('fieldset', 'update-choice');
  field.append(element('legend', '', '更新后用哪一份？'));
  const options = [
    ['mine', change.mineText === null ? '保持现在的样子（没有这个文件）' : '保留我的版本'],
    ['team', change.teamText === null ? '用团队版本（移除这个文件）' : '用团队版本']
  ];
  for (const [value, label] of options) {
    const option = element('label');
    const input = element('input');
    input.type = 'radio';
    input.name = 'update-choice-' + index;
    input.value = value;
    input.addEventListener('change', () => {
      updateChoices.set(change.path, value);
      renderUpdateControls();
    });
    option.append(input, document.createTextNode(label));
    field.append(option);
  }
  return field;
}

function showTeamUpdates(result) {
  updatePreview = result;
  updateStale = false;
  updateChoices.clear();
  const entries = document.createDocumentFragment();
  result.files.forEach((change, index) => {
    const row = element('li');
    const heading = element('div', 'update-file-heading');
    const tag = element('span', 'file-state', updateLabels[change.status] || '变动');
    tag.dataset.status = change.status;
    heading.append(element('code', '', change.path), tag);
    row.append(heading);
    if (change.reason) row.append(element('p', 'caption', change.reason));
    if (change.status === 'conflict') {
      const details = element('details', 'update-file-detail');
      details.append(element('summary', '', '对照我的版本和团队版本'));
      const sides = element('div', 'update-comparison');
      sides.append(fileText('我的版本', change.mineText), fileText('团队版本', change.teamText));
      details.append(sides);
      if (change.textTruncated) details.append(element('p', 'caption', '这里只显示部分内容。选择会影响整个文件。'));
      row.append(details, conflictChoices(change, index));
    } else if (change.diff) {
      const details = element('details', 'update-file-detail');
      const text = element('pre', '', change.diff);
      text.tabIndex = 0;
      text.setAttribute('aria-label', '文件差异');
      details.append(element('summary', '', '看看这个文件会怎么改'), text);
      row.append(details);
    }
    entries.append(row);
  });
  id('updates-files').replaceChildren(entries);
  show('update-conflict-help', result.files.some((file) => file.status === 'conflict'));
  say('updates-title', result.files.length ? '团队更新预览 · ' + result.files.length + ' 个文件' : '没有文件需要改动');
  say('updates-message', result.files.length
    ? '先查看哪些文件会变。如果需要选择，请对照后决定用哪一份。'
    : result.canApply ? '可以确认团队版本，原文件会保留。' : '');
  show('updates-panel', true);
  id('updates-title').focus({ preventScroll: true });
}

async function finishUpdate(result, restored) {
  const originalPath = account()?.path;
  const title = id('submit-title').value;
  const wasLocalRecovery = restored && status?.localRecoveryAvailable;
  setWorkspace(result.workspace);
  if (account()?.path === originalPath) id('submit-title').value = title;
  clearPreview();
  clearUpdatePreview();
  status = { ...status, recoveryRequired: false, localRecoveryAvailable: false,
    lastBackup: !restored && result.backupId ? { id: result.backupId } : undefined };
  if (!wasLocalRecovery) await optional(fetchStatus);
  if (canWork() && account()?.bound && !account()?.pending && !status?.recoveryRequired) await optional(fetchChanges);
  const message = result.message?.replace('已恢复安装前的 FVA 文件及协作工作区。', '已恢复更新前的 FVA 文件。');
  return message || (restored ? '已恢复更新前的文件。' : 'FVA 已更新。需要时可恢复更新前的文件。');
}

function restoreUpdate() {
  if (!canRestoreUpdate()) return;
  run('恢复更新前版本', async () => {
    let result;
    try { result = await api.restoreUpdate({ backupId: status.lastBackup.id }); }
    catch (error) {
      if (error?.message?.startsWith('已取消恢复')) return '已取消恢复。';
      clearPreview();
      if (!status?.localRecoveryAvailable) await optional(fetchStatus);
      throw error;
    }
    return finishUpdate(result, true);
  });
}

function refreshOnFocus() {
  if (updatePreview && preview?.files.length && !busy) {
    needsRefresh = true;
    render();
  }
  const canRefresh = () => !busy && canWork() && account()?.bound && !account().pending &&
    !updatePreview && !status?.recoveryRequired && !id('work-page').hidden;
  const markStale = () => {
    needsRefresh = true;
    render();
  };
  clearTimeout(focusTimer);
  if (!canRefresh()) return;
  if (hasChangeDraft()) {
    markStale();
    return;
  }
  focusTimer = setTimeout(() => {
    if (!canRefresh()) return;
    if (hasChangeDraft()) markStale();
    else run('读取本机改动', fetchChanges);
  }, 350);
}

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
    if (account()?.bound) {
      await optional(fetchChanges);
      return '已发给团队审核 #' + result.number + '。可在下方查看进度，团队采用后才进入正式版本。';
    }
    return '上次的改动已发给团队审核 #' + result.number + '。现在可以选择 SKILL.md。';
  });
}

function navigate(page, label) {
  waitingForUpdateSection = false;
  message('updates-entry-notice', '');
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

function hasChangeDraft() {
  return Boolean(id('submit-title').value || id('file-list').contains(document.activeElement) ||
    summaries.some((button) => button.getAttribute('aria-expanded') === 'true'));
}

function hasNavigationDraft() {
  return hasChangeDraft() || Boolean(updatePreview);
}

function renderNavigation() {
  show('navigation-request', Boolean(pendingNavigation));
  if (pendingNavigation) say('navigation-message', '网页请求打开「' + navigationLabels[pendingNavigation] + '」。');
  disable('accept-navigation', Boolean(busy || !pendingNavigation));
}

function openNavigation(view) {
  clearTimeout(focusTimer);
  if (view === 'docs') {
    navigate('docs', '项目资料');
    return;
  }
  if (view === 'help') {
    navigate('help', '使用帮助');
    return;
  }
  navigate('work', '工作台');
  if (view !== 'updates') return;
  if (initializing) {
    waitingForUpdateSection = true;
    message('updates-entry-notice', '正在检查 FVA 文件夹。');
    return;
  }
  locateTeamUpdates();
}

function locateTeamUpdates() {
  if (!account()?.bound) {
    message('updates-entry-notice', '请先选择现在用的 SKILL.md，再在工作台查看团队更新。');
    return;
  }
  id('team-updates-title').focus({ preventScroll: true });
  id('team-updates-card').scrollIntoView({ block: 'start' });
}

function filterDocuments() {
  const terms = id('doc-query').value.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  let count = 0;
  for (const row of docRows) {
    const matchesCategory = docCategory === 'all' || row.dataset.docCategory === docCategory;
    const searchable = row.textContent.toLowerCase();
    const matches = matchesCategory && terms.every((term) => searchable.includes(term));
    row.hidden = !matches;
    if (matches) count++;
  }
  for (const button of docFilters) button.setAttribute('aria-pressed', String(button.dataset.docFilter === docCategory));
  say('doc-count', count + ' 条资料');
  show('doc-empty', count === 0);
}

function signalNavigation() {
  navigationRequested = true;
  if ((busy && !initializing) || hasNavigationDraft()) navigationNeedsConfirmation = true;
  void receiveNavigation();
}

async function receiveNavigation() {
  if (!navigationReady || !navigationRequested || readingNavigation || (busy && !initializing) || pendingNavigation || !api?.takeNavigation) return;
  navigationRequested = false;
  readingNavigation = true;
  const needsConfirmation = navigationNeedsConfirmation;
  navigationNeedsConfirmation = false;
  try {
    const route = await api.takeNavigation();
    if (route?.project !== 'fva' || !Object.hasOwn(navigationLabels, route.view)) return;
    navigationRequested = true;
    if (needsConfirmation || (busy && !initializing) || hasNavigationDraft()) {
      navigationNeedsConfirmation = true;
      pendingNavigation = route.view;
      renderNavigation();
    } else {
      openNavigation(route.view);
    }
  } catch {
    // The current view stays usable if the desktop handoff is unavailable.
  } finally {
    readingNavigation = false;
    if (navigationRequested) void receiveNavigation();
  }
}

id('accept-navigation').addEventListener('click', () => {
  if (!pendingNavigation || busy) return;
  const view = pendingNavigation;
  pendingNavigation = undefined;
  renderNavigation();
  openNavigation(view);
  void receiveNavigation();
});
id('dismiss-navigation').addEventListener('click', () => {
  pendingNavigation = undefined;
  renderNavigation();
  void receiveNavigation();
});

id('primary-action').addEventListener('click', () => {
  if (primary === 'status') run('检查工作台', fetchStatus);
  if (primary === 'login') connect();
  if (primary === 'bind') bindWorkspace();
  if (primary === 'start') startWorkspace();
  if (primary === 'open') openWorkspace();
  if (primary === 'restore') restoreUpdate();
});
id('step-login').addEventListener('click', () => {
  if (!canUseWorkflow()) return;
  if (status.authenticated) {
    notice(canWork() ? '已登录 GitHub，可以继续。' : '已登录 GitHub。请查看当前账号的项目权限。');
    focusWorkflowTarget('action-title');
  } else if (status.tools?.git && status.tools?.gh) {
    connect();
  } else {
    guideWorkflowAccess();
  }
});
id('step-folder').addEventListener('click', () => {
  if (!canUseWorkflow() || !guideWorkflowAccess() || guidePendingWork()) return;
  if (updatePreview) {
    notice('请先关闭团队更新预览，再选择 SKILL.md。');
    focusWorkflowTarget('updates-title');
    return;
  }
  if (!api.bindWorkspace) {
    notice('客户端暂时无法选择 SKILL.md。请重新打开后再试。');
    return;
  }
  bindWorkspace();
});
id('step-review').addEventListener('click', () => {
  if (!canUseWorkflow() || !guideWorkflowAccess() || guidePendingWork()) return;
  if (!account()?.bound) {
    notice('请先选择现在用的 SKILL.md，再查看要发给团队的改动。');
    focusWorkflowHero();
    return;
  }
  focusWorkflowTarget('changes-title');
});
id('previous-folder').addEventListener('click', openWorkspace);
id('rebind-workspace').addEventListener('click', bindWorkspace);
id('refresh-changes').addEventListener('click', () => run('读取本机改动', fetchChanges));
id('submit-title').addEventListener('input', renderSubmissionControls);
id('submit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (id('submit-button').disabled) return;
  submit({ title: id('submit-title').value.trim(), files: [...selected], previewId: preview.previewId });
});
id('retry-submit').addEventListener('click', () => submit({ retry: true }));
id('recover-workspace').addEventListener('click', () => run('另开审核任务', async () => {
  const { workspace, previousPath } = await api.recoverWorkspace();
  setWorkspace(workspace);
  await optional(fetchStatus);
  if (account()?.bound) {
    await optional(fetchChanges);
    return '可以开始下一轮了。继续用原来的 FVA 文件夹，并查看本次全部改动。';
  }
  return '旧文件已保留在 ' + previousPath + '。现在可以选择 SKILL.md。';
}));
id('check-review').addEventListener('click', () => run('查询审核结果', async () => {
  review = await api.reviewStatus();
  return '审核进度已刷新。';
}));
id('update-workspace').addEventListener('click', () => run('检查团队更新', async () => {
  clearUpdatePreview();
  const result = await api.updateWorkspace();
  if (!result?.readOnly || !Array.isArray(result.files) ||
      (result.canApply && typeof result.previewId !== 'string')) throw new Error('无法读取团队更新，请重试。');
  setWorkspace(result.workspace);
  showTeamUpdates(result);
}));
id('close-update').addEventListener('click', () => {
  if (busy) return;
  clearUpdatePreview();
  render();
  id('update-workspace').focus({ preventScroll: true });
});
id('apply-update').addEventListener('click', () => run('更新我的 FVA', async () => {
  let result;
  try {
    result = await api.applyUpdates({ previewId: updatePreview.previewId, resolutions: Object.fromEntries(updateChoices) });
  } catch (error) {
    if (error?.message?.startsWith('已取消更新')) return '已取消更新。';
    updateStale = true;
    clearPreview();
    await optional(fetchStatus);
    if (status?.recoveryRequired) clearUpdatePreview();
    throw error;
  }
  return finishUpdate(result, false);
}));
id('restore-update').addEventListener('click', restoreUpdate);
for (const button of externalButtons) {
  button.addEventListener('click', () => run('打开浏览器', () => api.openExternal(button.dataset.external).then(() => '')));
}
for (const button of workButtons) {
  button.addEventListener('click', () => navigate(button.dataset.page, button.textContent.trim()));
}
for (const button of document.querySelectorAll('[data-local-view]')) {
  button.addEventListener('click', () => openNavigation(button.dataset.localView));
}
for (const button of docFilters) {
  button.addEventListener('click', () => {
    docCategory = button.dataset.docFilter;
    filterDocuments();
  });
}
id('doc-query').addEventListener('input', filterDocuments);
id('reset-doc-filter').addEventListener('click', () => {
  docCategory = 'all';
  id('doc-query').value = '';
  filterDocuments();
  id('doc-query').focus();
});
filterDocuments();
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
  const unsubscribeNavigation = api.onNavigation?.(signalNavigation);
  if (typeof unsubscribeNavigation === 'function') window.addEventListener('beforeunload', unsubscribeNavigation, { once: true });
  navigationReady = Boolean(api.takeNavigation);
  if (navigationReady) signalNavigation();
  window.addEventListener('focus', refreshOnFocus);
  run('检查工作台', async () => {
    await fetchStatus();
    if (canWork() && account()?.bound && !account()?.pending && !status?.recoveryRequired) await optional(fetchChanges);
  }).finally(() => {
    initializing = false;
    if (waitingForUpdateSection) {
      waitingForUpdateSection = false;
      locateTeamUpdates();
    }
    void receiveNavigation();
  });
} else {
  render();
  displayError(new Error('请从已安装的 Windows 客户端打开工作台。'));
}
