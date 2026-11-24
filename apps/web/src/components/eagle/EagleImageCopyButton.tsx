import { IconCopy } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { copyImageToClipboard } from '../../lib/image-clipboard';
import { LibraryShareCopyStatus } from './LibraryShareCopyStatus';
import { useLibraryShareCopy, type ShareCopyPhase } from './useLibraryShareCopy';
import styles from './EagleImageCopyButton.module.css';

function activeSharePhase(phase: ShareCopyPhase): boolean {
  return (
    phase === 'starting' ||
    phase === 'queued' ||
    phase === 'reading' ||
    phase === 'decoding' ||
    phase === 'encoding' ||
    phase === 'copying'
  );
}

function shareButtonLabel(phase: ShareCopyPhase, fourK: boolean): string {
  switch (phase) {
    case 'starting':
      return t('正在准备…');
    case 'queued':
      return t('排队中…');
    case 'reading':
      return t('正在读取原图…');
    case 'decoding':
      return t('正在解码…');
    case 'encoding':
      return fourK ? t('正在压缩 4K…') : t('正在压缩…');
    case 'copying':
      return t('正在写入剪贴板…');
    case 'readyToCopy':
      return t('点击复制');
    case 'copied':
      return t('已复制');
    default:
      return t('复制到剪贴板');
  }
}

export function EagleImageCopyButton({
  asset,
  sourceUrl,
}: {
  asset?: EagleAssetListItem;
  sourceUrl: string;
}) {
  // Each image owns its feedback; a previous photo's pending copy cannot update the next photo.
  const key = asset ? `${asset.libraryMode ?? ''}:${asset.id}:${asset.mediaRevision}` : sourceUrl;
  return <ImageCopyAction key={key} asset={asset} sourceUrl={sourceUrl} />;
}

function ImageCopyAction({ asset, sourceUrl }: { asset?: EagleAssetListItem; sourceUrl: string }) {
  const share = Boolean(asset?.mimeType.startsWith('image/'));
  const shareCopy = useLibraryShareCopy();
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'pending' | 'copied' | 'error'>(
    'idle',
  );
  const [previewError, setPreviewError] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const copy = async () => {
    if (share && asset) {
      await shareCopy.copy(asset);
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setPreviewStatus('pending');
    setPreviewError('');
    try {
      await copyImageToClipboard(sourceUrl);
      if (active.current) setPreviewStatus('copied');
    } catch (cause) {
      if (active.current) {
        setPreviewError(
          t('复制到剪贴板失败{{value1}}', {
            value1: cause instanceof Error ? `：${cause.message}` : '',
          }),
        );
        setPreviewStatus('error');
      }
    } finally {
      pending.current = false;
    }
  };
  const fourK = share && Math.max(asset?.width ?? 0, asset?.height ?? 0) >= 4_096;
  const shareActive = share && activeSharePhase(shareCopy.state.phase);
  const previewPending = !share && previewStatus === 'pending';
  const disabled = previewPending || shareActive;
  const pendingLabel = previewPending ? t('正在复制…') : t('复制到剪贴板');
  return (
    <div className={styles.root}>
      <button
        className={styles.button}
        type="button"
        aria-label={t('复制到剪贴板')}
        title={
          share
            ? t('复制为分享图：JPEG，长边最多 4096 像素；小图按原尺寸，透明区域变白底。')
            : undefined
        }
        disabled={disabled}
        data-pending={previewPending || shareActive || undefined}
        onClick={() => void copy()}
      >
        <IconCopy size={16} />
        <span data-viewer-secondary-label>
          {share ? shareButtonLabel(shareCopy.state.phase, fourK) : pendingLabel}
        </span>
        {(previewPending || shareActive) && (
          <span className={styles.pendingTrack} aria-hidden="true" />
        )}
      </button>
      {share && (
        <LibraryShareCopyStatus
          state={shareCopy.state}
          fourK={fourK}
          surface="inline"
          onCancel={() => void shareCopy.cancel()}
          onRetry={() => void shareCopy.copy()}
          onCopyReady={() => void shareCopy.copy()}
          onShareReady={() => undefined}
          onDismiss={shareCopy.dismiss}
        />
      )}
      {!share && previewStatus === 'copied' && <small role="status">{t('已复制')}</small>}
      {!share && previewStatus === 'error' && <small role="alert">{previewError}</small>}
    </div>
  );
}
