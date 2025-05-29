import { MeasureFunction } from './types';

// Not exported, internal helper
// This function now assumes the element is already in the DOM and styled appropriately for measurement.
function measureElement(element: HTMLElement): { width: number; height: number } {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  // Optional: console.log(`measureElement for ${element.id || 'un-ided element'}: width=${width}, height=${height}`);
  return { width, height };
}

export function getElementDimensions(
  element: HTMLElement,
  customMeasure?: MeasureFunction
): { width: number; height: number } {
  if (customMeasure) {
    return customMeasure(element);
  }
  // The caller (Virtualboy.handleElementAdded) is now responsible for
  // preparing the element in the DOM for measurement.
  // measureElement just reads offsetWidth/Height.
  return measureElement(element);
}
