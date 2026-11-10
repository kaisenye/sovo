/**
 * The classifier's categories (src/core/ai/classify.ts AI_CATEGORIES), in its
 * order, and the names the UI shows for them. The renderer may not import
 * classify.ts, so a test keeps the ids in step. Ids are what is stored and
 * searched (`ai:notification`); names are only shown.
 */
export const AI_CATEGORY_IDS = [
  'personal',
  'work',
  'billing',
  'notification',
  'marketing',
  'newsletter',
  'calendar',
  'support',
  'other'
] as const

export type AiCategoryId = (typeof AI_CATEGORY_IDS)[number]

export const AI_CATEGORY_NAMES = [
  'Personal',
  'Work',
  'Billing',
  'Notification',
  'Marketing',
  'Newsletter',
  'Calendar',
  'Support',
  'Other'
] as const

/** The category a shown name or an id stands for; null when it is no category. */
export function categoryId(name: string): AiCategoryId | null {
  const n = name.trim().toLowerCase()
  const i = AI_CATEGORY_NAMES.findIndex((x) => x.toLowerCase() === n)
  if (i >= 0) return AI_CATEGORY_IDS[i]
  return (AI_CATEGORY_IDS as readonly string[]).includes(n) ? (n as AiCategoryId) : null
}

/** The name the UI shows for a category id or name; anything else comes back as it is. */
export function categoryName(category: string): string {
  const id = categoryId(category)
  return id ? AI_CATEGORY_NAMES[AI_CATEGORY_IDS.indexOf(id)] : category
}
