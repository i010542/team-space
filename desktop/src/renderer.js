'use strict';

const api = window.teamSpace;
const id = (name) => document.getElementById(name);
const say = (name, value) => { id(name).textContent = value; };
const show = (name, visible) => { id(name).hidden = !visible; };
const disable = (name, disabled) => { id(name).disabled = disabled; };
const account = () => status?.workspace;
const ended = () => review?.state === 'merged' || review?.state === 'closed';
const canWork = () => status?.authorized && status.tools?.git && status.tools?.gh;
let externalButtons = [...document.querySelectorAll('[data-external]')];
const workButtons = [...document.querySelectorAll('[data-page]')];
const workTabs = [...document.querySelectorAll('[data-work-tab]')];
const docFilters = [...document.querySelectorAll('[data-doc-filter]')];
let docRows = [];
const changeLabels = { added: '新增', modified: '修改', deleted: '删除', A: '新增', M: '修改', D: '删除' };
const updateLabels = { added: '新增', modified: '更新', deleted: '移除', merged: '两边改动都保留', conflict: '需要选择版本', skipped: '保留原样' };
const progressMessages = {
  '选择 SKILL.md': '正在选择 SKILL.md…',
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
let activeWorkTab = 'changes';
let flowExpanded = false;
let catalog = [];
let currentProjectId = '';
let projectEpoch = 0;
let catalogReady = false;
let docsProject = '';
let pendingProjectSwitch = '';
const usageDrafts = new Map();
const usageTextLimit = 50000;
const usageTools = { codex: 'Codex', workbuddy: 'WorkBuddy', other: '其他' };

function isCjkLetter(char) {
  const code = char.codePointAt(0);
  return code >= 0x3400 && code <= 0x9fff;
}
function isPunct(char) { return /[，。、；：？！,.;:?!\])]/.test(char); }
function gap(left, right) {
  if (!left || !right) return '';
  const end = left.at(-1);
  const start = right[0];
  if (isPunct(end) || isPunct(start)) return '';
  return isCjkLetter(end) && isCjkLetter(start) ? '' : ' ';
}
function spaced(before, label, after = '') {
  return before + gap(before, label) + label + gap(label, after) + after;
}
function nameOf(projectId) {
  return catalog.find((item) => item.id === projectId)?.name || '';
}
function projectName() {
  const listed = catalog.find((item) => item.id === currentProjectId);
  if (listed?.name) return listed.name;
  if (status?.project?.id && status.project.id === currentProjectId && status.project.name) return status.project.name;
  return '';
}
function projectFullName() {
  return catalog.find((item) => item.id === currentProjectId)?.fullName || '';
}
function withName(before, after, neutral) {
  const name = projectName();
  return name ? spaced(before, name, after) : neutral;
}
function viewTitle(projectId, view) {
  const tail = view === 'docs' ? '项目资料' : view === 'updates' ? '团队更新' : '工作台';
  const name = nameOf(projectId);
  return name ? spaced('', name, tail) : tail;
}
function resultProject(value) {
  if (!value || typeof value !== 'object') return '';
  return typeof value.project === 'string' ? value.project : (value.project?.id || '');
}
function staleResult(epoch, projectId, value) {
  if (epoch !== projectEpoch || (projectId && projectId !== currentProjectId)) return true;
  const marker = resultProject(value);
  return Boolean(marker && currentProjectId && marker !== currentProjectId);
}

