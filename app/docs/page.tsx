import { AccessNote, Heading, Shell } from "../ui";
import { DocSearch } from "./doc-search";

export const metadata = { title: "文档资料" };

export default function Docs() {
  return (
    <Shell section="docs">
      <Heading eyebrow="只读资料库" title="文档资料">按标题、文件名和分类查找入门指南及 FVA 的仓库原文。</Heading>
      <DocSearch />
      <AccessNote />
    </Shell>
  );
}

