import Link from "next/link";
import { notFound } from "next/navigation";
import { DesktopEntry } from "../../desktop-entry";

const guides = {
  files: {title:"查看团队文件", intro:"这里看的是团队已经采用的正式版本。想知道 FVA 现在包含什么，就从这里开始。", steps:["点击下面的按钮，用团队已开通权限的 GitHub 账号登录。", "点击文件夹或文件名查看内容；SKILL.md 是这份 Skill 的主要说明。", "想修改时，回到客户端打开自己的 FVA 文件夹，改好后发给团队审核。"], button:"去 GitHub 查看团队文件", path:""},
  versions: {title:"大家的修改版本", intro:"每个人可以单独保存一份修改。GitHub 把这些版本叫作“分支”，它们不一定已经被团队采用。", steps:["打开版本列表，找到你想看的成员或任务名称。", "点击名称，查看这一份版本里的文件；列表也可能包含已经结束的任务。", "想看哪些修改正在等待团队处理，请到“待审核的修改”。"], button:"去 GitHub 查看修改版本", path:"/branches"},
  reviews: {title:"待审核的修改", intro:"同事发来修改后，团队会在这里查看、留言和决定是否采用。GitHub 把一次这样的审核叫作 Pull request，简称 PR。", steps:["打开列表，点击一条修改标题。Open 表示还没处理完，Closed 中也包含已采用的记录。", "Conversation 是说明与留言，Files changed 可以查看改了哪些内容。", "需要补充时，回到原 FVA 文件夹修改，再通过客户端发送。只有维护者确认合并后，修改才进入正式版本。"], button:"去 GitHub 查看待审核修改", path:"/pulls"},
  suggestions: {title:"提问题或建议", intro:"遇到问题、想到改进方法，或者希望团队补充内容，都可以在这里记录。GitHub 把这类记录叫作 Issue。", steps:["先看看有没有类似的问题，避免重复提出。", "有相同问题时可以在已有记录下留言；新问题点击 New issue。", "标题写清楚想解决什么，正文说明使用场景、遇到的情况和你的建议，再提交。"], button:"去 GitHub 提问题或建议", path:"/issues"},
} as const;
export function generateStaticParams(){return Object.keys(guides).map(topic=>({topic}));}
export const dynamicParams=false;
export default async function Guide({params}:{params:Promise<{topic:string}>}){
 const {topic}=await params;if(!(topic in guides))notFound();const guide=guides[topic as keyof typeof guides];
 return <><header className="site-header"><Link className="brand" href="/">团队共创空间</Link><Link href="/docs/">项目资料</Link></header><main className="content guide-content"><section className="hero"><p className="eyebrow">FVA · 团队协作</p><h1>{guide.title}</h1><p className="hero-description">{guide.intro}</p></section><section className="landing-section"><h2>接下来怎么做</h2><ol className="guide-steps">{guide.steps.map((step,i)=><li className="landing-card" key={step}><span className="step-number">{i+1}</span><p>{step}</p></li>)}</ol><p className="guide-note">下一步会打开 GitHub。需要使用有 FVA 项目权限的账号；如果看不到页面，请确认账号或联系项目负责人。</p><a className="button button-light" href={"https://github.com/i010542/fva"+guide.path} target="_blank" rel="noreferrer">{guide.button} ↗</a></section><nav className="guide-nav" aria-label="团队协作">{Object.entries(guides).map(([key,g])=><Link className="button button-outline" key={key} href={"/team/"+key+"/"} aria-current={key===topic?"page":undefined}>{g.title}</Link>)}</nav><section className="landing-section"><h2>继续修改自己的 FVA</h2><p>回到客户端选择文件、发给团队审核，或获取团队新版。</p><DesktopEntry /></section><footer className="footer">此页说明使用方法，实际文件和审核记录在 GitHub 中查看。</footer></main></>;
}
