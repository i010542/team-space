import Link from "next/link";
import { BookOpen, GitPullRequest, RefreshCw, Workflow } from "lucide-react";
import { desktopLinks, desktopVersion, steps } from "./catalog";
import { DesktopEntry } from "./desktop-entry";

const features = [
  { name: "项目和资料", detail: "查看 FVA 项目，按关键词或分类查找资料。", icon: BookOpen },
  { name: "改动和审核", detail: "绑定正在使用的 FVA，查看改动、选择文件并提交审核。", icon: GitPullRequest },
  { name: "更新和恢复", detail: "检查团队更新、处理冲突、备份并更新本机文件。", icon: RefreshCw },
];

export function Landing({ view = "workspace", title = "团队共创空间", description = "下载 Windows 客户端，在一个地方查看项目与资料、提交 FVA 改动和安装团队更新。" }: {
  view?: keyof typeof desktopLinks;
  title?: string;
  description?: string;
}) {
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand"><span className="brand-icon"><Workflow size={20} aria-hidden /></span>团队共创空间</Link>
        <span className="version">Windows · {desktopVersion}</span>
      </header>
      <main className="content">
        <section className="hero" aria-labelledby="landing-title">
          <p className="eyebrow">FVA · 团队协作客户端</p>
          <h1 id="landing-title">{title}</h1>
          <p className="hero-description">{description}</p>
          <DesktopEntry view={view} />
        </section>
        <section className="landing-section" aria-labelledby="first-use">
          <h2 id="first-use">第一次使用</h2>
          <ol className="landing-grid">
            {steps.map(({ title, description }, index) => <li className="landing-card" key={title}><span className="step-number">{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{description}</p></li>)}
          </ol>
        </section>
        <section className="landing-section" aria-labelledby="features">
          <h2 id="features">打开客户端后可以做什么</h2>
          <ul className="landing-grid">
            {features.map(({ name, detail, icon: Icon }) => <li className="landing-card" key={name}><Icon size={19} aria-hidden /><h3>{name}</h3><p>{detail}</p></li>)}
          </ul>
        </section>
        <footer className="footer">团队共创空间 · Windows</footer>
      </main>
    </>
  );
}
