import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pocket — Every seat has two minds",
  description:
    "A WebMCP-native poker table where personal agents advise and humans play.",
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
