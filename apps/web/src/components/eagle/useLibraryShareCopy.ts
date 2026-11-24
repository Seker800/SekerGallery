import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelEagleShareRender,
  getEagleShareRender,
  startEagleShareRender,
  type EagleAssetListItem,
  type LibraryShareRenderResult,
} from '../../lib/eagle-api';
import { fetchWithBrowserSession } from '../../lib/api-client';
import {
  copyPreparedShareImageToClipboard,
  prepareShareClipboardImage,
  type ShareClipboardImage,
} from '../../lib/image-clipboard';
import { t } from '../../i18n';

export type ShareCopyPhase =
  | 'idle'
  | 'starting'
  | 'queued'
  | 'reading'
  | 'decoding'
  | 'encoding'
  | 'copying'
  | 'readyToCopy'
  | 'readyToShare'
  | 'copied'
  | 'failed'
  | 'cancelled';

export interface ShareCopyState {
  phase: ShareCopyPhase;
  stage?: LibraryShareRenderResult['stage'];
  elapsedMs: number;
  startedAt: number;
  errorCode?: string;
  errorMessage?: string;
  rendererOnline?: boolean;
  result?: LibraryShareRenderResult;
  file?: File;
  fourK: boolean;
  assetId?: string;
  assetRevision?: number;
}

export type ShareFileResult =
  | { status: 'ready'; file: File }
  | { status: 'busy' }
  | { status: 'cancelled' }
  | { status: 'failed'; errorCode: string };

const IDLE: ShareCopyState = { phase: 'idle', elapsedMs: 0, startedAt: 0, fourK: false };
const SHARE_RENDER_TIMEOUT_MS = 10 * 60_000;
const SHARE_RENDER_OFFLINE_MS = 45_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class ShareJobError extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
  }
}

function phaseFor(stage: LibraryShareRenderResult['stage']): ShareCopyPhase {
  if (stage === 'READING') return 'reading';
  if (stage === 'DECODING') return 'decoding';
  if (stage === 'ENCODING') return 'encoding';
  return 'queued';
}