function message(target, value) {
  say(target, value);
  show(target, Boolean(value));
}
function notice(value) { message('notice', value); }
function displayError(error) {
  const panel = id('error');
  if (!panel) return;
  panel.textContent = error?.message || '操作未完成，请检查网络后重试。';
  panel.hidden = false;
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
  if (!status) {
    say('sidebar-account-title', '正在连接…');
    say('sidebar-account-text', '正在检查 GitHub 登录。');
    id('sidebar-account').dataset.tone = 'neutral';
  } else if (status.localRecoveryAvailable) {
    say('sidebar-account-title', '本机恢复');
    say('sidebar-account-text', status.login ? '@' + status.login : '可以在本机恢复，无需登录 GitHub。');
    id('sidebar-account').dataset.tone = status.authenticated ? (status.authorized ? 'good' : 'warn') : 'neutral';
  } else if (!status.authenticated) {
    say('sidebar-account-title', 'GitHub 未登录');
    say('sidebar-account-text', '用团队已开通权限的账号登录。');
    id('sidebar-account').dataset.tone = 'neutral';
  } else if (!status.authorized) {
    say('sidebar-account-title', '权限未确认');
    say('sidebar-account-text', '@' + (status.login || 'GitHub') + ' · 请用团队已开通权限的账号。');
    id('sidebar-account').dataset.tone = 'warn';
  } else {
    say('sidebar-account-title', '已登录 GitHub');
    say('sidebar-account-text', '@' + (status.login || 'GitHub'));
    id('sidebar-account').dataset.tone = 'good';
  }
  show('permission-link', Boolean(status?.authenticated && !status.authorized));
  show('previous-folder', bound && !recovering && (finished || !allowed));
  show('rebind-workspace', bound && !recovering);
  show('workspace-panels', bound || pending);
  renderWorkTabs();
  show('workspace-details', bound);
  show('pending-panel', pending && !recovering);
  show('open-review', Boolean(review?.url || (!review && workspace?.prUrl)));
  show('refresh-reminder', needsRefresh);
  if (bound) message('updates-entry-notice', '');

  if (!status) {
    hero('正在检查', working ? '正在打开工作台' : '暂时打不开工作台',
      withName('查看登录状态和', '文件夹。', '查看登录状态和你的 Skill 文件夹。'), working ? '' : 'status', '重新检查');
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
      '点下方第 1 步，用团队已开通权限的账号登录 GitHub。', '', '');
  } else if (!status.authorized) {
    hero('需要项目权限', withName('请确认账号能访问', '', '请确认账号能访问你的 Skill'),
      '用团队已开通权限的账号登录。需要权限时请联系项目负责人。', 'login', '重新登录 GitHub');
  } else if (!bound && pending) {
    hero('还有改动没发完', '先处理上次的改动',
      '在下方继续发送，或保留文件再开始新一轮。然后选择现在用的 SKILL.md。');
  } else if (!bound) {
    hero('第二步', '选择现在用的 SKILL.md',
      '点下方第 2 步，选正在使用的那份 SKILL.md。客户端会自动记住它所在的文件夹。', '', '',
      workspace ? '升级前的工作文件夹会保留在原处。' : '以后照常在原处用 WorkBuddy 或 Codex 修改。');
  } else if (finished && !pending) {
    hero('本轮审核已结束', '准备下一轮修改',
      withName('还是用同一个', '文件夹。改好后，再发给团队审核。', '还是用同一个 Skill 文件夹。改好后，再发给团队审核。'), 'start', '开始下一轮修改');
  } else {
    hero(withName('已记住', '文件夹', '已记住 Skill 文件夹'), withName('在原处修改', '', '在原处修改'),
      '用 WorkBuddy 或 Codex 改好并保存。回到这里查看全部改动，再发给团队审核。', 'open', withName('打开', '文件夹', '打开文件夹'),
      pending ? '更换 SKILL.md 前，请先继续发送，或保留文件再开始新一轮。' : '');
  }

  const directory = workspace?.path || '';
  message('location', directory ? (bound ? withName('', '文件夹 · ', 'Skill 文件夹 · ') : '以前的文件夹 · ') + directory : '');
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
  for (const button of summaries) button.disabled = working;

  show('changes-form', Boolean(preview?.files.length));
  show('changes-empty', !preview?.files.length);
  if (preview && !preview.files.length) {
    say('changes-empty-title', '暂时没有改动');
    say('changes-empty-description', withName('在原来的', '文件夹里改好并保存，再回来刷新。', '在原来的 Skill 文件夹里改好并保存，再回来刷新。'));
  } else {
    say('changes-empty-title', '查看你的改动');
    say('changes-empty-description', '点「刷新改动」查看可以发给团队的文件。');
  }
  renderSubmissionControls();
  renderWorkflow();
  renderUpdateControls();
  renderNavigation();
  applyChrome();
  renderSkillSwitch();
  renderUsage();
  for (const button of externalButtons) button.disabled = working || !api;
  show('project-switch-request', Boolean(pendingProjectSwitch));
  disable('accept-project-switch', Boolean(busy) || !pendingProjectSwitch);
  disable('dismiss-project-switch', Boolean(busy) || !pendingProjectSwitch);
}

