import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoSpace · 一起把下一步推进起来",
  description: "团队的共享项目上下文、任务交接与成果验收工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
