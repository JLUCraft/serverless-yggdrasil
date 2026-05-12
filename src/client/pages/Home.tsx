import { A } from '@solidjs/router';
import siteConfig from '../../../site.config.json';

export default function Home() {
  return (
    <div class="relative flex flex-col items-center justify-center min-h-[85vh] py-16 px-4 overflow-hidden">
      <div class="relative z-10 text-center max-w-4xl w-full animate-fade-in mt-8">
        <div class="flex justify-center mb-8">
          <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-20 h-20 md:w-24 md:h-24 object-contain drop-shadow-lg" />
        </div>

        <h1 class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-base-content via-primary to-base-content/70 tracking-tighter leading-tight mb-5">
          {siteConfig.appName}
        </h1>

        <p class="text-base md:text-xl text-base-content/60 font-light max-w-2xl mx-auto leading-relaxed mb-10 tracking-wide">
          {siteConfig.siteSubtitle}
        </p>

        <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <A href="/login" class="group relative px-8 py-3 w-full sm:w-auto text-base font-bold text-white overflow-hidden rounded shadow-glass-button hover:shadow-glass-button-lg transition-all duration-200 hover:-translate-y-0.5">
            <div class="absolute inset-0 bg-primary transition-all duration-300 group-hover:opacity-90"></div>
            <span class="relative flex items-center justify-center gap-2">
              进入系统
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            </span>
          </A>

          <a href="https://github.com/JLUCraft/serverless-yggdrasil" target="_blank" class="px-8 py-3 w-full sm:w-auto rounded bg-base-100 border border-base-300 text-base-content/80 font-semibold hover:bg-base-200 hover:text-primary shadow-panel hover:shadow-panel-md transition-all duration-200 flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.2c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
              GitHub 仓库
            </a>
        </div>
      </div>

      {}
      <div class="absolute bottom-0 left-0 w-full h-[40vh] bg-[linear-gradient(to_right,oklch(var(--p)/0.05)_1px,transparent_1px),linear-gradient(to_bottom,oklch(var(--p)/0.05)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:linear-gradient(to_bottom,transparent,black)] -z-10 transform perspective-[1000px] rotateX-[60deg] origin-bottom scale-150"></div>
    </div>
  );
}
