import type { NextFunction, Request, Response } from "express";

export function requireCompanySection(section: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const membership = req.companyPermissions;
    if (!membership || (!membership.sections.includes(section) && req.companyRole !== "owner" && req.companyRole !== "admin")) {
      res.status(403).json({ error: "У вашей роли нет доступа к этому разделу компании." });
      return;
    }
    next();
  };
}

export function requireCompanyFinance(req: Request, res: Response, next: NextFunction): void {
  if (req.companyRole !== "owner" && req.companyRole !== "admin" && !req.companyPermissions?.canSeeFinance) {
    res.status(403).json({ error: "У вашей роли нет доступа к финансовым данным." });
    return;
  }
  next();
}

export function requireMarketplaceAccess(req: Request, res: Response, next: NextFunction): void {
  if (req.companyRole === "owner" || req.companyRole === "admin") { next(); return; }
  const sections = req.companyPermissions?.sections ?? [];
  if (req.method === "GET" && (sections.includes("dashboard") || sections.includes("marketplaces"))) { next(); return; }
  if (sections.includes("marketplaces")) { next(); return; }
  res.status(403).json({ error: "У вашей роли нет доступа к магазинам компании." });
}

export function requireCogsEditor(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.companyRole !== "owner" && req.companyRole !== "admin" && !req.companyPermissions?.canEditCogs) {
    res.status(403).json({ error: "У вашей роли нет права изменять товары и себестоимость." });
    return;
  }
  next();
}
