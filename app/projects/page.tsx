import { projects } from "../catalog";
import { AccessNote, Heading, ProjectCard, Shell } from "../ui";

export const metadata = { title: "Skill 项目" };

export default function Projects() {
  return (
    <Shell section="projects">
      <Heading eyebrow="项目目录" title="Skill 项目">查找团队维护的 Skill，进入项目原文、分支和评审。</Heading>
      <div className="catalog-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} heading="h2" />)}</div>
      <AccessNote />
    </Shell>
  );
}


