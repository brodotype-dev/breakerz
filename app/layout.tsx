import type { Metadata, Viewport } from "next";
import { Public_Sans, Roboto_Mono } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "BreakIQ — Stop buying breaks blind.",
  description: "Every break you buy, in one place — research it, log it, learn from it.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://www.getbreakiq.com"),
  applicationName: "BreakIQ",
  appleWebApp: {
    capable: true,
    title: "BreakIQ",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "BreakIQ — Stop buying breaks blind.",
    description: "The break terminal for collectors and pros. Research it, log it, learn from it.",
    type: "website",
    siteName: "BreakIQ",
  },
  twitter: {
    card: "summary_large_image",
    title: "BreakIQ — Stop buying breaks blind.",
    description: "The break terminal for collectors and pros. Research it, log it, learn from it.",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e1a",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${publicSans.variable} ${robotoMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
