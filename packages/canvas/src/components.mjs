// Components, instances and detaching (ADR-0005): the history operations the editor sends as one
// transaction each. Pure functions over the document; the canvas draws the result.
import { expandInstance } from "../../renderer/src/index.mjs";

const siblingsOf = (document, node) => (node.parentId === null ? document.rootIds : document.nodes[node.parentId].children);
const ancestors = function* (document, node) {
  for (let parent = node?.parentId == null ? undefined : document.nodes[node.parentId], steps = 0; parent && steps <= 1_100; parent = parent.parentId === null ? undefined : document.nodes[parent.parentId], steps += 1) yield parent;
};

/** The document's components, by name. */
export function componentsOf(document) {
  return Object.values(document.nodes)
    .filter((node) => node.type === "component-definition")
    .map((node) => ({ id: node.id, name: typeof node.props.name === "string" && node.props.name !== "" ? node.props.name : "Unnamed component" }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// A layer's look, which a component made from it keeps: everything but what binds it to code.
const lookOf = (props) => {
  const { codeSource: _codeSource, ...look } = props;
  return look;
};

/**
 * Make a layer into a component: a component-definition takes its place, with its look (tag,
 * style, attributes, text, stylesheet) and its children, so the layer as it is becomes the main
 * component, with no wrapper in between. Refused for a design system, a component or an instance,
 * a layer inside a component, and a layer that holds a component.
 */
export function createComponent(document, nodeId, { id, name }) {
  const node = document.nodes[nodeId];
  if (!node) throw new Error("Select a layer first.");
  if (node.type === "design-system" || node.type === "component-instance" || node.type === "component-definition") throw new Error("That layer cannot become a component.");
  for (const parent of ancestors(document, node)) if (parent.type === "component-definition") throw new Error("That layer is already inside a component.");
  const stack = [...node.children];
  while (stack.length > 0) {
    const inner = document.nodes[stack.pop()];
    if (!inner) continue;
    if (inner.type === "component-definition") throw new Error("That layer holds a component; make the component from a layer that does not.");
    stack.push(...inner.children);
  }
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("A new component needs an unused id.");
  const label = typeof name === "string" && name.trim() !== "" ? name.trim() : typeof node.props.name === "string" && node.props.name !== "" ? node.props.name : "Component";
  const index = siblingsOf(document, node).indexOf(nodeId);
  return [
    { type: "insert-node", parentId: node.parentId, index, node: { id, type: "component-definition", props: { ...lookOf(node.props), name: label, properties: [] } } },
    ...node.children.map((childId, at) => ({ type: "move-node", nodeId: childId, parentId: id, index: at })),
    { type: "remove-node", nodeId },
  ];
}

/** Whether `componentId`, drawn, draws `targetId`: itself, or through the instances it holds. */
export function drawsComponent(document, componentId, targetId) {
  const seen = new Set();
  const queue = [componentId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === targetId) return true;
    if (seen.has(id) || !document.nodes[id]) continue;
    seen.add(id);
    const stack = [...document.nodes[id].children];
    while (stack.length > 0) {
      const node = document.nodes[stack.pop()];
      if (!node) continue;
      if (node.type === "component-instance") queue.push(node.props.componentId);
      stack.push(...node.children);
    }
  }
  return false;
}

/**
 * Place an instance of a component after `afterId` (or at the end of the top level). One that
 * would draw itself, inside its own component or one it draws, goes beside that component instead.
 */
export function insertInstance(document, componentId, { id, afterId = null }) {
  const component = document.nodes[componentId];
  if (!component || component.type !== "component-definition") throw new Error("Choose a component.");
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("A new instance needs an unused id.");
  const after = afterId === null ? undefined : document.nodes[afterId];
  let parentId = after ? after.parentId : null;
  let place = after;
  const parent = parentId === null ? undefined : document.nodes[parentId];
  for (const holder of [parent, ...ancestors(document, parent)].filter(Boolean)) {
    if (holder.type === "component-definition" && drawsComponent(document, componentId, holder.id)) {
      parentId = holder.parentId;
      place = holder;
    }
  }
  const siblings = parentId === null ? document.rootIds : document.nodes[parentId].children;
  const index = place && place.parentId === parentId ? siblings.indexOf(place.id) + 1 : siblings.length;
  // An absolutely placed component's new instance is set off from it, not drawn on top of it.
  const style = component.props.style ?? {};
  const offset = (value) => (typeof value === "string" && /^-?\d+(\.\d+)?px$/u.test(value) ? `${Number.parseFloat(value) + 24}px` : undefined);
  const placed = (style.position === "absolute" || style.position === "fixed") ? Object.fromEntries([["left", offset(style.left)], ["top", offset(style.top)]].filter(([, value]) => value !== undefined)) : {};
  return [{ type: "insert-node", parentId, index, node: { id, type: "component-instance", props: { componentId, propertyValues: {}, overrides: [], ...(Object.keys(placed).length > 0 ? { style: placed } : {}) } } }];
}

/**
 * Detach an instance: one transaction that writes what it draws as real layers in its place, with
 * fresh ids from `mint`, and removes the instance. The layers keep the look they were drawn with,
 * and nothing that binds a component's layer to code. Undo puts the instance back.
 */
export function detachInstance(document, instanceId, mint) {
  const instance = document.nodes[instanceId];
  if (!instance || instance.type !== "component-instance") throw new Error("Select an instance.");
  const view = expandInstance(document, instanceId);
  if (view === null) throw new Error("Its component is missing or draws too many layers, so there is nothing to detach.");
  const nodes = [];
  const add = (entry, parentId) => {
    const id = mint();
    if (Object.hasOwn(document.nodes, id)) throw new Error("A detached layer needs an unused id.");
    const record = { id, type: entry.type === "component-instance" ? "frame" : entry.type, parentId, children: [], props: lookOf(structuredClone(entry.props)), metadata: {} };
    nodes.push(record);
    record.children = entry.children.map((child) => add(child, id));
    return id;
  };
  const rootId = add({ ...view, type: "frame" }, instance.parentId);
  const index = siblingsOf(document, instance).indexOf(instanceId);
  return { rootId, operations: [{ type: "remove-node", nodeId: instanceId }, { type: "restore-subtree", rootId, parentId: instance.parentId, index, nodes }] };
}
