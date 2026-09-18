/**
 * api.js — เรียก InvoiceService (CAP OData v4) ที่ /odata/v4/invoice
 * dev: vite proxy /odata → http://localhost:4004
 * prod: React ถูก serve จาก approuter เดียวกัน → path เดียวกันใช้ได้เลย
 */
const INV = '/odata/v4/invoice'
const ZGS = '/odata/v4/zgs'

/** ดึงข้อความ error ที่อ่านรู้เรื่องจาก CAP/OData (แทนที่จะโชว์ "500") */
function errorOf(payload, res, text) {
    const e = payload?.error
    if (e) {
        const main = typeof e.message === 'string' ? e.message : e.message?.value
        const details = (e.details || []).map(d => d.message).filter(Boolean)
        return [main, ...details].filter(Boolean).join(' · ') || `HTTP ${res.status}`
    }
    return (text || '').slice(0, 300) || `HTTP ${res.status} ${res.statusText}`
}

async function request(url, options) {
    let res
    try {
        res = await fetch(url, options)
    } catch (err) {
        // network ล้ม / เซิร์ฟเวอร์ไม่ขึ้น → ข้อความที่บอกทางแก้
        throw new Error(`เชื่อมต่อ backend ไม่ได้ (${err.message}) — ตรวจว่า cds watch รันอยู่ที่ port 4004`)
    }
    const text = await res.text()
    let payload = null
    try { payload = text ? JSON.parse(text) : null } catch { /* ไม่ใช่ JSON */ }
    if (!res.ok) throw new Error(errorOf(payload, res, text))
    return payload
}

const callAction = (name, data) => request(`${INV}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(data)
})

// ───────── actions ─────────
export const uploadInvoiceBatch = (fileName, rows) => callAction('uploadInvoiceBatch', { fileName, rows })
export const processInvoiceBatch = (batchID) => callAction('processInvoiceBatch', { batchID })
export const retryFailedItems = (batchID) => callAction('retryFailedItems', { batchID })

// ───────── reads (ใช้ poll สถานะ) ─────────
export const getBatches = async (top = 20) =>
    (await request(`${INV}/Batches?$orderby=createdAt desc&$top=${top}`)).value || []

export const getBatch = (batchID) => request(`${INV}/Batches/${batchID}`)

export const getItems = async (batchID) =>
    (await request(`${INV}/Items?$filter=batch_ID eq ${batchID}&$orderby=rowNumber&$top=1000`)).value || []

// ───────── journal (หน้า dashboard เดิม) ─────────
export const getJournal = async (companyCode) => {
    let url = `${ZGS}/JournalEntryItem?$orderby=CompanyCode,FiscalYear,FiscalPeriod`
    if (companyCode) url += `&$filter=CompanyCode eq '${companyCode}'`
    return (await request(url)).value || []
}
