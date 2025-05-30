import { Rect, VirtualElement } from './types';

class KDNode {
  constructor(
    public element: VirtualElement,
    public axis: number, // 0 for x, 1 for y
    public left: KDNode | null = null,
    public right: KDNode | null = null
  ) {}
}

export class KDTree {
  private root: KDNode | null = null;

  constructor() {}

  // --- INSERT ---
  public insert(element: VirtualElement): void {
    this.root = this.insertNode(this.root, element, 0);
  }

  private insertNode(node: KDNode | null, element: VirtualElement, depth: number): KDNode {
    if (node === null) {
      const axis = depth % 2;
      return new KDNode(element, axis);
    }

    const axis = depth % 2; // 0 for x, 1 for y

    let currentCoord: number;
    let elementCoord: number;

    if (axis === 0) { // Compare x-coordinates
      currentCoord = node.element.rect.x;
      elementCoord = element.rect.x;
    } else { // Compare y-coordinates
      currentCoord = node.element.rect.y;
      elementCoord = element.rect.y;
    }

    if (elementCoord < currentCoord) {
      node.left = this.insertNode(node.left, element, depth + 1);
    } else {
      node.right = this.insertNode(node.right, element, depth + 1);
    }

    return node;
  }

  // --- QUERY RANGE ---
  public queryRange(queryRect: Rect): VirtualElement[] {
    const results: VirtualElement[] = [];
    this.queryRangeNode(this.root, queryRect, results);
    return results;
  }

  private queryRangeNode(node: KDNode | null, queryRect: Rect, results: VirtualElement[]): void {
    if (node === null) {
      return;
    }

    if (this.intersects(node.element.rect, queryRect)) {
      results.push(node.element);
    }

    const axis = node.axis;
    const nodeCoord = (axis === 0) ? node.element.rect.x : node.element.rect.y;
    const queryMinCoord = (axis === 0) ? queryRect.x : queryRect.y;
    const queryMaxCoord = (axis === 0) ? (queryRect.x + queryRect.width) : (queryRect.y + queryRect.height);

    // If the query range's minimum for the current axis is less than the node's coordinate,
    // it means the range might extend into the left/bottom subtree.
    if (queryMinCoord < nodeCoord) {
      this.queryRangeNode(node.left, queryRect, results);
    }

    // If the query range's maximum for the current axis is greater than or equal to the node's coordinate,
    // it means the range might extend into the right/top subtree.
    // Using >= for the nodeCoord comparison with queryMaxCoord to ensure elements starting exactly at queryMaxCoord are included.
    // However, standard K-D tree pruning often checks if nodeCoord < queryMaxCoord for the right subtree.
    // Let's adjust to: if nodeCoord <= queryMaxCoord for right subtree exploration,
    // and nodeCoord >= queryMinCoord for left subtree exploration.
    // The current logic is:
    // Go left if queryMin < nodeCoord
    // Go right if queryMax > nodeCoord (this implies nodeCoord < queryMax)

    // Corrected pruning logic:
    // The node's coordinate acts as a splitting plane.
    // If the queryMin is less than the node's coordinate, the left subtree could have relevant nodes.
    if (queryMinCoord <= nodeCoord) { // Or queryMinCoord < nodeCoord depending on how splits are handled for exact matches
        this.queryRangeNode(node.left, queryRect, results);
    }
    // If the queryMax is greater than the node's coordinate, the right subtree could have relevant nodes.
    if (queryMaxCoord >= nodeCoord) { // Or queryMaxCoord > nodeCoord
        this.queryRangeNode(node.right, queryRect, results);
    }
  }

  // --- QUERY POINT ---
  public queryPoint(x: number, y: number): VirtualElement[] {
    // Create a 1x1 rect for the query.
    // Using a 0x0 rect might be problematic if intersects logic expects positive width/height.
    const pointRect: Rect = { x: x, y: y, width: 1, height: 1 };

    // Alternative: direct point query. For now, using queryRange.
    // const results: VirtualElement[] = [];
    // this.queryPointNode(this.root, x, y, results);
    // return results;

    // Filter results from queryRange to ensure only elements strictly containing the point are returned.
    const rangeResults = this.queryRange(pointRect);
    return rangeResults.filter(el => this.contains(el.rect, x, y));
  }

  // --- HELPERS ---
  private intersects(rect1: Rect, rect2: Rect): boolean {
    // Check if rect2 is to the right of rect1 OR
    // rect2 is to the left of rect1 OR
    // rect2 is below rect1 OR
    // rect2 is above rect1
    return !(
      rect2.x >= rect1.x + rect1.width || // rect2 is to the right of rect1's right edge
      rect2.x + rect2.width <= rect1.x ||  // rect2's right edge is to the left of rect1's left edge
      rect2.y >= rect1.y + rect1.height || // rect2 is below rect1's bottom edge
      rect2.y + rect2.height <= rect1.y    // rect2's bottom edge is above rect1's top edge
    );
  }

