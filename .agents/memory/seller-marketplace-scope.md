---
name: Marketplace data scope
description: Preserve accurate marketplace funnel semantics and protect seller API credentials.
---

- Do not present Ozon ordered units as completed purchases. The initial Ozon analytics mapping only supports the funnel through orders; Wildberries exposes buyouts separately.
  **Why:** An order and a completed buyout are different events, and combining them creates a false conversion rate.
  **How to apply:** Verify the official field semantics before adding funnel stages; keep platform-specific stages distinct until a completed-sales metric is confirmed.

- Marketplace API credentials belong to the authenticated seller and must remain server-side, encrypted at rest, and isolated by user.
  **Why:** Replit project secrets are global to the app, while each seller supplies their own keys; browser storage would expose them.
  **How to apply:** Keep credentials out of client storage and logs. The current encryption key is derived from `SESSION_SECRET`, so plan a controlled re-encryption before rotating that secret.
