import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnName, columnWidths, csvSheet, decodeText, looksNumeric, parseDelimited, sniffDelimiter, workbookSheets } from './sheet.js'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('csv', () => {
  it('handles quotes, doubled quotes and newlines inside quotes', () => {
    const { rows } = parseDelimited('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n', ',')
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3']
    ])
  })

  it('sniffs tabs and semicolons', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a,b\n1,2')).toBe(',')
  })

  it('reads a GBK file without mojibake and strips a UTF-8 BOM', () => {
    // 客户,金额 in GBK.
    const gbk = Uint8Array.from([0xbf, 0xcd, 0xbb, 0xa7, 0x2c, 0xbd, 0xf0, 0xb6, 0xee])
    expect(decodeText(gbk)).toBe('客户,金额')
    expect(decodeText(enc('﻿name'))).toBe('name')
  })

  it('caps rows and keeps the real count', () => {
    const { rows, total } = parseDelimited('a\nb\nc\nd\n', ',', 2)
    expect(rows).toEqual([['a'], ['b']])
    expect(total).toBe(4)
    const s = csvSheet(enc('x,y\n1\n'))
    expect(s.cols).toBe(2)
    expect(s.truncated).toBe(false)
  })
})

describe('workbook', () => {
  it('reads every visible sheet as formatted text', () => {
    const wb = XLSX.utils.book_new()
    const a = XLSX.utils.aoa_to_sheet([
      ['Item', 'Qty', 'Price'],
      ['End mill', 4, 12.5]
    ])
    a.C2.z = '$0.00'
    XLSX.utils.book_append_sheet(wb, a, 'Quote')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['secret']]), 'Hidden')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['notes']]), 'Notes')
    wb.Workbook = { Sheets: [{ name: 'Quote' }, { name: 'Hidden', Hidden: 1 }, { name: 'Notes' }] }
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    const sheets = workbookSheets(bytes)
    expect(sheets.map((s) => s.name)).toEqual(['Quote', 'Notes'])
    expect(sheets[0].rows).toEqual([
      ['Item', 'Qty', 'Price'],
      ['End mill', '4', '$12.50']
    ])
    expect(sheets[0].cols).toBe(3)
  })
})

describe('grid helpers', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('right-aligns numbers, money and percents only', () => {
    expect(['12', '-3.5', '1,200', '$12.50', '15%', '(4)', '¥ 300'].every(looksNumeric)).toBe(true)
    expect(['abc', '12 pcs', '2024-01-02', ''].some(looksNumeric)).toBe(false)
  })

  it('sizes columns by content, wide glyphs double', () => {
    const [narrow, cjk, long] = columnWidths([['a', '客户名称', 'x'.repeat(500)]], 3)
    expect(narrow).toBe(64)
    expect(cjk).toBeGreaterThan(64)
    expect(long).toBe(360)
  })
})
