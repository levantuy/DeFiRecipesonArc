export interface FooterLink {
  id: string;
  label: string;
  href: string;
}

export interface AccountLink {
  id: string;
  label: string;
  to?: string;
  disabled?: boolean;
}

export const APP_VERSION = "v0.1.0";

function appLink(envKey: string, fallback: string): string {
  const value = process.env[envKey];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const footerLinks: FooterLink[] = [
  { id: "x", label: "X", href: appLink("NEXT_PUBLIC_APP_LINK_X", "https://x.com/defirecipes") },
  { id: "discord", label: "Discord", href: appLink("NEXT_PUBLIC_APP_LINK_DISCORD", "https://discord.gg/tuylv") },
  { id: "github", label: "GitHub", href: appLink("NEXT_PUBLIC_APP_LINK_GITHUB", "https://github.com/levantuy") },
  { id: "documentation", label: "Documentation", href: appLink("NEXT_PUBLIC_APP_LINK_DOCUMENTATION", "https://docs.defirecipes.com") },
];

export const accountMenuLinks: AccountLink[] = [
  { id: "account-info", label: "Profile Settings", to: "/profile" },
  { id: "preferences", label: "Notification Preferences", to: "/profile?tab=notifications" },
];
