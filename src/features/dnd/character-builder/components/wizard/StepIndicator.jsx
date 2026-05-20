import { useEffect, useRef } from 'react'
import { useLanguage } from '../../lib/i18n'

export default function StepIndicator({ steps, currentStep, onStepClick, completedSteps = [] }) {
  // Keep the active step visible. On PWA mobile the step bar is a
  // horizontal-scroll rail (see mobile-layouts.css); without this the
  // user has to manually scroll to find their current step. On desktop
  // the bar wraps and nothing scrolls, so this is a harmless no-op
  // (`block: 'nearest'` prevents any vertical page jump).
  const activeRef = useRef(null)
  useEffect(() => {
    const el = activeRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [currentStep])

  return (
    <div style={styles.container}>
      {steps.map((step, index) => {
        const isDone = completedSteps.includes(index)
        const isActive = index === currentStep
        const state = isDone ? 'done' : isActive ? 'active' : 'upcoming'
        const isClickable = isDone || isActive || completedSteps.includes(index - 1)

        return (
          <div key={index} style={styles.stepWrapper} ref={isActive ? activeRef : null}>
            <div
              style={{
                ...styles.stepInner,
                cursor: isClickable ? 'pointer' : 'default',
                opacity: state === 'upcoming' && !isClickable ? 0.4 : 1,
              }}
              onClick={() => isClickable && onStepClick && onStepClick(index)}
              title={step}
            >
              <div style={{ ...styles.circle, ...circleStyle[state] }}>
                {state === 'done' ? '✓' : index + 1}
              </div>
              <span style={{ ...styles.label, ...labelStyle[state] }}>
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div style={{ ...styles.line, background: isDone ? 'var(--accent)' : 'var(--border)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

const circleStyle = {
  done:     { background: 'var(--accent)', color: 'var(--bg-deep)', borderColor: 'var(--accent)' },
  active:   { background: 'var(--bg-elevated)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  upcoming: { background: 'transparent', color: 'var(--text-dim)', borderColor: 'var(--border)' },
}
const labelStyle = {
  done:     { color: 'var(--accent)' },
  active:   { color: 'var(--text-primary)' },
  upcoming: { color: 'var(--text-dim)' },
}
const styles = {
  container: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '20px 32px', gap: 0, flexWrap: 'wrap', rowGap: 12,
    background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
  },
  stepWrapper: { display: 'flex', alignItems: 'center', gap: 0 },
  stepInner: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6 },
  circle: {
    width: 28, height: 28, borderRadius: '50%', border: '2px solid',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 'bold', flexShrink: 0,
  },
  label: { fontSize: 12, whiteSpace: 'nowrap' },
  line: { width: 24, height: 2, margin: '0 4px' },
}