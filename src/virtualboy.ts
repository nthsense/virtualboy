import { Rect, VirtualElement, MeasureFunction, VirtualboyInstance } from './types';
import { getElementDimensions } from './measure';
import { KDTree } from './kdTree';

class Virtualboy implements VirtualboyInstance {
  private parentElement: HTMLElement;
  private measureFunction: MeasureFunction;
  private kdTree: KDTree;
  private elements: Map<string, VirtualElement>; // Store by ID
  private virtualScrollTop: number;
  private virtualScrollLeft: number;
  private totalVirtualWidth: number;
  private totalVirtualHeight: number;
  private nextElementId: number = 0;

  // Set of VirtualElement IDs currently rendered in the DOM
  private currentlyVisibleElements: Set<string>;
  // Bound scroll event handler
  private scrollHandler: () => void;
  private shadowRoot: ShadowRoot | null = null;
  // Sizer element for creating scrollable area
  private sizerElement: HTMLDivElement | null = null;

  // Store original DOM methods
  private originalAppendChild: <T extends Node>(newChild: T) => T;
  private originalInsertBefore: <T extends Node>(newChild: T, refChild: Node | null) => T;
  private originalRemoveChild: <T extends Node>(oldChild: T) => T;

  constructor(parentElement: HTMLElement, customMeasureFn?: MeasureFunction) {
    this.parentElement = parentElement;
    this.currentlyVisibleElements = new Set<string>();

    // Initialize original DOM methods first, as the default measureFunction will need them.
    // Note: overrideDOMMethods also *sets* the overrides on parentElement.
    this.overrideDOMMethods();

    if (customMeasureFn) {
      this.measureFunction = customMeasureFn;
    } else {
      // Default measure function now calls the simplified getElementDimensions.
      // getElementDimensions will internally call the minimal measureElement(element).
      // The responsibility for DOM manipulation for measurement is now in handleElementAdded.
      this.measureFunction = (element: HTMLElement) =>
        getElementDimensions(element, undefined); // Pass element and undefined for customMeasure
    }

    this.kdTree = new KDTree();
    this.elements = new Map<string, VirtualElement>();
    this.virtualScrollTop = 0;
    this.virtualScrollLeft = 0;

    // Initial dimensions could be based on parent or 0.
    // Parent's clientWidth might be a good starting point for totalVirtualWidth if elements are laid out horizontally.
    // totalVirtualHeight will typically grow as elements are added vertically.
    this.totalVirtualWidth = this.parentElement.clientWidth;
    this.totalVirtualHeight = 0;

    // Attach Shadow DOM and create sizer within it
    if (this.parentElement.attachShadow) {
        this.shadowRoot = this.parentElement.attachShadow({ mode: 'open' });

        this.sizerElement = document.createElement('div');
        this.sizerElement.style.position = 'absolute';
        this.sizerElement.style.top = '0';
        this.sizerElement.style.left = '0';
        this.sizerElement.style.visibility = 'hidden';
        this.sizerElement.style.zIndex = '-1';
        // 'data-virtualboy-internal' attribute is NOT set as it's encapsulated.

        this.shadowRoot.appendChild(this.sizerElement);

        // Create and append a default slot for light DOM content (rendered items)
        const slotElement = document.createElement('slot');
        this.shadowRoot.appendChild(slotElement);

    } else {
        console.error(
            "Virtualboy: Shadow DOM not supported on the parentElement. " +
            "Scrollbars may not function correctly without a sizer. " +
            "Consider using a polyfill or ensuring the parentElement is styled to scroll its content."
        );
        // this.sizerElement remains null
        // this.shadowRoot remains null
    }
    // updateSizer (called later) will handle the case where this.sizerElement is null.


    // Discover and virtualize existing elements.
    // This will use this.measureFunction, which might use getElementDimensions,
    // which now correctly uses the original DOM methods for measurement.
    this.discoverInitialElements();

    // Setup scroll handling
    this.scrollHandler = this.handleScroll.bind(this);
    this.parentElement.addEventListener('scroll', this.scrollHandler);

    // Initial render of visible elements
    this.updateVisibleElements();
    // Ensure sizer is updated with initial dimensions
    this.updateSizer();
  }

  private generateId(): string {
    return `virtual-element-${this.nextElementId++}`;
  }

