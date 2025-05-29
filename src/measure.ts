import { MeasureFunction } from './types';

// Not exported, internal helper
function measureElement(
  element: HTMLElement,
  parentElement: HTMLElement,
  originalAppend: (node: Node) => Node,
  originalRemove: (node: Node) => Node
): { width: number; height: number } {
  const originalStyles = {
    position: element.style.position,
    visibility: element.style.visibility,
    display: element.style.display,
    left: element.style.left,
    top: element.style.top,
  };

  element.style.position = 'absolute';
  element.style.visibility = 'hidden';
  element.style.display = 'block'; // Using 'block' as a generally safe default for measurement
  element.style.left = '-9999px';
  element.style.top = '-9999px';

  originalAppend.call(parentElement, element);

  const width = element.offsetWidth;
  const height = element.offsetHeight;

  originalRemove.call(parentElement, element);

  // Restore original styles
  element.style.position = originalStyles.position;
  element.style.visibility = originalStyles.visibility;
  element.style.display = originalStyles.display;
  element.style.left = originalStyles.left;
  element.style.top = originalStyles.top;

  return { width, height };
}

export function getElementDimensions(
  element: HTMLElement,
  parentElement: HTMLElement,
  originalAppend: (node: Node) => Node,
  originalRemove: (node: Node) => Node,
  customMeasure?: MeasureFunction
): { width: number; height: number } {
  if (customMeasure) {
    return customMeasure(element);
  }
  return measureElement(element, parentElement, originalAppend, originalRemove);
}
