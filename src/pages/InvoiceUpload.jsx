import { useEffect, useRef, useState } from 'react'
import {
  Card, CardHeader, AnalyticalTable, FlexBox, Title, Text, Label, Button, ObjectStatus,
  Icon, MessageStrip, ProgressIndicator, BusyIndicator, List, ListItemStandard
} from '@ui5/webcomponents-react'
import { parseFile, unknownHeaders, downloadTemplate, TEMPLATE_HEADERS } from '../lib/parseFile'
import { uploadInvoiceBatch, processInvoiceBatch, retryFailedItems, getBatch, getItems, getBatches } from '../lib/api'

const fmt2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const POLL_MS = 1500

const STATE_OF = { Success: 'Positive', Failed: 'Negative', Pending: 'Information' }
const BATCH_STATE = {
  Completed: 'Positive', CompletedWithErrors: 'Critical', Processing: 'Information', Pending: 'None'
}

/** คอลัมน์ preview ก่อน upload — โชว์ตรง ๆ จากไฟล์ */
const previewColumns = [
  { Header: '#', accessor: '_row', width: 50 },
  { Header: 'Vendor', accessor: 'vendorCode', width: 110 },
  { Header: 'CC', accessor: 'companyCode', width: 70 },
  { Header: 'Doc Date', accessor: 'documentDate', width: 110 },
  { Header: 'Posting', accessor: 'postingDate', width: 110 },
  { Header: 'Curr', accessor: 'currency', width: 70 },
  { Header: 'Amount', accessor: 'grossAmount', width: 120, hAlign: 'End' },
  { Header: 'PO', accessor: 'purchaseOrder', width: 120 },
  { Header: 'Item', accessor: 'purchaseOrderItem', width: 70 }
]

/** คอลัมน์ผลลัพธ์ต่อแถว — สถานะ + เลขเอกสาร S/4 + error */
const itemColumns = [
  { Header: '#', accessor: 'rowNumber', width: 50 },
  {
    Header: 'Status', accessor: 'status', width: 110,
    Cell: ({ value }) => <ObjectStatus state={STATE_OF[value] || 'None'} showDefaultIcon>{value}</ObjectStatus>
  },
  { Header: 'Vendor', accessor: 'vendorCode', width: 100 },
  { Header: 'CC', accessor: 'companyCode', width: 60 },
  { Header: 'PO', accessor: 'purchaseOrder', width: 115 },
  {
    Header: 'Amount', accessor: 'grossAmount', width: 110, hAlign: 'End',
    Cell: ({ value }) => fmt2(value)
  },
  {
    Header: 'S/4 Invoice', accessor: 's4InvoiceDocNo', width: 130,
    Cell: ({ row }) => row.original.s4InvoiceDocNo
      ? <ObjectStatus state="Positive">{row.original.s4InvoiceDocNo} / {row.original.s4FiscalYear}</ObjectStatus>
      : <Text style={{ color: 'var(--sapNeutralColor)' }}>—</Text>
  },
  {
    Header: 'Message', accessor: 'errorMessage', width: 420,
    Cell: ({ value }) => value
      ? <span title={value} style={{ color: 'var(--sapNegativeColor)', fontSize: 12 }}>{value}</span>
      : null
  }
]

function Step({ n, title, done, children }) {
  return (
    <Card
      header={<CardHeader
        titleText={`${n}. ${title}`}
        avatar={<Icon name={done ? 'accept' : 'circle-task-2'}
          style={{ color: done ? 'var(--sapPositiveColor)' : 'var(--sapContent_IconColor)' }} />}
      />}
    >
      <div style={{ padding: '0.85rem 1.15rem' }}>{children}</div>
    </Card>
  )
}

