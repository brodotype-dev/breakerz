// Canonical product-line taxonomy ("taxonomy lite" per the data-model
// roadmap). One brand-line per product. The list lives here because the
// form dropdown, parser prompt, and TypeScript type system all share it
// — new lines = a change to this file, not a database migration.
//
// `is_specialty` = the line typically ships hobby-only (Best, Chrome,
// Cosmic Chrome, Finest, Pristine, etc.). The parser uses this as a
// soft hint when reasoning about "JUMBO" titled breaks on these products
// (the title is descriptive of the break, not the product format).

export interface ProductLineDef {
  key: string;
  label: string;
  manufacturer: 'Topps' | 'Panini' | 'Upper Deck' | 'Other';
  family: 'bowman' | 'topps' | 'panini' | 'upper_deck' | 'other';
  is_specialty: boolean;
}

export const PRODUCT_LINES: ProductLineDef[] = [
  // Topps · Bowman family
  { key: 'bowman_flagship',  label: 'Bowman',          manufacturer: 'Topps', family: 'bowman', is_specialty: false },
  { key: 'bowman_chrome',    label: 'Bowman Chrome',   manufacturer: 'Topps', family: 'bowman', is_specialty: true  },
  { key: 'bowman_best',      label: "Bowman's Best",   manufacturer: 'Topps', family: 'bowman', is_specialty: true  },
  { key: 'bowman_cosmic',    label: 'Bowman Cosmic',   manufacturer: 'Topps', family: 'bowman', is_specialty: true  },
  { key: 'bowman_draft',     label: 'Bowman Draft',    manufacturer: 'Topps', family: 'bowman', is_specialty: false },
  { key: 'bowman_sapphire',  label: 'Bowman Sapphire', manufacturer: 'Topps', family: 'bowman', is_specialty: true  },
  { key: 'bowman_platinum',  label: 'Bowman Platinum', manufacturer: 'Topps', family: 'bowman', is_specialty: true  },
  { key: 'bowman_mega',      label: 'Bowman Mega Box', manufacturer: 'Topps', family: 'bowman', is_specialty: true  },

  // Topps · flagship + specialty
  { key: 'topps_flagship',       label: 'Topps Series',         manufacturer: 'Topps', family: 'topps', is_specialty: false },
  { key: 'topps_chrome',         label: 'Topps Chrome',         manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_cosmic_chrome',  label: 'Topps Cosmic Chrome',  manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_finest',         label: 'Topps Finest',         manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_pristine',       label: 'Topps Pristine',       manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_three',          label: 'Topps 3',              manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_heritage',       label: 'Topps Heritage',       manufacturer: 'Topps', family: 'topps', is_specialty: false },
  { key: 'topps_stadium_club',   label: 'Topps Stadium Club',   manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_allen_ginter',   label: 'Topps Allen & Ginter', manufacturer: 'Topps', family: 'topps', is_specialty: false },
  { key: 'topps_archives',       label: 'Topps Archives',       manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_dynasty',        label: 'Topps Dynasty',        manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_definitive',     label: 'Topps Definitive',     manufacturer: 'Topps', family: 'topps', is_specialty: true  },
  { key: 'topps_update',         label: 'Topps Update',         manufacturer: 'Topps', family: 'topps', is_specialty: false },

  // Panini
  { key: 'panini_prizm',              label: 'Prizm',              manufacturer: 'Panini', family: 'panini', is_specialty: false },
  { key: 'panini_donruss',            label: 'Donruss',            manufacturer: 'Panini', family: 'panini', is_specialty: false },
  { key: 'panini_donruss_optic',      label: 'Donruss Optic',      manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_select',             label: 'Select',             manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_mosaic',             label: 'Mosaic',             manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_immaculate',         label: 'Immaculate',         manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_national_treasures', label: 'National Treasures', manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_contenders',         label: 'Contenders',         manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_obsidian',           label: 'Obsidian',            manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_one',                label: 'One-on-One',          manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_chronicles',         label: 'Chronicles',         manufacturer: 'Panini', family: 'panini', is_specialty: true  },
  { key: 'panini_certified',          label: 'Certified',          manufacturer: 'Panini', family: 'panini', is_specialty: true  },

  // Upper Deck
  { key: 'upper_deck_series',    label: 'Upper Deck Series',    manufacturer: 'Upper Deck', family: 'upper_deck', is_specialty: false },
  { key: 'upper_deck_artifacts', label: 'Upper Deck Artifacts', manufacturer: 'Upper Deck', family: 'upper_deck', is_specialty: true  },
  { key: 'upper_deck_spx',       label: 'Upper Deck SPx',       manufacturer: 'Upper Deck', family: 'upper_deck', is_specialty: true  },

  // Catch-all
  { key: 'other',                label: 'Other',                manufacturer: 'Other', family: 'other', is_specialty: false },
];

export const PRODUCT_LINE_KEYS = PRODUCT_LINES.map(l => l.key);

const BY_KEY = new Map(PRODUCT_LINES.map(l => [l.key, l]));

export function getProductLine(key: string | null | undefined): ProductLineDef | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

export function isValidProductLine(key: string | null | undefined): boolean {
  return !!key && BY_KEY.has(key);
}

/** Groups for the form dropdown <optgroup>. Preserves the order above. */
export function groupedForDropdown(): Array<{ manufacturer: string; lines: ProductLineDef[] }> {
  const groups = new Map<string, ProductLineDef[]>();
  for (const l of PRODUCT_LINES) {
    const arr = groups.get(l.manufacturer) ?? [];
    arr.push(l);
    groups.set(l.manufacturer, arr);
  }
  return Array.from(groups.entries()).map(([manufacturer, lines]) => ({ manufacturer, lines }));
}
