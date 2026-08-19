import { useEffect, useMemo, useState } from 'react'
import {
  ThemeProvider,
  ShellBar,
  Card,
  CardHeader,
  AnalyticalTable,
  FlexBox,
  Title,
  Label,
  Text,
  Input,
  Button,
  ObjectStatus
} from '@ui5/webcomponents-react'

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const columns = [
  { Header: 'Company', accessor: 'CompanyCode', width: 100 },
  { Header: 'Year', accessor: 'FiscalYear', width: 80 },
  { Header: 'Period', accessor: 'FiscalPeriod', width: 80 },
  { Header: 'G/L Account', accessor: 'GLAccountDisplay', width: 130 },  // ← ใช้ field ที่ mask แล้ว (7xxx → 99999999)
  { Header: 'Profit Ctr', accessor: 'ProfitCenter', width: 110 },
  { Header: 'Cost Ctr', accessor: 'CostCenter', width: 100 },
  {
    Header: 'Amount',
    accessor: 'AmountInCompanyCurrency',
    hAlign: 'End',
    width: 140,
    Cell: ({ value }) => (
      <ObjectStatus state={Number(value) < 0 ? 'Negative' : 'Positive'}>{fmt(value)}</ObjectStatus>
    )
  },
  { Header: 'Cur', accessor: 'CompanyCodeCurrency', width: 70 },
  {
    Header: 'Direction',
    accessor: 'Direction',            // ← virtual field จาก CAP (after READ handler)
    width: 100,
    Cell: ({ value }) => (
      <ObjectStatus state={value === 'Credit' ? 'Negative' : 'Positive'}>{value}</ObjectStatus>
    )
  }
]

function Kpi({ label, value, sub }) {
  return (
    <Card style={{ width: '240px' }}>
      <div style={{ padding: '1rem 1.25rem' }}>
        <Label>{label}</Label>
        <Title level="H2" style={{ marginTop: '0.25rem' }}>{value}</Title>
        {sub && <Text style={{ color: 'var(--sapNeutralColor)' }}>{sub}</Text>}
      </div>
    </Card>
  )
}

export default function App() {
  const [rows, setRows] = useState([])
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [byCompany, setByCompany] = useState([])   // ผลจาก function totalByCompany()

  const load = async (filter) => {
    setBusy(true)
    let url = '/odata/v4/zgs/JournalEntryItem?$orderby=CompanyCode,FiscalYear,FiscalPeriod'
    if (filter) url += `&$filter=CompanyCode eq '${filter}'`
    const res = await fetch(url)
    const data = await res.json()
    setRows(data.value || [])
    setBusy(false)
  }

  // เรียก custom function totalByCompany() มาโชว์เป็นสรุป
  const loadTotals = async () => {
    try {
      const res = await fetch('/odata/v4/zgs/totalByCompany()')
      const data = await res.json()
      setByCompany(data.value || [])
    } catch { /* ignore */ }
  }

  useEffect(() => { load(''); loadTotals() }, [])

  const kpis = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.AmountInCompanyCurrency || 0), 0)
    const companies = new Set(rows.map((r) => r.CompanyCode)).size
    return { total, companies, count: rows.length }
  }, [rows])

  return (
    <ThemeProvider>
      <div style={{ minHeight: '100vh', background: 'var(--sapBackgroundColor)' }}>
        <ShellBar
          primaryTitle="ZGS Journal"
          secondaryTitle="Finance Analytics · React + UI5 + CAP"
        />

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* KPI row */}
          <FlexBox style={{ gap: '1rem', flexWrap: 'wrap' }}>
            <Kpi label="Total Amount (THB)" value={fmt(kpis.total)} sub="Sum of shown rows" />
            <Kpi label="Journal Entries" value={kpis.count} sub="Rows returned" />
            <Kpi label="Company Codes" value={kpis.companies} sub="Distinct companies" />
          </FlexBox>

          {/* Total by Company — จาก custom function totalByCompany() */}
          <Card>
            <div style={{ padding: '1rem 1.25rem' }}>
              <Title level="H5" style={{ marginBottom: '0.75rem' }}>
                Total by Company <span style={{ color: 'var(--sapNeutralColor)', fontWeight: 400, fontSize: '13px' }}>· via totalByCompany()</span>
              </Title>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--sapNeutralColor)', fontSize: '12px' }}>
                    <th style={{ padding: '6px 8px' }}>Company</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total (THB)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {byCompany.length === 0 && (
                    <tr><td colSpan={3} style={{ padding: '6px 8px', color: 'var(--sapNeutralColor)' }}>—</td></tr>
                  )}
                  {byCompany.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--sapList_BorderColor)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.CompanyCode}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(r.total)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Filter card */}
          <Card>
            <div style={{ padding: '1rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Label for="cc">Company Code</Label>
              <Input
                id="cc"
                value={company}
                placeholder="e.g. 6810"
                onInput={(e) => setCompany(e.target.value)}
              />
              <Button design="Emphasized" onClick={() => load(company)}>Go</Button>
              <Button design="Transparent" onClick={() => { setCompany(''); load('') }}>Reset</Button>
            </div>
          </Card>

          {/* Table (AnalyticalTable needs a plain sized container, not inside a Card) */}
          <div>
            <Title level="H4" style={{ marginBottom: '0.5rem' }}>
              Journal Entries — {rows.length} record(s)
            </Title>
            <AnalyticalTable
              columns={columns}
              data={rows}
              loading={busy}
              visibleRows={10}
              minRows={5}
              filterable
              sortable
              alternateRowColor
            />
          </div>
        </div>
      </div>
    </ThemeProvider>
  )
}
