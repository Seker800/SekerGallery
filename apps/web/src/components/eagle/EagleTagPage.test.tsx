import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EagleManualTag, EagleManualTagGroup } from '../../lib/eagle-api';
import { EagleTagPage } from './EagleTagPage';

const manualTags: EagleManualTag[] = [
  {
    id: 'tag-reference',
    name: 'Reference',
    color: '#d69b48',
    groupId: 'group-purpose',
    groupIds: ['group-purpose'],
    isStarred: true,
    rowVersion: 1,
    assetCount: 12,
    lastUsedAt: null,
    pinyin: 'reference',
    pinyinInitials: 'r',
  },
  {
    id: 'tag-ui',
    name: 'UI 界面',
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: false,
    rowVersion: 1,
    assetCount: 3,
    lastUsedAt: null,
    pinyin: 'uijiemian',
    pinyinInitials: 'uijm',
  },
];

const groups: EagleManualTagGroup[] = [
  {
    id: 'group-purpose',
    name: '用途',
    color: '#d69b48',
    description: null,
    rowVersion: 1,
    tagCount: 1,
  },
];

function renderManualPage(overrides: Partial<Parameters<typeof EagleTagPage>[0]> = {}) {
  const props: Parameters<typeof EagleTagPage>[0] = {
    manualTags,
    manualTagGroups: groups,
    onCreateManualTag: vi.fn(),
    onCreateManualTagGroup: vi.fn(),
    onUpdateManualTags: vi.fn(),
    onDeleteManualTags: vi.fn(),
    onUpdateManualTagGroup: vi.fn(),
    onDeleteManualTagGroup: vi.fn(),
    onSelectTag: vi.fn(),
    ...overrides,
  };
  render(<EagleTagPage {...props} />);
  return props;
}

