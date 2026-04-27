import { createEffect, onCleanup, onMount } from 'solid-js';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import type { Shape } from '../lib/api';

type ViewerProps = {
  shape: Shape;
  skin: string | null;
  cape: string | null;
};

export default function Viewer(props: ViewerProps) {
  let host: HTMLDivElement | undefined;
  let viewer: SkinViewer | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const syncTextures = async () => {
    if (!viewer) {
      return;
    }
    if (props.skin) {
      await viewer.loadSkin(props.skin, { model: props.shape });
    } else {
      viewer.loadSkin(null);
    }
    if (props.cape) {
      await viewer.loadCape(props.cape);
      return;
    }
    viewer.loadCape(null);
  };

  const resize = () => {
    if (!viewer || !host) {
      return;
    }
    const { clientWidth, clientHeight } = host;
    if (!clientWidth || !clientHeight) {
      return;
    }
    viewer.setSize(clientWidth, clientHeight);
  };

  onMount(async () => {
    if (!host) {
      return;
    }
    canvas = document.createElement('canvas');
    canvas.className = 'h-full w-full';
    host.append(canvas);
    viewer = new SkinViewer({
      canvas,
      width: host.clientWidth,
      height: host.clientHeight,
      skin: props.skin ?? undefined,
      cape: props.cape ?? undefined,
      model: props.shape,
      enableControls: true,
      animation: new WalkingAnimation(),
      zoom: 0.82,
    });
    viewer.background = 0x000000;
    viewer.globalLight.intensity = 0.8;
    viewer.cameraLight.intensity = 0.7;
    viewer.controls.enablePan = false;
    viewer.controls.enableDamping = true;
    viewer.controls.rotateSpeed = 0.7;
    viewer.controls.zoomSpeed = 0.9;
    viewer.controls.minDistance = 18;
    viewer.controls.maxDistance = 60;
    viewer.playerWrapper.rotation.x = -0.12;
    viewer.playerWrapper.rotation.y = 0.35;
    await syncTextures();
    resize();
    window.addEventListener('resize', resize);
  });

  createEffect(() => {
    props.skin;
    props.cape;
    props.shape;
    void syncTextures();
  });

  onCleanup(() => {
    window.removeEventListener('resize', resize);
    viewer?.dispose();
    viewer = null;
    canvas?.remove();
    canvas = null;
  });

  return <div ref={host} class="h-full w-full" />;
}
