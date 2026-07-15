import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company RAG Assistant",
  description: "Private AI assistant for company documents",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Added a root wrapper for better structure */}
        <div id="root">
          {children}
        </div>
      </body>
    </html>
  );
}