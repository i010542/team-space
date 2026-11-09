import { ArrowUpRight } from "lucide-react";
import { steps, websiteSource } from "../catalog";
import { DesktopDownload, External, Heading, SectionHeading, Shell } from "../ui";

export const metadata = { title: "协作指南" };

export default function Guide() {
  return (
    <Shell section="guide">
      <Heading eyebrow="共创入门" title="用 Windows 客户端参与 FVA">安装团队共创空间客户端，完成从本地编辑到提交审核的三个步骤。</Heading>
      <div className="guide-layout">
        <section aria-label="使用客户端">
          <SectionHeading title="开始协作" />
          <ol className="guide-steps" aria-label="协作步骤">
            {steps.map((step, index) => (
              <li className="card guide-step" key={step.title}>
                <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
              </li>
            ))}
          </ol>
        </section>
        <aside className="card review-card" aria-label="客户端入口">
          <SectionHeading title="Windows 客户端">绑定正在使用的 FVA，支持单个不超过 1 MB 的 UTF-8 文本文件。检查团队更新后，可选择冲突内容，备份并更新自己的 FVA；也可恢复更新前的文件。</SectionHeading>
          <DesktopDownload />
          <div className="guide-source">
            <External href={websiteSource} className="quiet-link">查看网站源码<ArrowUpRight size={14} aria-hidden /></External>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