function renderWorkflow() {
  const authenticated = Boolean(status?.authenticated);
  const workspace = account();
  const bound = Boolean(workspace?.bound);
  const blocked = Boolean(!api || !status || busy || status?.recoveryRequired);
  const accessLabel = !authenticated ? '先登录' : !canWork() ? '查看权限' : '';
  const loginDone = Boolean(status?.authenticated && status?.authorized);
  const states = {
    'step-login': loginDone ? 'done' : 'current',
    'step-folder': bound ? 'done' : (loginDone ? 'current' : 'todo'),
    'step-review': bound ? 'current' : 'todo',
  };
  const stateLabels = { done: '已完成', current: '当前这一步', todo: '还没到' };
  say('flow-label', bound ? '日常协作' : '第一次参与');
  say('step-login-label', authenticated ? '已登录 · 查看状态' : '登录 GitHub');
  say('step-folder-label', accessLabel || (workspace?.pending ? '先处理上次改动'
    : updatePreview ? '先关闭更新预览' : bound ? '已选择 · 更换 SKILL.md' : '选择 SKILL.md'));
  say('step-review-label', accessLabel || (workspace?.pending ? '先处理上次改动'
    : bound ? '前往查看改动' : '完成第 2 步后可用'));
  for (const step of ['step-login', 'step-folder', 'step-review']) {
    const state = states[step];
    id(step).dataset.state = state;
    say(step + '-state', stateLabels[state]);
    disable(step, blocked);
  }
  if (!bound) flowExpanded = false;
  id('onboarding').classList.toggle('is-compact', bound && !flowExpanded);
  show('flow-toggle', bound);
  id('flow-toggle').setAttribute('aria-expanded', String(bound && flowExpanded));
  say('flow-toggle', flowExpanded ? '收起说明' : '查看三步说明');
}

function focusWorkflowTarget(target) {
  const destination = id(target);
  destination.focus({ preventScroll: true });
  destination.scrollIntoView({ block: 'start' });
}

function workTabAvailable(tab) {
  return Boolean(account()?.bound && (!status?.recoveryRequired || tab.dataset.workTab === 'updates'));
}

function renderWorkTabs() {
  const available = workTabs.filter(workTabAvailable);
  const active = available.find((tab) => tab.dataset.workTab === activeWorkTab) || available[0];
  show('workspace-tablist', Boolean(active));
  for (const tab of workTabs) {
    const selectedTab = tab === active;
    tab.disabled = !available.includes(tab);
    tab.tabIndex = selectedTab ? 0 : -1;
    tab.setAttribute('aria-selected', String(selectedTab));
    show(tab.getAttribute('aria-controls'), selectedTab);
  }
}

function selectWorkTab(name, target) {
  const tab = workTabs.find((candidate) => candidate.dataset.workTab === name);
  if (!tab || !workTabAvailable(tab)) return;
  activeWorkTab = name;
  renderWorkTabs();
  if (target) {
    id(target).focus({ preventScroll: true });
    id('workspace-tablist').scrollIntoView({ block: 'start' });
  }
}

