import './ManaSymbol.css';

const SYMBOLS = {
  W:  { bg: '#f5e9a0', color: '#5a4a00', border: '#c8b840' },
  U:  { bg: '#1a78cc', color: '#fff',    border: '#1258a0' },
  B:  { bg: '#2a2438', color: '#c0b0d8', border: '#504868' },
  R:  { bg: '#cc3020', color: '#fff',    border: '#a02010' },
  G:  { bg: '#1a6e28', color: '#fff',    border: '#0e4a1a' },
  C:  { bg: '#b0a890', color: '#2a2018', border: '#888070' },
  S:  { bg: '#a0c8e0', color: '#203040', border: '#608090' }, // snow
  X:  { bg: '#444',    color: '#ddd',    border: '#666' },
};

function getStyle(sym) {
  if (SYMBOLS[sym.toUpperCase()]) return SYMBOLS[sym.toUpperCase()];
  if (/^\d+$/.test(sym))          return { bg: '#404040', color: '#e0e0e0', border: '#666' };
  return { bg: '#555', color: '#eee', border: '#777' };
}

export default function ManaSymbol({ symbol, size = 'sm' }) {
  const { bg, color, border } = getStyle(symbol);
  return (
    <span
      className={`mana-sym mana-sym--${size}`}
      style={{ background: bg, color, borderColor: border }}
      title={`{${symbol}}`}
    >
      {symbol}
    </span>
  );
}
