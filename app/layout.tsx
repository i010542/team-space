import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "团队共创空间", template: "%s · 团队共创空间" },
  description: "下载或打开团队共创空间 Windows 客户端。",
  icons: { icon: (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}


