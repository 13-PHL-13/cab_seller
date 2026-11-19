export interface TaskBlockContext {
  section: string;
  stores: string;
  period: string;
  storeIds: string[];
  reference?: string;
  image?: { dataUrl: string; width: number; height: number; at: string };
}
export function parseTaskBlock(value: unknown): TaskBlockContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Некорректный контекст поручения.");
  const v = value as Record<string, unknown>;
  if (
    typeof v.section !== "string" ||
    typeof v.stores !== "string" ||
    typeof v.period !== "string" ||
    !Array.isArray(v.storeIds) ||
    v.storeIds.length > 100 ||
    !v.storeIds.every((id) => typeof id === "string" && /^\d+$/.test(id))
  )
    throw new Error("Некорректный контекст поручения.");
  const result: TaskBlockContext = {
    section: v.section.slice(0, 200),
    stores: v.stores.slice(0, 300),
    period: v.period.slice(0, 100),
    storeIds: v.storeIds,
  };
  if (
    typeof v.reference === "string" &&
    /^\/[?#]/.test(v.reference) &&
    v.reference.length < 1000
  )
    result.reference = v.reference;
  if (v.image) {
    const image = v.image as Record<string, unknown>;
    if (
      typeof image.dataUrl !== "string" ||
      image.dataUrl.length > 2600000 ||
      !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(
        image.dataUrl,
      ) ||
      typeof image.width !== "number" ||
      typeof image.height !== "number" ||
      image.width <= 0 ||
      image.height <= 0 ||
      image.width > 10000 ||
      image.height > 20000 ||
      typeof image.at !== "string" ||
      !Number.isFinite(Date.parse(image.at))
    )
      throw new Error("Некорректный снимок блока.");
    result.image = {
      dataUrl: image.dataUrl,
      width: image.width,
      height: image.height,
      at: image.at,
    };
  }
  return result;
}
export function mayReceiveBlock(
  member: {
    role: string;
    canSeeFinance: boolean;
    sections: string[];
    storeAccess: "all" | string[];
  },
  context: TaskBlockContext,
): boolean {
  if (member.role === "owner" || member.role === "admin") return true;
  return (
    member.canSeeFinance &&
    member.sections.includes("dashboard") &&
    (member.storeAccess === "all" ||
      context.storeIds.every((id) => member.storeAccess.includes(id)))
  );
}
