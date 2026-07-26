import id from './id'
import en from './en'
import type { Dictionary } from './id'

export type Locale = 'id' | 'en'
export type { Dictionary }

export const dictionaries: Record<Locale, Dictionary> = { id, en }

export const LOCALE_STORAGE_KEY = 'locale'
export const DEFAULT_LOCALE: Locale = 'id'
