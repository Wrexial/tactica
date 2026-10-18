import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  availableLocales,
  catalogFor,
  clearMissingKeys,
  createTranslator,
  enMessages,
  formatList,
  formatNumber,
  getLocale,
  hasKey,
  interpolate,
  isLocaleAvailable,
  listKeys,
  matchSupportedLocale,
  missingKeys,
  pseudolocalize,
  registerLocale,
  resetI18n,
  setLocale,
  setMissingKeyHandler,
  subscribe,
  t,
  translate,
  type TranslationVars,
} from "../../src/i18n";

/* --------------------------------------------------------------------------
 * T111 — i18n scaffolding
 *
 * The presentation layer must read every string through a key. These tests pin
 * the toolkit that makes that possible: lookup + fallback, interpolation and
 * plural selection, the QA pseudo-locale, locale switching/subscription, and
 * missing-key reporting. The React hook is a thin binding over the same store,
 * so `useTranslation` consumers are covered by the store tests below.
 * ------------------------------------------------------------------------ */

beforeEach(() => {
  resetI18n();
});

afterEach(() => {
  resetI18n();
  vi.restoreAllMocks();
});

describe("English catalog", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getLocale()).toBe("en");
  });

  it("translates a key to its copy", () => {
    expect(t("nav.battlefield")).toBe("Field");
    expect(t("app.title")).toBe("Lines of Glory");
    expect(t("hud.orders")).toBe("Field Orders");
  });

  it("exposes a translator bound to a locale", () => {
    const english = createTranslator("en");
    expect(english("nav.saves")).toBe("Saves");
    // The bound translator ignores the global locale.
    setLocale("pseudo");
    expect(english("nav.saves")).toBe("Saves");
  });

  it("reports whether a key exists", () => {
    expect(hasKey("en", "nav.battlefield")).toBe(true);
    expect(hasKey("en", "nav.nowhere")).toBe(false);
    // The fallback catalog answers for an empty locale.
    registerLocale("emptied", {});
    expect(hasKey("emptied", "nav.battlefield")).toBe(true);
  });

  it("lists the keys a locale defines directly", () => {
    expect(listKeys("en")).toContain("nav.battlefield");
    expect(listKeys("en")).toHaveLength(Object.keys(enMessages).length);
  });

  it("resolves every English message to non-empty copy", () => {
    for (const key of listKeys("en")) {
      const message = enMessages[key];
      const vars: TranslationVars = typeof message === "object" ? { count: 2 } : {};
      const value = translate("en", key, vars);
      expect(value, key).not.toBe("");
      expect(value, key).not.toBe(key);
      expect(value, key).not.toContain("undefined");
    }
  });
});

describe("pluralization", () => {
  it("selects the singular form for one", () => {
    expect(t("common.tiles", { count: 1 })).toBe("1 tile");
    expect(t("common.soldiers", { count: 1 })).toBe("1 soldier");
  });

  it("selects the plural form for many, including zero", () => {
    expect(t("common.tiles", { count: 3 })).toBe("3 tiles");
    expect(t("common.tiles", { count: 0 })).toBe("0 tiles");
  });

  it("falls back to the 'other' form when no count is given", () => {
    expect(t("common.tiles")).toBe("{count} tiles");
  });

  it("formats the count with the locale's number format", () => {
    expect(t("common.tiles", { count: 1234 })).toBe("1,234 tiles");
  });
});

describe("interpolation", () => {
  it("substitutes named string variables", () => {
    expect(t("tutorial.binds", { weapon: "Musket", ability: "Volley Fire" })).toBe(
      "Musket binds Volley Fire.",
    );
  });

  it("formats numeric variables", () => {
    expect(t("hud.elanCost", { amount: 4 })).toBe("Élan 4");
    expect(t("hud.elanCost", { amount: 1000 })).toBe("Élan 1,000");
  });

  it("leaves unknown placeholders visible", () => {
    expect(interpolate("{known} and {missing}", { known: "x" })).toBe("x and {missing}");
  });

  it("can interpolate against an explicit locale", () => {
    expect(interpolate("{count}", { count: 1000 }, "en")).toBe("1,000");
  });
});

