import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Fira_Code } from "next/font/google";
import "./globals.css";
import DevelopmentLocatorOverlay from "@/components/DevelopmentLocatorOverlay";
import { Providers } from "@/components/providers";
import { DevelopmentSessionGuard } from "@/components/shared/DevelopmentSessionGuard";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});
const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-fira-code",
});

export const metadata: Metadata = {
  title: "Kolam Ikan - Your Personal Thinking Environment",
  description:
    "An inventor's logbook that combines chronological momentum with evolving documentation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${firaCode.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <DevelopmentLocatorOverlay />
        <Providers>
          <DevelopmentSessionGuard />
          {children}
        </Providers>
      </body>
    </html>
  );
}
