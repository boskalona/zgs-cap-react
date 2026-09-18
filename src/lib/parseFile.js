/**
 * parseFile.js — อ่านไฟล์ CSV / Excel ในเบราว์เซอร์ → rows พร้อมส่งเข้า action uploadInvoiceBatch
 *
 * ทำ 2 อย่าง:
 *   1) parse ไฟล์ (papaparse สำหรับ CSV · SheetJS สำหรับ .xlsx/.xls)
 *   2) map header ของไฟล์ → ชื่อ property ตาม type InvoiceRow ใน CAP
 *
 * หมายเหตุ: ฝั่ง CAP (srv/lib/invoice-transform.js) ยังมี alias map ของตัวเองอีกชั้น
 * ไว้รองรับ caller อื่น (integration/Postman ที่ส่งชื่อ field แบบ SAP เช่น bukrs, ebeln)
 * — ที่นี่แปลงก่อนเพราะ OData v4 ยึดชื่อ property ตาม type ที่ประกาศไว้
 */
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

/** header ที่ต้องมี (PO-based) */
export const TEMPLATE_HEADERS = [
    'Vendor Code', 'Company Code', 'Document Date', 'Posting Date',
    'Currency', 'Gross Amount',
    // เลือกอย่างใดอย่างหนึ่ง: มี PO Number = PO-based · ไม่มี = Non-PO ต้องมี GL Account
    'PO Number', 'PO Item', 'GL Account'
]

/** header ที่ใส่ก็ได้ไม่ใส่ก็ได้ — account assignment
 *  ไม่กรอก = ให้ S/4 ใช้ของ PO ตามปกติ (ปลอดภัยที่สุด)
 *  💡 FI Segment ไม่ต้องกรอก — S/4 derive จาก Profit Center ให้เอง */
export const OPTIONAL_HEADERS = [
    // S/4 มักบังคับตอนโพสต์ (ไทยใช้ Tax Code V0/V1 · Business Place = รหัสสาขาภาษี)
    'Tax Code', 'Business Place', 'Quantity', 'UoM',
    // GR-based invoice verification (อ้างเอกสารรับของ)
    'Material Document', 'Material Document Year', 'Material Document Item',
    // service PO (lean services)
    'Service Entry Sheet', 'SES Item',
    // account assignment
    'Profit Center', 'Cost Center', 'WBS Element', 'Internal Order', 'Profitability Segment'
]

/** ทำ key ให้เทียบง่าย: ตัดช่องว่าง/ขีด/จุด + ตัวเล็ก (ตรงกับ canon() ฝั่ง CAP) */
const canon = (s) => String(s ?? '').toLowerCase().replace(/[\s_\-.()]/g, '')

/** header ที่ยอมรับ → ชื่อ property ของ InvoiceRow */
const FIELD_ALIASES = {
    vendorCode: ['vendorcode', 'vendor', 'supplier', 'suppliercode', 'invoicingparty'],
    companyCode: ['companycode', 'company', 'bukrs'],
    documentDate: ['documentdate', 'docdate', 'invoicedate'],
    postingDate: ['postingdate', 'postdate'],
    currency: ['currency', 'documentcurrency', 'waers'],
    grossAmount: ['grossamount', 'amount', 'invoicegrossamount', 'total'],
    purchaseOrder: ['ponumber', 'purchaseorder', 'po', 'ebeln'],
    purchaseOrderItem: ['poitem', 'purchaseorderitem', 'poitemno', 'ebelp'],
    glAccount: ['glaccount', 'gl', 'account', 'hkont'],
    // S/4 บังคับตอนโพสต์ PO-based
    taxCode: ['taxcode', 'tax', 'mwskz'],
    businessPlace: ['businessplace', 'branch', 'branchcode', 'bupla'],
    quantity: ['quantity', 'qty', 'menge', 'invoicequantity'],
    quantityUnit: ['quantityunit', 'uom', 'unit', 'meins', 'baseunit'],
    // GR-based invoice verification
    referenceDocument: ['referencedocument', 'materialdocument', 'grdocument', 'mblnr'],
    referenceDocumentFiscalYear: ['referencedocumentfiscalyear', 'materialdocumentyear', 'mjahr'],
    referenceDocumentItem: ['referencedocumentitem', 'materialdocumentitem', 'zeile'],
    // service PO
    serviceEntrySheet: ['serviceentrysheet', 'ses', 'entrysheet', 'lblni'],
    serviceEntrySheetItem: ['serviceentrysheetitem', 'sesitem', 'entrysheetitem'],
    // account assignment (ไม่บังคับ)
    profitCenter: ['profitcenter', 'pc', 'prctr'],
    costCenter: ['costcenter', 'cc2', 'kostl'],
    wbsElement: ['wbselement', 'wbs', 'posid', 'projectelement'],
    internalOrder: ['internalorder', 'order', 'aufnr'],
    profitabilitySegment: ['profitabilitysegment', 'profitsegment', 'copa', 'paobjnr', 'rkeobjnr']
}

