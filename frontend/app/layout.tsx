import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "./sw-register";

export const metadata: Metadata = {
  title: "allbele.app",
  description: "Análise de pele com IA",
  manifest: "/manifest.json",
  themeColor: "#D99C94",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "allbele",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <head>
        {/* PWA */}
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {/* All clinic fonts loaded upfront; active font applied via CSS var */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Nunito+Sans:wght@300;400;500;600;700&family=Cormorant+Garamond:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Source+Serif+4:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link href="https://fonts.cdnfonts.com/css/metropolis-2" rel="stylesheet" />
      </head>
      <body
        className="min-h-full flex flex-col"
        style={{ fontFamily: "var(--font-main, 'Inter', system-ui, sans-serif)" }}
      >
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
