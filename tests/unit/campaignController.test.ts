/**
 * Campaign controller — deploying an action (T164).
 *
 * The controller used to open a battle only for a contract that *posted* a map,
 * so taking one of the map-less contracts charged the fee and returned no
 * battle. `battleMapFor` now resolves a contract that **names** a reused board
 * as well, and this test pins the controller path for that case.
 */

import { describe, expect, it } from "vitest";

import {
  createCampaignState,
  createDemoCampaign,
  startCampaignBattle,
} from "../../src/app/campaignController";
import { asContractId } from "../../src/engine/ids";

describe("startCampaignBattle (T164)", () => {
  it("opens a battle for a contract that names a reused board", () => {
    const state = createCampaignState(createDemoCampaign());
    const started = startCampaignBattle(state, asContractId("take-the-mill"));

    expect(started.contractId).toBe("take-the-mill");
    expect(started.save.progress.activeContractId).toBe("take-the-mill");
    expect(started.battle).not.toBeNull();
    expect(started.battle?.units.some((unit) => unit.side === "enemy")).toBe(true);
  });

  it("still opens a battle for a contract posted by its own map", () => {
    const state = createCampaignState(createDemoCampaign());
    const started = startCampaignBattle(state, asContractId("break-the-bridge"));

    expect(started.contractId).toBe("break-the-bridge");
    expect(started.battle).not.toBeNull();
  });
});