  private overrideDOMMethods(): void {
    this.originalAppendChild = this.parentElement.appendChild.bind(this.parentElement);
    this.originalInsertBefore = this.parentElement.insertBefore.bind(this.parentElement);
    this.originalRemoveChild = this.parentElement.removeChild.bind(this.parentElement);

    this.parentElement.appendChild = <T extends Node>(newChild: T): T => {
      if (newChild instanceof HTMLElement) {
        this.handleElementAdded(newChild as HTMLElement);
        return newChild;
      } else {
        return this.originalAppendChild.call(this.parentElement, newChild) as T;
      }
    };

    this.parentElement.insertBefore = <T extends Node>(newChild: T, refChild: Node | null): T => {
      if (newChild instanceof HTMLElement) {
        this.handleElementAdded(newChild as HTMLElement, refChild as HTMLElement | null);
        return newChild;
      } else {
        return this.originalInsertBefore.call(this.parentElement, newChild, refChild) as T;
      }
    };

    this.parentElement.removeChild = <T extends Node>(oldChild: T): T => {
      if (oldChild instanceof HTMLElement) {
        // If we are not tracking it, it means it was likely a non-virtualized element (e.g. a text node's wrapper, or added by other script)
        // or it was a virtualized element that is currently visible in the DOM.
        // The handleElementRemoved method will decide if originalRemoveChild should be called.
        this.handleElementRemoved(oldChild as HTMLElement);
        return oldChild;
      } else {
        return this.originalRemoveChild(oldChild);
      }
    };
  }

  private discoverInitialElements(): void {
    // Convert HTMLCollection to array to avoid issues if collection mutates during iteration
    const initialChildren = Array.from(this.parentElement.children);
    initialChildren.forEach(child => {
      if (child instanceof HTMLElement) {
        // isInitialDiscovery = true, so it will be removed from DOM after processing
        this.handleElementAdded(child, null, true);
      }
    });
  }

  private handleElementAdded(element: HTMLElement, _refChild?: HTMLElement | null, isInitialDiscovery: boolean = false): void {
    // Basic check to prevent double-adding if element already has an ID we track.
    // More robust checking might be needed if IDs are not stable or guaranteed unique outside Virtualboy.
    if (element.id && this.elements.has(element.id)) {
      console.warn(`Virtualboy: Element with ID '${element.id}' already added. Skipping.`);
      return;
    }

    // --- Start Measurement Preparation ---
    const originalStyle = {
        position: element.style.position,
        visibility: element.style.visibility,
        display: element.style.display,
        left: element.style.left,
        top: element.style.top,
    };

    // Apply styles for off-screen measurement
    // Use existing display if set and likely to give valid dimensions (e.g. inline-block), else default to 'block'
    const currentDisplay = element.style.display;
    const displayForMeasure = (currentDisplay && currentDisplay !== 'none' && currentDisplay !== 'inline') ? currentDisplay : 'block';

    element.style.position = 'absolute';
    element.style.visibility = 'hidden';
    element.style.display = displayForMeasure;
    element.style.left = '-9999px';
    element.style.top = '-9999px';

    if (!isInitialDiscovery) {
        // If it's a new element (not from initial DOM scan), append it for measurement.
        // Initial elements are already in the DOM.
        this.originalAppendChild.call(this.parentElement, element);
    }
    // For initial elements, they are already children and now have the temporary measurement styles applied.

    const dimensions = this.measureFunction(element); // Element is now in DOM and styled for measurement

    // Immediately remove the element from the DOM after measurement.
    // This applies to both initial elements (making them virtual) and newly added ones (which were temporary).
    this.originalRemoveChild.call(this.parentElement, element);

    // Restore original styles
    element.style.position = originalStyle.position;
    element.style.visibility = originalStyle.visibility;
    element.style.display = originalStyle.display;
    element.style.left = originalStyle.left;
    element.style.top = originalStyle.top;
    // --- End Measurement Preparation & Restoration ---


    // Simple vertical stacking layout logic
    // TODO: Support more complex layout strategies (e.g., using refChild, explicit x/y)
    const virtualRect: Rect = {
      x: 0, // Assuming all elements are stacked vertically at x=0 for now
      y: this.totalVirtualHeight,
      width: dimensions.width,
      height: dimensions.height,
    };

    this.totalVirtualHeight += dimensions.height;
    this.totalVirtualWidth = Math.max(this.totalVirtualWidth, dimensions.width);
    this.updateSizer();

    let id = element.id;
    if (!id) {
      id = this.generateId();
      element.id = id; // Assign the generated ID back to the element for future reference
    }

    const virtualElement: VirtualElement = {
      id: id,
      element: element,
      rect: virtualRect,
      isVisible: false, // Elements are not visible until explicitly rendered by Virtualboy
      originalDisplay: element.style.display || '', // Store original display style
    };

    this.elements.set(virtualElement.id, virtualElement);
    this.kdTree.insert(virtualElement);

    // The old conditional removal for isInitialDiscovery is no longer needed here,
    // as all elements (initial or new) are removed from DOM after measurement above.
    // Virtualboy will re-add them to the DOM if they are in the viewport during updateVisibleElements().
  }

