// Collapsible sidebar section. Header toggles the body open/closed.
import { useState } from 'react';
import { Panel } from '../../../../shared/ui';

export default function Collapsible({ title, defaultOpen = true, right = null, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel padding="sm">
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 12, transition: 'transform 120ms', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
          {title}
        </span>
        {right}
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </Panel>
  );
}
