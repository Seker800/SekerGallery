import { IconAlertTriangle, IconCircleCheck, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { ShareCopyState } from './useLibraryShareCopy';
import styles from './LibraryShareCopyStatus.module.css';

type Surface = 'inline' | 'floating' | 'mobile';

function errorText(state: ShareCopyState): string {
  if (state.errorMessage) return state.errorMessage;
  switch (state.errorCode) {
    case 'ASSET_CHANGED':
      return t('图片已变化，请重新打开后再复制。');
    case 'NOT_IMAGE':
      return t('仅图片支持复制分享版。');
    case 'SOURCE_MISSING':
      return t('原图文件不存在。');
    case 'INVALID_SPEC':
      return t('分享图规格无效，请更新客户端后重试。');
    case 'RETRY_EXHAUSTED':
    case 'RENDER_FAILED':
    case 'STORAGE_READ_FAILED':
    case 'STORAGE_WRITE_FAILED':
    case 'INTERNAL':
      return t('分享图生成失败，请重试。');
    case 'RENDER_TIMEOUT':
      return t('分享图生成超时，请重试。');
    case 'RENDERER_OFFLINE':
      return t('渲染服务未就绪，请稍后重试。');
    case 'CLIPBOARD_FAILED':
      return t('图片已生成，但写入剪贴板失败。');
    case 'CANCELLED':
      return t('已取消');
    default:
      return t('分享图生成失败，请重试。');
  }
}

function stageText(state: ShareCopyState, fourK: boolean): string {
  switch (state.phase) {
    case 'queued':
      return state.rendererOnline === false ? t('排队中 · 等待渲染服务') : t('排队中');
    case 'reading':
      return t('正在读取原图');
    case 'decoding':
      return t('正在解码 HEIC/RAW');
    case 'encoding':
      return fourK ? t('正在压缩 4K') : t('正在压缩分享图');
    case 'copying':
      return t('正在写入剪贴板');
    case 'readyToCopy':
      return t('分享图已准备好，点击复制');
    case 'readyToShare':
      return t('分享图已准备好，点击分享');
    case 'copied':
      return t('已复制分享图');
    case 'cancelled':
      return t('已取消');
    default:
      return errorText(state);
  }
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function LibraryShareCopyStatus({
  state,
  fourK,
  surface,
  onCancel,
  onRetry,
  onCopyReady,
  onShareReady,
  onDismiss,
}: {
  state: ShareCopyState;
  fourK: boolean;
  surface: Surface;
  onCancel: () => void;
  onRetry: () => void;
  onCopyReady: () => void;
  onShareReady: () => void;
  onDismiss: () => void;
}) {
  const active =
    state.phase === 'starting' ||
    state.phase === 'queued' ||
    state.phase === 'reading' ||
    state.phase === 'decoding' ||
    state.phase === 'encoding' ||
    state.phase === 'copying';
  const terminal = !active;
  const [visible, setVisible] = useState(terminal);
  const [now, setNow] = useState(Date.now());

  const activity = state.phase === 'idle' ? 'idle' : active ? 'active' : 'terminal';
  useEffect(() => {
    if (activity === 'idle') {
      setVisible(false);
      return;
    }
    if (activity === 'terminal') {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), 1_000);
    return () => clearTimeout(timer);
  }, [activity]);

  useEffect(() => {
    if (!visible || !active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active, visible]);

  useEffect(() => {
    if (state.phase !== 'copied') return;
    const timer = setTimeout(onDismiss, 4_000);
    return () => clearTimeout(timer);
  }, [state.phase, onDismiss]);

  if (state.phase === 'idle' || !visible) return null;

  const elapsed = Math.max(0, Math.round((now - state.startedAt) / 1_000));
  const bytes = formatBytes(state.result?.byteSize);
  const success = state.phase === 'copied';
  const failed = state.phase === 'failed';
  const secondary = success
    ? [bytes, t('用时 {{value1}} 秒', { value1: elapsed })].filter(Boolean).join(' · ')
    : state.phase === 'readyToCopy'
      ? state.errorCode === 'CLIPBOARD_FAILED'
        ? state.errorMessage || t('图片已生成，但写入剪贴板失败。')
        : t('图片已生成，点击即可写入剪贴板。')
      : state.phase === 'readyToShare'
        ? t('图片已生成，点击即可打开系统分享。')
        : failed
          ? ''
          : t('已用 {{value1}} 秒', { value1: elapsed });

  return (
    <div
      className={`${styles.root} ${styles[surface]} ${failed ? styles.danger : ''} ${success ? styles.success : ''}`}
      data-share-copy-status={state.phase}
    >
      <div className={styles.panel} role={failed ? 'alert' : 'status'} aria-live="polite">
        <span className={styles.icon} aria-hidden="true">
          {success ? (
            <IconCircleCheck size={15} />
          ) : failed ? (
            <IconAlertTriangle size={15} />
          ) : (
            <span className={styles.dot} />
          )}
        </span>
        <span className={styles.body}>
          <span className={styles.main}>
            {success
              ? fourK
                ? t('已复制 4K 分享图')
                : t('已复制分享图')
              : stageText(state, fourK)}
          </span>
          {secondary && <span className={styles.hint}>{secondary}</span>}
        </span>
        <span className={styles.actions}>
          {active && state.phase !== 'copying' && (
            <button className={styles.action} type="button" onClick={onCancel}>
              {t('取消')}
            </button>
          )}
          {state.phase === 'readyToCopy' && (
            <button className={styles.primary} type="button" onClick={onCopyReady}>
              {t('复制')}
            </button>
          )}
          {state.phase === 'readyToShare' && (
            <button className={styles.primary} type="button" onClick={onShareReady}>
              {t('分享')}
            </button>
          )}
          {failed && (
            <button className={styles.primary} type="button" onClick={onRetry}>
              {t('重试')}
            </button>
          )}
          {terminal && (
            <button
              className={styles.iconButton}
              type="button"
              aria-label={t('关闭')}
              onClick={onDismiss}
            >
              <IconX size={13} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
