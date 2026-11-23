import { t } from '../../i18n';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { IconPlus, IconSearch, IconTags, IconX } from '@tabler/icons-react';
import type { EagleManualTag, EagleManualTagGroup } from '../../lib/eagle-api';
import {
  createEagleTagIndex,
  normalizeEagleTagSearchText,
  searchAndSortEagleTags,
} from './eagle-tag-index';
import { EagleVirtualList } from './EagleVirtualList';
import styles from './EagleBatchTagPicker.module.css';
type TagScope = 'ALL' | 'UNCATEGORIZED' | 'STARRED' | `GROUP:${string}`;
interface EagleBatchTagPickerProps {
  mode?: 'add' | 'remove';
  assetCount: number;
  tags: EagleManualTag[];
  manualTagGroups?: EagleManualTagGroup[];
  selectedAssetCountByTagId?: Readonly<Record<string, number>>;
  pending?: boolean;
  error?: string;
  onApply: (tagIds: string[]) => void;
  onCreate?: (name: string) => Promise<EagleManualTag>;
  onClose: () => void;
}
export function EagleBatchTagPicker({
  mode = 'add',
  assetCount,
  tags,
  manualTagGroups = [],
  selectedAssetCountByTagId,
  pending = false,
  error,
  onApply,
  onCreate,
  onClose,
}: EagleBatchTagPickerProps) {
  const isRemoving = mode === 'remove';
  const dialogTitle = isRemoving ? t('删除人工标签') : t('添加标签');
  const [query, setQuery] = useState('');
  const [tagScope, setTagScope] = useState<TagScope>('ALL');
  const [createdTags, setCreatedTags] = useState<EagleManualTag[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const allTags = useMemo(() => {
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    createdTags.forEach((tag) => tagsById.set(tag.id, tag));
    return [...tagsById.values()];
  }, [createdTags, tags]);
  const tagIndexes = useMemo(() => allTags.map((tag) => createEagleTagIndex(tag)), [allTags]);
  const scopedTags = useMemo(() => {
    if (tagScope === 'ALL') return allTags;
    if (tagScope === 'UNCATEGORIZED') return allTags.filter((tag) => tag.groupId === null);
    if (tagScope === 'STARRED') return allTags.filter((tag) => tag.isStarred);
    const groupId = tagScope.slice(6);
    return allTags.filter((tag) => tag.groupId === groupId);
  }, [allTags, tagScope]);
  const visibleTags = useMemo(
    () => searchAndSortEagleTags(scopedTags, query, selectedTagIds),
    [query, scopedTags, selectedTagIds],
  );
  const recentTags = useMemo(
    () =>
      visibleTags
        .filter(({ tag }) => tag.lastUsedAt !== null)
        .sort(
          (left, right) =>
            Date.parse(right.tag.lastUsedAt ?? '') - Date.parse(left.tag.lastUsedAt ?? ''),
        ),
    [visibleTags],
  );
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeEagleTagSearchText(trimmedQuery);
  const compactQuery = normalizedQuery.replace(/\s+/gu, '');
  const asciiQuery = compactQuery.length > 0 && /^[a-z0-9]+$/u.test(compactQuery);
  const hasNameMatch =
    asciiQuery && tagIndexes.some((index) => index.compactName.includes(compactQuery));
  const hasPinyinMatch =
    asciiQuery &&
    tagIndexes.some(
      (index) =>
        index.fullPinyin.includes(compactQuery) || index.pinyinInitials.includes(compactQuery),
    );
  // Pinyin searches are searches, not names: do not create a tag literally called "yjfw".
  const pinyinOnlyMatch = hasNameMatch === false && hasPinyinMatch;
  const exactNameMatch = allTags.some(
    (tag) => normalizeEagleTagSearchText(tag.name) === normalizedQuery,
  );
  const canCreate = Boolean(
    !isRemoving &&
    onCreate &&
    trimmedQuery &&
    trimmedQuery.length <= 64 &&
    !exactNameMatch &&
    !pinyinOnlyMatch,
  );
  const showAppliedCount = !isRemoving && selectedAssetCountByTagId !== undefined;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };
  const createTag = async () => {
    if (!onCreate || !canCreate) return;
    setIsCreating(true);
    try {
      const tag = await onCreate(trimmedQuery);
      setCreatedTags((current) => [...current, tag]);
      setSelectedTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
      if (tagScope.startsWith('GROUP:') && tag.groupId !== tagScope.slice(6)) setTagScope('ALL');
      setQuery('');
      searchInput.current?.focus();
    } catch {
      // The parent mutation exposes the API error through the dialog's error prop.
    } finally {
      setIsCreating(false);
    }
  };
  const apply = () => {
    if (selectedTagIds.length > 0) onApply(selectedTagIds);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canCreate) {
      void createTag();
      return;
    }
    apply();
  };
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className={`${styles.dialog} ${isRemoving ? '' : styles.dialogWide}`}
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        onSubmit={submit}
      >
        <header>
          <div>
            <IconTags size={19} />
            <h2>{dialogTitle}</h2>
            <span>
              {assetCount}
              {' ' + t('项素材')}
            </span>
          </div>
          <button type="button" data-mobile-back aria-label={t('关闭标签选择')} onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>
        <label className={styles.searchBox}>
          <IconSearch size={16} aria-hidden="true" />
          <input
            ref={searchInput}
            autoFocus
            type="search"
            aria-label={isRemoving ? t('搜索可删除标签') : t('搜索可添加标签')}
            placeholder={t('搜索名称、拼音或首字母')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                apply();
              }
            }}
          />
        </label>
        <div className={styles.tagList}>
          {manualTagGroups.length > 0 && (
            <label className={styles.groupFilter}>
              <span>{t('标签组')}</span>
              <select
                aria-label={t('按标签组筛选')}
                value={tagScope}
                onChange={(event) => setTagScope(event.target.value as TagScope)}
              >
                <option value="ALL">{t('全部标签')}</option>
                <option value="UNCATEGORIZED">{t('未分类')}</option>
                <option value="STARRED">{t('常用标签')}</option>
                {manualTagGroups.map((group) => (
                  <option key={group.id} value={`GROUP:${group.id}`}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isRemoving && onCreate && !trimmedQuery && (
            <button
              className={styles.createTag}
              type="button"
              aria-label={t('新建标签')}
              disabled={isCreating || pending}
              onClick={() => searchInput.current?.focus()}
            >
              <IconPlus size={15} />
              {' ' + t('新建标签') + '…'}
              <small>{t('输入名称后创建')}</small>
            </button>
          )}
          {canCreate && (
            <button
              className={styles.createTag}
              type="button"
              aria-label={t('创建标签 {{value1}}', {
                value1: trimmedQuery,
              })}
              disabled={isCreating || pending}
              onClick={() => void createTag()}
            >
              <IconPlus size={15} />
              {' ' + t('创建“')}
              {trimmedQuery}”
            </button>
          )}
          <div className={`${styles.tagColumns} ${isRemoving ? styles.tagColumnsSingle : ''}`}>
            <section
              className={styles.tagColumn}
              aria-label={isRemoving ? t('可删除标签') : t('所有标签')}
            >
              <h3>{isRemoving ? t('可删除标签') : t('所有标签')}</h3>
              {visibleTags.length > 0 ? (
                <EagleVirtualList
                  ariaLabel={isRemoving ? t('可删除标签列表') : t('所有标签列表')}
                  className={styles.virtualTagList}
                  items={visibleTags}
                  itemKey={({ tag }) => tag.id}
                  rowHeight={37}
                  viewportHeight={390}
                  renderItem={({ tag }) => (
                    <BatchTagOption
                      tag={tag}
                      selected={selectedTagIds.includes(tag.id)}
                      selectedAssetCount={selectedAssetCountByTagId?.[tag.id]}
                      showApplied={showAppliedCount}
                      assetCount={assetCount}
                      isRemoving={isRemoving}
                      onToggle={toggleTag}
                    />
                  )}
                />
              ) : (
                <div className={styles.empty}>
                  {isRemoving && !query ? t('所选素材没有人工标签') : t('没有匹配的标签')}
                </div>
              )}
            </section>
            {!isRemoving && (
              <section className={styles.tagColumn} aria-label={t('最近使用')}>
                <h3>{t('最近使用')}</h3>
                {recentTags.length > 0 ? (
                  <EagleVirtualList
                    ariaLabel={t('最近使用标签列表')}
                    className={styles.virtualTagList}
                    items={recentTags}
                    itemKey={({ tag }) => tag.id}
                    rowHeight={37}
                    viewportHeight={390}
                    renderItem={({ tag }) => (
                      <BatchTagOption
                        tag={tag}
                        selected={selectedTagIds.includes(tag.id)}
                        selectedAssetCount={selectedAssetCountByTagId?.[tag.id]}
                        showApplied={showAppliedCount}
                        assetCount={assetCount}
                        recent
                        onToggle={toggleTag}
                      />
                    )}
                  />
                ) : (
                  <div className={styles.empty}>
                    {query ? t('没有匹配的最近标签') : t('还没有最近使用的标签')}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <footer>
          <span>
            {selectedTagIds.length > 0
              ? t('已选择 {{value1}} 个标签', {
                  value1: selectedTagIds.length,
                })
              : t('选择一个或多个标签')}
          </span>
          <button type="button" onClick={onClose}>
            {' ' + t('取消') + ' '}
          </button>
          <button
            className={styles.primary}
            type="button"
            aria-label={
              isRemoving
                ? t('从 {{value1}} 项素材删除 {{value2}} 个标签', {
                    value1: assetCount,
                    value2: selectedTagIds.length,
                  })
                : t('添加 {{value1}} 个标签到 {{value2}} 项素材', {
                    value1: selectedTagIds.length,
                    value2: assetCount,
                  })
            }
            disabled={selectedTagIds.length === 0 || pending || isCreating}
            onClick={apply}
          >
            {isRemoving ? t('删除') : t('添加')}
          </button>
        </footer>
      </form>
    </div>
  );
}
function BatchTagOption({
  tag,
  selected,
  selectedAssetCount,
  showApplied = false,
  assetCount,
  isRemoving = false,
  recent = false,
  onToggle,
}: {
  tag: EagleManualTag;
  selected: boolean;
  selectedAssetCount?: number;
  showApplied?: boolean;
  assetCount: number;
  isRemoving?: boolean;
  recent?: boolean;
  onToggle: (tagId: string) => void;
}) {
  return (
    <label className={styles.tagOption}>
      <input
        type="checkbox"
        aria-label={
          recent
            ? t('{{value1}}（最近使用）', {
                value1: tag.name,
              })
            : tag.name
        }
        checked={selected}
        onChange={() => onToggle(tag.id)}
      />
      <span className={styles.color} style={tag.color ? { background: tag.color } : undefined} />
      {isRemoving ? (
        <span>
          {tag.name} · {selectedAssetCount ?? 0}/{assetCount}
        </span>
      ) : (
        <>
          <span>{tag.name}</span>
          <small>
            {showApplied
              ? t('已应用 {{value1}}/{{value2}}', {
                  value1: selectedAssetCount ?? 0,
                  value2: assetCount,
                })
              : tag.assetCount}
          </small>
        </>
      )}
    </label>
  );
}
