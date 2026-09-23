import type { Metadata } from "next";
import { DM_Sans, Lora } from "next/font/google";
import "./globals.css";

const bodyFont = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Lora({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "SyncBooks | Bookkeeping for Australian businesses",
  description:
    "Get matched with experienced local or overseas bookkeepers who understand your business, software, and day-to-day operations.",
  openGraph: {
    title: "SyncBooks | Bookkeeping for Australian businesses",
    description:
      "Flexible bookkeeping support matched to your business, from weekly reconciliations to payroll and month-end reporting.",
    type: "website",
    locale: "en_AU",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        {children}
      </body>
    </html>
  );
}
