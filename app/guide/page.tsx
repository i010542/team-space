import { ArrowUpRight } from "lucide-react";
import { repo, steps } from "../catalog";
import { External, Heading, ReviewChecklist, SectionHeading, Shell } from "../ui";
import { CopyBranch } from "./copy-branch";

export const metadata = { title: "协作指南" };

const desktopSteps = [
  <>用有权限的账号登录 GitHub Desktop。首次使用，打开 <strong>File → Clone repository</strong>，选择团队仓库并克隆。通过 <strong>Current Branch</strong> 切到默认分支，拉取最新版本，再点 <strong>New Branch</strong> 新建自己的分支。</>,
  <>在本地编辑器修改文件。回到 GitHub Desktop 的 <strong>Changes</strong> 检查差异，填写 <strong>Summary</strong> 并提交。首次用 <strong>Publish branch</strong> 发布分支，后续用 <strong>Push origin</strong> 推送。</>,
  <>推送后打开 <strong>Preview Pull Request</strong>，再点 <strong>Create Pull Request</strong>。在 GitHub 网页核对来源分支和目标分支，写明改动和验证方式，并邀请队友评审。</>,
  <>按项目说明运行相关检查，并用代表性输入验证 Skill 行为。把通过、失败或未验证的项目写入 PR。根据评审意见在同一个分支继续提交和推送。</>,
  <>等评审意见和所需检查都处理完成，由有权限的协作者按仓库规则合并。合并后切回默认分支并拉取最新版本。</>,
];

export default function Guide() {
  return (
    <Shell section="guide">
      <Heading eyebrow="共创入门" title="第一次参与 Skill 共创">每位协作者在自己的分支工作，在 GitHub 通过 PR 提交评审，审核通过后再合并。</Heading>
      <dl className="card glossary">
        <div><dt>分支 · Branch</dt><dd>为本次改动开的独立工作线。</dd></div>
        <div><dt>提交 · Commit</dt><dd>记录一组改动和改动原因。</dd></div>
        <div><dt>合并请求 · PR</dt><dd>让队友审阅改动，申请合入目标分支。</dd></div>
      </dl>
      <div className="guide-layout">
        <section aria-label="使用 GitHub Desktop">
          <SectionHeading title="使用 GitHub Desktop">准备好仓库权限后，按下面的步骤完成一次协作。</SectionHeading>
          <ol className="guide-steps" aria-label="协作步骤">
            {steps.map((step, index) => (
              <li className="card guide-step" key={step.title}>
                <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{desktopSteps[index]}</p>
                  {index === 0 && <><p>分支名可用「成员名/任务名」，复制后换成自己的名字和任务。</p><CopyBranch /></>}
                  {step.code && <details className="command-option"><summary>命令行做法（可选）</summary><pre><code>{step.code}</code></pre></details>}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <aside>
          <div className="card review-card">
            <SectionHeading title="合并前检查" />
            <ReviewChecklist />
            <External href={repo + "/pulls"} className="text-link">打开 FVA 的 PR<ArrowUpRight size={16} aria-hidden /></External>
          </div>
          <div className="guide-source">
            <External href="https://docs.github.com/en/desktop/making-changes-in-a-branch" className="quiet-link">GitHub Desktop 官方说明<ArrowUpRight size={14} aria-hidden /></External>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

