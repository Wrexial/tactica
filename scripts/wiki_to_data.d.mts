/**
 * Type declarations for `scripts/wiki_to_data.mjs` (T088).
 *
 * The converter is plain JavaScript so it runs under `node` without a build
 * step. These declarations let the Vitest suite import it with real types while
 * keeping `npm run build` (tsc) happy. The conversion output is typed against
 * the authored content schemas in `src/data/schema.ts` — the same contract the
 * converter validates against at runtime.
 */

import type { AbilityDef, EquipmentDef } from "../src/data/schema";

/** One skill taught by a piece of reference kit. */
export interface ReferenceSkill {
  jobs: string[];
  name: string;
  ap: number;
}

/** A reference item parsed out of a wiki equipment table, before re-authoring. */
export interface ReferenceItem {
  section: string;
  refName: string;
  slot?: string;
  weaponType?: string;
  stats: {
    atk: number;
    def: number;
    mag: number;
    res: number;
    spd: number;
    eva: number;
    jump: number;
    range: number;
  };
  cost: number;
  skills: ReferenceSkill[];
  element?: string;
  effects: string[];
}

export interface WikiTable {
  headers: string[];
  rows: string[][];
  cont: boolean[];
}

export interface ConvertedData {
  equipment: EquipmentDef[];
  abilities: AbilityDef[];
}

export const WEAPONS_FILE: string;
export const ARMOR_FILE: string;

export function splitTopLevel(value: string, sep: string): string[];
export function cleanWikiText(input: unknown): string;
export function cleanInline(input: unknown): string;
export function parseWikiTable(tableText: string): WikiTable | null;
export function extractTables(wikitext: string): Array<{ path: string[]; tableText: string }>;
export function parseSkillLines(text: string): ReferenceSkill[];

export function extractReferenceItems(wikitext: string): ReferenceItem[];
export function convertReferenceItems(items: ReferenceItem[]): ConvertedData;
export function convertWikiSources(sources?: { weapons?: string; armor?: string }): ConvertedData;
export function loadReferenceSources(): { weapons: string; armor: string };
export function validateConverted(converted: ConvertedData): ConvertedData;

export function reauthorDrill(referenceAp: number): number;
export function deriveStats(refStats: ReferenceItem["stats"]): Record<string, number>;
export function deriveCost(stats: Record<string, number>): number;
export function slug(value: unknown): string;

export const WEAPON_SECTION_TYPES: Record<string, string>;
export const ARMOR_SECTION_SLOTS: Record<string, string>;
export const JOB_TO_POST: Record<string, { role: string; power: string }>;
export const ELEMENT_NAMES: Record<string, string>;
export const CONDITION_KEYWORDS: ReadonlyArray<readonly [string, string]>;
export const QUALITY_TIERS: string[];
export const WEAPON_NOUNS: Record<string, string>;
export const SECTION_NOUNS: Record<string, string>;
