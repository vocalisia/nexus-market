import type { AssetCategory } from "@/types/market";

// ─── Market Hours Detection ─────────────────────────────────
// All times in UTC

export interface MarketStatus {
  isOpen: boolean;
  label: string; // "OUVERT" | "FERMÉ" | "PRÉ-MARCHÉ" | "24/7"
  nextChange: string; // "Ouvre lundi 22h UTC" or "Ferme vendredi 22h UTC"
}

function getUTCDay(now: Date): number {
  return now.getUTCDay(); // 0=Sunday, 6=Saturday
}

function getUTCHour(now: Date): number {
  return now.getUTCHours();
}

export function isMarketOpen(category: AssetCategory, now = new Date()): MarketStatus {
  const day = getUTCDay(now);
  const hour = getUTCHour(now);

  switch (category) {
    case "CRYPTO":
      return { isOpen: true, label: "24/7", nextChange: "Toujours ouvert" };

    case "FOREX": {
      // Forex: Sunday 22:00 UTC → Friday 22:00 UTC
      // Closed: Friday 22:00 → Sunday 22:00
      const isClosed =
        (day === 6) || // Saturday = closed
        (day === 0 && hour < 22) || // Sunday before 22h = closed
        (day === 5 && hour >= 22); // Friday after 22h = closed

      if (isClosed) {
        return { isOpen: false, label: "FERM\u00C9", nextChange: "Ouvre dimanche 22h UTC" };
      }
      if (day === 5 && hour >= 20) {
        return { isOpen: true, label: "FERME BIENT\u00D4T", nextChange: "Ferme vendredi 22h UTC" };
      }
      return { isOpen: true, label: "OUVERT", nextChange: "Ferme vendredi 22h UTC" };
    }

    case "STOCKS": {
      // US Stocks: Mon-Fri 14:30-21:00 UTC (9:30 AM - 4:00 PM ET)
      const isWeekend = day === 0 || day === 6;
      if (isWeekend) {
        return { isOpen: false, label: "FERM\u00C9", nextChange: "Ouvre lundi 14h30 UTC" };
      }

      const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const openMin = 14 * 60 + 30; // 14:30
      const closeMin = 21 * 60; // 21:00

      if (minutes < openMin) {
        return { isOpen: false, label: "PR\u00C9-MARCH\u00C9", nextChange: `Ouvre \u00E0 14h30 UTC` };
      }
      if (minutes >= closeMin) {
        return { isOpen: false, label: "FERM\u00C9", nextChange: "Ouvre demain 14h30 UTC" };
      }
      return { isOpen: true, label: "OUVERT", nextChange: "Ferme \u00E0 21h UTC" };
    }

    case "COMMODITIES": {
      // Commodities (COMEX/NYMEX): Sun 23:00 → Fri 22:00 UTC (with daily break 22:00-23:00)
      const isClosed =
        (day === 6) ||
        (day === 0 && hour < 23) ||
        (day === 5 && hour >= 22);

      if (isClosed) {
        return { isOpen: false, label: "FERM\u00C9", nextChange: "Ouvre dimanche 23h UTC" };
      }
      return { isOpen: true, label: "OUVERT", nextChange: "Ferme vendredi 22h UTC" };
    }

    default:
      return { isOpen: true, label: "OUVERT", nextChange: "" };
  }
}
