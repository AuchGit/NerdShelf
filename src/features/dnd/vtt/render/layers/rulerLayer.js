// Ruler layer. Draws the active measurement line + a distance label in ft.
// The ruler state is broadcast so the whole table sees the DM measuring.
import { Container, Graphics, Text } from 'pixi.js';
import { gridDistanceFt } from '../../lib/geometry';

export class RulerLayer {
  constructor() {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.line = new Graphics();
    this.label = new Text({ text: '', style: { fill: '#fff', fontSize: 16, fontWeight: '700', stroke: { color: '#000', width: 4 } } });
    this.label.anchor.set(0.5, 1.4);
    this.container.addChild(this.line, this.label);
  }

  update(ruler, grid, moveFt = null) {
    this.line.clear();
    if (!ruler) { this.label.visible = false; return; }
    const { from, to } = ruler;
    this.line.moveTo(from.x, from.y).lineTo(to.x, to.y)
      .stroke({ width: 3, color: '#ffe066', alpha: 0.95 });
    this.line.circle(from.x, from.y, 5).fill('#ffe066');
    this.line.circle(to.x, to.y, 5).fill('#ffe066');

    const ft = gridDistanceFt(from, to, grid);
    this.label.visible = true;
    let txt = `${Math.round(ft)} ft (${(ft / 5).toFixed(0)} Felder)`;
    // Movement cost (difficult terrain doubled) when it differs from the raw distance.
    if (moveFt != null && Math.round(moveFt) > Math.round(ft)) txt += ` · Bewegung ${Math.round(moveFt)} ft`;
    this.label.text = txt;
    this.label.position.set((from.x + to.x) / 2, (from.y + to.y) / 2);
  }
}
