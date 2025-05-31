import { Rect, VirtualElement, MeasureFunction, VirtualboyInstance } from './types';
import { getElementDimensions } from './measure';
import { KDTree } from './kdTree';

class Virtualboy implements VirtualboyInstance {
  private static readonly MAX_SCROLL_HEIGHT: number = 1000000;
  private static readonly MAX_SCROLL_WIDTH: number = 1000000;
  private parentElement: HTMLElement;
  private measureFunction: MeasureFunction;
  private kdTree: KDTree;
  private elements: Map<string, VirtualElement>; // Store by ID
  private virtualScrollTop: number;
  private virtualScrollLeft: number;
  private totalVirtualWidth: number;
  private totalVirtualHeight: number;
  private nextElementId: number = 0;
  private originalParentPosition?: string;

  // Set of VirtualElement IDs currently rendered in the DOM
  private currentlyVisibleElements: Set<string>;
  // Bound scroll event handler
  private scrollHandler: () => void;
  // Sizer element for creating scrollable area
  private sizerElement: HTMLDivElement | null = null;
  private updateQueued: boolean = false; // Add this line

  // Store original DOM methods
  private originalAppendChild: <T extends Node>(newChild: T) => T;
  private originalInsertBefore: <T extends Node>(newChild: T, refChild: Node | null) => T;
  private originalRemoveChild: <T extends Node>(oldChild: T) => T;

