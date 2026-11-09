// Components, instances and detaching (ADR-0005): the history operations the editor sends as one
// transaction each. Pure functions over the document; the canvas draws the result.
import { expandInstance } from "../../renderer/src/index.mjs";

const siblingsOf = (document, node) => (node.parentId === null ? document.rootIds : document.nodes[node.parentId].children);

/** The document's components, by name. */
export function componentsOf(document) {
  return Object.values(document.nodes)
    .filter((node) => node.type === "component-definition")
    .map((node) => ({ id: node.id, name: typeof node.props.name === "string" ? node.props.name : node.id }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Make a layer into a component: a component-definition takes its place and holds it, so the layer
 * as it is becomes the main component. Refused for a layer that is or lies inside a component or an
 * instance, or a design system.
 */
export function createComponent(document, nodeId, { id, name }) {
  const node = document.nodes[nodeId];
  if (!node) throw new Error("Select a layer first.");
  if (node.type === "design-system" || node.type === "component-instance" || node.type === "component-definition") throw new Error("That layer cannot become a component.");
  for (let parent = node.parentId === null ? undefined : document.nodes[node.parentId]; parent; parent = parent.parentId === null ? undefined : document.nodes[parent.parentId]) {
    if (parent.type === "component-definition") throw new Error("That layer is already inside a component.");
  }
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("A new component needs an unused id.");
  const label = typeof name === "string" && name.trim() !== "" ? name.trim() : typeof node.props.name === "string" ? node.props.name : "Component";
  const index = siblingsOf(document, node).indexOf(nodeId);
  return [
    { type: "insert-node", parentId: node.parentId, index, node: { id, type: "component-definition", props: { name: label, properties: [] } } },
    { type: "move-node", nodeId, parentId: id, index: 0 },
  ];
}

/** Place an instance of a component after `afterId` (or at the end of the top level). */
export function insertInstance(document, componentId, { id, afterId = null }) {
  const component = document.nodes[componentId];
  if (!component || component.type !== "component-definition") throw new Error("Choose a component.");
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("A new instance needs an unused id.");
  const after = afterId === null ? undefined : document.nodes[afterId];
  // Never inside its own component, directly or through another instance's component.
  let parentId = after ? after.parentId : null;
  for (let parent = parentId === null ? undefined : document.nodes[parentId]; parent; parent = parent.parentId === null ? undefined : document.nodes[parent.parentId]) {
    if (parent.id === componentId) {
      parentId = component.parentId;
      break;
    }
  }
  const siblings = parentId === null ? document.rootIds : document.nodes[parentId].children;
  const index = after && after.parentId === parentId ? siblings.indexOf(after.id) + 1 : siblings.length;
  return [{ type: "insert-node", parentId, index, node: { id, type: "component-instance", props: { componentId, propertyValues: {}, overrides: [] } } }];
}

/**
 * Detach an instance: one transaction that writes what it draws as real layers in its place, with
 * fresh ids from `mint`, and removes the instance. Undo puts the instance back.
 */
export function detachInstance(document, instanceId, mint) {
  const instance = document.nodes[instanceId];
  if (!instance || instance.type !== "component-instance") throw new Error("Select an instance.");
  const view = expandInstance(document, instanceId);
  if (view === null) throw new Error("Its component is missing, so there is nothing to detach.");
  const nodes = [];
  const add = (entry, parentId) => {
    const id = mint();
    if (Object.hasOwn(document.nodes, id)) throw new Error("A detached layer needs an unused id.");
    const record = { id, type: entry.type === "component-instance" ? "frame" : entry.type, parentId, children: [], props: structuredClone(entry.props), metadata: {} };
    // A component's own props (its name, properties and variants) are not a layer's.
    delete record.props.properties;
    delete record.props.variants;
    nodes.push(record);
    record.children = entry.children.map((child) => add(child, id));
    return id;
  };
  const rootId = add({ ...view, type: "frame" }, instance.parentId);
  const index = siblingsOf(document, instance).indexOf(instanceId);
  return { rootId, operations: [{ type: "remove-node", nodeId: instanceId }, { type: "restore-subtree", rootId, parentId: instance.parentId, index, nodes }] };
}
