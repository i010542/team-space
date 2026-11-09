import Link from "next/link";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Boxes, ChevronRight,
  CircleHelp, Download, FileText, GitBranch, GitPullRequest, LayoutGrid, LockKeyhole,
  Workflow,
} from "lucide-react";
import { desktopDownload, repo, type DocumentEntry } from "./catalog";

const nav = [
  { id: "home", title: "空间概览", href: "/", icon: LayoutGrid },
  { id: "projects", title: "Skill 项目", href: "/projects", icon: Boxes },
  { id: "docs", title: "文档资料", href: "/docs", icon: BookOpen },
  { id: "guide", title: "协作指南", href: "/guide", icon: GitPullRequest },
];

export function Shell({
  section, title, children,
}: {
  section: (typeof nav)[number]["id"];
  title?: string;
  children: React.ReactNode;
}) {
  const current = nav.find((item) => item.id === section)!;
  return (
    <div className="shell">
      <a className="skip" href="#content">跳到主要内容</a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon"><Workflow size={23} aria-hidden /></span>
          <span><strong>共创空间</strong><small>TEAM WORKSPACE</small></span>
        </Link>
        <p className="nav-label">工作空间</p>
        <nav aria-label="主导航">
          {nav.map(({ id, href, title: label, icon: Icon }) => (
            <Link key={id} href={href} aria-current={id === section && !title ? "page" : undefined} data-active={id === section} className="nav-item">
              <Icon size={17} aria-hidden />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <GitBranch size={17} aria-hidden />
          <div><strong>在 GitHub 协作</strong><p>分支开发 · PR 审核</p></div>
        </div>
      </aside>
      <div className="frame">
        <header className="topbar">
          <nav aria-label="当前位置" className="breadcrumb">
            <Link href="/">工作空间</Link>
            <ChevronRight size={14} aria-hidden />
            {title ? <><Link href={current.href}>{current.title}</Link><ChevronRight size={14} aria-hidden /><span aria-current="page">{title}</span></> : <span aria-current="page">{current.title}</span>}
          </nav>
          <Link href="/guide" className="top-link"><CircleHelp size={16} aria-hidden />如何参与</Link>
        </header>
        <main id="content" className="content" tabIndex={-1}>
          {children}
          <footer className="footer">
            <span>团队共创空间</span>
            <span>资料索引为手动维护 · GitHub 状态请以仓库为准</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

export function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <header className="page-heading"><p className="eyebrow"><span />{eyebrow}</p><h1>{title}</h1><p>{children}</p></header>;
}

export function SectionHeading({ title, children, href, link }: { title: string; children?: React.ReactNode; href?: string; link?: string }) {
  return (
    <div className="section-heading">
      <div><h2>{title}</h2>{children && <p>{children}</p>}</div>
      {href && <Link className="text-link" href={href}>{link}<ArrowRight size={15} aria-hidden /></Link>}
    </div>
  );
}

export function External({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}<span className="sr-only">（在新标签页打开）</span></a>;
}

export function DesktopDownload() {
  return (
    <a href={desktopDownload} className="button button-light">
      <Download size={16} aria-hidden />下载 Windows 客户端
    </a>
  );
}

export function ProjectCard({ project, heading: Title = "h3" }: { heading?: "h2" | "h3"; project: { id: string; title: string; subtitle: string; description: string; repo: string } }) {
  return (
    <article className="project-card card">
      <div className="project-top">
        <div className="project-mark" aria-hidden><span /><span /><span /></div>
        <span className="badge"><LockKeyhole size={12} aria-hidden />私有仓库</span>
      </div>
      <div><Title className="project-title">{project.title} <span>{project.subtitle}</span></Title><p>{project.description}</p></div>
      <div className="project-links">
        <Link href={"/projects/" + project.id} className="text-link">项目详情<ArrowRight size={16} aria-hidden /></Link>
        <External href={project.repo} className="quiet-link">GitHub<ArrowUpRight size={14} aria-hidden /></External>
      </div>
    </article>
  );
}

export function DocumentRow({ document }: { document: DocumentEntry }) {
  const Icon = document.id === "guide" ? BookOpen : FileText;
  const contents = (
    <>
      <span className="doc-icon"><Icon size={17} aria-hidden /></span>
      <span className="doc-text"><strong>{document.title}</strong><small>{document.description}</small></span>
      <span className="doc-source">{document.source}</span>
      {document.href.startsWith("/") ? <ArrowRight size={16} aria-hidden /> : <ArrowUpRight size={16} aria-hidden />}
    </>
  );
  return (
    <li>{document.href.startsWith("/") ? <Link href={document.href} className="document-row">{contents}</Link> : <External href={document.href} className="document-row">{contents}</External>}</li>
  );
}

export function AccessNote() {
  return <div className="access-note"><LockKeyhole size={17} aria-hidden /><p><strong>GitHub 仓库权限</strong><span>站内目录可以直接浏览。打开 FVA 原始资料时，请使用已有仓库访问权限的 GitHub 账号。</span></p></div>;
}

export function BranchArt() {
  return (
    <svg className="branch-art" viewBox="0 0 420 258" fill="none" aria-hidden="true">
      <defs>
        <pattern id="branch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#8eabe0" fillOpacity=".28" />
        </pattern>
        <linearGradient id="art-fade"><stop stopColor="#fff" stopOpacity="0" /><stop offset=".24" stopColor="#fff" /><stop offset=".92" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id="grid-mask"><rect width="420" height="258" fill="url(#art-fade)" /></mask>
      </defs>
      <rect width="420" height="258" fill="url(#branch-grid)" mask="url(#grid-mask)" />
      <path d="M47 165H369" stroke="#a0b6de" strokeOpacity=".44" />
      <path d="M97 165C131 165 126 97 162 97H244C277 97 268 165 310 165" stroke="#2563eb" strokeWidth="2" />
      <path d="M97 165H313" stroke="#2563eb" strokeWidth="2" strokeOpacity=".69" />
      <circle cx="97" cy="165" r="6" fill="#fff" stroke="#2563eb" strokeWidth="2" />
      <circle cx="173" cy="97" r="6" fill="#fff" stroke="#2563eb" strokeWidth="2" />
      <circle cx="310" cy="165" r="15" fill="#2563eb" fillOpacity=".13" />
      <circle cx="310" cy="165" r="7" fill="#2563eb" />
      <rect x="197" y="78" width="68" height="37" rx="9" fill="#f9fbff" stroke="#9bb9f0" />
      <path d="M209 90v14m0-10c0 4 8 0 8 5m-2 4 2 2 2-2" stroke="#2563eb" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="226" y="101" fill="#1d4ed8" fontFamily="monospace" fontSize="12" letterSpacing="1">PR</text>
      <text x="144" y="71" fill="#415b89" fontFamily="monospace" fontSize="11" letterSpacing="1">branch</text>
      <text x="83" y="194" fill="#415b89" fontFamily="monospace" fontSize="11" letterSpacing="1">main</text>
      <text x="290" y="194" fill="#415b89" fontFamily="monospace" fontSize="11" letterSpacing="1">merge</text>
    </svg>
  );
}

export function RepositoryLinks() {
  const links = [
    { title: "仓库首页", detail: "查看代码与资料", href: repo, icon: Boxes },
    { title: "Branches", detail: "查找或对比分支", href: repo + "/branches", icon: GitBranch },
    { title: "Pull Requests", detail: "提交改动与参与评审", href: repo + "/pulls", icon: GitPullRequest },
    { title: "Issues", detail: "讨论任务、建议与问题", href: repo + "/issues", icon: CircleHelp },
  ];
  return <div className="repository-grid">{links.map(({ title, detail, href, icon: Icon }) => (
    <External key={href} href={href} className="repo-card card"><span className="doc-icon"><Icon size={18} aria-hidden /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={16} aria-hidden /></External>
  ))}</div>;
}

export function BackLink() {
  return <Link href="/projects" className="back-link"><ArrowLeft size={16} aria-hidden />返回项目目录</Link>;
}
