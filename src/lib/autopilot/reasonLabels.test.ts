import { describe, it, expect } from 'vitest'
import { moduleLabel, reasonHint } from './reasonLabels'

describe('moduleLabel', () => {
  it('maps each module id to a Russian label', () => {
    expect(moduleLabel('engagement')).toBe('Лайки')
    expect(moduleLabel('smart_connect')).toBe('Коннекты')
    expect(moduleLabel('content')).toBe('Посты')
    expect(moduleLabel('profile_views')).toBe('Просмотры')
  })
})

describe('reasonHint', () => {
  it('is empty for a clean run (count speaks for itself)', () => {
    expect(reasonHint('done')).toBe('')
    expect(reasonHint(undefined)).toBe('')
  })

  it('explains why a module did nothing', () => {
    expect(reasonHint('disabled')).toBe('модуль выключен')
    expect(reasonHint('empty_search')).toBe('поиск без результатов')
    expect(reasonHint('not_publish_day')).toBe('сегодня не день публикации')
    expect(reasonHint('not_ready')).toBe('страница не успела загрузиться')
  })

  it('falls back to the raw code for an unknown reason (visible, not swallowed)', () => {
    expect(reasonHint('some_new_code')).toBe('some_new_code')
  })
})
