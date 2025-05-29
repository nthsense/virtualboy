export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VirtualElement {
  id: string; // A unique identifier for the element
  element: HTMLElement;
  rect: Rect; // Its virtual bounding box
  isVisible: boolean; // Currently rendered in the DOM
  // Add any other relevant properties that come to mind, e.g., original display style
  originalDisplay?: string; 
}

export type MeasureFunction = (element: HTMLElement) => { width: number; height: number };

export interface VirtualboyInstance {
  getVisibleElements: () => HTMLElement[];
  getElementsForRect: (rect: Rect) => HTMLElement[];
  getElementsAt: (x: number, y: number) => HTMLElement[];
  // Add any other methods planned for the public API if they come to mind,
  // e.g., a method to explicitly trigger a remeasure or redraw, or destroy instance.
  // For now, the ones from the plan are sufficient.
  remeasure: () => void;
  destroy: () => void;
}
