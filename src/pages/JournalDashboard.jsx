import { useEffect, useMemo, useState } from 'react'
import {
  Card, CardHeader, AnalyticalTable, FlexBox, Title, Text, Label, Input, Button, ObjectStatus, Icon
} from '@ui5/webcomponents-react'
import { BarChart, DonutChart } from '@ui5/webcomponents-react-charts'
import { getJournal } from '../lib/api'

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmt2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const columns = [
  { Header: 'Company', accessor: 'CompanyCode', width: 90 },
  { Header: 'Company Name', accessor: 'CompanyCodeName', width: 150 },
  { Header: 'Year', accessor: 'FiscalYear', width: 70 },
  { Header: 'Per.', accessor: 'FiscalPeriod', width: 60 },
  { Header: 'G/L', accessor: 'GLAccountDisplay', width: 100 },
  { Header: 'G/L Name', accessor: 'GLAccountName', width: 170 },
  { Header: 'Segment', accessor: 'SegmentName', width: 120 },
  {
    Header: 'Amount', accessor: 'AmountInCompanyCurrency', hAlign: 'End', width: 140,
    Cell: ({ value }) => <ObjectStatus state={Number(value) < 0 ? 'Negative' : 'Positive'}>{fmt2(value)}</ObjectStatus>
  },
  {
    Header: 'Dir.', accessor: 'Direction', width: 90,
    Cell: ({ value }) => <ObjectStatus state={value === 'Credit' ? 'Negative' : 'Positive'}>{value}</ObjectStatus>
  }
]

function Kpi({ icon, label, value, sub, accent }) {
  return (
    <Card style={{ minWidth: '200px', flex: '1 1 200px' }}>
      <div style={{ padding: '1rem 1.15rem', display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
        <div style={{
          width: 46, height: 46, borderRadius: 12, flex: 'none', display: 'grid', placeItems: 'center',
          background: accent || 'var(--sapButton_Emphasized_Background)'
        }}>
          <Icon name={icon} style={{ color: '#fff', width: 22, height: 22 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <Label>{label}</Label>
          <Title level="H3" style={{ margin: '2px 0' }}>{value}</Title>
          {sub && <Text style={{ color: 'var(--sapNeutralColor)', fontSize: '12px' }}>{sub}</Text>}
        </div>
      </div>
    </Card>
  )
}

export default function JournalDashboard() {
  const [rows, setRows] = useState([])
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async (filter) => {
    setBusy(true); setError('')
    try {
      setRows(await getJournal(filter))
    } catch (e) {
      setError(e.message); setRows([])
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { load('') }, [])

  const m = useMemo(() => {
    let debit = 0, credit = 0
    const period = {}
    for (const r of rows) {
      const a = Number(r.AmountInCompanyCurrency || 0)
      if (a < 0) credit += Math.abs(a); else debit += a
      const p = `${r.FiscalYear}/${String(r.FiscalPeriod).padStart(3, '0')}`
      period[p] = (period[p] || 0) + a
    }
    const byPeriod = Object.entries(period).sort().map(([Period, Amount]) => ({ Period, Amount: Math.round(Amount) }))
    const dir = [{ name: 'Debit', val: Math.round(debit) }, { name: 'Credit', val: Math.round(credit) }]
    return {
      debit, credit, net: debit - credit, count: rows.length,
      companies: new Set(rows.map(r => r.CompanyCode)).size, byPeriod, dir
    }
  }, [rows])

  return (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1280, margin: '0 auto' }}>

      {error && <ObjectStatus state="Negative" showDefaultIcon>{error}</ObjectStatus>}

      {/* KPI tiles */}
      <FlexBox style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <Kpi icon="money-bills" label="Net Amount (THB)" value={fmt(m.net)} sub="Debit − Credit" />
        <Kpi icon="trend-up" label="Debit Total" value={fmt(m.debit)} sub="Positive postings" accent="var(--sapPositiveColor)" />
        <Kpi icon="trend-down" label="Credit Total" value={fmt(m.credit)} sub="Negative postings" accent="var(--sapNegativeColor)" />
        <Kpi icon="list" label="Journal Entries" value={fmt(m.count)} sub={`${m.companies} company`} accent="var(--sapInformativeColor)" />
      </FlexBox>

      {/* Charts */}
      <FlexBox style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <Card header={<CardHeader titleText="Amount by Period" subtitleText="ยอดสุทธิต่องวด" />} style={{ flex: '2 1 420px' }}>
          <div style={{ padding: '0.5rem', height: 300 }}>
            <BarChart dataset={m.byPeriod} dimensions={[{ accessor: 'Period' }]} measures={[{ accessor: 'Amount', label: 'Amount' }]} />
          </div>
        </Card>
        <Card header={<CardHeader titleText="Debit vs Credit" subtitleText="สัดส่วน" />} style={{ flex: '1 1 280px' }}>
          <div style={{ padding: '0.5rem', height: 300 }}>
            <DonutChart dataset={m.dir} dimension={{ accessor: 'name' }} measure={{ accessor: 'val' }} />
          </div>
        </Card>
      </FlexBox>

      {/* Filter */}
      <Card>
        <div style={{ padding: '0.85rem 1.15rem', display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name="business-objects-experience" style={{ color: 'var(--sapContent_IconColor)' }} />
          <Label for="cc">Company Code</Label>
          <Input id="cc" value={company} placeholder="e.g. 6810" onInput={(e) => setCompany(e.target.value)} />
          <Button design="Emphasized" onClick={() => load(company)}>Go</Button>
          <Button design="Transparent" onClick={() => { setCompany(''); load('') }}>Reset</Button>
          <span style={{ marginLeft: 'auto', color: 'var(--sapNeutralColor)', fontSize: 13 }}>{m.count} rows</span>
        </div>
      </Card>

      {/* Table */}
      <div>
        <Title level="H4" style={{ marginBottom: '0.5rem' }}>Journal Entries</Title>
        <AnalyticalTable columns={columns} data={rows} loading={busy} visibleRows={10} minRows={5} filterable sortable alternateRowColor />
      </div>

    </div>
  )
}
