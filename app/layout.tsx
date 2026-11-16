import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uchat | UICTO Freshman Assistant",
  description: "Find reviewed UICTO freshman guidance and its sources. A Uchat project by Japfetooo Hub.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
