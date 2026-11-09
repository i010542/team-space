import Link from "next/link";
import { ArrowRight, ArrowUpRight, GitBranch, GitPullRequest } from "lucide-react";
import { documents, projects, steps } from "./catalog";
import { BranchArt, DocumentRow, ProjectCard, SectionHeading, Shell } from "./ui";

export default function Home() {
  return (
    <Shell section="home">
      <section className="hero" aria-labelledby="welcome">
        <BranchArt />
        <div className="hero-content">
          <p className="eyebrow"><span />团队工作台</p>
          <h1 id="welcome">团队共创空间</h1>
          <p className="hero-description">查找团队的 Skill 项目与资料。<br />从自己的分支出发，把改动交给团队评审。</p>
          <div className="hero-actions">
            <Link href="/projects" className="button button-light">浏览 Skill 项目<ArrowRight size={16} aria-hidden /></Link>
            <Link href="/guide" className="button button-outline">协作指南<ArrowUpRight size={15} aria-hidden /></Link>
          </div>
        </div>
      </section>

      <div className="home-grid">
        <section aria-label="Skill 项目">
          <SectionHeading title="Skill 项目" href="/projects" link="查看全部">从这里进入项目资料、仓库和评审。</SectionHeading>
          {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </section>
        <section aria-label="团队协作流程">
          <SectionHeading title="团队协作" href="/guide" link="完整指南">每次改动有分支，每次合并有评审。</SectionHeading>
          <div className="workflow-card card">
            <div className="workflow-intro"><span className="doc-icon"><GitPullRequest size={17} aria-hidden /></span><strong>从分支到合并</strong></div>
            <ol className="workflow-list">
              {steps.map((step, index) => <li key={step.title}><span className="step-number">{String(index + 1).padStart(2, "0")}</span><strong>{step.title}</strong><small>{step.short}</small></li>)}
            </ol>
          </div>
        </section>
      </div>

      <section className="home-docs" aria-label="常用文档">
        <SectionHeading title="常用资料" href="/docs" link="浏览文档">阅读站内指南，或前往 GitHub 查阅项目原文。</SectionHeading>
        <ul className="card doc-list">{documents.slice(0, 3).map((document) => <DocumentRow key={document.id} document={document} />)}</ul>
      </section>
      <p className="source-note"><GitBranch size={16} aria-hidden />本站未接入实时 GitHub 数据。分支、PR 与 Issues 的当前状态可在仓库查看。</p>
    </Shell>
  );
}


