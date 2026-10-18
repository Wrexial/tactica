/**
 * Equipment info (UX) — the stat line behind a depot item.
 *
 * A shop row names an item and its price; what the kit actually does (its stat
 * modifiers, element and the Drill it teaches) lives in the authored
 * {@link EquipmentDef}. This renders that as a tooltip body so a player can
 * compare kit before spending Crowns. Presentation only.
 */

import { findAbility } from "../data/abilities";
import { ELEMENTS } from "../data/elements";
import type { EquipmentDef, EquipSlot, StatMods } from "../data/schema";
import { useTranslation, type MessageKey } from "../i18n";

/** Catalog keys for the five kit slots. */
const SLOT_KEYS: Readonly<Record<EquipSlot, MessageKey>> = {
  weapon: "slot.weapon",
  offhand: "slot.offhand",
  armour: "slot.armour",
  head: "slot.head",
  accessory: "slot.accessory",
};

/** Which stat modifiers to show, in a stable order, with their label key. */
const STAT_ROWS: readonly { readonly key: keyof StatMods; readonly label: MessageKey }[] = [
  { key: "hp", label: "stat.hp" },
  { key: "mp", label: "stat.mp" },
  { key: "atk", label: "stat.atk" },
  { key: "def", label: "stat.def" },
  { key: "mag", label: "stat.mag" },
  { key: "res", label: "stat.res" },
  { key: "spd", label: "stat.spd" },
  { key: "move", label: "stat.move" },
  { key: "jump", label: "stat.jump" },
];

/** Format a stat modifier with its sign (`+2`, `-1`). */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** One `label: value` row of the tooltip's stat grid. */
function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Props for {@link EquipmentInfo}. */
export interface EquipmentInfoProps {
  readonly item: EquipmentDef;
}

/** The rich tooltip body for one piece of kit. */
export function EquipmentInfo({ item }: EquipmentInfoProps) {
  const { t } = useTranslation();
  const mods = STAT_ROWS.filter(({ key }) => item.stats[key] !== 0);
  const element = item.element === undefined ? null : ELEMENTS[item.element];
  const teaches = item.teaches
    .map((teach) => `${findAbility(teach.abilityId)?.name ?? teach.abilityId} (${teach.ap} Drill)`)
    .join(", ");

  return (
    <span className="tip__content">
      <strong className="tip__title">{item.name}</strong>
      <span className="tip__text">{item.description}</span>
      <span className="tip__flavour">{item.flavour}</span>
      <dl className="tip__stats">
        <Row label={t("equip.slot")} value={t(SLOT_KEYS[item.slot])} />
        {item.cost !== null && (
          <Row label={t("equip.cost")} value={`${item.cost} ${t("common.crowns")}`} />
        )}
        {element !== null && <Row label={t("ability.element")} value={element.name} />}
        {mods.map(({ key, label }) => (
          <Row key={key} label={t(label)} value={signed(item.stats[key])} />
        ))}
        {teaches.length > 0 && <Row label={t("equip.teaches")} value={teaches} />}
      </dl>
    </span>
  );
}
