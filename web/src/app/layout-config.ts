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

export const APP_VERSION = "v0.1.2";

export const footerLinks: FooterLink[] = [
  { id: "x", label: "X", href: "https://x.com/defirecipes" },
  { id: "discord", label: "Discord", href: "https://discord.gg/BRHdeUnAq" },
  { id: "github", label: "GitHub", href: "https://github.com/levantuy" },
  { id: "documentation", label: "Documentation", href: "https://docs.defirecipes.com" },
];

export const accountMenuLinks: AccountLink[] = [
  { id: "account-info", label: "Profile Settings", to: "/profile" },
  { id: "preferences", label: "Notification Preferences", to: "/profile?tab=notifications" },
];
