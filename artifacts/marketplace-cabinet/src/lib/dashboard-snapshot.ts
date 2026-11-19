import type { BlockContext } from "./dashboard-model";
export async function captureDashboardBlock(
  element: HTMLElement,
): Promise<NonNullable<BlockContext["image"]>> {
  await document.fonts.ready;
  const rect = element.getBoundingClientRect(),
    width = Math.ceil(rect.width),
    height = Math.ceil(rect.height);
  if (!width || !height)
    throw new Error("Разверните блок перед созданием поручения.");
  const clone = element.cloneNode(true) as HTMLElement,
    source = [element, ...element.querySelectorAll("*")],
    target = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < source.length; i++) {
    const style = getComputedStyle(source[i]);
    for (const property of style)
      (target[i] as HTMLElement).style.setProperty(
        property,
        style.getPropertyValue(property),
      );
    (target[i] as HTMLElement).style.animation = "none";
    (target[i] as HTMLElement).style.transition = "none";
    target[i].removeAttribute("tabindex");
  }
  Object.assign(clone.style, {
    width: width + "px",
    height: height + "px",
    margin: "0",
    position: "relative",
    inset: "auto",
    transform: "none",
  });
  const html = new XMLSerializer().serializeToString(clone),
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Не удалось подготовить снимок блока.")),
      10000,
    );
    image.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Не удалось подготовить снимок блока."));
    };
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const scale = Math.min(2, 4096 / width, 4096 / height),
    canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось подготовить снимок блока.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > 2600000)
    throw new Error(
      "Снимок слишком большой. Сверните лишнюю детализацию и повторите.",
    );
  return { dataUrl, width, height, at: new Date().toISOString() };
}
