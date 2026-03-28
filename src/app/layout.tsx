import type { Metadata } from "next";
import { Rajdhani, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const rajdhani = Rajdhani({
  weight: ["400", "600", "700"],
  variable: "--font-rajdhani",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NEXUS — AI Market Intelligence",
  description: "Real-time AI prediction dashboard — crypto, signals, prediction markets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${rajdhani.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ background: "#05070D", color: "#F1F5F9" }}>
        {children}
      </body>
    </html>
  );
}
