import { useLanguage } from '../../lib/i18n'

export default function StepIndicator({ steps, currentStep, onStepClick, completedSteps = [] }) {
  return (
    <div style={styles.container}>
      {steps.map((step, index) => {
        const isDone = completedSteps.includes(index)
        const isActive = index === currentStep
        const state = isDone ? 'done' : isActive ? 'active' : 'upcoming'
        const isClickable = isDone || isActive || completedSteps.includes(index - 1)

        return (
          <div key={index} style={styles.stepWrapper}>
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