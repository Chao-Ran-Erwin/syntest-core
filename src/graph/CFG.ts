import { Node } from "./nodes/Node";
import { Edge } from "./Edge";

export interface CFG {
  nodes: Node[];
  edges: Edge[];
}
