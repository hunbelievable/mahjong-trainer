import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mahjong Trainer",
  description: "American Mahjong learning tool",
};

const NAV_LINKS = [
  { href: "/",           label: "Home"       },
  { href: "/live",       label: "Live"       },
  { href: "/simulation", label: "Simulation" },
  { href: "/observe",    label: "Observe"    },
  { href: "/study",      label: "Study"      },
  { href: "/stats",      label: "Stats"      },
  { href: "/patterns",   label: "Patterns"   },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-1 text-sm">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-1 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors font-medium"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {children}
      </body>
    </html>
  );
}
