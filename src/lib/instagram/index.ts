import { cacheLife } from "next/cache";
import { loadPortfolio } from "./load";

/** Serves one API fetch to all visitors; failures retry much sooner than successes. */
export async function getPortfolio() {
  "use cache";
  const portfolio = await loadPortfolio();
  if (portfolio.status === "live") {
    cacheLife({ stale: 300, revalidate: 1800, expire: 86400 });
  } else {
    cacheLife({ stale: 60, revalidate: 300, expire: 900 });
  }
  return portfolio;
}
