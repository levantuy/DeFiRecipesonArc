import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Svg({ className, children, viewBox = "0 0 24 24" }: IconProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function FooterLinkIcon({ id, className }: { id: string; className?: string }) {
  if (id === "github") {
    return (
      <Svg className={className} viewBox="0 0 24 24">
        <path d="M9 19c-4 1.5-4-2-6-2" />
        <path d="M15 22v-3.9c0-1.1.1-1.9-.5-2.6 2.3-.3 4.7-1.1 4.7-5.2A4 4 0 0 0 18 7.5 3.7 3.7 0 0 0 17.9 5S16.8 4.7 15 6a10.3 10.3 0 0 0-6 0C7.2 4.7 6.1 5 6.1 5A3.7 3.7 0 0 0 6 7.5a4 4 0 0 0-1.2 2.8c0 4.1 2.4 4.9 4.7 5.2-.6.7-.6 1.6-.6 2.6V22" />
      </Svg>
    );
  }
  if (id === "discord") {
    return (
      <Svg className={className} viewBox="0 0 24 24">
        <path d="M7.8 7.3A15 15 0 0 1 12 6c1.4 0 2.8.3 4.2 1.3" />
        <path d="M7 17c2.3 1.7 7.7 1.7 10 0" />
        <path d="M5.7 8.3A15.8 15.8 0 0 0 4 15.1 12.9 12.9 0 0 0 7 18c.8-.4 1.5-.8 2.2-1.3" />
        <path d="M18.3 8.3A15.8 15.8 0 0 1 20 15.1 12.9 12.9 0 0 1 17 18c-.8-.4-1.5-.8-2.2-1.3" />
        <circle cx="9" cy="12" r="1" />
        <circle cx="15" cy="12" r="1" />
      </Svg>
    );
  }
  if (id === "facebook") {
    return (
      <Svg className={className} viewBox="0 0 24 24">
        <path d="M14 8h3V4h-3c-2.2 0-4 1.8-4 4v3H7v4h3v5h4v-5h3l1-4h-4V8a1 1 0 0 1 1-1" />
      </Svg>
    );
  }
  if (id === "x") {
    return (
      <Svg className={className} viewBox="0 0 24 24">
        <path d="m4 4 6.7 8.9L4.5 20h3.1l4.6-5.3L16.2 20H20l-6.9-9.2L19 4h-3.1l-4.2 4.9L7.9 4z" />
      </Svg>
    );
  }
  return (
    <Svg className={className}>
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v6h-6" />
      <path d="M4 10V4h6" />
      <path d="M4 20v-6" />
    </Svg>
  );
}
