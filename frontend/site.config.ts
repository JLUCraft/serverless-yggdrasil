import { defineSiteConfig } from './src/types/config.ts';

export default defineSiteConfig({
  appName: 'JLUCraft Skin Station',
  shortName: 'JLUCraft',
  siteDomain: 'skin.jlucraft.com',
  allowedEmailDomains: ['jlu.edu.cn', 'mails.jlu.edu.cn'],
  siteSubtitle: '吉林大学 Minecraft 社团官方皮肤站',
  themeColor: '#10368A',
  logoUrl: '/logo.png',
  defaultSkinUrl: '/skin.png',
  emailWebmailUrl: 'https://mails.jlu.edu.cn/',
});
