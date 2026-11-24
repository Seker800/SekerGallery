import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { EagleImageCopyButton } from './EagleImageCopyButton';
const { copy, copyPrepared, prepareShare, startShare, getShare, cancelShare } = vi.hoisted(() => ({
  copy: vi.fn(),
  copyPrepared: vi.fn(),
  prepareShare: vi.fn(),
  startShare: vi.fn(),
  getShare: vi.fn(),
  cancelShare: vi.fn(),
}));
vi.mock('../../lib/image-clipboard', () => ({
  copyImageToClipboard: copy,
  prepareShareClipboardImage: prepareShare,
  copyPreparedShareImageToClipboard: copyPrepared,
}));
vi.mock('../../lib/eagle-api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    startEagleShareRender: startShare,
    getEagleShareRender: getShare,
    cancelEagleShareRender: cancelShare,
  };
});

const imageAsset = {
  id: 'asset-1',
  mimeType: 'image/jpeg',
  libraryMode: 'MATERIAL',
  width: 8_000,
  height: 6_000,
} as unknown as EagleAssetListItem;
const smallImageAsset = {
  ...imageAsset,
  id: 'asset-2',
  width: 1_600,
  height: 1_200,
} as EagleAssetListItem;

describe('EagleImageCopyButton', () => {
  beforeEach(() => {
    copy.mockReset();
    copyPrepared.mockReset();
    prepareShare.mockReset();
    startShare.mockReset();
    getShare.mockReset();
    cancelShare.mockReset();
    copyPrepared.mockResolvedValue(undefined);
    prepareShare.mockReturnValue({
      jpeg: Promise.resolve({ buffer: new ArrayBuffer(0), contentType: 'image/jpeg' }),
      png: Promise.resolve(new Blob(['png'], { type: 'image/png' })),
    });
    startShare.mockResolvedValue({
      id: 'rendition-1',
      status: 'READY',
      stage: 'READY',
      elapsedMs: 0,
      contentUrl: '/api/eagle/assets/asset-1/renditions/rendition-1/content',
      renditionId: 'rendition-1',
      width: 4_096,
      height: 3_072,
      byteSize: 4_194_304,
      cached: true,
    });
  });
  it('copies the 4K share rendition when the viewer knows the asset', async () => {
    render(<EagleImageCopyButton asset={imageAsset} sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(startShare).toHaveBeenCalledWith('asset-1', 'MATERIAL', expect.any(AbortSignal));
    expect(copyPrepared).toHaveBeenCalledTimes(1);
    expect(copy).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('已复制 4K 分享图');
    expect(screen.getByRole('button', { name: '复制到剪贴板' })).toHaveAttribute(
      'title',
      '复制为分享图：JPEG，长边最多 4096 像素；小图按原尺寸，透明区域变白底。',
    );
  });
  it('does not claim 4K when the copied share version is smaller', async () => {
    render(<EagleImageCopyButton asset={smallImageAsset} sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已复制分享图');
  });
  it('prevents concurrent writes and resets feedback when the photo changes', async () => {
    let complete!: () => void;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<EagleImageCopyButton sourceUrl="first.webp" />);
    const button = screen.getByRole('button', { name: '复制到剪贴板' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledTimes(1);
    view.rerender(<EagleImageCopyButton sourceUrl="second.webp" />);
    await act(async () => complete());
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
    copy.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(copy).toHaveBeenLastCalledWith('second.webp');
    expect(await screen.findByRole('status')).toHaveTextContent('已复制');
    view.rerender(<EagleImageCopyButton sourceUrl="third.webp" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('explains clipboard failures and allows retry without closing the viewer', async () => {
    copy
      .mockRejectedValueOnce(new Error('请使用 localhost 或 HTTPS'))
      .mockResolvedValueOnce(undefined);
    render(<EagleImageCopyButton sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请使用 localhost 或 HTTPS');
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已复制');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('handles non Error rejections and discards errors after unmount', async () => {
    copy.mockRejectedValueOnce('denied');
    const view = render(<EagleImageCopyButton sourceUrl="preview.webp" />);
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制到剪贴板失败');
    let reject!: (reason: Error) => void;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '复制到剪贴板' }));
    view.unmount();
    await act(async () => reject(new Error('denied')));
  });
});
