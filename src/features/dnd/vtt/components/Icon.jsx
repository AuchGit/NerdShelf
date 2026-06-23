// Small icon helper: renders an SVG from `src`, falling back to an `emoji`
// glyph if the file is missing (so the UI stays usable until every SVG asset
// is dropped into public/Assets/vtt/). Once the file exists, the emoji is gone.
import { useState } from 'react';

export default function Icon({ src, emoji, size = 16, style }) {
  const [ok, setOk] = useState(true);
  if (ok && src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        onError={() => setOk(false)}
        style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
      />
    );
  }
  return <span style={style}>{emoji}</span>;
}
