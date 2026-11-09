import { documents, defaultBranch } from "../../catalog";
import { AccessNote, BackLink, DocumentRow, Heading, RepositoryLinks, SectionHeading, Shell } from "../../ui";

export const metadata = { title: "FVA" };

export default function Fva() {
  return (
    <Shell section="projects" title="FVA">
      <BackLink />
      <Heading eyebrow="短视频创作 Skill" title="FVA">拆解参考视频，辅助制作，并记录可以复用的经验。</Heading>
      <dl className="card repository-meta">
        <div><dt>仓库</dt><dd>i010542/fva</dd></div>
        <div><dt>默认分支</dt><dd><code>{defaultBranch}</code></dd></div>
        <div><dt>访问范围</dt><dd>私有仓库</dd></div>
      </dl>
      <section className="subsection" aria-label="仓库入口">
        <SectionHeading title="仓库入口">代码、分支和讨论均在 GitHub 查看。</SectionHeading>
        <RepositoryLinks />
        <AccessNote />
      </section>
      <section className="subsection" aria-label="FVA 文档">
        <SectionHeading title="FVA 文档" href="/docs" link="文档资料" />
        <ul className="card doc-list">{documents.filter(({ id }) => id !== "guide").map((document) => <DocumentRow key={document.id} document={document} />)}</ul>
      </section>
    </Shell>
  );
}

