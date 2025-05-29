import { MeasureFunction } from './types';

// Not exported, internal helper
function measureElement(element: HTMLElement, parentElement: HTMLElement): { width: number; height: number } {
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

  parentElement.appendChild(element);

  const width = element.offsetWidth;
  const height = element.offsetHeight;

  parentElement.removeChild(element);

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
  customMeasure?: MeasureFunction
): { width: number; height: number } {
  if (customMeasure) {
    return customMeasure(element);
  }
  return measureElement(element, parentElement);
}