export default function InvoiceUpload() {
  const [parsed, setParsed] = useState(null)     // { rows, raw, skipped, fileName }
  const [warnings, setWarnings] = useState([])
  const [batch, setBatch] = useState(null)       // แถว Batches จาก DB
  const [items, setItems] = useState([])
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')           // '' | 'parse' | 'upload' | 'process' | 'retry'
  const pollRef = useRef(null)

  // ───── polling: refresh สถานะระหว่าง process/retry กำลังวิ่ง ─────
  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  const startPoll = (batchID) => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const [b, its] = await Promise.all([getBatch(batchID), getItems(batchID)])
        setBatch(b); setItems(its)
      } catch { /* กลืน error ตอน poll — ปุ่มหลักจะรายงานเอง */ }
    }, POLL_MS)
  }
  useEffect(() => stopPoll, [])

  const loadHistory = async () => {
    try { setHistory(await getBatches(10)) } catch (e) { /* ไม่สำคัญพอจะบล็อกหน้าจอ */ }
  }
  useEffect(() => { loadHistory() }, [])

  const refresh = async (batchID) => {
    const [b, its] = await Promise.all([getBatch(batchID), getItems(batchID)])
    setBatch(b); setItems(its)
  }

  // ───── 1) เลือกไฟล์ → parse ในเบราว์เซอร์ ─────
  const onFile = async (e) => {
    const file = (e.detail?.files || e.target?.files || [])[0]
    if (!file) return
    setError(''); setInfo(''); setBatch(null); setItems([]); setBusy('parse')
    try {
      const res = await parseFile(file)
      if (!res.rows.length) throw new Error('ไม่พบข้อมูลในไฟล์ (มีแต่ header?)')
      setParsed({ ...res, fileName: file.name })
      const unknown = res.raw.length ? unknownHeaders(res.raw[0]) : []
      const w = []
      if (unknown.length) w.push(`คอลัมน์ที่ระบบไม่รู้จัก (จะถูกข้าม): ${unknown.join(', ')}`)
      if (res.skipped) w.push(`ข้ามแถวว่าง ${res.skipped} แถว`)
      setWarnings(w)
    } catch (err) {
      setParsed(null); setError(err.message)
    } finally {
      setBusy('')
    }
  }

  // ───── 2) upload → CAP validate + เก็บ batch (ยังไม่ยิง S/4) ─────
  const onUpload = async () => {
    setBusy('upload'); setError(''); setInfo('')
    try {
      const res = await uploadInvoiceBatch(parsed.fileName, parsed.rows)
      await refresh(res.batchID)
      await loadHistory()
      setInfo(`บันทึก batch แล้ว: ${res.totalRows} แถว (ผ่าน validate ${res.validRows} · ไม่ผ่าน ${res.invalidRows})`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  // ───── 3) process / retry → ยิงไป S/4 ทีละแถว ─────
  const run = async (kind) => {
    const fn = kind === 'retry' ? retryFailedItems : processInvoiceBatch
    setBusy(kind); setError(''); setInfo('')
    startPoll(batch.ID)
    try {
      const res = await fn(batch.ID)
      setInfo(`${kind === 'retry' ? 'Retry' : 'Process'} เสร็จ: ส่ง ${res.processed} แถว · สำเร็จ ${res.success} · ไม่สำเร็จ ${res.failed}`)
    } catch (err) {
      setError(err.message)   // เช่น 502 ต่อ S/4 ไม่ได้ — สถานะรายแถวยังถูกบันทึกไว้
    } finally {
      stopPoll()
      setBusy('')
      try { await refresh(batch.ID); await loadHistory() } catch { /* ignore */ }
    }
  }

  const openHistory = async (b) => {
    setError(''); setInfo(''); setParsed(null)
    try { await refresh(b.ID) } catch (err) { setError(err.message) }
  }

  const failedCount = items.filter(i => i.status === 'Failed').length
  const successCount = items.filter(i => i.status === 'Success').length
  const pendingCount = items.filter(i => i.status === 'Pending').length
  const donePct = items.length ? Math.round(((successCount + failedCount) / items.length) * 100) : 0
  const previewRows = parsed ? parsed.rows.map((r, i) => ({ ...r, _row: i + 1 })) : []

  return (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 1280, margin: '0 auto' }}>

      {error && <MessageStrip design="Negative" onClose={() => setError('')}>{error}</MessageStrip>}
      {info && <MessageStrip design="Positive" onClose={() => setInfo('')}>{info}</MessageStrip>}
      {warnings.map((w, i) => <MessageStrip key={i} design="Critical" hideCloseButton>{w}</MessageStrip>)}

      {/* ─── STEP 1: เลือกไฟล์ ─── */}
      <Step n="1" title="เลือกไฟล์ CSV / Excel" done={!!parsed}>
        <FlexBox style={{ gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* ใช้ input ปกติ — คุมง่ายและไม่ผูกกับ event ของ web component */}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
            border: '1px solid var(--sapButton_BorderColor)', borderRadius: 'var(--sapButton_BorderCornerRadius)',
            padding: '0.4rem 0.8rem', background: 'var(--sapButton_Background)'
          }}>
            <Icon name="upload" />
            <span>เลือกไฟล์…</span>
            <input type="file" accept=".csv,.xlsx,.xls,.txt" style={{ display: 'none' }} onChange={onFile} />
          </label>
          <Button design="Transparent" icon="download" onClick={downloadTemplate}>ดาวน์โหลด template</Button>
          {busy === 'parse' && <BusyIndicator active size="S" />}
          {parsed && <Text>{parsed.fileName} — <b>{parsed.rows.length}</b> แถว</Text>}
        </FlexBox>
        <Text style={{ display: 'block', marginTop: '0.5rem', color: 'var(--sapNeutralColor)', fontSize: 12 }}>
          คอลัมน์ที่ต้องมี (PO-based): {TEMPLATE_HEADERS.join(' · ')}
        </Text>
      </Step>

      {/* ─── STEP 2: preview + upload ─── */}
      {parsed && (
        <Step n="2" title="ตรวจข้อมูล แล้วบันทึกเป็น batch" done={!!batch}>
          <div style={{ height: 260, marginBottom: '0.75rem' }}>
            <AnalyticalTable columns={previewColumns} data={previewRows} visibleRows={6} minRows={3} alternateRowColor />
          </div>
          <Button design="Emphasized" icon="save" disabled={!!busy} onClick={onUpload}>
            {busy === 'upload' ? 'กำลังบันทึก…' : `Upload ${parsed.rows.length} แถว`}
          </Button>
          <Text style={{ display: 'block', marginTop: '0.4rem', color: 'var(--sapNeutralColor)', fontSize: 12 }}>
            ขั้นนี้ยังไม่ส่งไป S/4 — CAP จะ validate ทีละแถวแล้วคืน batch ID ให้ทันที
          </Text>
        </Step>
      )}

      {/* ─── STEP 3: process ไป S/4 ─── */}
      {batch && (
        <Step n="3" title="ส่งขึ้น S/4HANA" done={batch.status === 'Completed'}>
          <FlexBox style={{ gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <Label>Batch</Label>
              <Text style={{ display: 'block', fontFamily: 'monospace', fontSize: 12 }}>{batch.ID}</Text>
            </div>
            <div>
              <Label>File</Label>
              <Text style={{ display: 'block' }}>{batch.fileName}</Text>
            </div>
            <div>
              <Label>Uploaded by</Label>
              <Text style={{ display: 'block' }}>{batch.uploadedBy} · {new Date(batch.createdAt).toLocaleString()}</Text>
            </div>
            <div>
              <Label>Status</Label>
              <ObjectStatus state={BATCH_STATE[batch.status] || 'None'} showDefaultIcon>{batch.status}</ObjectStatus>
            </div>
          </FlexBox>

          <FlexBox style={{ gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <ObjectStatus state="Positive">Success {successCount}</ObjectStatus>
            <ObjectStatus state="Negative">Failed {failedCount}</ObjectStatus>
            <ObjectStatus state="Information">Pending {pendingCount}</ObjectStatus>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <ProgressIndicator value={donePct} valueState={failedCount ? 'Critical' : 'Positive'} displayValue={`${donePct}%`} />
            </div>
          </FlexBox>

          <FlexBox style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button design="Emphasized" icon="paper-plane" disabled={!!busy || pendingCount === 0} onClick={() => run('process')}>
              {busy === 'process' ? 'กำลังส่ง…' : `Post to S/4 (${pendingCount})`}
            </Button>
            <Button icon="synchronize" disabled={!!busy || failedCount === 0} onClick={() => run('retry')}>
              {busy === 'retry' ? 'กำลัง retry…' : `Retry Failed (${failedCount})`}
            </Button>
            <Button design="Transparent" icon="refresh" disabled={!!busy} onClick={() => refresh(batch.ID)}>Refresh</Button>
            {(busy === 'process' || busy === 'retry') && <BusyIndicator active size="S" />}
          </FlexBox>
          <Text style={{ display: 'block', marginTop: '0.4rem', color: 'var(--sapNeutralColor)', fontSize: 12 }}>
            Retry ส่งเฉพาะแถวที่ Failed และข้อมูลผ่าน validate แล้ว — แถวที่ข้อมูลผิดต้องแก้ไฟล์แล้ว upload ใหม่
          </Text>
        </Step>
      )}

      {/* ─── ผลลัพธ์รายแถว ─── */}
      {batch && (
        <div>
          <Title level="H4" style={{ marginBottom: '0.5rem' }}>ผลลัพธ์รายแถว ({items.length})</Title>
          <AnalyticalTable columns={itemColumns} data={items} visibleRows={10} minRows={5} filterable sortable alternateRowColor />
        </div>
      )}

      {/* ─── ประวัติ batch ─── */}
      <Card header={<CardHeader titleText="Upload Log" subtitleText="10 batch ล่าสุด — ใคร/เมื่อไหร่/สำเร็จเท่าไร" />}>
        <List onItemClick={(e) => openHistory(history[Number(e.detail.item.dataset.idx)])}>
          {history.map((b, i) => (
            <ListItemStandard
              key={b.ID}
              data-idx={i}
              text={`${b.fileName} — ${b.totalRows} แถว`}
              additionalText={b.status}
              additionalTextState={BATCH_STATE[b.status] || 'None'}
              description={`${b.uploadedBy} · ${new Date(b.createdAt).toLocaleString()} · ok ${b.successCount} / fail ${b.failedCount}`}
            />
          ))}
        </List>
        {!history.length && <div style={{ padding: '1rem' }}><Text>ยังไม่มีประวัติการอัปโหลด</Text></div>}
      </Card>

    </div>
  )
}