describe('EagleTagPage', () => {
  it('renders the manual tag management workbench with scopes and groups', () => {
    renderManualPage();

    const page = screen.getByRole('region', { name: '人工标签管理' });
    expect(within(page).getByRole('navigation', { name: '人工标签导航' })).toHaveTextContent(
      '全部标签',
    );
    expect(page).toHaveTextContent('未分类');
    expect(page).toHaveTextContent('常用标签');
    expect(page).toHaveTextContent('标签组');
    expect(page).toHaveTextContent('用途');
    expect(within(page).getByRole('button', { name: /人工标签 Reference/ })).toBeInTheDocument();
  });

  it('filters tags, sorts by count and switches to list view', () => {
    renderManualPage();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索人工标签' }), {
      target: { value: 'ui' },
    });
    expect(screen.queryByRole('button', { name: /人工标签 Reference/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /人工标签 UI 界面/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '标签排序' }), {
      target: { value: 'COUNT_DESC' },
    });
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('list', { name: '人工标签目录' })).toHaveAttribute(
      'data-layout',
      'list',
    );
  });

  it('selects a tag on click and opens its assets on double click', () => {
    const onSelectTag = vi.fn();
    renderManualPage({ onSelectTag });
    const tag = screen.getByRole('button', { name: /人工标签 Reference/ });

    fireEvent.click(tag);
    expect(tag).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已选择 1 个')).toBeInTheDocument();
    expect(onSelectTag).not.toHaveBeenCalled();

    fireEvent.doubleClick(tag);
    expect(onSelectTag).toHaveBeenCalledWith('tag-reference');
  });

  it('moves and stars selected manual tags through management actions', () => {
    const onUpdateManualTags = vi.fn();
    renderManualPage({ onUpdateManualTags });
    fireEvent.click(screen.getByRole('button', { name: /人工标签 UI 界面/ }));

    fireEvent.click(screen.getByRole('button', { name: '设为常用' }));
    expect(onUpdateManualTags).toHaveBeenCalledWith([expect.objectContaining({ id: 'tag-ui' })], {
      isStarred: true,
    });

    fireEvent.change(screen.getByRole('combobox', { name: '移动到标签组' }), {
      target: { value: 'group-purpose' },
    });
    expect(onUpdateManualTags).toHaveBeenCalledWith([expect.objectContaining({ id: 'tag-ui' })], {
      groupId: 'group-purpose',
    });
  });

  it('groups Chinese tags into A-Z by phrase-aware pinyin instead of a Chinese fallback', () => {
    render(
      <EagleTagPage
        manualTags={[
          {
            id: 'tag-changchun',
            name: '长春',
            assetCount: 1,
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            lastUsedAt: null,
            pinyin: 'changchun',
            pinyinInitials: 'cc',
          },
          {
            id: 'tag-chongqing',
            name: '重庆',
            assetCount: 1,
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            lastUsedAt: null,
            pinyin: 'chongqing',
            pinyinInitials: 'cq',
          },
          {
            id: 'tag-material',
            name: 'Material',
            assetCount: 1,
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            lastUsedAt: null,
            pinyin: 'material',
            pinyinInitials: 'm',
          },
          {
            id: 'tag-owl',
            name: '猫头鹰',
            assetCount: 1,
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            lastUsedAt: null,
            pinyin: 'maotouying',
            pinyinInitials: 'mty',
          },
          {
            id: 'tag-number',
            name: '42',
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            assetCount: 1,
            lastUsedAt: null,
            pinyin: '42',
            pinyinInitials: '4',
          },
          {
            id: 'tag-symbol',
            name: '✨灵感',
            assetCount: 1,
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            lastUsedAt: null,
            pinyin: 'linggan',
            pinyinInitials: 'lg',
          },
        ]}
        manualTagGroups={groups}
        onCreateManualTag={vi.fn()}
        onCreateManualTagGroup={vi.fn()}
        onUpdateManualTags={vi.fn()}
        onDeleteManualTags={vi.fn()}
        onUpdateManualTagGroup={vi.fn()}
        onDeleteManualTagGroup={vi.fn()}
        onSelectTag={vi.fn()}
      />,
    );

    const directory = screen.getByRole('list', { name: '人工标签目录' });
    expect(within(directory).getByText('C', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).getByText('M', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).getByText('0–9', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).getByText('其他', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).queryByText('中文与其他')).not.toBeInTheDocument();

    const cSection = within(directory).getByText('C', { selector: 'span' }).closest('li');
    expect(cSection).not.toBeNull();
    expect(
      within(cSection!)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([expect.stringContaining('长春'), expect.stringContaining('重庆')]);
  });

  it('finds Chinese tags by full pinyin and pinyin initials', () => {
    render(
      <EagleTagPage
        manualTags={[
          {
            id: 'tag-owl',
            name: '猫头鹰',
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            assetCount: 8,
            lastUsedAt: null,
            pinyin: 'maotouying',
            pinyinInitials: 'mty',
          },
          {
            id: 'tag-night',
            name: 'night',
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            assetCount: 0,
            lastUsedAt: null,
            pinyin: 'night',
            pinyinInitials: 'n',
          },
        ]}
        manualTagGroups={groups}
        onCreateManualTag={vi.fn()}
        onCreateManualTagGroup={vi.fn()}
        onUpdateManualTags={vi.fn()}
        onDeleteManualTags={vi.fn()}
        onUpdateManualTagGroup={vi.fn()}
        onDeleteManualTagGroup={vi.fn()}
        onSelectTag={vi.fn()}
      />,
    );

    const search = screen.getByRole('searchbox', { name: '搜索人工标签' });
    fireEvent.change(search, { target: { value: 'maotouying' } });
    expect(screen.getByRole('button', { name: /人工标签 猫头鹰/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /人工标签 night/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'mty' } });
    expect(screen.getByRole('button', { name: /人工标签 猫头鹰/ })).toBeInTheDocument();
  });
  it('selects every filtered tag and keeps the selection across pages', () => {
    const many = Array.from({ length: 121 }, (_, index) => ({
      ...manualTags[1],
      id: `tag-${index}`,
      name: `标签 ${String(index).padStart(3, '0')}`,
      pinyin: `biaoqian ${index}`,
      pinyinInitials: `bq${index}`,
    }));
    renderManualPage({ manualTags: many });

    fireEvent.click(screen.getByRole('button', { name: /人工标签 标签 000/ }));
    expect(screen.getByText('已选择 1 个')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('已选择 1 个')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    expect(screen.getByText('已选择 121 个')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
  });

  it('sets and clears a color for the selected tags', async () => {
    const onUpdateManualTags = vi.fn();
    renderManualPage({ onUpdateManualTags });
    fireEvent.click(screen.getByRole('button', { name: /人工标签 UI 界面/ }));

    fireEvent.click(screen.getByRole('button', { name: '设置颜色 #ef4444' }));
    expect(onUpdateManualTags).toHaveBeenCalledWith([expect.objectContaining({ id: 'tag-ui' })], {
      color: '#ef4444',
    });
    const clear = screen.getByRole('button', { name: '清除颜色' });
    await waitFor(() => expect(clear).toBeEnabled());
    fireEvent.click(clear);
    expect(onUpdateManualTags).toHaveBeenLastCalledWith(
      [expect.objectContaining({ id: 'tag-ui' })],
      { color: null },
    );
  });

  it('keeps a new tag name when creation fails', async () => {
    const onCreateManualTag = vi.fn().mockRejectedValue(new Error('创建失败'));
    renderManualPage({ onCreateManualTag });
    const input = screen.getByRole('textbox', { name: '新建人工标签' });
    fireEvent.change(input, { target: { value: '素材标签' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('创建失败')).toBeInTheDocument();
    expect(input).toHaveValue('素材标签');
  });

  it('keeps the rename bar and input when the update fails', async () => {
    const onUpdateManualTags = vi.fn().mockRejectedValue(new Error('改名失败'));
    renderManualPage({ onUpdateManualTags });
    fireEvent.click(screen.getByRole('button', { name: /人工标签 UI 界面/ }));
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '重命名标签' });
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('改名失败')).toBeInTheDocument();
    expect(input).toHaveValue('新名字');
  });
  it('merges selected tags into one target and blocks private sources', async () => {
    const onMergeManualTags = vi.fn().mockResolvedValue(undefined);
    renderManualPage({ onMergeManualTags });
    fireEvent.click(screen.getByRole('button', { name: /人工标签 Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: /人工标签 UI 界面/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '合并…' }));

    const dialog = screen.getByRole('alertdialog', { name: '合并标签' });
    expect(within(dialog).getByRole('combobox', { name: '合并目标标签' })).toHaveValue(
      'tag-reference',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '合并' }));
    expect(onMergeManualTags).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'tag-ui' })],
      expect.objectContaining({ id: 'tag-reference' }),
    );
  });

  it('does not allow a private tag to be merged away', () => {
    const onMergeManualTags = vi.fn();
    renderManualPage({
      onMergeManualTags,
      manualTags: [
        manualTags[0]!,
        { ...manualTags[1]!, id: 'tag-private', name: '私密', marksAssetsPrivate: true },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /人工标签 Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: /人工标签 私密/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '合并…' }));

    const dialog = screen.getByRole('alertdialog', { name: '合并标签' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('是私密标签');
    expect(within(dialog).getByRole('button', { name: '合并' })).toBeDisabled();
  });
});

it('shows settled partial results and offers only the unfinished names for retry', () => {
  const retry = vi.fn();
  renderManualPage({
    error: 'partial failure',
    batchFailure: { completed: 3, items: [manualTags[0]], retry },
  });
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('已完成 3 项，待重试 1 项');
  expect(within(status).getByRole('listitem')).toHaveTextContent('Reference');
  expect(within(status).queryByText('UI 界面')).not.toBeInTheDocument();
  fireEvent.click(within(status).getByRole('button', { name: '重试未完成项' }));
  expect(retry).toHaveBeenCalledOnce();
});
