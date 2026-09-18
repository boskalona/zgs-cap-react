import { useState } from 'react'
import { ThemeProvider, ShellBar, ShellBarItem, Icon } from '@ui5/webcomponents-react'
import JournalDashboard from './pages/JournalDashboard'
import InvoiceUpload from './pages/InvoiceUpload'

// icons ที่ใช้ทั้งแอป (UI5 web components ต้อง import ทีละตัว)
import '@ui5/webcomponents-icons/dist/money-bills.js'
import '@ui5/webcomponents-icons/dist/list.js'
import '@ui5/webcomponents-icons/dist/trend-up.js'
import '@ui5/webcomponents-icons/dist/trend-down.js'
import '@ui5/webcomponents-icons/dist/business-objects-experience.js'
import '@ui5/webcomponents-icons/dist/upload.js'
import '@ui5/webcomponents-icons/dist/download.js'
import '@ui5/webcomponents-icons/dist/save.js'
import '@ui5/webcomponents-icons/dist/paper-plane.js'
import '@ui5/webcomponents-icons/dist/synchronize.js'
import '@ui5/webcomponents-icons/dist/refresh.js'
import '@ui5/webcomponents-icons/dist/accept.js'
import '@ui5/webcomponents-icons/dist/circle-task-2.js'
import '@ui5/webcomponents-icons/dist/bar-chart.js'

const PAGES = [
  { key: 'journal', text: 'Journal Analytics', icon: 'bar-chart', el: <JournalDashboard /> },
  { key: 'invoice', text: 'Upload Supplier Invoice', icon: 'upload', el: <InvoiceUpload /> }
]

export default function App() {
  const [page, setPage] = useState('journal')
  const active = PAGES.find(p => p.key === page)

  return (
    <ThemeProvider>
      <div style={{ minHeight: '100vh', background: 'var(--sapBackgroundColor)' }}>
        <ShellBar primaryTitle="ZGS Finance" secondaryTitle={active.text}>
          {PAGES.map(p => (
            <ShellBarItem
              key={p.key}
              icon={p.icon}
              text={p.text}
              onClick={() => setPage(p.key)}
            />
          ))}
        </ShellBar>

        {/* แถบสลับหน้า — เห็นชัดกว่าไอคอนใน ShellBar อย่างเดียว */}
        <div style={{
          display: 'flex', gap: '0.25rem', padding: '0 1.25rem',
          borderBottom: '1px solid var(--sapGroup_ContentBorderColor)',
          background: 'var(--sapObjectHeader_Background)'
        }}>
          {PAGES.map(p => {
            const on = p.key === page
            return (
              <button
                key={p.key}
                onClick={() => setPage(p.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.45rem',
                  padding: '0.7rem 1rem', border: 'none', cursor: 'pointer',
                  background: 'transparent', font: 'inherit',
                  color: on ? 'var(--sapSelectedColor)' : 'var(--sapContent_LabelColor)',
                  borderBottom: `3px solid ${on ? 'var(--sapSelectedColor)' : 'transparent'}`
                }}
              >
                <Icon name={p.icon} />
                {p.text}
              </button>
            )
          })}
        </div>

        {/* mount ทั้งสองหน้าไว้ แล้วซ่อนหน้าที่ไม่ได้ใช้ → สลับแท็บแล้วไม่โหลดข้อมูลใหม่ */}
        {PAGES.map(p => (
          <div key={p.key} style={{ display: p.key === page ? 'block' : 'none' }}>{p.el}</div>
        ))}
      </div>
    </ThemeProvider>
  )
}