  private handleElementRemoved(element: HTMLElement): void {
    const id = element.id;
    if (id && this.elements.has(id)) {
      const virtualElement = this.elements.get(id)!;

      this.kdTree.remove(virtualElement); // Call stubbed KDTree.remove
      this.elements.delete(id);

      // Naive recalculation of total dimensions.
      // TODO: Implement a more efficient way, especially if elements can have varying x/y positions.
      // This current logic assumes simple vertical stacking for totalVirtualHeight.
      let newTotalHeight = 0;
      let newTotalWidth = 0;
      // The order of elements matters for recalculating height in a simple stacking model.
      // This simple iteration won't preserve order if items are removed from middle.
      // For now, this is a placeholder for a more robust layout recalculation.
      // A better approach might be to find the element with max y + height.
      for (const ve of this.elements.values()) {
        // This logic is flawed for totalVirtualHeight if elements are not re-stacked.
        // newTotalHeight += ve.rect.height; // This is wrong.
        // Instead, find the maximum extent:
        newTotalHeight = Math.max(newTotalHeight, ve.rect.y + ve.rect.height);
        newTotalWidth = Math.max(newTotalWidth, ve.rect.x + ve.rect.width);
      }
      this.totalVirtualHeight = newTotalHeight;
      this.totalVirtualWidth = newTotalWidth;
      this.updateSizer();


      // If the element was visible (i.e., physically in the DOM managed by Virtualboy), remove it.
      if (virtualElement.isVisible) {
        this.originalRemoveChild.call(this.parentElement, element);
        virtualElement.isVisible = false; // Update its state
        this.currentlyVisibleElements.delete(id); // Also remove from visible set
      }
      // If it wasn't visible, it means it was only in our virtual model, so no DOM removal needed here.
    } else {
      // If Virtualboy wasn't tracking this element, it's likely a non-virtualized child (e.g., a TextNode)
      // or an element that was somehow removed from tracking without going through this path.
      // In this case, perform the original removal from the DOM.
      this.originalRemoveChild.call(this.parentElement, element);
    }
  }

  private updateSizer(): void {
    if (this.sizerElement) {
      this.sizerElement.style.width = `${this.totalVirtualWidth}px`;
      this.sizerElement.style.height = `${this.totalVirtualHeight}px`;
    }
  }

  private handleScroll(): void {
    this.virtualScrollTop = this.parentElement.scrollTop;
    this.virtualScrollLeft = this.parentElement.scrollLeft;
    this.updateVisibleElements();
  }