  private contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  // --- REMOVE ---
  public remove(element: VirtualElement): void {
    if (!element || element.id == null) {
      console.warn('KDTree.remove called with invalid element or element ID.');
      return;
    }
    this.root = this.removeNode(this.root, element, 0);
  }

  private removeNode(node: KDNode | null, elementToRemove: VirtualElement, depth: number): KDNode | null {
    if (node === null) {
      return null;
    }

    const axis = depth % 2; // 0 for x, 1 for y

    // Check if the current node is the one to remove
    if (node.element.id === elementToRemove.id) {
      // Case 1: Node has no right child (or no children at all if left is also null)
      if (node.right === null) {
        return node.left;
      }
      // Case 2: Node has no left child (but has a right child)
      if (node.left === null) {
        return node.right;
      }

      // Case 3: Node has both left and right children
      // Find the minimum element in the right subtree along the current axis (this node's axis)
      const replacementNode = this.findMinNode(node.right, axis, depth + 1);

      // Replace node's element with the replacement node's element
      node.element = replacementNode.element;

      // Recursively remove the replacement node from the right subtree
      node.right = this.removeNode(node.right, replacementNode.element, depth + 1);
      return node;

    } else {
      // Node not found yet, recurse
      const nodeCoord = (axis === 0) ? node.element.rect.x : node.element.rect.y;
      const elementToRemoveCoord = (axis === 0) ? elementToRemove.rect.x : elementToRemove.rect.y;

      // Note: When removing, the comparison logic should guide towards where the element *would* have been inserted.
      // If the element to remove's coordinate is less than the current node's coordinate on this axis,
      // it must be in the left subtree. Otherwise, it must be in the right subtree.
      // This assumes no duplicate coordinates for different elements at the same K-D tree node position,
      // which is why element.id matching is crucial.
      if (elementToRemoveCoord < nodeCoord) {
        node.left = this.removeNode(node.left, elementToRemove, depth + 1);
      } else {
        // If elementToRemoveCoord === nodeCoord, but IDs don't match, we still need to pick a path.
        // The standard K-D tree insertion logic (elementCoord >= currentCoord goes right) suggests
        // we should go right if coordinates are equal but IDs differ.
        node.right = this.removeNode(node.right, elementToRemove, depth + 1);
      }
      return node;
    }
  }

  private findMinNode(node: KDNode, axisToMinimize: number, currentDepth: number): KDNode {
    // findMinNode is called on a non-null node (e.g., node.right from removeNode Case 3)
    // The goal is to find the node with the smallest coordinate value along 'axisToMinimize'
    // in the subtree rooted at 'node'.

    const currentSplitAxis = currentDepth % 2;

    let minCandidateNode = node;

    if (currentSplitAxis === axisToMinimize) {
      // If we are splitting on the axis we want to minimize,
      // the absolute minimum for this axis in this subtree *could* only be further down the left path.
      // If there's no left path, then 'node' itself is the minimum along this split axis in this subtree.
      if (node.left !== null) {
        const leftMin = this.findMinNode(node.left, axisToMinimize, currentDepth + 1);
        // Compare current node with the minimum found in the left subtree along the axisToMinimize
        const nodeVal = node.element.rect[axisToMinimize === 0 ? 'x' : 'y'];
        const leftMinVal = leftMin.element.rect[axisToMinimize === 0 ? 'x' : 'y'];
        if (leftMinVal < nodeVal) {
          minCandidateNode = leftMin;
        }
        // If nodeVal <= leftMinVal, current 'node' remains the minCandidateNode from this path.
      }
      // If node.left is null, 'node' is the minimum along this path for this split axis.
    } else {
      // We are splitting on a *different* axis than the one we want to minimize ('axisToMinimize').
      // The minimum value for 'axisToMinimize' could be the current node,
      // or it could be in the left subtree, or in the right subtree.
      // We need to check all possibilities and compare their values for 'axisToMinimize'.

      // Candidate 1: The current node itself
      // minCandidateNode is already 'node'

      if (node.left !== null) {
        const leftSubtreeMin = this.findMinNode(node.left, axisToMinimize, currentDepth + 1);
        if (leftSubtreeMin.element.rect[axisToMinimize === 0 ? 'x' : 'y'] < minCandidateNode.element.rect[axisToMinimize === 0 ? 'x' : 'y']) {
          minCandidateNode = leftSubtreeMin;
        }
      }

      if (node.right !== null) {
        const rightSubtreeMin = this.findMinNode(node.right, axisToMinimize, currentDepth + 1);
        if (rightSubtreeMin.element.rect[axisToMinimize === 0 ? 'x' : 'y'] < minCandidateNode.element.rect[axisToMinimize === 0 ? 'x' : 'y']) {
          minCandidateNode = rightSubtreeMin;
        }
      }
    }
    return minCandidateNode;
  }
}
