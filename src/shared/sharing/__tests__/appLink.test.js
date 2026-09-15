import { describe, it, expect } from 'vitest';
import { appLinkForRoute, routeFromAppLink } from '../appLink';

describe('app links', () => {
  it('round-trips a share route', () => {
    const link = appLinkForRoute('/mtg/?import=X3Q9F4MV7K2H');
    expect(link).toBe('nerdshelf://mtg/?import=X3Q9F4MV7K2H');
    expect(routeFromAppLink(link)).toBe('/mtg/?import=X3Q9F4MV7K2H');
  });

  it('accepts only our sections', () => {
    expect(routeFromAppLink('nerdshelf://dnd/?join=K7QM2F')).toBe('/dnd/?join=K7QM2F');
    expect(routeFromAppLink('nerdshelf://settings')).toBeNull();
    expect(routeFromAppLink('https://example.com/mtg/')).toBeNull();
    expect(routeFromAppLink(null)).toBeNull();
  });
});
