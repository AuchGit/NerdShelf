// components/ui/GlobalToolbar.jsx — Always visible: settings + bug report
import { useState } from 'react'
import SettingsModal from './SettingsModal'
import BugReportModal from './BugReportModal'

export default function GlobalToolbar({ session }) {
  const [showSettings, setShowSettings] = useState(false)
  const [showBugReport, setShowBugReport] = useState(false)

  return (
    <>
      <div style={S.bar}>
        <button style={S.btn} onClick={() => setShowSettings(true)} title="Einstellungen">⚙️</button>
        <button style={S.btn} onClick={() => setShowBugReport(true)} title="Bug melden">🐛</button>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} session={session} />}
      {showBugReport && <BugReportModal onClose={() => setShowBugReport(false)} session={session} />}
    </>
  )
}

const S = {
  bar: {
    position: 'fixed', bottom: 16, right: 16, zIndex: 9990,
    display: 'flex', gap: 6,
  },
  btn: {
    width: 40, height: 40, borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    boxShadow: '0 2px 12px var(--shadow)', cursor: 'pointer',
    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
}
