// Context + hook for the VTT pinnable-tooltip system. Kept separate from the
// components so the JSX file only exports components (fast-refresh friendly).
import { createContext, useContext } from 'react';

export const TooltipCtx = createContext(null);
export function useTooltips() { return useContext(TooltipCtx); }
