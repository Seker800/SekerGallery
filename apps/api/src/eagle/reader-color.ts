import type { LibraryMemoryIndex, MemoryDateField } from './reader-index';
import { memoryDateTime } from './reader-index';
import type { AssetSearchWhere } from './eagle-search-predicate';
import type { MemorySearchContext } from './reader-predicate';
import { createMemoryColorScorer } from './reader-color-score';
export { createMemoryColorScorer } from './reader-color-score';

export interface MemoryColorPosition {
  id: string;
  score: number;
  time: string;
  mediaRevision: number;
}

export interface MemoryColorPageOptions {
  where: AssetSearchWhere;
  color: string;
  date: MemoryDateField;
  limit: number;
  offset: number;
  after?: { id: string; score: number; time: string; newer?: true };
}

type RankedColorPosition = Omit<MemoryColorPosition, 'time'> & { time: number };

const DEFAULT_RANKING_ENTRIES = 4;
const DEFAULT_RANKING_MAX_POSITIONS = 100_000;
const rankingCache = new Map<string, RankedColorPosition[]>();

function rankingEntries() {
  const value = Number(process.env.EAGLE_READER_COLOR_RANKING_ENTRIES ?? DEFAULT_RANKING_ENTRIES);
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_RANKING_ENTRIES;
}
function rankingMaxPositions() {
  const value = Number(
    process.env.EAGLE_READER_COLOR_RANKING_MAX_POSITIONS ?? DEFAULT_RANKING_MAX_POSITIONS,
  );
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_RANKING_MAX_POSITIONS;
}
function rankingKey(index: LibraryMemoryIndex, options: MemoryColorPageOptions) {
  return `${index.revision}\u0000${options.color}\u0000${options.date}\u0000${JSON.stringify(options.where)}`;
}
function rankedPositions(
  index: LibraryMemoryIndex,
  options: MemoryColorPageOptions,
  context?: MemorySearchContext,
): RankedColorPosition[] {
  const score = createMemoryColorScorer();
  const positions: RankedColorPosition[] = [];
  index.forEach(
    options.where,
    (row) => {
      positions.push({
        id: String(row.id),
        score: score(row, options.color) || 100,
        time: memoryDateTime(row[options.date]),
        mediaRevision: Number(row.mediaRevision),
      });
    },
    context,
  );
  positions.sort(comparePositions);
  return positions;
}
type ColorOrder = Pick<RankedColorPosition, 'id' | 'score' | 'time'>;
function comparePositions(a: ColorOrder, b: ColorOrder) {
  return a.score - b.score || b.time - a.time || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
function cachedRankedPositions(
  index: LibraryMemoryIndex,
  options: MemoryColorPageOptions,
  context?: MemorySearchContext,
) {
  // Semantic contexts narrow the resident view per request; they are not shareable.
  if (context) return rankedPositions(index, options, context);
  const entries = rankingEntries();
  if (!entries) return rankedPositions(index, options);
  const key = rankingKey(index, options);
  const hit = rankingCache.get(key);
  if (hit) {
    rankingCache.delete(key);
    rankingCache.set(key, hit);
    return hit;
  }
  const positions = rankedPositions(index, options);
  if (positions.length > rankingMaxPositions()) return positions;
  rankingCache.set(key, positions);
  while (rankingCache.size > entries) rankingCache.delete(rankingCache.keys().next().value!);
  return positions;
}
/** Preserve Eagle's score-or-100 order and the existing SQL cursor's inverse traversal. */
export function residentColorPage(
  index: LibraryMemoryIndex,
  options: MemoryColorPageOptions,
  context?: MemorySearchContext,
): MemoryColorPosition[] {
  const ranked = cachedRankedPositions(index, options, context);
  const after = options.after
    ? { ...options.after, time: Date.parse(options.after.time) }
    : undefined;
  const filtered = after
    ? ranked.filter((position) =>
        after.newer ? comparePositions(position, after) < 0 : comparePositions(position, after) > 0,
      )
    : ranked;
  const ordered = after?.newer ? [...filtered].reverse() : filtered;
  return ordered
    .slice(options.offset, options.offset + options.limit + 1)
    .map((row) => ({ ...row, time: new Date(row.time).toISOString() }));
}
/** Test-only reset; the ranking cache is derived data and never owns business facts. */
export function resetColorRankingCache() {
  rankingCache.clear();
}