/** Date object → 'YYYY-MM-DD' (กัน timezone เลื่อนวัน) */
const dateToIso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** ทุกค่าที่ส่งไป CAP เป็น string (type InvoiceRow ประกาศเป็น String ทุกช่องโดยเจตนา) */
function toText(v) {
    if (v == null) return ''
    if (v instanceof Date) return isNaN(v) ? '' : dateToIso(v)
    return String(v).trim()
}

/** raw row (key = header ในไฟล์) → InvoiceRow */
export function mapRow(raw) {
    const byCanon = {}
    for (const [k, v] of Object.entries(raw || {})) byCanon[canon(k)] = v

    const row = {}
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        const hit = aliases.find(a => byCanon[a] !== undefined && toText(byCanon[a]) !== '')
        row[field] = hit ? toText(byCanon[hit]) : ''
    }
    return row
}

/** header ในไฟล์ที่ไม่ตรง alias ไหนเลย → เอาไปเตือนผู้ใช้ */
export function unknownHeaders(raw) {
    const known = new Set(Object.values(FIELD_ALIASES).flat())
    return Object.keys(raw || {}).filter(h => h && !known.has(canon(h)))
}

/**
 * parse ไฟล์ → { rows, raw, skipped }
 *   rows    = InvoiceRow[] พร้อมส่งเข้า action
 *   raw     = แถวดิบ (ใช้โชว์ preview / หา header ที่ไม่รู้จัก)
 *   skipped = จำนวนแถวว่างที่ข้ามไป
 */
export async function parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    let raw

    if (ext === 'csv' || ext === 'txt') {
        raw = await new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: 'greedy',
                transformHeader: (h) => String(h || '').trim(),
                complete: (r) => resolve(r.data),
                error: reject
            })
        })
    } else if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        if (!ws) throw new Error('ไม่พบ sheet ในไฟล์')
        raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
    } else {
        throw new Error(`ไม่รองรับไฟล์ .${ext} — ใช้ .csv, .xlsx หรือ .xls`)
    }

    // ตัดแถวที่ทุกช่องว่าง
    const before = raw.length
    raw = raw.filter(r => Object.values(r).some(v => toText(v) !== ''))

    return { rows: raw.map(mapRow), raw, skipped: before - raw.length }
}

/** สร้างไฟล์ template ให้ผู้ใช้ดาวน์โหลด */
export function downloadTemplate() {
    const cols = [...TEMPLATE_HEADERS, ...OPTIONAL_HEADERS]
    const row = (v) => cols.map(h => v[h] ?? '').join(',')
    const csv = [
        cols.join(','),
        // แถว 1: Non-PO — ชุดนี้โพสต์ผ่านจริงแล้ว (ไม่ต้องมี PO / ไม่แตะบัญชีพัก GR-IR)
        row({
            'Vendor Code': '1000000', 'Company Code': '6810',
            'Document Date': '2026-08-31', 'Posting Date': '2026-08-31',
            'Currency': 'THB', 'Gross Amount': '100.00',
            'GL Account': '65001000', 'Cost Center': '68101101',
            'Tax Code': 'V0', 'Business Place': '0000'
        }),
        // แถว 2: Non-PO + ระบุ Profit Center เอง (Segment จะ derive ตามให้)
        row({
            'Vendor Code': '1000000', 'Company Code': '6810',
            'Document Date': '2026-08-31', 'Posting Date': '2026-08-31',
            'Currency': 'THB', 'Gross Amount': '250.00',
            'GL Account': '63005000', 'Cost Center': '68101201',
            'Tax Code': 'V0', 'Business Place': '0000', 'Profit Center': 'YB101'
        }),
        // แถว 3: PO-based — ต้องมี tax/qty/uom และ S/4 ต้อง config บัญชี GR-IR (WRX) ไว้ก่อน
        row({
            'Vendor Code': '1000000', 'Company Code': '6810',
            'Document Date': '2026-08-31', 'Posting Date': '2026-08-31',
            'Currency': 'THB', 'Gross Amount': '100.00',
            'PO Number': '4500000041', 'PO Item': '10',
            'Tax Code': 'V0', 'Business Place': '0000', 'Quantity': '1', 'UoM': 'PC'
        })
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'supplier-invoice-template.csv'
    a.click()
    URL.revokeObjectURL(url)
}
