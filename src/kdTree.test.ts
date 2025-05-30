import { KDTree } from './kdTree';
import { VirtualElement, Rect } from './types';

// Helper function to create mock VirtualElements for testing
const createMockVirtualElement = (id: string, rect: Rect): VirtualElement => ({
  id,
  element: document.createElement('div'), // Mock HTMLElement
  rect,
  isVisible: false,
  originalDisplay: 'block',
});

describe('KDTree', () => {
  let kdTree: KDTree;

  beforeEach(() => {
    kdTree = new KDTree(); // Create a new tree before each test
  });

  // --- INSERTION TESTS ---
  describe('insert', () => {
    test('should insert an element into an empty tree', () => {
      const element = createMockVirtualElement('el1', { x: 10, y: 20, width: 5, height: 5 });
      kdTree.insert(element);
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('el1');
    });

    test('should insert multiple elements correctly', () => {
      const el1 = createMockVirtualElement('el1', { x: 10, y: 20, width: 5, height: 5 });
      // Note: KD-tree splits alternately. Depth 0: X, Depth 1: Y, Depth 2: X ...
      // el1 (10,20) is root. Axis X.
      // el2 (5,15) -> el2.x < el1.x, so el2 goes left.
      // el3 (15,25) -> el3.x >= el1.x, so el3 goes right.
      const el2 = createMockVirtualElement('el2', { x: 5, y: 15, width: 5, height: 5 });
      const el3 = createMockVirtualElement('el3', { x: 15, y: 25, width: 5, height: 5 });
      kdTree.insert(el1);
      kdTree.insert(el2);
      kdTree.insert(el3);
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toHaveLength(3);
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el2', 'el3'].sort());
    });

    test('should handle elements with identical coordinates but different IDs', () => {
      const el1 = createMockVirtualElement('el1', { x: 10, y: 20, width: 5, height: 5 });
      const el2 = createMockVirtualElement('el2', { x: 10, y: 20, width: 5, height: 5 });
      kdTree.insert(el1);
      kdTree.insert(el2);
      // queryRange includes elements whose rects intersect the queryRect.
      // A 1x1 query rect at the exact start of el1 and el2 should find them.
      const result = kdTree.queryRange({ x: 10, y: 20, width: 1, height: 1 });
      expect(result).toHaveLength(2);
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el2'].sort());
    });
  });

  // --- QUERYRANGE TESTS ---
  describe('queryRange', () => {
    const el1 = createMockVirtualElement('el1', { x: 10, y: 20, width: 10, height: 10 }); // 10,20 to 20,30
    const el2 = createMockVirtualElement('el2', { x: 30, y: 40, width: 10, height: 10 }); // 30,40 to 40,50
    const el3 = createMockVirtualElement('el3', { x: 15, y: 25, width: 10, height: 10 }); // 15,25 to 25,35 (overlaps el1)

    beforeEach(() => {
      kdTree.insert(el1);
      kdTree.insert(el2);
      kdTree.insert(el3);
    });

    test('should return an empty array when querying an empty tree', () => {
      const emptyTree = new KDTree();
      expect(emptyTree.queryRange({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
    });

    test('should return elements within the query rectangle', () => {
      const result = kdTree.queryRange({ x: 5, y: 15, width: 15, height: 15 }); // Query: 5,15 to 20,30. Catches el1, el3.
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el3'].sort());
    });

    test('should return elements that partially intersect the query rectangle', () => {
      const result = kdTree.queryRange({ x: 18, y: 28, width: 5, height: 5 }); // Query: 18,28 to 23,33. Intersects el1, el3.
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el3'].sort());
    });

    test('should return an empty array if no elements intersect', () => {
      const result = kdTree.queryRange({ x: 100, y: 100, width: 10, height: 10 });
      expect(result).toHaveLength(0);
    });

    test('should return elements when query rect is identical to an element rect', () => {
      const result = kdTree.queryRange({ x: 10, y: 20, width: 10, height: 10 });
      expect(result.find(e => e.id === 'el1')).toBeDefined();
      // Depending on tree structure and pruning, others might be included if their regions are checked.
      // The key is that el1 must be there.
    });

    test('should return elements when query rect is larger and contains elements', () => {
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el2', 'el3'].sort());
    });
  });

  // --- QUERYPOINT TESTS ---
  describe('queryPoint', () => {
    const el1 = createMockVirtualElement('el1', { x: 10, y: 20, width: 10, height: 10 }); // 10,20 to 20,30
    beforeEach(() => {
      kdTree.insert(el1);
    });

    test('should return elements containing the point', () => {
      const result = kdTree.queryPoint(15, 25);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('el1');
    });

    test('should return empty array if point is outside any element', () => {
      expect(kdTree.queryPoint(0, 0)).toHaveLength(0);
      expect(kdTree.queryPoint(21, 31)).toHaveLength(0); // Outside el1 by 1px
    });

    test('should return elements if point is on the edge', () => {
      // KDTree.queryPoint uses a 1x1 rect for queryRange, then filters with `contains`.
      // The `contains` helper is inclusive: x >= rect.x && x <= rect.x + rect.width
      expect(kdTree.queryPoint(10, 20).map(e => e.id)).toContain('el1'); // Top-left corner
      expect(kdTree.queryPoint(20, 30).map(e => e.id)).toContain('el1'); // Bottom-right corner (point is x,y, so rect is x to x+w, y to y+h)
      // Point (20,30) is on the edge el1.rect.x + el1.rect.width and el1.rect.y + el1.rect.height
    });
  });

  // --- REMOVAL TESTS ---
  describe('remove', () => {
    const el1 = createMockVirtualElement('el1', { x: 10, y: 20, width: 5, height: 5 });
    const el2 = createMockVirtualElement('el2', { x: 5, y: 15, width: 5, height: 5 });
    const el3 = createMockVirtualElement('el3', { x: 15, y: 25, width: 5, height: 5 });

    beforeEach(() => {
      kdTree.insert(el1); // Root, X-split
      kdTree.insert(el2); // Left of el1
      kdTree.insert(el3); // Right of el1
    });

    test('should remove an element (leaf-like)', () => {
      // el2 (5,15) is left of el1 (10,20)
      // el3 (15,25) is right of el1 (10,20)
      // Depending on insertion order and balancing, el2 or el3 might be leaves.
      // Let's assume el2 is simpler to remove initially.
      kdTree.remove(el2);
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el3'].sort());
    });

    test('should remove an element (internal node, e.g., root)', () => {
      kdTree.remove(el1); // el1 is the root
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result.map(e => e.id).sort()).toEqual(['el2', 'el3'].sort());
      // Verify kd-tree properties still hold by checking specific queries
      expect(kdTree.queryPoint(5,15)[0]?.id).toBe('el2');
      expect(kdTree.queryPoint(15,25)[0]?.id).toBe('el3');
    });

    test('should do nothing if element to remove is not found (wrong id)', () => {
      const fakeElement = createMockVirtualElement('fake', { x: 10, y: 20, width: 5, height: 5 }); // Same rect as el1
      kdTree.remove(fakeElement);
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toHaveLength(3);
    });

    test('should do nothing if element to remove is not found (different rect)', () => {
      const fakeElement = createMockVirtualElement('el1', { x: 0, y: 0, width: 1, height: 1 }); // Same ID as el1 but different rect
      // Our remove logic uses ID, so if ID matches, it will try to remove.
      // The current remove in KDTree doesn't re-check coordinates, only ID.
      // So, if we pass el1 (which has id: 'el1'), it *will* remove the original el1.
      // This test should be about an element whose ID is not in the tree.
      const nonExistentElement = createMockVirtualElement('nonexistent', { x: 0, y: 0, width: 1, height: 1 });
      kdTree.remove(nonExistentElement);
      const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toHaveLength(3);

    });


    test('should handle removing all elements', () => {
      kdTree.remove(el1);
      kdTree.remove(el2);
      kdTree.remove(el3);
      expect(kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
    });

    test('should correctly remove and re-add elements', () => {
      const el1OriginalRect = { ...el1.rect };
      kdTree.remove(el1);
      // Verify el1 is gone
      let result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result.map(e=>e.id)).not.toContain('el1');

      const el1Reinserted = createMockVirtualElement('el1', el1OriginalRect); // Use original rect
      kdTree.insert(el1Reinserted);
      result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
      expect(result.map(e => e.id).sort()).toEqual(['el1', 'el2', 'el3'].sort());
    });

    test('should handle removing the root multiple times if structure changes', () => {
        // Elements: el1(10,20), el2(5,15), el3(15,25)
        // Initial root: el1
        kdTree.remove(el1); // Remove el1. Let's say el3 becomes root.
        let currentRoot = kdTree.queryRange({x:0,y:0,width:100,height:100}).find(e => e.rect.x === 15); // Try to find el3
        if (!currentRoot) { // Or el2 might become root
            currentRoot = kdTree.queryRange({x:0,y:0,width:100,height:100}).find(e => e.rect.x === 5);
        }
        expect(currentRoot).toBeDefined();

        kdTree.remove(currentRoot!); // Remove the new root
        const result = kdTree.queryRange({ x: 0, y: 0, width: 100, height: 100 });
        expect(result.length).toBe(1); // Only one element should remain
    });
  });
});