function navigateWorkTabs(event, current) {
  const { key } = event;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
  const available = workTabs.filter(workTabAvailable);
  const index = available.indexOf(current);
  if (index < 0) return;
  const last = available.length - 1;
  let next;
  if (key === 'Home') next = available[0];
  else if (key === 'End') next = available[last];
  else if (key === 'ArrowLeft') next = available[index ? index - 1 : last];
  else next = available[index === last ? 0 : index + 1];
  event.preventDefault();
  selectWorkTab(next.dataset.workTab);
  next.focus({ preventScroll: true });
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
  if (value?.project?.id) currentProjectId = value.project.id;
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

function prepareDiffPreview(container, diff, label) {
  let mounted = false;
  return () => {
    if (!diff || mounted) return;
    const preview = element('pre', 'diff-preview');
    preview.tabIndex = 0;
    preview.setAttribute('aria-label', label);
    const rows = document.createDocumentFragment();
    const lines = diff.split('\n');
    for (const [index, line] of lines.entries()) {
      let kind = 'context';
      if (line.startsWith('+')) kind = 'added';
      else if (line.startsWith('-')) kind = 'deleted';
      else if (line.startsWith('@@')) kind = 'hunk';
      else if (line === '… 差异已截断') kind = 'note';
      rows.append(element('span', 'diff-line diff-' + kind, line + (index < lines.length - 1 ? '\n' : '')));
    }
    preview.append(rows);
    container.append(preview);
    mounted = true;
  };
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
      const showDiff = prepareDiffPreview(details, file.diff, '文件改动预览');
      toggle.addEventListener('click', () => {
        const expanded = details.hidden;
        if (expanded) showDiff();
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
  const epoch = projectEpoch;
  const projectId = currentProjectId;
  const wait = setTimeout(() => {
    const progress = id('notice');
    if (busy && progress && epoch === projectEpoch) {
      progress.textContent = '仍在等待读取结果，请不要重复操作。';
      progress.hidden = false;
    }
  }, 15000);
  try {
    const next = await api.changes();
    if (staleResult(epoch, projectId, next)) return;
    setWorkspace(next.workspace);
    renderFiles(next);
  } catch (error) {
    if (epoch !== projectEpoch || projectId !== currentProjectId) return;
    clearPreview();
    throw error;
  } finally {
    clearTimeout(wait);
  }
}

async function optional(operation) {
  try { await operation(); }
  catch (error) { displayError(error); }
}

async function run(label, operation) {
  if (busy || !api) return;
  busy = label;
  let operationStarted = false;
  try {
    message('error', '');
    notice(progressMessages[label] || label + '中…');
    render();
    operationStarted = true;
    const success = await operation();
    notice(success || '');
  } catch (error) {
    showOperationError(operationStarted ? error : new Error('工作台界面未能刷新。请重试这一步。'));
  } finally {
    busy = '';
    renderIdle();
    void receiveNavigation();
  }
}

function showOperationError(error) {
  const progress = id('notice');
  if (progress) {
    progress.textContent = '';
    progress.hidden = true;
  }
  displayError(error);
}

function renderIdle() {
  try { render(); }
  catch {
    // Only retry drawing the view. The operation has already finished.
    try { render(); }
    catch { showOperationError(new Error('工作台界面未能刷新。请重新打开客户端，并查看上次操作的结果。')); }
  }
}

async function fetchStatus() {
  const epoch = projectEpoch;
  const projectId = currentProjectId;
  const value = await api.status();
  if (staleResult(epoch, projectId, value)) return false;
  applyStatus(value);
  if (canWork() && account()?.bound && !status?.recoveryRequired) {
    try {
      const nextReview = await api.reviewStatus();
      if (staleResult(epoch, projectId, nextReview)) return true;
      review = nextReview;
    } catch (error) { displayError(error); }
  }
  return true;
}

function connect() {
  const epoch = projectEpoch;
  const projectId = currentProjectId;
  run('连接 GitHub', async () => {
    try {
      const value = await api.login();
      if (staleResult(epoch, projectId, value)) return;
      applyStatus(value);
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
  run('选择 SKILL.md', async () => {
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
    return withName('可以开始下一轮了。继续用原来的', '文件夹。', '可以开始下一轮了。继续用原来的 Skill 文件夹。');
  });
}

function openWorkspace() { run('打开文件夹', async () => { await api.openWorkspace(); }); }

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
      const showDiff = prepareDiffPreview(details, change.diff, '文件差异');
      details.append(element('summary', '', '看看这个文件会怎么改'));
      details.addEventListener('toggle', () => { if (details.open) showDiff(); });
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
  const text = result.message?.replace(/已恢复安装前的.*?文件及协作工作区。/, withName('已恢复更新前的', '文件。', '已恢复更新前的文件。'));
  return text || (restored ? '已恢复更新前的文件。' : withName('', '已更新。需要时可恢复更新前的文件。', '已更新。需要时可恢复更新前的文件。'));
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

function remindRefreshOnFocus() {
  if (busy || needsRefresh || !canWork() || !account()?.bound || account().pending || status?.recoveryRequired) return;
  needsRefresh = true;
  renderIdle();
}

function submit(input) {
  const epoch = projectEpoch;
  const projectId = currentProjectId;
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
    if (staleResult(epoch, projectId, result)) return;
    setWorkspace(result.workspace);
    review = { state: 'open', url: result.prUrl, number: result.number };
    id('submit-title').value = '';
    clearPreview();
    if (account()?.bound) {
      await optional(fetchChanges);
      selectWorkTab('review', id('work-page').hidden ? undefined : 'review-title');
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
  if (page === 'usage') renderUsage();
  id(page + '-heading').focus({ preventScroll: true });
  window.scrollTo?.(0, 0);
}

function usageState() {
  if (!currentProjectId) return null;
  if (!usageDrafts.has(currentProjectId)) {
    usageDrafts.set(currentProjectId, { title: '', tool: '', text: '', viewer: '',
      items: null, page: 1, hasNext: false, detail: null, incomplete: false, error: '', success: '' });
  }
  return usageDrafts.get(currentProjectId);
}

function usageViewer() {
  return status?.authenticated && status?.project?.id === currentProjectId && status?.tools?.gh
    ? (status.login || '').toLowerCase() : '';
}

function usageMetadata(record) {
  const date = new Date(record.createdAt).toLocaleString('zh-CN');
  return [record.author, date, usageTools[record.tool]].filter(Boolean).join(' · ');
}

function renderUsageForm() {
  const state = usageState();
  const canSave = Boolean(!busy && api?.usageSave && state && usageViewer());
  const titleLength = state?.title.trim().length || 0;
  const length = state?.text.length || 0;
  for (const field of ['title', 'tool', 'text']) disable('usage-' + field, Boolean(busy || !state));
  disable('usage-import', Boolean(busy || !state || !api?.usageImport));
  disable('usage-save', !canSave || !titleLength || titleLength > 80 || !state?.text.trim() || length > usageTextLimit);
  say('usage-length', length + ' / 50000 字符' + (length > usageTextLimit
    ? '，请缩短内容。客户端不会截断。' : titleLength > 80 ? '。标题最多 80 字符。' : '。超过上限不会截断。'));
}

function renderUsage() {
  const state = usageState();
  const viewer = usageViewer();
  const canRead = Boolean(viewer && api?.usageList);
  const visible = Boolean(canRead && state?.viewer === viewer);
  const items = visible ? state.items : null;
  const detail = visible ? state.detail : null;
  say('usage-project', withName('当前 Skill ·', '', '当前 Skill'));
  message('usage-access', viewer ? '' : '登录 GitHub 后可查看或保存团队记录。这里不需要先选择 SKILL.md。');
  message('usage-error', state?.error || '');
  message('usage-success', state?.success || '');
  for (const field of ['title', 'tool', 'text']) {
    const input = id('usage-' + field);
    const value = state?.[field] || '';
    if (input.value !== value) input.value = value;
  }
  renderUsageForm();
  disable('usage-refresh', !canRead || Boolean(busy));
  show('usage-pagination', Boolean(items && !state.incomplete && (state.page > 1 || state.hasNext)));
  disable('usage-prev', Boolean(busy || !visible || state?.page <= 1));
  disable('usage-next', Boolean(busy || !visible || !state?.hasNext));
  say('usage-page-number', '第 ' + (state?.page || 1) + ' 页');
  let empty = '';
  if (!canRead) empty = '登录后可查看当前 Skill 的团队记录。';
  else if (visible && state.incomplete) empty = '已显示刚保存的记录。点「刷新记录」查看团队列表。';
  else if (!items) empty = '点「刷新记录」读取当前 Skill 的团队记录。';
  else if (!items.length) empty = state.hasNext ? '本页没有使用记录，可以查看下一页。' : '本页没有使用记录。';
  message('usage-empty', empty);
  const entries = document.createDocumentFragment();
  for (const record of items || []) {
    const row = element('li');
    const button = element('button', 'usage-item');
    button.type = 'button';
    button.disabled = Boolean(busy);
    if (detail?.number === record.number) button.setAttribute('aria-current', 'true');
    button.append(element('strong', '', record.title), element('small', '', usageMetadata(record)));
    button.addEventListener('click', () => viewUsageRecord(record.number));
    row.append(button);
    entries.append(row);
  }
  id('usage-items').replaceChildren(entries);
  show('usage-detail', Boolean(detail));
  say('usage-detail-title', detail?.title || '');
  say('usage-detail-meta', detail ? usageMetadata(detail) : '');
  say('usage-detail-text', detail?.text || '');
  disable('usage-open', Boolean(busy || !detail || !api?.usageOpen));
}

function checkUsageResult(value, project, epoch, needsViewer = true) {
  if (!value || value.project !== project || staleResult(epoch, project, value) ||
      (needsViewer && value.viewer?.toLowerCase() !== usageViewer())) {
    throw new Error('当前 Skill 或登录账号已变化，请重新读取使用记录。');
  }
}

function clearUsageRecords(state) {
  Object.assign(state, { viewer: '', items: null, page: 1, hasNext: false, detail: null, incomplete: false });
}

async function runUsage(label, operation, { remote = true, showDetail = false } = {}) {
  const state = usageState();
  if (busy || !state || (remote && !usageViewer())) return;
  const project = currentProjectId;
  const epoch = projectEpoch;
  let finished = false;
  await run(label, async () => {
    state.error = '';
    state.success = '';
    try {
      await operation(state, project, epoch);
      finished = true;
    } catch (error) {
      if (remote) clearUsageRecords(state);
      state.error = error?.message || '使用记录操作未完成，请重试。';
    }
  });
  if (finished && showDetail && state.detail && project === currentProjectId && !id('usage-page').hidden) {
    focusWorkflowTarget('usage-detail-title');
  }
}

function readUsagePage(page) {
  return runUsage('读取团队记录', async (state, project, epoch) => {
    const data = await api.usageList({ project, page });
    checkUsageResult(data, project, epoch);
    Object.assign(state, { viewer: data.viewer.toLowerCase(), items: data.items, page: data.page,
      hasNext: data.hasNext, detail: null, incomplete: false });
  });
}

function viewUsageRecord(number) {
  return runUsage('打开使用记录', async (state, project, epoch) => {
    const data = await api.usageDetail({ project, number });
    checkUsageResult(data, project, epoch);
    state.viewer = data.viewer.toLowerCase();
    state.detail = data;
  }, { showDetail: true });
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
  if (!pendingNavigation) return;
  const route = pendingNavigation;
  const other = route.project && route.project !== currentProjectId;
  const label = viewTitle(route.project || currentProjectId, route.view);
  say('navigation-message', other
    ? '网页请求打开「' + label + '」。切换到「' + nameOf(route.project) + '」后，当前写的修改说明和更新预览不会保留。'
    : '网页请求打开「' + label + '」。');
  say('navigation-caption', other ? '确认后会先切换 Skill，再打开页面。' : '已写的修改说明和正在查看的改动会保留。');
  say('accept-navigation', other ? '切换' : '前往');
  disable('accept-navigation', Boolean(busy || !pendingNavigation));
}

function openNavigation(view) {
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
    message('updates-entry-notice', withName('正在检查', '文件夹。', '正在检查 Skill 文件夹。'));
    return;
  }
  locateTeamUpdates();
}

function locateTeamUpdates() {
  if (!account()?.bound) {
    message('updates-entry-notice', '请先选择现在用的 SKILL.md，再在工作台查看团队更新。');
    return;
  }
  selectWorkTab('updates', 'team-updates-title');
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

function acceptedRoute(route) {
  if (!route || typeof route !== 'object') return null;
  if (!['workspace', 'docs', 'updates'].includes(route.view)) return null;
  const project = typeof route.project === 'string' ? route.project : 'fva';
  if (project !== 'fva' && !catalog.some((item) => item.id === project)) return null;
  return { project, view: route.view };
}

function navigationWaiting() {
  if (busy || initializing) return true;
  if (typeof api?.projects === 'function' && !catalogReady) return true;
  return false;
}

async function receiveNavigation() {
  if (!navigationReady || !navigationRequested || readingNavigation || navigationWaiting() || pendingNavigation || pendingProjectSwitch || !api?.takeNavigation) return;
  navigationRequested = false;
  readingNavigation = true;
  const needsConfirmation = navigationNeedsConfirmation;
  navigationNeedsConfirmation = false;
  try {
    const route = acceptedRoute(await api.takeNavigation());
    if (!route) return;
    navigationRequested = true;
    const other = route.project !== currentProjectId;
    if (needsConfirmation || (busy && !initializing) || hasNavigationDraft() || (other && hasSwitchLoss())) {
      navigationNeedsConfirmation = true;
      pendingNavigation = route;
      renderNavigation();
    } else if (other) {
      void switchToProject(route.project, route.view);
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
  const route = pendingNavigation;
  pendingNavigation = undefined;
  renderNavigation();
  if (route.project && route.project !== currentProjectId) void switchToProject(route.project, route.view);
  else openNavigation(route.view);
  void receiveNavigation();
});
id('dismiss-navigation').addEventListener('click', () => {
  pendingNavigation = undefined;
  renderNavigation();
  void receiveNavigation();
});

for (const field of ['title', 'tool', 'text']) {
  id('usage-' + field).addEventListener(field === 'tool' ? 'change' : 'input', (event) => {
    const state = usageState();
    if (!state || busy) return;
    state[field] = event.target.value;
    renderUsageForm();
  });
}
id('usage-import').addEventListener('click', () => runUsage('导入聊天文本', async (state, project, epoch) => {
  if (state.text) throw new Error('已有聊天内容。请先复制备份或清空，再导入。');
  const value = await api.usageImport({ project });
  if (!value) return;
  checkUsageResult(value, project, epoch, false);
  state.text = value.text;
  state.success = '文本已放入编辑区。确认后请点「保存给团队」。';
}, { remote: false }));
id('usage-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (id('usage-save').disabled) return;
  return runUsage('保存使用记录', async (state, project, epoch) => {
    const value = await api.usageSave({ project, title: state.title.trim(), tool: state.tool, text: state.text });
    checkUsageResult(value, project, epoch);
    const hasFirstPage = state.viewer === usageViewer() && state.page === 1 && state.items && !state.incomplete;
    const items = hasFirstPage ? state.items : [];
    Object.assign(state, { viewer: value.viewer.toLowerCase(), title: '', tool: '', text: '', detail: value, page: 1,
      items: [value, ...items.filter((record) => record.number !== value.number)].slice(0, 20),
      hasNext: Boolean(hasFirstPage && (state.hasNext || items.length === 20)), incomplete: !hasFirstPage,
      success: '已保存。能访问当前私有仓库的团队成员现在可以查看这条记录。' });
  }, { showDetail: true });
});
id('usage-refresh').addEventListener('click', () => readUsagePage(usageState()?.page || 1));
id('usage-prev').addEventListener('click', () => readUsagePage((usageState()?.page || 1) - 1));
id('usage-next').addEventListener('click', () => readUsagePage((usageState()?.page || 1) + 1));
id('usage-open').addEventListener('click', () => runUsage('在浏览器打开使用记录', (state, project) => {
  if (!state.detail || state.viewer !== usageViewer()) return;
  return api.usageOpen({ project, number: state.detail.number });
}));

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
    selectWorkTab('updates', 'updates-title');
    return;
  }
  if (!api.bindWorkspace) {
    notice('客户端暂时无法选择 SKILL.md。请重新打开后再试。');
    return;
  }
  bindWorkspace();
});
id('flow-toggle').addEventListener('click', () => {
  flowExpanded = !flowExpanded;
  renderWorkflow();
});
id('step-review').addEventListener('click', () => {
  if (!canUseWorkflow() || !guideWorkflowAccess() || guidePendingWork()) return;
  if (!account()?.bound) {
    notice('请先选择现在用的 SKILL.md，再查看要发给团队的改动。');
    focusWorkflowHero();
    return;
  }
  selectWorkTab('changes', 'changes-title');
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
    return withName('可以开始下一轮了。继续用原来的', '文件夹，并查看本次全部改动。', '可以开始下一轮了。继续用原来的 Skill 文件夹，并查看本次全部改动。');
  }
  return '旧文件已保留在 ' + previousPath + '。现在可以选择 SKILL.md。';
}));
id('check-review').addEventListener('click', () => {
  const epoch = projectEpoch;
  const projectId = currentProjectId;
  return run('查询审核结果', async () => {
    const next = await api.reviewStatus();
    if (staleResult(epoch, projectId, next)) return;
    review = next;
    return '审核进度已刷新。';
  });
});
id('update-workspace').addEventListener('click', () => {
  const epoch = projectEpoch;
  const projectId = currentProjectId;
  return run('检查团队更新', async () => {
    clearUpdatePreview();
    const result = await api.updateWorkspace();
    if (staleResult(epoch, projectId, result)) return;
    if (!result?.readOnly || !Array.isArray(result.files) ||
        (result.canApply && typeof result.previewId !== 'string')) throw new Error('无法读取团队更新，请重试。');
    setWorkspace(result.workspace);
    showTeamUpdates(result);
  });
});
id('close-update').addEventListener('click', () => {
  if (busy) return;
  clearUpdatePreview();
  render();
  id('update-workspace').focus({ preventScroll: true });
});
id('apply-update').addEventListener('click', () => run('更新文件夹', async () => {
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
for (const tab of workTabs) {
  tab.addEventListener('click', () => selectWorkTab(tab.dataset.workTab));
  tab.addEventListener('keydown', (event) => navigateWorkTabs(event, tab));
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

function icon(ref) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS ? document.createElementNS(ns, 'svg') : document.createElement('svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS ? document.createElementNS(ns, 'use') : document.createElement('use');
  use.setAttribute('href', ref);
  svg.append(use);
  return svg;
}

function docRow(item) {
  const row = document.createElement('li');
  row.dataset.docCategory = item.category;
  row.setAttribute('data-doc-category', item.category);
  const button = document.createElement('button');
  button.type = 'button';
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = item.title;
  const summary = document.createElement('small');
  summary.textContent = item.summary;
  const source = document.createElement('small');
  source.className = 'doc-source';
  source.textContent = item.source;
  copy.append(title, summary, source);
  if (item.external) {
    button.dataset.external = item.external;
    button.dataset.docItem = '1';
    button.setAttribute('data-external', item.external);
    button.addEventListener('click', () => run('打开浏览器', () => api.openExternal(button.dataset.external || button.getAttribute('data-external')).then(() => '')));
    externalButtons.push(button);
    button.append(icon('#i-file'), copy, icon('#i-external'));
  } else {
    button.dataset.localView = item.local;
    button.setAttribute('data-local-view', item.local);
    button.addEventListener('click', () => openNavigation(item.local));
    button.append(icon('#i-help'), copy, icon('#i-arrow'));
  }
  row.append(button);
  docRows.push(row);
  return row;
}

function renderDocuments() {
  externalButtons = externalButtons.filter((button) => button.dataset.docItem !== '1');
  docRows = [];
  const fragment = document.createDocumentFragment();
  fragment.append(docRow({
    category: 'guide', local: 'help',
    title: '第一次参与', summary: '登录、选择 SKILL.md、发改动、查看结果。', source: '客户端使用帮助',
  }));
  const project = catalog.find((item) => item.id === currentProjectId);
  for (const doc of project?.docs || []) {
    if (!doc || typeof doc.key !== 'string' || typeof doc.title !== 'string') continue;
    fragment.append(docRow({
      category: doc.category || 'project', external: doc.key,
      title: doc.title, summary: doc.summary || '', source: (doc.path || doc.title) + ' · 浏览器原文',
    }));
  }
  id('doc-list').replaceChildren(fragment);
  filterDocuments();
}

function applyChrome() {
  const name = projectName();
  say('work-eyebrow', name ? spaced('我的', name) : '你的 Skill');
  say('work-heading', name ? spaced('', name, '共创工作台') : '共创工作台');
  say('work-intro', name ? spaced('修改原来的', name, '文件，检查后发给团队审核。') : '修改原来的 Skill 文件，检查后发给团队审核。');
  say('previous-folder-label', name ? spaced('打开', name, '文件夹') : '打开文件夹');
  id('workspace-tablist').setAttribute('aria-label', name ? spaced('', name, '工作台') : '工作台');
  say('team-updates-title', name ? spaced('更新我的', name) : '更新我的 Skill');
  say('apply-update-label', name ? spaced('更新我的', name) : '更新我的 Skill');
  say('workspace-path-label', name ? spaced('正在使用的', name) : '正在使用的 Skill');
  say('team-eyebrow', name ? name + ' · 团队项目' : '团队项目');
  say('team-intro', name ? spaced('查看', name, '的团队文件、待审核的修改和讨论。') : '查看团队文件、待审核的修改和讨论。');
  say('docs-eyebrow', name ? '团队项目 / ' + name : '团队项目');
  say('docs-title', name ? spaced('', name, '资料目录') : '资料目录');
  say('help-update-text', name
    ? spaced('点「刷新审核进度」看结果。要更新自己的', name, '，先看哪些文件会变，再确认。需要时可以恢复更新前的文件。')
    : '点「刷新审核进度」看结果。要更新自己的 Skill，先看哪些文件会变，再确认。需要时可以恢复更新前的文件。');
  say('footer-skill', projectFullName() ? projectFullName() + ' Skill' : '你的 Skill');
  if (catalog.length && docsProject !== currentProjectId) {
    docsProject = currentProjectId;
    renderDocuments();
  }
}

function renderSkillSwitch() {
  const box = id('skill-switch');
  const signature = catalog.map((item) => item.id).join('\n');
  if (box.getAttribute('data-signature') !== signature) {
    box.setAttribute('data-signature', signature);
    box.replaceChildren();
    for (const project of catalog) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skill-option';
      button.textContent = project.name;
      button.dataset.projectId = project.id;
      button.addEventListener('click', () => requestProjectSwitch(project.id));
      box.append(button);
    }
  }
  for (const button of box.children) {
    const on = button.dataset.projectId === currentProjectId;
    button.disabled = Boolean(busy) || !catalogReady || typeof api?.selectProject !== 'function';
    button.setAttribute('aria-pressed', String(on));
    if (on) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

function hasSwitchLoss() {
  return Boolean(id('submit-title').value.trim() || updatePreview ||
    summaries.some((button) => button.getAttribute('aria-expanded') === 'true'));
}

function requestProjectSwitch(nextId) {
  if (busy || !nextId || nextId === currentProjectId) return;
  if (catalog.length && !catalog.some((item) => item.id === nextId)) return;
  if (hasSwitchLoss()) {
    pendingProjectSwitch = nextId;
    say('project-switch-message', '切换到「' + nameOf(nextId) + '」后，当前写的修改说明和更新预览不会保留。');
    show('project-switch-request', true);
    disable('accept-project-switch', false);
    disable('dismiss-project-switch', false);
    return;
  }
  return switchToProject(nextId);
}

async function switchToProject(nextId, view) {
  if (busy || !nextId || nextId === currentProjectId) return;
  if (catalog.length && !catalog.some((item) => item.id === nextId)) return;
  const known = catalog.find((item) => item.id === nextId);
  await run('切换 Skill', async () => {
    await api.selectProject(nextId);
    projectEpoch += 1;
    currentProjectId = nextId;
    renderUsage();
    review = undefined;
    clearPreview();
    clearUpdatePreview();
    id('submit-title').value = '';
    const loaded = await fetchStatus();
    if (loaded && canWork() && account()?.bound && !account()?.pending && !status?.recoveryRequired) await optional(fetchChanges);
    if (view) openNavigation(view);
    return '已切换到「' + (known?.name || projectName()) + '」。';
  });
}

async function loadProjects() {
  if (typeof api?.projects !== 'function') return;
  try {
    const payload = await api.projects();
    if (payload && Array.isArray(payload.projects)) {
      catalog = payload.projects.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string');
      if (typeof payload.activeProject === 'string' && catalog.some((item) => item.id === payload.activeProject)) {
        currentProjectId = payload.activeProject;
      }
    }
  } catch (error) {
    displayError(error);
  } finally {
    catalogReady = true;
  }
}

id('accept-project-switch').addEventListener('click', () => {
  if (!pendingProjectSwitch || busy) return;
  const nextId = pendingProjectSwitch;
  pendingProjectSwitch = '';
  show('project-switch-request', false);
  return switchToProject(nextId);
});
id('dismiss-project-switch').addEventListener('click', () => {
  if (busy) return;
  pendingProjectSwitch = '';
  show('project-switch-request', false);
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
  window.addEventListener('focus', remindRefreshOnFocus);
  run('检查工作台', async () => {
    await loadProjects();
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
