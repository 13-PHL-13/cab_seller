import { useEffect, useRef, useState } from "react";
import { useCollaboration } from "@/components/CollaborationProvider";
import { useAiWorkspace } from "@/components/AiWorkspace";
import { workspaceRequest as request } from "@/lib/collaboration-api";
import { captureDashboardBlock } from "@/lib/dashboard-snapshot";
import type { BlockContext } from "@/lib/dashboard-model";
import { makeRuntime, type CommerceBootstrap } from "@/commerce/runtime";
import { initCosts } from "@/commerce/costs.js";
import { initUnitEconomics } from "@/commerce/unit.js";
import "@/commerce/costs.css";
import "@/commerce/unit.css";
import "./commerce-prototype.css";

type Root = HTMLDivElement & {
  costContext?: () => any;
  unitContext?: () => any;
};
function CommercePage({ kind }: { kind: "costs" | "unit" }) {
  const root = useRef<Root>(null),
    { workspace, createTask, canCreate } = useCollaboration(),
    ai = useAiWorkspace();
  const callbacks = useRef({ createTask, canCreate, ai });
  callbacks.current = { createTask, canCreate, ai };
  const [status, setStatus] = useState("Загружаем расчёты компании…"),
    [error, setError] = useState(false);
  const companyId = workspace?.activeCompanyId;
  useEffect(() => {
    if (!companyId || !root.current) return;
    let disposed = false,
      cleanup: (() => void) | undefined,
      runtime: ReturnType<typeof makeRuntime> | undefined,
      observer: MutationObserver | undefined;
    const element = root.current;
    function notify(text: string, isError = false) {
      if (!disposed) {
        setStatus(text);
        setError(isError);
      }
    }
    void request<CommerceBootstrap>("/api/commerce/bootstrap")
      .then((boot) => {
        if (disposed) return;
        runtime = makeRuntime(
          boot,
          workspace.companies.find((c) => c.id === companyId)?.name ??
            "Компания",
          notify,
        );
        cleanup = (kind === "costs" ? initCosts : initUnitEconomics)(
          element,
          runtime,
        );
        const params = new URLSearchParams(location.search);
        if (kind === "costs" && params.has("tab"))
          document.dispatchEvent(
            new CustomEvent("cost-source-open", {
              detail: { tab: params.get("tab"), scope: params.get("scope") },
            }),
          );
        function decorate() {
          for (const control of element.querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLButtonElement
          >(
            "[data-row-field],[data-component],[data-pool-total],[data-pool-mode],#cost-file,#cost-manual-file,#cost-save-manual,#cost-add-row,#cost-add-column,[data-remove-cost-row]",
          ))
            if (!boot.permissions.edit) control.disabled = true;
          for (const control of element.querySelectorAll<HTMLInputElement>(
            "[data-approve-sku],[data-bulk-markup]",
          ))
            if (!boot.permissions.approve) control.disabled = true;
          for (const block of element.querySelectorAll<HTMLElement>(
            "[data-task-block]",
          )) {
            const heading = block.querySelector<HTMLElement>(
              "[data-task-heading]",
            );
            if (!heading || heading.querySelector(".commerce-actions"))
              continue;
            const actions = document.createElement("div");
            actions.className = "commerce-actions";
            const context = (): BlockContext => {
              const source =
                kind === "costs"
                  ? element.costContext?.()
                  : element.unitContext?.();
              return {
                section:
                  source?.section ??
                  heading.querySelector("h2")?.textContent ??
                  "Расчёт",
                sectionId: "products",
                stores: String(source?.stores ?? ""),
                period: String(source?.period ?? ""),
                storeIds: boot.stores.map((s) => s.id),
                reference:
                  kind === "costs"
                    ? "/costs?" +
                      new URLSearchParams({
                        tab: source?.reference?.tab ?? "minimum",
                        scope: source?.reference?.scope ?? "all",
                      })
                    : "/unit?source=chart",
              };
            };
            if (callbacks.current.ai.allowed) {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "commerce-ask";
              button.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></svg>Спросить ИИ';
              button.onclick = () => {
                const source =
                  kind === "costs"
                    ? element.costContext?.()
                    : element.unitContext?.();
                void callbacks.current.ai.openBlock(
                  JSON.stringify({ ...context(), data: source?.data }),
                );
              };
              actions.append(button);
            }
            if (callbacks.current.canCreate) {
              const button = document.createElement("button");
              button.type = "button";
              button.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 4H5v17h14v-7M9 2h6v4H9zM12 14l7-7 3 3-7 7-4 1Z"/></svg>Поручить';
              button.onclick = async () => {
                button.disabled = true;
                try {
                  const image = await captureDashboardBlock(block);
                  callbacks.current.createTask({ ...context(), image });
                } catch (e) {
                  notify((e as Error).message, true);
                } finally {
                  button.disabled = false;
                }
              };
              actions.append(button);
            }
            heading.append(actions);
          }
        }
        observer = new MutationObserver(decorate);
        observer.observe(element, { childList: true, subtree: true });
        decorate();
        notify("");
        if (kind === "costs") void runtime.loadFinance();
      })
      .catch((e) => notify(e.message, true));
    return () => {
      disposed = true;
      observer?.disconnect();
      cleanup?.();
      runtime?.dispose();
    };
  }, [companyId, kind]);
  return (
    <div className="commerce-prototype">
      <p
        className={"commerce-save-status" + (error ? " is-error" : "")}
        role={error ? "alert" : "status"}
      >
        {status}
      </p>
      <div id={kind === "costs" ? "costs-view" : "unit-view"} ref={root} />
    </div>
  );
}
export function CostsPage() {
  return <CommercePage kind="costs" />;
}
export function UnitPage() {
  return <CommercePage kind="unit" />;
}
