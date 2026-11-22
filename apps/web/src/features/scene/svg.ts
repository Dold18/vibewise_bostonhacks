import type { AssetRegistry } from './assets';
/** Decode an original SVG/atlas once, then crop its authored cell into a GPU-ready image. */
export function createSvgCache(assets: AssetRegistry) {
  const images = new Map<string, Promise<HTMLImageElement>>();
  const cells = new Map<string, Promise<ImageData>>();
  return {
    load(id: string): Promise<ImageData> {
      const cached = cells.get(id);
      if (cached) return cached;
      const source = assets.sources?.get(id);
      if (!source || !assets.svg.has(id)) return Promise.reject(new Error(`Unknown SVG ${id}`));
      let image = images.get(source.uri);
      if (!image) {
        image = new Promise((resolve, reject) => {
          const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`SVG load failed: ${id}`)); img.src = source.uri;
        });
        images.set(source.uri, image);
      }
      const cell = image.then(img => {
        const [x, y, w, h] = source.rect ?? [0, 0, img.width, img.height];
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, x!, y!, w!, h!, 0, 0, 256, 256);
        return ctx.getImageData(0, 0, 256, 256);
      }).catch(error => { cells.delete(id); images.delete(source.uri); throw error; });
      cells.set(id, cell); return cell;
    },
    clear() { cells.clear(); images.clear(); },
  };
}
