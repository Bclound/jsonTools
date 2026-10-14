import React, { createContext, memo, useCallback, useContext, useMemo } from 'react';
import { ReactFlow, Handle, Position, BaseEdge } from '@xyflow/react';
import { visibleFieldRange, CARD_HEADER, FIELD_HEIGHT } from './graph-layout.js';

const GraphContext = createContext(null);
const empty = [];
const keyLabel = key => typeof key === 'number' ? `[${key}]` : key;
const TypeTag = ({ row }) => <span className={`graph-type type-${row.type}`} title={`当前值类型：${row.tsType}`}>{row.tsType}</span>;

const JsonNode = memo(function JsonNode({ data: card }) {
  const { selected, bounds, callbacks } = useContext(GraphContext);
  const range = visibleFieldRange(card, bounds);
  return <section className={`graph-card${card.id === selected ? ' selected' : ''}`} aria-label={card.path}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
    <div className="graph-card-title">
      <button className="graph-title-select nopan" title={`定位 ${card.path}`} onClick={() => callbacks.select(card)}>
        <span className="graph-title-key">{keyLabel(card.key)}</span><TypeTag row={card} />
        {(card.type === 'array' || card.type === 'object') && <small>{card.count} {card.type === 'array' ? '项' : '字段'}</small>}
      </button>
    </div>
    {card.rows.slice(range.from, Math.max(range.from, range.to)).map((row, index) => <div key={row.id}
      className={`graph-field${row.id === selected ? ' selected' : ''}`} data-path={row.path}
      style={{ position: 'absolute', top: CARD_HEADER + (range.from + index) * FIELD_HEIGHT, left: 0, right: 0 }}>
      <button className="graph-value nopan" title={`${row.path}: ${row.value}\n当前值类型：${row.tsType}`} onClick={() => callbacks.select(row)}>
        <span className="graph-field-content"><span className="graph-key">{keyLabel(row.key)}</span><span className={`type-${row.type}`}>{row.value}</span></span>
        <TypeTag row={row} />
      </button>
      {row.expandable && <button className="graph-toggle nopan" title={`${row.open ? '收起' : '展开'} ${row.path}`}
        aria-label={`${row.open ? '收起' : '展开'} ${row.path}`} aria-expanded={row.open} onClick={() => callbacks.toggle(row)}>
        <svg className="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={row.open ? 'M5 12h14' : 'M5 12h14M12 5v14'} /></svg>
      </button>}
    </div>)}
    {!card.rows.length && <div className="graph-empty-value">{card.value}</div>}
  </section>;
});

const JsonEdge = memo(function JsonEdge({ id, data }) {
  return <BaseEdge id={id} path={data.path} interactionWidth={0} style={{ stroke: 'var(--graph-line)', strokeWidth: 1.25, vectorEffect: 'non-scaling-stroke' }} />;
});
const nodeTypes = { json: JsonNode }, edgeTypes = { json: JsonEdge };

export function FlowGraph({ model, viewport, bounds, selected, callbacks, onViewportChange, onMoveStart, onPaneClick }) {
  const context = useMemo(() => ({ bounds, selected, callbacks }), [bounds, selected, callbacks]);
  const selectNode = useCallback((event, node) => {
    if (!event.target.closest('button')) callbacks.select(node.data);
  }, [callbacks]);
  const overview = viewport.zoom < .35;
  return <GraphContext.Provider value={context}>
    <ReactFlow nodes={overview ? empty : model.nodes} edges={overview ? empty : model.edges}
      nodeTypes={nodeTypes} edgeTypes={edgeTypes} viewport={viewport} onViewportChange={onViewportChange} onNodeClick={selectNode}
      onMoveStart={onMoveStart} onPaneClick={onPaneClick} minZoom={.00001} maxZoom={2}
      onlyRenderVisibleElements nodesDraggable={false} nodesConnectable={false}
      nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
      edgesReconnectable={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
      panActivationKeyCode={null} zoomActivationKeyCode={null} zoomOnDoubleClick={false}
      colorMode="dark" aria-label="JSON 结构图画布" />
  </GraphContext.Provider>;
}
