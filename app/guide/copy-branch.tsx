"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { exampleBranch } from "../catalog";

export function CopyBranch() {
  const [result, setResult] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(exampleBranch);
      setResult("已复制");
    } catch {
      setResult("剪贴板不可用，请选中分支名手动复制。");
    }
  }

  return (
    <div className="copy-branch">
      <code>{exampleBranch}</code>
      <button type="button" aria-label="复制分支名示例" onClick={copy}><Copy size={14} aria-hidden />复制</button>
      <span role="status">{result}</span>
    </div>
  );
}

