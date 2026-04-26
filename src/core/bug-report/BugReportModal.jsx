// src/core/bug-report/BugReportModal.jsx
import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Modal, Button } from '../../shared/ui'
import {
  buildReportPayload, sendBugReport,
  detectActiveTool, getRecentLogs,
} from './collector'

export default function BugReportModal({ open, onClose }) {
  const { user } = useAuth()
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [appVersion, setAppVersion] = useState('web')

  useEffect(() => {
    if (!open) return
    if (window.__TAURI_INTERNALS__) {
      import('@tauri-apps/api/app')
        .then(m => m.getVersion())
        .then(v => setAppVersion(v))
        .catch(() => setAppVersion('web'))
    }
  }, [open])

  // Reset form whenever modal closes
  useEffect(() => {
    if (!open) {
      setDescription('')
      setResult(null)
      setSending(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!description.trim()) {
      setResult({ type: 'error', text: 'Bitte beschreibe den Bug.' })
      return
    }
    setSending(true)
    setResult(null)

    try {
      const payload = await buildReportPayload({ description, priority, user })
      const res = await sendBugReport(payload)
      if (res.ok) {
        setResult({ type: 'success', text: 'Bug Report gesendet! Danke für dein Feedback.' })
        setTimeout(() => onClose?.(), 1800)
      } else {
        setResult({ type: 'error', text: 'Senden fehlgeschlagen: ' + (res.error || 'Unbekannter Fehler') })
      }
    } catch (e) {
      setResult({ type: 'error', text: 'Unerwarteter Fehler: ' + (e?.message || e) })
    } finally {
      setSending(false)
    }
  }

  const logs = getRecentLogs(30)
  const errorCount = logs.filter(l => l.type === 'error').length
  const warnCount  = logs.filter(l => l.type === 'warn').length
  const tool       = detectActiveTool()
  const route      = window.location.pathname + (window.location.hash || '')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bug melden"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={handleSubmit} disabled={sending}>
            {sending ? 'Wird gesendet…' : '➤ Senden'}
          </Button>
        </>
      }
    >
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-3)' }}>
        Beschreibe was passiert ist. Technische Infos werden automatisch mitgesendet.
      </div>

      <textarea
        placeholder="Was ist passiert? Was hast du getan? Was hättest du erwartet?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={5}
        autoFocus
        style={{
          width: '100%', resize: 'vertical', fontFamily: 'inherit',
          padding: 'var(--space-3)',
          background: 'var(--color-surface)', color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-md)',
        }}
      />

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', alignItems: 'center' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>Priorität:</span>
        {['low', 'medium', 'high'].map((p) => (
          <Button
            key={p}
            size="sm"
            variant={priority === p ? 'primary' : 'secondary'}
            onClick={() => setPriority(p)}
          >
            {p === 'low' ? 'Niedrig' : p === 'medium' ? 'Mittel' : 'Hoch'}
          </Button>
        ))}
      </div>

      <details style={{ marginTop: 'var(--space-4)' }}>
        <summary style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-xs)', cursor: 'pointer' }}>
          Wird mitgesendet (klicken zum Anzeigen)
        </summary>
        <div style={{
          marginTop: 'var(--space-2)', padding: 'var(--space-3)',
          background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
          fontFamily: 'var(--font-mono)', lineHeight: 1.6,
        }}>
          <div>Tool: {tool}</div>
          <div>Route: {route}</div>
          <div>App Version: {appVersion}</div>
          <div>Theme: {document.documentElement.getAttribute('data-theme')}</div>
          <div>Screen: {window.innerWidth}x{window.innerHeight}</div>
          <div>User: {user?.email || '—'}</div>
          {(errorCount + warnCount) > 0 && (
            <div style={{ color: 'var(--color-danger)', marginTop: 4 }}>
              {errorCount} Fehler, {warnCount} Warnungen erfasst
            </div>
          )}
        </div>
      </details>

      {result && (
        <div style={{
          marginTop: 'var(--space-3)',
          fontSize: 'var(--fs-sm)',
          color: result.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)',
          textAlign: 'center',
        }}>
          {result.text}
        </div>
      )}
    </Modal>
  )
}