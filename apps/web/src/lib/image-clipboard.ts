import { t } from '../i18n';
import { fetchWithBrowserSession } from './api-client';
import { getDesktopClipboardBridge, resolveClipboardImageUrl } from './media-resolver';
// A 4K share image is bounded by 4096x4096, not by the 1600x10000 preview shape.
const MAX_CLIPBOARD_PIXELS = 4_096 * 4_096;
interface ImageClipboardDependencies {
  convertToPng?: (source: Blob) => Promise<Blob>;
  createClipboardItem?: (items: Record<string, Blob | PromiseLike<string | Blob>>) => ClipboardItem;
  fetch?: typeof globalThis.fetch;
  write?: (items: ClipboardItem[]) => Promise<void>;
}
export function canCopyImageToClipboard(): boolean {
  if (getDesktopClipboardBridge()) return true;
  const clipboard = globalThis.navigator?.clipboard;
  return Boolean(
    globalThis.isSecureContext !== false &&
    typeof globalThis.ClipboardItem === 'function' &&
    typeof clipboard?.write === 'function',
  );
}
export async function copyImageToClipboard(
  sourceUrl: string,
  dependencies: ImageClipboardDependencies = {},
): Promise<void> {
  const desktop = getDesktopClipboardBridge();
  if (desktop) {
    const png = await loadClipboardPng(sourceUrl, dependencies);
    await desktop.writeClipboardImage(new Uint8Array(await png.arrayBuffer()));
    return;
  }
  const createClipboardItem =
    dependencies.createClipboardItem ??
    ((items: Record<string, Blob | PromiseLike<string | Blob>>) =>
      new globalThis.ClipboardItem(items));
  const writeClipboard =
    dependencies.write ??
    globalThis.navigator?.clipboard?.write?.bind(globalThis.navigator.clipboard);
  if (
    globalThis.isSecureContext === false ||
    !writeClipboard ||
    (!dependencies.createClipboardItem && typeof globalThis.ClipboardItem !== 'function')
  ) {
    throw new Error(
      globalThis.isSecureContext === false
        ? t('当前网页地址不支持复制到剪贴板，请使用 localhost 或 HTTPS。')
        : t('当前环境不支持复制到剪贴板。'),
    );
  }
  const pngPromise = loadClipboardPng(sourceUrl, dependencies);
  await writeClipboard([createClipboardItem({ 'image/png': pngPromise })]);
}
export interface ShareClipboardImage {
  jpeg: Promise<ShareJpeg>;
  png: Promise<Blob>;
}

/** Start fetching the permanent share rendition; the PNG is what browsers can publish. */
export function prepareShareClipboardImage(contentUrl: Promise<string>): ShareClipboardImage {
  const jpeg = contentUrl.then(fetchShareJpeg);
  const png = jpeg.then(convertJpegToPng);
  // A caller may fail before consuming both promises (unsupported clipboard, early cancel).
  jpeg.catch(() => undefined);
  png.catch(() => undefined);
  return { jpeg, png };
}

/**
 * The desktop hands the JPEG to the native clipboard; browsers publish the prepared PNG.
 * Call inside the click when the image may still be rendering: ClipboardItem accepts a promise.
 */
export async function copyPreparedShareImageToClipboard(image: ShareClipboardImage): Promise<void> {
  const desktop = getDesktopClipboardBridge();
  if (desktop) {
    const jpeg = await image.jpeg;
    if (desktop.writeClipboardImageData) {
      await desktop.writeClipboardImageData({
        contentType: jpeg.contentType,
        bytes: new Uint8Array(jpeg.buffer),
      });
      return;
    }
    // Desktop builds before the JPEG bridge still accept PNG through the original IPC.
    const png = await image.png;
    await desktop.writeClipboardImage(new Uint8Array(await png.arrayBuffer()));
    return;
  }
  const createClipboardItem = (items: Record<string, Blob | PromiseLike<string | Blob>>) =>
    new globalThis.ClipboardItem(items);
  const writeClipboard = globalThis.navigator?.clipboard?.write?.bind(
    globalThis.navigator.clipboard,
  );
  if (
    globalThis.isSecureContext === false ||
    !writeClipboard ||
    typeof globalThis.ClipboardItem !== 'function'
  ) {
    throw new Error(
      globalThis.isSecureContext === false
        ? t('当前网页地址不支持复制到剪贴板，请使用 localhost 或 HTTPS。')
        : t('当前环境不支持复制到剪贴板。'),
    );
  }
  // Start the clipboard write inside the click gesture; the promise resolves after the render.
  await writeClipboard([createClipboardItem({ 'image/png': image.png })]);
}

export async function copyShareImageToClipboard(shareUrl: string): Promise<void> {
  await copyPreparedShareImageToClipboard(prepareShareClipboardImage(Promise.resolve(shareUrl)));
}

export interface ShareJpeg {
  buffer: ArrayBuffer;
  contentType: 'image/jpeg';
}

async function fetchShareJpeg(shareUrl: string): Promise<ShareJpeg> {
  const response = await fetchWithBrowserSession(shareUrl, {}, 120_000);
  if (!response.ok)
    throw new Error(
      t('读取图片失败（{{value1}}）。', {
        value1: response.status,
      }),
    );
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (contentType !== 'image/jpeg') throw new Error(t('复制来源不是图片。'));
  return { buffer: await response.arrayBuffer(), contentType: 'image/jpeg' };
}

function convertJpegToPng(jpeg: ShareJpeg): Promise<Blob> {
  return convertImageToPng(new Blob([jpeg.buffer], { type: jpeg.contentType }));
}

async function loadClipboardPng(
  sourceUrl: string,
  dependencies: ImageClipboardDependencies,
): Promise<Blob> {
  const fetchImage = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImage(resolveClipboardImageUrl(sourceUrl), {
    credentials: 'include',
  });
  if (!response.ok)
    throw new Error(
      t('读取图片失败（{{value1}}）。', {
        value1: response.status,
      }),
    );
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (!contentType?.startsWith('image/')) throw new Error(t('复制来源不是图片。'));
  return (dependencies.convertToPng ?? convertImageToPng)(await response.blob());
}
async function convertImageToPng(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width * bitmap.height > MAX_CLIPBOARD_PIXELS
    ) {
      throw new Error(t('图片尺寸超出复制限制。'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('无法创建图片复制画布。'));
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error(t('无法编码剪贴板图片。'));
    return png;
  } finally {
    bitmap.close();
  }
}
