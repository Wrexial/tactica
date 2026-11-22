/**
 * Contract readiness hints (T169) — the recommended level a combat contract's
 * board asks for, and whether the company is under it.
 *
 * `recommendedLevel` is authored on every map (`src/data/maps/schema.ts`) and
 * T168 tuned it so each action is a contest at that level. The Mess surfaces it
 * so a player can see which posts are out of reach before paying a fee. The
 * comparison is deliberately simple — the roster's **average** level, floored —
 * because that is the detachment the board expects to field, not its best
 * soldier.
 *
 * Pure and presentation-only: no engine or app state is touched.
 */

import { battleMapFor, isCombatContract } from "../app/battleSetup";
import type { ContractDef } from "../data/schema";
import type { Company } from "../engine/company";

/**
 * The level a contract's battlefield recommends, or `null` when the contract
 * fields no battle (detachments, or a combat contract with no resolved board).
 */
export function recommendedLevelOf(contract: ContractDef): number | null {
  if (!isCombatContract(contract)) return null;
  return battleMapFor(contract)?.recommendedLevel ?? null;
}

/**
 * The company's level: the floored average of its roster. An empty roster reads
 * as `0` so every recommended level is "under strength" rather than a crash.
 */
export function companyLevelOf(company: Company): number {
  const roster = company.roster;
  if (roster.length === 0) return 0;
  const total = roster.reduce((sum, member) => sum + member.unit.level, 0);
  return Math.floor(total / roster.length);
}

/** Whether the company is below the contract's recommended level. */
export function isUnderLevel(company: Company, contract: ContractDef): boolean {
  const recommended = recommendedLevelOf(contract);
  return recommended !== null && companyLevelOf(company) < recommended;
}
