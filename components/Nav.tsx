"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/",           label: "Home"       },
  { href: "/live",       label: "Live"       },
  { href: "/simulation", label: "Simulation" },
  { href: "/observe",    label: "Observe"    },
  { href: "/study",       label: "Study"       },
  { href: "/stats",       label: "Stats"       },
  { href: "/patterns",    label: "Patterns"    },
  { href: "/multiplayer", label: "Multiplayer" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const linkClass = (href: string) => {
    const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
    return `px-3 py-1.5 rounded transition-colors font-medium ${
      active
        ? "bg-gray-900 text-white"
        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
    }`;
  };

  return (
    <nav className="bg-white border-b border-gray-200 text-sm relative">
      <div className="px-4 py-2 flex items-center justify-between">
        {/* Brand — visible on mobile only */}
        <Link
          href="/"
          className="sm:hidden font-bold text-gray-900"
          onClick={() => setOpen(false)}
        >
          Mahjong Trainer
        </Link>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-1">
          {NAV_LINKS.map(link => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
              {link.label}
            </Link>
          ))}
        </div>

        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label="Toggle menu"
          className="sm:hidden p-2 -mr-2 rounded text-gray-700 hover:bg-gray-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            {open ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </>
            ) : (
              <>
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown panel */}
      {open && (
        <div className="sm:hidden border-t border-gray-200 bg-white absolute left-0 right-0 top-full shadow-md z-50">
          <div className="flex flex-col p-2">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={linkClass(link.href) + " text-base"}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