  constructor(parentElement: HTMLElement, customMeasureFn?: MeasureFunction) {
    this.parentElement = parentElement;

    // Ensure parentElement is a positioning context
    const parentComputedStyle = window.getComputedStyle(this.parentElement);
    if (parentComputedStyle.position === 'static') {
      this.originalParentPosition = this.parentElement.style.position; // Store inline style or empty if not set
      this.parentElement.style.position = 'relative';
    }

    this.currentlyVisibleElements = new Set<string>();

    // Initialize original DOM methods first, as the default measureFunction will need them.
    // Note: overrideDOMMethods also *sets* the overrides on parentElement.
    this.overrideDOMMethods();

    this.sizerElement = document.createElement('div');
    if (this.sizerElement) { // sizerElement is created just before this
        this.sizerElement.style.position = 'absolute';
        this.sizerElement.style.visibility = 'hidden';
        this.sizerElement.style.zIndex = '-1';
        this.sizerElement.style.top = '0px';
        this.sizerElement.style.left = '0px';
        this.sizerElement.style.width = '0px';
        this.sizerElement.style.height = '0px';
        // Ensure it's not virtualized if it were to be appended via parentElement.appendChild
        // by using originalAppendChild.
        this.originalAppendChild.call(this.parentElement, this.sizerElement);
    }

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
        if (child === this.sizerElement) { // Add this check
          return; // Skip processing for the sizer element
        }
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
      const sizerHeight = this.totalVirtualHeight > Virtualboy.MAX_SCROLL_HEIGHT ?
        Virtualboy.MAX_SCROLL_HEIGHT : this.totalVirtualHeight;
      this.sizerElement.style.height = `${sizerHeight}px`;

      const sizerWidth = this.totalVirtualWidth > Virtualboy.MAX_SCROLL_WIDTH ?
        Virtualboy.MAX_SCROLL_WIDTH : this.totalVirtualWidth;
      this.sizerElement.style.width = `${sizerWidth}px`;
    }
  }

  private handleScroll(): void {
    // Vertical scroll calculation
    if (this.totalVirtualHeight <= Virtualboy.MAX_SCROLL_HEIGHT) {
      this.virtualScrollTop = this.parentElement.scrollTop;
    } else {
      const sizerEffectiveHeight = Virtualboy.MAX_SCROLL_HEIGHT;
      const parentClientHeight = this.parentElement.clientHeight;
      const maxScrollTopForSizer = sizerEffectiveHeight - parentClientHeight;

      if (maxScrollTopForSizer <= 0) {
        this.virtualScrollTop = 0;
      } else {
        const currentScrollTopForSizer = this.parentElement.scrollTop;
        let scrollPercentageY = 0; // Default to 0
        if (maxScrollTopForSizer > 0) { // Ensure maxScrollTopForSizer is positive before division
            scrollPercentageY = currentScrollTopForSizer / maxScrollTopForSizer;
        }
        scrollPercentageY = Math.max(0, Math.min(1, scrollPercentageY)); // Clamp

        const maxVirtualScrollTop = this.totalVirtualHeight - parentClientHeight;
        this.virtualScrollTop = scrollPercentageY * (maxVirtualScrollTop > 0 ? maxVirtualScrollTop : 0);
      }
    }
    // Clamping virtualScrollTop
    this.virtualScrollTop = Math.max(0, this.virtualScrollTop);
    const maxPossibleVirtualScrollTop = this.totalVirtualHeight - this.parentElement.clientHeight;
    this.virtualScrollTop = Math.min(this.virtualScrollTop, maxPossibleVirtualScrollTop > 0 ? maxPossibleVirtualScrollTop : 0);


    // Horizontal scroll calculation
    if (this.totalVirtualWidth <= Virtualboy.MAX_SCROLL_WIDTH) {
      this.virtualScrollLeft = this.parentElement.scrollLeft;
    } else {
      const sizerEffectiveWidth = Virtualboy.MAX_SCROLL_WIDTH;
      const parentClientWidth = this.parentElement.clientWidth;
      const maxScrollLeftForSizer = sizerEffectiveWidth - parentClientWidth;

      if (maxScrollLeftForSizer <= 0) {
        this.virtualScrollLeft = 0;
      } else {
        const currentScrollLeftForSizer = this.parentElement.scrollLeft;
        let scrollPercentageX = 0; // Default to 0
        if (maxScrollLeftForSizer > 0) { // Ensure maxScrollLeftForSizer is positive before division
            scrollPercentageX = currentScrollLeftForSizer / maxScrollLeftForSizer;
        }
        scrollPercentageX = Math.max(0, Math.min(1, scrollPercentageX)); // Clamp

        const maxVirtualScrollLeft = this.totalVirtualWidth - parentClientWidth;
        this.virtualScrollLeft = scrollPercentageX * (maxVirtualScrollLeft > 0 ? maxVirtualScrollLeft : 0);
      }
    }
    // Clamping virtualScrollLeft
    this.virtualScrollLeft = Math.max(0, this.virtualScrollLeft);
    const maxPossibleVirtualScrollLeft = this.totalVirtualWidth - this.parentElement.clientWidth;
    this.virtualScrollLeft = Math.min(this.virtualScrollLeft, maxPossibleVirtualScrollLeft > 0 ? maxPossibleVirtualScrollLeft : 0);

    if (!this.updateQueued) {
      this.updateQueued = true;
      requestAnimationFrame(() => {
        this.updateVisibleElements();
        this.updateQueued = false;
      });
    }
  }

  private updateVisibleElements(): void {
    const viewportRect: Rect = {
      x: this.virtualScrollLeft,
      y: this.virtualScrollTop,
      width: this.parentElement.clientWidth,
      height: this.parentElement.clientHeight,
    };

    const elementsInViewport = this.kdTree.queryRange(viewportRect); // VirtualElement[]
    // Optional: Log details of a few elements found
    // if (elementsInViewport.length > 0) {
    //   console.log(`[Virtualboy DEBUG]     First few elements in viewport:`);
    //   for (let i = 0; i < Math.min(3, elementsInViewport.length); i++) {
    //     const ve = elementsInViewport[i];
    //     console.log(`[Virtualboy DEBUG]       ID: ${ve.id}, Rect: x=${ve.rect.x}, y=${ve.rect.y}, w=${ve.rect.width}, h=${ve.rect.height}`);
    //   }
    // }

    const shouldBeVisibleIds = new Set(elementsInViewport.map(ve => ve.id));

    // Process Removals
    let removedCount = 0;
    for (const idToRemove of Array.from(this.currentlyVisibleElements)) {
      if (!shouldBeVisibleIds.has(idToRemove)) {
        const virtualElement = this.elements.get(idToRemove);
        if (virtualElement && virtualElement.isVisible) {
          // console.log(`[Virtualboy DEBUG]     Removing element ID: ${idToRemove}`); // Can be very verbose
          this.originalRemoveChild.call(this.parentElement, virtualElement.element);
          virtualElement.isVisible = false;
          removedCount++;
        }
        this.currentlyVisibleElements.delete(idToRemove); // Ensure it's removed from the set
      }
    }

    // Process Additions
    const fragment = document.createDocumentFragment();
    const addedVirtualElements: VirtualElement[] = [];
    let addedToFragmentCount = 0;

    for (const virtualElement of elementsInViewport) {
      if (!this.currentlyVisibleElements.has(virtualElement.id)) {
        // console.log(`[Virtualboy DEBUG]     Adding element ID: ${virtualElement.id}`); // Can be very verbose
        const domElement = virtualElement.element;
        domElement.style.position = 'absolute';
      // Apply the new formula
      domElement.style.left = `${(virtualElement.rect.x - this.virtualScrollLeft) + this.parentElement.scrollLeft}px`;
      domElement.style.top = `${(virtualElement.rect.y - this.virtualScrollTop) + this.parentElement.scrollTop}px`;
        domElement.style.width = `${virtualElement.rect.width}px`;
        domElement.style.height = `${virtualElement.rect.height}px`;
        domElement.style.display = virtualElement.originalDisplay || 'block';

        fragment.appendChild(domElement);
        addedVirtualElements.push(virtualElement);
        addedToFragmentCount++;
      } else {
        const ve = this.elements.get(virtualElement.id);
        if (ve && !ve.isVisible) {
          ve.isVisible = true; // Should already be visible, but ensure state consistency
        }
      }
    }

    if (fragment.childNodes.length > 0) {
      this.originalAppendChild.call(this.parentElement, fragment);
    } else if (addedToFragmentCount === 0 && removedCount === 0 && elementsInViewport.length > 0) {
      // This case means elementsInViewport are all already in currentlyVisibleElements.
      // console.log(`[Virtualboy DEBUG]   No DOM changes needed, all ${elementsInViewport.length} viewport elements already visible.`);
    }


    for (const virtualElement of addedVirtualElements) {
      virtualElement.isVisible = true;
      this.currentlyVisibleElements.add(virtualElement.id);
    }
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
    const savedVirtualScrollTop = this.virtualScrollTop;
    const savedVirtualScrollLeft = this.virtualScrollLeft;


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

    // Restore scroll position
    // Vertical scroll restoration
    let newParentScrollTop: number;
    if (this.totalVirtualHeight <= Virtualboy.MAX_SCROLL_HEIGHT) {
      newParentScrollTop = savedVirtualScrollTop;
    } else {
      const parentClientHeight = this.parentElement.clientHeight;
      const maxVirtualScrollTop = this.totalVirtualHeight - parentClientHeight;
      let scrollPercentageY = 0;
      if (maxVirtualScrollTop > 0) {
        scrollPercentageY = savedVirtualScrollTop / maxVirtualScrollTop;
      }
      scrollPercentageY = Math.max(0, Math.min(1, scrollPercentageY)); // Clamp percentage

      const sizerEffectiveHeight = Virtualboy.MAX_SCROLL_HEIGHT;
      const maxScrollTopForSizer = sizerEffectiveHeight - parentClientHeight;
      newParentScrollTop = scrollPercentageY * (maxScrollTopForSizer > 0 ? maxScrollTopForSizer : 0);
    }

    // Clamping newParentScrollTop
    newParentScrollTop = Math.max(0, newParentScrollTop);
    // Max possible scroll for parentElement with current sizer.
    // Ensure sizerElement and style.height are valid before parsing
    let actualSizerHeightForScroll = 0;
    if (this.sizerElement && this.sizerElement.style.height) {
      actualSizerHeightForScroll = parseFloat(this.sizerElement.style.height);
    }
    const maxParentScrollTop = actualSizerHeightForScroll - this.parentElement.clientHeight;

    if (maxParentScrollTop > 0) {
        newParentScrollTop = Math.min(newParentScrollTop, maxParentScrollTop);
    } else {
        newParentScrollTop = 0;
    }
    this.parentElement.scrollTop = newParentScrollTop;


    // Horizontal scroll restoration (similar logging structure)
    let newParentScrollLeft: number;
    if (this.totalVirtualWidth <= Virtualboy.MAX_SCROLL_WIDTH) {
      newParentScrollLeft = savedVirtualScrollLeft;
    } else {
      const parentClientWidth = this.parentElement.clientWidth;
      const maxVirtualScrollLeft = this.totalVirtualWidth - parentClientWidth;
      let scrollPercentageX = 0;
      if (maxVirtualScrollLeft > 0) {
        scrollPercentageX = savedVirtualScrollLeft / maxVirtualScrollLeft;
      }
      scrollPercentageX = Math.max(0, Math.min(1, scrollPercentageX));

      const sizerEffectiveWidth = Virtualboy.MAX_SCROLL_WIDTH;
      const maxScrollLeftForSizer = sizerEffectiveWidth - parentClientWidth;
      newParentScrollLeft = scrollPercentageX * (maxScrollLeftForSizer > 0 ? maxScrollLeftForSizer : 0);
    }

    // Clamping newParentScrollLeft
    newParentScrollLeft = Math.max(0, newParentScrollLeft);
    let actualSizerWidthForScroll = 0;
    if (this.sizerElement && this.sizerElement.style.width) {
      actualSizerWidthForScroll = parseFloat(this.sizerElement.style.width);
    }
    const maxParentScrollLeft = actualSizerWidthForScroll - this.parentElement.clientWidth;

    if (maxParentScrollLeft > 0) {
        newParentScrollLeft = Math.min(newParentScrollLeft, maxParentScrollLeft);
    } else {
        newParentScrollLeft = 0;
    }
    this.parentElement.scrollLeft = newParentScrollLeft;


    // After restoring parentElement.scrollTop/Left, we MUST update this.virtualScrollTop/Left
    // --- Recalculate virtualScrollTop based on restored parentElement.scrollTop ---
    // (This is the same logic as in handleScroll, so not repeating all sub-logs here for brevity,
    //  but in a real scenario, you might want the same level of detail or a shared logged function)
    if (this.totalVirtualHeight <= Virtualboy.MAX_SCROLL_HEIGHT) {
        this.virtualScrollTop = this.parentElement.scrollTop;
    } else {
        // ... percentage logic as in handleScroll ... (briefly)
        const sizerEffectiveHeight = Virtualboy.MAX_SCROLL_HEIGHT;
        const parentClientHeight = this.parentElement.clientHeight;
        const maxScrollTopForSizer = sizerEffectiveHeight - parentClientHeight;
        if (maxScrollTopForSizer <= 0) { this.virtualScrollTop = 0; }
        else {
            const currentScrollTopForSizer = this.parentElement.scrollTop;
            const scrollPercentageY = Math.max(0, Math.min(1, currentScrollTopForSizer / maxScrollTopForSizer));
            const maxVirtualScrollTopVal = this.totalVirtualHeight - parentClientHeight;
            this.virtualScrollTop = scrollPercentageY * (maxVirtualScrollTopVal > 0 ? maxVirtualScrollTopVal : 0);
        }
    }
    this.virtualScrollTop = Math.max(0, this.virtualScrollTop);
    const maxPossibleVirtualScrollTopRecalc = this.totalVirtualHeight - this.parentElement.clientHeight;
    this.virtualScrollTop = Math.min(this.virtualScrollTop, maxPossibleVirtualScrollTopRecalc > 0 ? maxPossibleVirtualScrollTopRecalc : 0);


    // --- Recalculate virtualScrollLeft based on restored parentElement.scrollLeft ---
    if (this.totalVirtualWidth <= Virtualboy.MAX_SCROLL_WIDTH) {
        this.virtualScrollLeft = this.parentElement.scrollLeft;
    } else {
        // ... percentage logic as in handleScroll ... (briefly)
        const sizerEffectiveWidth = Virtualboy.MAX_SCROLL_WIDTH;
        const parentClientWidth = this.parentElement.clientWidth;
        const maxScrollLeftForSizer = sizerEffectiveWidth - parentClientWidth;
        if (maxScrollLeftForSizer <= 0) { this.virtualScrollLeft = 0; }
        else {
            const currentScrollLeftForSizer = this.parentElement.scrollLeft;
            const scrollPercentageX = Math.max(0, Math.min(1, currentScrollLeftForSizer / maxScrollLeftForSizer));
            const maxVirtualScrollLeftVal = this.totalVirtualWidth - parentClientWidth;
            this.virtualScrollLeft = scrollPercentageX * (maxVirtualScrollLeftVal > 0 ? maxVirtualScrollLeftVal : 0);
        }
    }
    this.virtualScrollLeft = Math.max(0, this.virtualScrollLeft);
    const maxPossibleVirtualScrollLeftRecalc = this.totalVirtualWidth - this.parentElement.clientWidth;
    this.virtualScrollLeft = Math.min(this.virtualScrollLeft, maxPossibleVirtualScrollLeftRecalc > 0 ? maxPossibleVirtualScrollLeftRecalc : 0);


    this.updateVisibleElements(); // This method now has its own logs.
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
    if (this.sizerElement && this.sizerElement.parentElement === this.parentElement) {
        this.originalRemoveChild.call(this.parentElement, this.sizerElement);
    }
    this.sizerElement = null;

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

    // Restore original parent position if it was changed
    if (this.originalParentPosition !== undefined) { // Check if it was set
        this.parentElement.style.position = this.originalParentPosition;
        if (this.originalParentPosition === "") { // If original was empty, means it was truly static via CSS
             // Best effort to remove inline style. Setting to empty string might not revert to stylesheet's 'static'.
             // A more robust way might be this.parentElement.style.removeProperty('position');
             // However, for this exercise, setting to original (even if empty) is the direct reversal.
             // If originalParentPosition was e.g. 'absolute' and we set it to 'relative', this restores 'absolute'.
        }
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