describe("fallback", () => {
  it("serves missing keys from the default locale", () => {
    registerLocale("partial", { "nav.battlefield": "Champ de bataille" });
    expect(translate("partial", "nav.battlefield")).toBe("Champ de bataille");
    expect(translate("partial", "nav.saves")).toBe("Saves");
  });

  it("falls back when a plural form is missing", () => {
    registerLocale("partial", { "common.tiles": { other: "{count} tuiles" } });
    expect(translate("partial", "common.tiles", { count: 7 })).toBe("7 tuiles");
  });
});

describe("pseudo-locale", () => {
  it("is built in and named", () => {
    expect(SUPPORTED_LOCALES).toContain("pseudo");
    expect(LOCALE_NAMES["pseudo"]).toContain("Pseudo");
    expect(isLocaleAvailable("pseudo")).toBe(true);
  });

  it("accents copy and wraps it in markers", () => {
    setLocale("pseudo");
    const value = t("nav.battlefield");
    expect(value).not.toBe("Field");
    expect(value.startsWith("⟦")).toBe(true);
    expect(value.endsWith("⟧")).toBe(true);
  });

  it("preserves interpolation placeholders", () => {
    expect(pseudolocalize("Élan {amount}")).toContain("{amount}");
    expect(pseudolocalize("Élan {amount}")).not.toBe("Élan {amount}");
    expect(translate("pseudo", "hud.elanCost", { amount: 3 })).toContain("3");
  });

  it("mirrors every English key", () => {
    expect([...listKeys("pseudo")].sort()).toEqual([...listKeys("en")].sort());
  });
});

describe("locale switching", () => {
  it("ignores unregistered locales", () => {
    setLocale("kl");
    expect(getLocale()).toBe("en");
  });

  it("notifies subscribers exactly once per change and is idempotent", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setLocale("pseudo");
    setLocale("pseudo");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("pseudo");
    unsubscribe();
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("registers and lists locales", () => {
    registerLocale("kl", { "nav.battlefield": "Field" });
    expect(isLocaleAvailable("kl")).toBe(true);
    expect(availableLocales()).toContain("kl");
    expect(catalogFor("kl")).toEqual({ "nav.battlefield": "Field" });
  });

  it("matches browser preferences, then the primary subtag, then defaults", () => {
    expect(matchSupportedLocale(["pseudo", "en"])).toBe("pseudo");
    expect(matchSupportedLocale(["en-GB", "fr"])).toBe("en");
    expect(matchSupportedLocale(["fr-FR", "de"])).toBe("en");
  });
});

describe("missing keys", () => {
  it("returns the key and records the gap", () => {
    clearMissingKeys();
    expect(translate("en", "does.not.exist")).toBe("does.not.exist");
    expect(missingKeys()).toContain("en:does.not.exist");
  });

  it("invokes a handler when a key is unresolved", () => {
    const handler = vi.fn();
    setMissingKeyHandler(handler);
    translate("en", "another.missing", { count: 1 });
    expect(handler).toHaveBeenCalledWith("en", "another.missing");
  });

  it("clears the recorded gaps", () => {
    translate("en", "one.more.missing");
    expect(missingKeys().length).toBeGreaterThan(0);
    clearMissingKeys();
    expect(missingKeys()).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats numbers by locale", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });

  it("formats lists", () => {
    expect(formatList(["a", "b", "c"], "en")).toBe("a, b, and c");
  });

  it("degrades to the default locale for an unknown locale tag", () => {
    expect(formatNumber(42, "not a valid tag @@@")).toBe("42");
  });
});

describe("translate overrides", () => {
  it("accepts an explicit catalog registry, leaving the global store alone", () => {
    const registry = { en: { "nav.battlefield": "Overridden" } };
    expect(translate("en", "nav.battlefield", {}, registry)).toBe("Overridden");
    expect(t("nav.battlefield")).toBe("Field");
  });
});

describe("resetI18n", () => {
  it("restores the built-in catalogs and clears transient state", () => {
    registerLocale("tmp", { "nav.saves": "Saved" });
    setLocale("pseudo");
    translate("en", "ghost.key");
    resetI18n();
    expect(getLocale()).toBe("en");
    expect(isLocaleAvailable("tmp")).toBe(false);
    expect(missingKeys()).toEqual([]);
    // The handler is cleared too.
    const handler = vi.fn();
    setMissingKeyHandler(handler);
    resetI18n();
    translate("en", "after.reset");
    expect(handler).not.toHaveBeenCalled();
  });
});
