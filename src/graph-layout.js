export const CARD_WIDTH = 340, CARD_HEADER = 36, FIELD_HEIGHT = 30;

export function layoutGraph(data) {
  const cards = data.cards.map(card => ({ ...card, height: CARD_HEADER + Math.max(1, card.rows.length) * FIELD_HEIGHT, children: [] }));
  const byId = new Map(cards.map(card => [card.id, card]));
  for (const edge of data.edges) byId.get(edge.from).children.push(byId.get(edge.to));
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    card.span = Math.max(card.height, card.children.reduce((n, child) => n + child.span + 24, -24));
  }
  const stack = [{ card: cards[0], top: 0 }];
  while (stack.length) {
    const { card, top } = stack.pop();
    card.x = card.depth * (CARD_WIDTH + 80);
    card.y = top + (card.span - card.height) / 2;
    let childTop = top;
    for (const child of card.children) { stack.push({ card: child, top: childTop }); childTop += child.span + 24; }
  }
  const levels = [], targets = new Map();
  let width = 0;
  for (const card of cards) {
    (levels[card.depth] ||= []).push(card);
    width = Math.max(width, card.x + CARD_WIDTH);
    card.rows.forEach((row, index) => targets.set(row.id, { card, row: index, x: card.x + CARD_WIDTH / 2, y: card.y + CARD_HEADER + (index + .5) * FIELD_HEIGHT }));
  }
  targets.set(cards[0].id, { card: cards[0], row: -1, x: CARD_WIDTH / 2, y: cards[0].y + CARD_HEADER / 2 });
  return { cards, byId, levels, targets, edges: data.edges, width, height: cards[0].span };
}

export function visibleCards(layout, { left, top, right, bottom }) {
  const visible = [];
  for (const level of layout.levels) {
    if (!level?.length || level[0].x > right || level[0].x + CARD_WIDTH < left) continue;
    let low = 0, high = level.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (level[mid].y + level[mid].height < top) low = mid + 1; else high = mid;
    }
    for (let i = low; i < level.length && level[i].y < bottom; i++) visible.push(level[i]);
  }
  return visible;
}

export function visibleFieldRange(card, { top, bottom }) {
  return {
    from: Math.max(0, Math.floor((top - card.y - CARD_HEADER) / FIELD_HEIGHT)),
    to: Math.min(card.rows.length, Math.ceil((bottom - card.y - CARD_HEADER) / FIELD_HEIGHT)),
  };
}

export function edgeCoordinates(layout, edge) {
  const from = layout.byId.get(edge.from), to = layout.byId.get(edge.to);
  return {
    x: from.x + CARD_WIDTH, y: from.y + CARD_HEADER + (edge.row + .5) * FIELD_HEIGHT,
    endX: to.x, endY: to.y + CARD_HEADER / 2,
  };
}

export function flowGraph(layout) {
  const nodes = layout.cards.map(card => ({
    id: String(card.id), type: 'json', data: card,
    position: { x: card.x, y: card.y }, width: CARD_WIDTH, height: card.height,
    ariaLabel: card.path,
    handles: [
      { type: 'source', position: 'right', x: CARD_WIDTH, y: CARD_HEADER / 2, width: 1, height: 1 },
      { type: 'target', position: 'left', x: 0, y: CARD_HEADER / 2, width: 1, height: 1 },
    ],
  }));
  // 高分支图的连线会大量交叠，改用同一画布绘制，避免海量 SVG 元素。
  const canvasEdges = layout.edges.length > 1000;
  const edges = canvasEdges ? [] : layout.edges.map(edge => {
    const { x, y, endX, endY } = edgeCoordinates(layout, edge);
    return {
      id: `${edge.from}-${edge.to}`, source: String(edge.from), target: String(edge.to), type: 'json',
      data: { path: `M ${x} ${y} C ${x + 42} ${y}, ${endX - 42} ${endY}, ${endX} ${endY}` },
    };
  });
  return { nodes, edges, canvasEdges };
}
