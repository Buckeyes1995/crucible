import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { ToastContainer } from "@/components/Toast";
import { RecoveryBanner } from "@/components/RecoveryBanner";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { FirstRunWizard } from "@/components/FirstRunWizard";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Crucible — Local LLM Manager",
  description: "Benchmark and manage local LLMs",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Crucible",
  },
  themeColor: "#4f46e5",
  icons: {
    icon: [
      { url: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: "/icon-192.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex h-full bg-zinc-950 text-zinc-100 antialiased">
        <Sidebar />
        <div className="flex flex-col flex-1 min-h-0">
          <TopBar />
          <RecoveryBanner />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
        <ToastContainer />
        <ShortcutsHelp />
        <FirstRunWizard />
      </body>
    </html>
  );
}
