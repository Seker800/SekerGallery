const METADATA_FIELDS = new Set(['NAME', 'DESCRIPTION', 'SOURCE_URL']);
const TAG_FIELDS = new Set(['MANUAL_TAGS']);

function hasRuleField(value: unknown, fields: ReadonlySet<string>): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasRuleField(entry, fields));
  const rule = value as Record<string, unknown>;
  if (typeof rule.field === 'string' && fields.has(rule.field)) return true;
  return Object.values(rule).some((entry) => hasRuleField(entry, fields));
}

function filterRecord(filters: unknown): Record<string, unknown> | null {
  return filters && typeof filters === 'object' && !Array.isArray(filters)
    ? (filters as Record<string, unknown>)
    : null;
}

/** A title/description/source write can change which assets match search or a smart folder. */
export function metadataListMembershipSensitive(filters: unknown): boolean {
  const record = filterRecord(filters);
  if (!record) return false;
  if (typeof record.smartFolderId === 'string') return true;
  if (typeof record.search === 'string' && record.search.trim()) return true;
  return hasRuleField(record.rules, METADATA_FIELDS);
}

/** Tag writes only change membership for tag-filtered views and smart folders. */
export function tagListMembershipSensitive(filters: unknown): boolean {
  const record = filterRecord(filters);
  if (!record) return false;
  if (typeof record.smartFolderId === 'string') return true;
  // Server search matches manual tag names in addition to names.
  if (typeof record.search === 'string' && record.search.trim()) return true;
  if (Array.isArray(record.manualTagIds) && record.manualTagIds.length) return true;
  return hasRuleField(record.rules, TAG_FIELDS);
}
