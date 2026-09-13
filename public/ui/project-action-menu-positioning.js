const MENU_GAP = 6;

export function projectActionMenuPlacement({
  triggerTop,
  triggerBottom,
  menuHeight,
  boundaryTop,
  boundaryBottom,
  gap = MENU_GAP
}) {
  const roomAbove = Math.max(0, triggerTop - boundaryTop - gap);
  const roomBelow = Math.max(0, boundaryBottom - triggerBottom - gap);

  if (roomBelow >= menuHeight) return 'down';
  if (roomAbove >= menuHeight) return 'up';
  return roomAbove > roomBelow ? 'up' : 'down';
}
