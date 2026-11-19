import { workspaceRequest } from "./collaboration-api";
import type { DashboardWindow } from "./dashboard-model";
export const getDashboardWindow = (
  view: "current" | "previous",
  marketplace = "all",
  storeId = "",
) =>
  workspaceRequest<DashboardWindow>(
    "/api/marketplace/dashboard?" +
      new URLSearchParams({
        layout: "prototype",
        period: "30d",
        view,
        marketplace,
        ...(storeId ? { storeId } : {}),
      }),
  );