  private updateVisibleElements(): void {
    const viewportRect: Rect = {
      x: this.parentElement.scrollLeft,
      y: this.parentElement.scrollTop,
      width: this.parentElement.clientWidth,
      height: this.parentElement.clientHeight,
    };

    const elementsInViewport = this.kdTree.queryRange(viewportRect); // VirtualElement[]
    const shouldBeVisibleIds = new Set(elementsInViewport.map(ve => ve.id));
    const idsToRemoveFromVisibleSet: string[] = [];

    // Process Removals - Identify elements to "soft remove" and mark for actual Set deletion
    // Iterate over a copy of the set because we might modify it if we were deleting directly
    for (const idToRemove of Array.from(this.currentlyVisibleElements)) {
      if (!shouldBeVisibleIds.has(idToRemove)) {
        const virtualElement = this.elements.get(idToRemove);
        if (virtualElement && virtualElement.isVisible) { // Process only if currently marked as visible
          virtualElement.element.style.display = 'none';
          virtualElement.isVisible = false;
          idsToRemoveFromVisibleSet.push(idToRemove); // Add to list for delayed Set.delete()
        }
      }
    }

    // Process Additions / Re-showing
    for (const virtualElementInViewport of elementsInViewport) {
      // Use the ID from the element found in the viewport query
      const elementId = virtualElementInViewport.id;
      const existingVE = this.elements.get(elementId); // Get the authoritative VirtualElement from our main map

      if (!existingVE) {
        // This should ideally not happen if elements are managed correctly via handleElementAdded/Removed
        console.warn(`Virtualboy: Element with ID '${elementId}' found in viewport query but not in master elements map.`);
        continue;
      }

      if (!this.currentlyVisibleElements.has(elementId)) {
        // This element is TRULY NEW to the visible set for this update cycle
        // (it wasn't in currentlyVisibleElements at the start of this function).
        // This path handles elements that were fully removed (not just soft-removed) or are new.
        // However, with soft-removal, this path might be less common for items just scrolling in/out.
        // The more common path for re-showing soft-removed items is the 'else' block below.
        // For this diagnostic, we'll assume this path is for elements that were genuinely not tracked as visible.

        existingVE.element.style.position = 'absolute';
        existingVE.element.style.left = `${existingVE.rect.x}px`;
        existingVE.element.style.top = `${existingVE.rect.y}px`;
        existingVE.element.style.width = `${existingVE.rect.width}px`;
        existingVE.element.style.height = `${existingVE.rect.height}px`;
        existingVE.element.style.display = existingVE.originalDisplay || 'block';

        // If the element was previously 'display:none', it's already in the DOM.
        // If it's a brand new element (e.g. added via public API and then scrolled into view),
        // it might not be. This appendChild is generally safe; browsers handle it.
        this.originalAppendChild.call(this.parentElement, existingVE.element);
        existingVE.isVisible = true;
        this.currentlyVisibleElements.add(elementId); // Add to the live set of visible elements
      } else {
        // Element ID IS in currentlyVisibleElements.
        // This means either it remained visible from the last cycle OR
        // it was "soft removed" (display:none, isVisible:false) in the loop above,
        // BUT its ID was NOT yet deleted from currentlyVisibleElements (that's delayed).
        if (!existingVE.isVisible) {
            // This is a soft-removed element that's back in viewport. Make it visible again.
            existingVE.element.style.display = existingVE.originalDisplay || 'block';
            // Ensure position/size are correct as well, in case they could have changed
            existingVE.element.style.position = 'absolute';
            existingVE.element.style.left = `${existingVE.rect.x}px`;
            existingVE.element.style.top = `${existingVE.rect.y}px`;
            existingVE.element.style.width = `${existingVE.rect.width}px`;
            existingVE.element.style.height = `${existingVE.rect.height}px`;
            existingVE.isVisible = true;
            // No need to re-add to currentlyVisibleElements as its ID was never deleted from there in this pass.
        }
        // If existingVE.isVisible is true, it was already visible and remains so.
        // We could re-apply styles here if rects could change for visible elements.
        // For now, assume rects for visible elements are stable between updates unless remeasured.
      }
    }

    // Now, perform the actual Set.delete() operations
    for (const id of idsToRemoveFromVisibleSet) {
        this.currentlyVisibleElements.delete(id);
    }
    // Note: The parentElement should have appropriate CSS (e.g., position: relative)
    // for absolute positioning of children to work as expected. This is a user responsibility.
  }

  // --- Public API Methods ---
  public getVisibleElements(): HTMLElement[] {
    const visibleHtmlElements: HTMLElement[] = [];
    for (const id of this.currentlyVisibleElements) {
      const virtualElement = this.elements.get(id);
      // Ensure the element is indeed marked as visible and exists
      if (virtualElement && virtualElement.isVisible) {
        visibleHtmlElements.push(virtualElement.element);
      }
    }
    return visibleHtmlElements;
  }

  public getElementsForRect(queryRect: Rect): HTMLElement[] {
    if (!this.kdTree) return []; // Should not happen if initialized
    const virtualElements = this.kdTree.queryRange(queryRect);
    return virtualElements.map(ve => ve.element);
  }

  public getElementsAt(x: number, y: number): HTMLElement[] {
    if (!this.kdTree) return []; // Should not happen if initialized
    const virtualElements = this.kdTree.queryPoint(x, y);
    return virtualElements.map(ve => ve.element);
  }

