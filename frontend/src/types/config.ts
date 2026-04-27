export interface SiteConfig {
  appName: string;
  shortName: string;
  siteDomain: string;
  allowedEmailDomains: string[];
  siteSubtitle: string;
  themeColor: string;
  logoUrl: string;
  defaultSkinUrl: string;
  emailWebmailUrl?: string;
}

export function defineSiteConfig(config: SiteConfig) {
  return config;
}