function errorCodeOf(error: unknown): string {
  if (error instanceof ShareJobError) return error.errorCode;
  if (error instanceof DOMException && error.name === 'AbortError') return 'CANCELLED';
  return 'FAILED';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFourK(asset: EagleAssetListItem): boolean {
  return Math.max(asset.width ?? 0, asset.height ?? 0) >= 4_096;
}

function shareFile(asset: EagleAssetListItem, blob: Blob): File {
  const name =
    asset.originalName
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'share';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

export function useLibraryShareCopy() {
  const [state, setState] = useState<ShareCopyState>(IDLE);
  const prepared = useRef<ShareClipboardImage | null>(null);
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const currentAsset = useRef<EagleAssetListItem | undefined>(undefined);
  const active = useRef(false);

  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      active.current = false;
    },
    [],
  );

  const applyStatus = useCallback((current: LibraryShareRenderResult) => {
    jobId.current = current.id;
    setState((value) => ({
      ...value,
      phase: phaseFor(current.stage),
      stage: current.stage,
      elapsedMs: current.elapsedMs,
      rendererOnline: current.rendererOnline,
      result: current,
    }));
  }, []);

  const drive = useCallback(
    async (
      asset: EagleAssetListItem,
      signal: AbortSignal,
      onReady: (current: LibraryShareRenderResult) => void,
    ): Promise<LibraryShareRenderResult> => {
      let current = await startEagleShareRender(asset.id, asset.libraryMode ?? 'MATERIAL', signal);
      const deadline = Date.now() + SHARE_RENDER_TIMEOUT_MS;
      let offlineSince: number | null = null;
      for (;;) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (Date.now() > deadline) throw new ShareJobError('RENDER_TIMEOUT');
        applyStatus(current);
        if (current.status === 'READY') {
          if (!current.contentUrl) throw new ShareJobError('ASSET_CHANGED');
          onReady(current);
          return current;
        }
        if (current.status === 'FAILED' || current.status === 'CANCELLED')
          throw new ShareJobError(current.errorCode ?? current.status);
        offlineSince = current.rendererOnline === false ? (offlineSince ?? Date.now()) : null;
        if (offlineSince !== null && Date.now() - offlineSince > SHARE_RENDER_OFFLINE_MS)
          throw new ShareJobError('RENDERER_OFFLINE');
        await sleep(700);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        current = await getEagleShareRender(
          asset.id,
          current.id,
          asset.libraryMode ?? 'MATERIAL',
          signal,
        );
      }
    },
    [applyStatus],
  );

  const copy = useCallback(
    async (target?: EagleAssetListItem) => {
      const asset = target ?? currentAsset.current;
      if (!asset) return;
      currentAsset.current = asset;
      if (
        state.phase === 'readyToCopy' &&
        state.assetId === asset.id &&
        state.assetRevision === asset.mediaRevision &&
        prepared.current
      ) {
        setState((value) => ({ ...value, phase: 'copying', errorCode: undefined }));
        try {
          await copyPreparedShareImageToClipboard(prepared.current);
          setState((value) => ({ ...value, phase: 'copied' }));
        } catch (error) {
          setState((value) => ({
            ...value,
            phase: 'readyToCopy',
            errorCode: 'CLIPBOARD_FAILED',
            errorMessage: error instanceof Error ? error.message : t('写入剪贴板失败'),
          }));
        }
        return;
      }
      if (active.current) return;
      active.current = true;
      const signalController = new AbortController();
      controller.current = signalController;
      const startedAt = Date.now();
      setState({
        phase: 'starting',
        elapsedMs: 0,
        startedAt,
        fourK: isFourK(asset),
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
      });
      const content = deferred<string>();
      const image = prepareShareClipboardImage(content.promise);
      // A clipboard support check can fail before the eventual content fetch is consumed.
      image.jpeg.catch(() => undefined);
      image.png.catch(() => undefined);
      prepared.current = image;
      let clipboardError: unknown;
      const clipboard = copyPreparedShareImageToClipboard(image).catch((error: unknown) => {
        clipboardError = error;
      });
      try {
        const result = await drive(asset, signalController.signal, (current) => {
          if (current.contentUrl) content.resolve(current.contentUrl);
        });
        setState((value) => ({ ...value, phase: 'copying', result }));
        await clipboard;
        if (clipboardError) {
          const message =
            clipboardError instanceof Error ? clipboardError.message : t('写入剪贴板失败');
          setState((value) => ({
            ...value,
            phase: 'readyToCopy',
            errorCode: 'CLIPBOARD_FAILED',
            errorMessage: message,
          }));
        } else {
          setState((value) => ({ ...value, phase: 'copied', result }));
        }
      } catch (error) {
        content.reject(error);
        await clipboard;
        if (signalController.signal.aborted)
          setState((value) => ({ ...value, phase: 'cancelled', errorCode: 'CANCELLED' }));
        else
          setState((value) => ({
            ...value,
            phase: 'failed',
            errorCode: errorCodeOf(error),
          }));
      } finally {
        active.current = false;
        controller.current = null;
      }
    },
    [drive, state.assetId, state.phase],
  );

  const prepareShareFile = useCallback(
    async (asset: EagleAssetListItem): Promise<ShareFileResult> => {
      currentAsset.current = asset;
      if (state.file && state.assetId === asset.id && state.assetRevision === asset.mediaRevision)
        return { status: 'ready', file: state.file };
      if (active.current) return { status: 'busy' };
      active.current = true;
      const signalController = new AbortController();
      controller.current = signalController;
      setState({
        phase: 'starting',
        elapsedMs: 0,
        startedAt: Date.now(),
        fourK: isFourK(asset),
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
      });
      try {
        let contentUrl = '';
        const result = await drive(asset, signalController.signal, (current) => {
          contentUrl = current.contentUrl ?? '';
        });
        if (!contentUrl) throw new ShareJobError('ASSET_CHANGED');
        const response = await fetchWithBrowserSession(contentUrl, {}, 120_000);
        if (!response.ok) throw new ShareJobError('ASSET_CHANGED');
        const file = shareFile(asset, await response.blob());
        setState((value) => ({
          ...value,
          phase: 'readyToShare',
          result,
          file,
        }));
        return { status: 'ready', file };
      } catch (error) {
        if (signalController.signal.aborted) {
          setState((value) => ({ ...value, phase: 'cancelled', errorCode: 'CANCELLED' }));
          return { status: 'cancelled' };
        }
        const errorCode = errorCodeOf(error);
        setState((value) => ({ ...value, phase: 'failed', errorCode }));
        return { status: 'failed', errorCode };
      } finally {
        active.current = false;
        controller.current = null;
      }
    },
    [drive, state.assetId, state.file],
  );

  const cancel = useCallback(async () => {
    controller.current?.abort();
    const asset = currentAsset.current;
    const id = jobId.current;
    if (id && asset)
      await cancelEagleShareRender(asset.id, id, asset.libraryMode ?? 'MATERIAL').catch(
        () => undefined,
      );
    prepared.current = null;
    setState((value) => ({ ...value, phase: 'cancelled', errorCode: 'CANCELLED' }));
  }, []);

  const dismiss = useCallback(() => {
    setState(IDLE);
    prepared.current = null;
  }, []);

  return { state, copy, cancel, dismiss, prepareShareFile };
}