  public remeasure(): void {
    const currentScrollTop = this.parentElement.scrollTop;
    const currentScrollLeft = this.parentElement.scrollLeft;

    // Clear currently visible elements from DOM and internal set
    for (const id of Array.from(this.currentlyVisibleElements)) { // Iterate copy
      const ve = this.elements.get(id);
      if (ve && ve.isVisible) {
        this.originalRemoveChild.call(this.parentElement, ve.element);
        ve.isVisible = false; // Mark as not visible
      }
    }
    this.currentlyVisibleElements.clear();

    // Reset KDTree and virtual dimensions
    this.kdTree = new KDTree(); // Clears the tree by creating a new one
    let newTotalVirtualHeight = 0;
    let newTotalVirtualWidth = this.parentElement.clientWidth; // Start with parent width as a base

    // Iterate over all tracked elements to remeasure and re-calculate layout
    // Using Array.from to safely iterate if .values() is a live collection (though typically not for Map)
    const allVirtualElements = Array.from(this.elements.values());

    for (const virtualElement of allVirtualElements) {
      const dimensions = this.measureFunction(virtualElement.element);
      virtualElement.rect.width = dimensions.width;
      virtualElement.rect.height = dimensions.height;

      // Recalculate position (simple vertical stack for this example)
      // TODO: Allow for more sophisticated layout strategies if needed
      virtualElement.rect.x = 0;
      virtualElement.rect.y = newTotalVirtualHeight;

      newTotalVirtualHeight += virtualElement.rect.height;
      newTotalVirtualWidth = Math.max(newTotalVirtualWidth, virtualElement.rect.x + virtualElement.rect.width);

      // Re-insert the updated element into the new KDTree
      this.kdTree.insert(virtualElement);
    }

    this.totalVirtualHeight = newTotalVirtualHeight;
    this.totalVirtualWidth = newTotalVirtualWidth;
    this.updateSizer();

    // Restore scroll position. This is important to do *before* updateVisibleElements
    // so that the viewport calculation is based on the intended scroll state.
    this.parentElement.scrollTop = currentScrollTop;
    this.parentElement.scrollLeft = currentScrollLeft;

    // Re-render elements based on the new layout and restored scroll position
    this.updateVisibleElements();
  }

  public destroy(): void {
    // Remove event listener
    this.parentElement.removeEventListener('scroll', this.scrollHandler);

    // Clear all visible elements from DOM
    // Iterate over a copy for modification safety, though direct iteration and removal might also work
    for (const id of Array.from(this.currentlyVisibleElements)) {
      const virtualElement = this.elements.get(id);
      if (virtualElement && virtualElement.isVisible) {
        // Use originalRemoveChild as parentElement.removeChild is the overridden one
        this.originalRemoveChild.call(this.parentElement, virtualElement.element);
        virtualElement.isVisible = false; // Mark as not visible
      }
    }
    this.currentlyVisibleElements.clear();

    // Clear internal element tracking
    this.elements.clear();
    // Re-initialize KDTree; alternatively, if KDTree had a .clear() method, that could be used.
    this.kdTree = new KDTree();

    // Reset scroll and dimension properties
    this.virtualScrollLeft = 0;
    this.virtualScrollTop = 0;
    this.totalVirtualHeight = 0;
    this.totalVirtualWidth = this.parentElement.clientWidth; // Reset to parent's current width

    // Sizer and Shadow DOM cleanup
    if (this.shadowRoot) {
        // Clear all content from the shadow root, which includes the sizer.
        this.shadowRoot.innerHTML = '';
        this.shadowRoot = null;
    }
    // The sizerElement was a child of shadowRoot, so it's gone now if shadowRoot existed.
    // If shadowRoot didn't exist, sizerElement was never created in the simplified constructor.
    this.sizerElement = null; // Ensure sizerElement reference is always cleared.

    // Restore original DOM methods
    if (this.originalAppendChild) {
      this.parentElement.appendChild = this.originalAppendChild;
    }
    if (this.originalInsertBefore) {
      this.parentElement.insertBefore = this.originalInsertBefore;
    }
    if (this.originalRemoveChild) {
      this.parentElement.removeChild = this.originalRemoveChild;
    }
    console.log('Virtualboy instance destroyed.');
  }

  // --- Methods to be added/completed later ---
  // addElement(element: HTMLElement, x?: number, y?: number): void
  // updateScrollPosition(scrollTop: number, scrollLeft: number): void
  // render(): void
}

export function init(parentElement: HTMLElement, customMeasure?: MeasureFunction): VirtualboyInstance {
  const virtualboy = new Virtualboy(parentElement, customMeasure);
  return virtualboy;
}
