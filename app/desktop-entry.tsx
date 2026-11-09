"use client";

import { useState } from "react";
import { Download, Monitor } from "lucide-react";
import { desktopDownload, desktopLinks, desktopVersion } from "./catalog";

const labels = {
  workspace: "在本地客户端打开 FVA",
  docs: "在本地客户端查看 FVA 资料",
  updates: "在本地客户端查看团队更新",
};

export function DesktopEntry({ view = "workspace" }: { view?: keyof typeof desktopLinks }) {
  const [requested, setRequested] = useState(false);

  return (
    <div className="desktop-entry" data-desktop-view={view}>
      <div className="desktop-actions">
        <a href={desktopLinks[view]} className="button button-light" onClick={() => setRequested(true)}>
          <Monitor size={16} aria-hidden />{labels[view]}
        </a>
        <a href={desktopDownload} className="button button-outline"><Download size={16} aria-hidden />首次使用：下载 Windows 客户端</a>
      </div>
      <div role="status">
        {requested && <p className="desktop-fallback">
          浏览器可能会询问是否允许打开客户端。如果没有提示或客户端没有打开，请<a href={desktopDownload}>下载或升级 Windows 客户端 {desktopVersion}</a>。
        </p>}
      </div>
    </div>
  );
}
