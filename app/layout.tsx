import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Storro",
  description: "Production developer memory and publishing platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
