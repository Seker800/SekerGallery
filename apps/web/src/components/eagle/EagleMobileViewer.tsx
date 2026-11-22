import { useEnqueueAssetOperation } from './useAssetOperations';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  IconShare2,
  IconEdit,
  IconTrash,
  IconDotsCircleHorizontal,
  IconDownload,
} from '@tabler/icons-react';
import { getLocale, t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { saveOriginalFile } from '../../lib/original-file-export';
import type { EagleMobileViewerPresentation } from './EagleViewerShell';
import styles from './EagleMobileViewer.module.css';
import { EagleFavoriteButton } from './EagleFavoriteButton';
export { toggleViewerFavorite } from './EagleFavoriteButton';
export function mobileViewerPresentation(
  asset: EagleAssetListItem,
  onClose: () => void,
  onEdit: (() => void) | undefined,
  more: ReactNode,
  onRotate?: () => void,
  readOnly = false,
): EagleMobileViewerPresentation {
  const value =
    asset.photoMetadata?.capturedLocal ??
    asset.photoMetadata?.capturedAt ??
    asset.chronologicalAt ??
    asset.libraryAddedAt;
  const date = new Date(value);
  const valid = Number.isFinite(date.getTime());
  return {
    date: valid
      ? new Intl.DateTimeFormat(getLocale(), {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(date)
      : asset.displayName,
    time: valid
      ? new Intl.DateTimeFormat(getLocale(), {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date)
      : undefined,
    onRotate,
    actions: (
      <MobileViewerActions
        key={`${asset.libraryMode}:${asset.id}`}
        asset={asset}
        onClose={onClose}
        onEdit={onEdit}
        readOnly={readOnly}
        more={more}
      />
    ),
  };
}
function shareFileName(originalName: string): string {
  const name = originalName.replace(/\\/g, '/').split('/').pop() ?? 'share.jpg';
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/[:*?"<>|]/g, '')
    .trim();
  return `${stem || 'share'}.jpg`;
}

function MobileViewerActions({
  asset,
  onClose,
  onEdit,
  more,
  readOnly,
}: {
  asset: EagleAssetListItem;
  onClose: () => void;
  onEdit?: () => void;
  more: ReactNode;
  readOnly: boolean;
}) {
  const { api, libraryMode } = useLibraryWorkspace();
  const enqueue = useEnqueueAssetOperation();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [fallbackReason, setFallbackReason] = useState<'' | 'unsupported' | 'large'>('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const download = () =>
    run(async () => {
      await saveOriginalFile({ ...asset, libraryMode });
    });
  const share = () =>
    run(async () => {
      setFallbackReason('');
      if (!navigator.share) {
        setFallbackReason('unsupported');
        return;
      }
      // Still images use the bounded server rendering; GIF/WebP keep their original animation.
      const shareImage =
        asset.mimeType.startsWith('image/') &&
        asset.mimeType !== 'image/gif' &&
        asset.mimeType !== 'image/webp';
      if (shareImage) {
        let file: File | undefined;
        try {
          const response = await fetch(api.getEagleShareImageUrl(asset.id, asset.libraryMode), {
            credentials: 'same-origin',
          });
          if (!response.ok) throw new Error(t('无法生成分享图，请重试。'));
          const blob = await response.blob();
          if (blob.type !== 'image/jpeg') throw new Error(t('分享图格式不正确，请重试。'));
          file = new File([blob], shareFileName(asset.originalName), { type: 'image/jpeg' });
        } catch (reason) {
          // A server-side render failure falls back to the original only when it is small enough.
          if (asset.byteSize > 32 * 1024 * 1024) throw reason;
        }
        if (file) {
          if (!navigator.canShare?.({ files: [file] })) {
            setFallbackReason('unsupported');
            return;
          }
          try {
            await navigator.share({ files: [file], title: asset.displayName });
          } catch (reason) {
            if (reason instanceof DOMException && reason.name === 'AbortError') return;
            throw reason;
          }
          return;
        }
      }
      if (asset.byteSize > 32 * 1024 * 1024) {
        setFallbackReason('large');
        return;
      }
      const response = await fetch(api.getEagleAssetContentUrl(asset.id), {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(t('无法读取原文件，请重试。'));
      const reader = response.body?.getReader();
      if (!reader) throw new Error(t('无法读取原文件，请重试。'));
      const chunks: BlobPart[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 32 * 1024 * 1024) {
            await reader.cancel();
            setFallbackReason('large');
            return;
          }
          chunks.push(new Uint8Array(part.value));
        }
      } finally {
        reader.releaseLock();
      }
      const file = new File(chunks, asset.originalName, { type: asset.mimeType });
      if (!navigator.canShare?.({ files: [file] })) {
        setFallbackReason('unsupported');
        return;
      }
      try {
        await navigator.share({ files: [file], title: asset.displayName });
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) throw reason;
      }
    });
  return (
    <div className={styles.root}>
      <div className={styles.bar} role="toolbar" aria-label={t('图片操作')}>
        <button type="button" disabled={pending} onClick={() => void share()}>
          <IconShare2 />
          <span>{t('分享')}</span>
        </button>
        <button type="button" disabled={!onEdit || pending || readOnly} onClick={onEdit}>
          <IconEdit />
          <span>{t('编辑')}</span>
        </button>
        <EagleFavoriteButton assets={[asset]} disabled={pending || readOnly} />
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => {
            if (window.confirm(t('移入当前图库回收站？可以在回收站恢复。')))
              void run(async () => {
                await enqueue('TRASH', [asset.id]);
                onClose();
              });
          }}
        >
          <IconTrash />
          <span>{t('删除')}</span>
        </button>
        <details className={styles.more}>
          <summary>
            <IconDotsCircleHorizontal />
            <span>{t('更多')}</span>
          </summary>
          <div className={styles.menu}>
            <strong>{asset.displayName}</strong>
            <p>
              {asset.format?.toUpperCase()} · {asset.width} × {asset.height}
            </p>
            <button type="button" onClick={() => void download()}>
              <IconDownload size={18} />
              {t('下载原文件')}
            </button>
            {more}
          </div>
        </details>
      </div>
      {fallbackReason && (
        <div className={styles.notice} role="status">
          <span>
            {fallbackReason === 'large'
              ? t('文件较大，建议先下载原文件。')
              : t('当前环境不支持系统分享，可先下载原文件。')}
          </span>
          <button type="button" onClick={() => void download()}>
            {t('下载原文件')}
          </button>
          <button type="button" onClick={() => setFallbackReason('')}>
            {t('关闭')}
          </button>
        </div>
      )}
      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
