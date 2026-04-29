/**
 * Team logo URL resolution.
 *
 * Breakers sometimes bundle multiple teams into one slot ("Pirates/White Sox").
 * `getTeamLogos` splits on `/` and returns one logo per team. If a label
 * doesn't map to a known team (e.g. "National League", a non-MLB team like
 * "Yomiuri Giants"), the entry is dropped — callers fall back to the raw
 * text label so nothing renders blank.
 *
 * URL pattern: ESPN's CDN serves PNGs for MLB, NBA, and NFL keyed by lowercase
 * 3-letter abbreviation. We use plain <img> tags (not next/image) so we don't
 * have to whitelist espncdn.com in next.config.
 */

const MLB_ABBREV: Record<string, string> = {
  'arizona diamondbacks': 'ari',
  'atlanta braves': 'atl',
  'baltimore orioles': 'bal',
  'boston red sox': 'bos',
  'chicago cubs': 'chc',
  'chicago white sox': 'chw',
  'cincinnati reds': 'cin',
  'cleveland guardians': 'cle',
  'colorado rockies': 'col',
  'detroit tigers': 'det',
  'houston astros': 'hou',
  'kansas city royals': 'kc',
  'los angeles angels': 'laa',
  'los angeles dodgers': 'lad',
  'miami marlins': 'mia',
  'milwaukee brewers': 'mil',
  'minnesota twins': 'min',
  'new york mets': 'nym',
  'new york yankees': 'nyy',
  'oakland athletics': 'oak',
  'athletics': 'oak',
  'philadelphia phillies': 'phi',
  'pittsburgh pirates': 'pit',
  'san diego padres': 'sd',
  'san francisco giants': 'sf',
  'seattle mariners': 'sea',
  'st. louis cardinals': 'stl',
  'st louis cardinals': 'stl',
  'tampa bay rays': 'tb',
  'texas rangers': 'tex',
  'toronto blue jays': 'tor',
  'washington nationals': 'wsh',
};

const NBA_ABBREV: Record<string, string> = {
  'atlanta hawks': 'atl',
  'boston celtics': 'bos',
  'brooklyn nets': 'bkn',
  'charlotte hornets': 'cha',
  'chicago bulls': 'chi',
  'cleveland cavaliers': 'cle',
  'dallas mavericks': 'dal',
  'denver nuggets': 'den',
  'detroit pistons': 'det',
  'golden state warriors': 'gs',
  'houston rockets': 'hou',
  'indiana pacers': 'ind',
  'los angeles clippers': 'lac',
  'la clippers': 'lac',
  'los angeles lakers': 'lal',
  'memphis grizzlies': 'mem',
  'miami heat': 'mia',
  'milwaukee bucks': 'mil',
  'minnesota timberwolves': 'min',
  'new orleans pelicans': 'no',
  'new york knicks': 'ny',
  'oklahoma city thunder': 'okc',
  'orlando magic': 'orl',
  'philadelphia 76ers': 'phi',
  'phoenix suns': 'phx',
  'portland trail blazers': 'por',
  'sacramento kings': 'sac',
  'san antonio spurs': 'sa',
  'toronto raptors': 'tor',
  'utah jazz': 'utah',
  'washington wizards': 'wsh',
};

const NFL_ABBREV: Record<string, string> = {
  'arizona cardinals': 'ari',
  'atlanta falcons': 'atl',
  'baltimore ravens': 'bal',
  'buffalo bills': 'buf',
  'carolina panthers': 'car',
  'chicago bears': 'chi',
  'cincinnati bengals': 'cin',
  'cleveland browns': 'cle',
  'dallas cowboys': 'dal',
  'denver broncos': 'den',
  'detroit lions': 'det',
  'green bay packers': 'gb',
  'houston texans': 'hou',
  'indianapolis colts': 'ind',
  'jacksonville jaguars': 'jax',
  'kansas city chiefs': 'kc',
  'las vegas raiders': 'lv',
  'los angeles chargers': 'lac',
  'los angeles rams': 'lar',
  'miami dolphins': 'mia',
  'minnesota vikings': 'min',
  'new england patriots': 'ne',
  'new orleans saints': 'no',
  'new york giants': 'nyg',
  'new york jets': 'nyj',
  'philadelphia eagles': 'phi',
  'pittsburgh steelers': 'pit',
  'san francisco 49ers': 'sf',
  'seattle seahawks': 'sea',
  'tampa bay buccaneers': 'tb',
  'tennessee titans': 'ten',
  'washington commanders': 'wsh',
};

function leagueFor(sport: string | undefined): 'mlb' | 'nba' | 'nfl' | null {
  const s = (sport ?? '').toLowerCase();
  if (s === 'baseball') return 'mlb';
  if (s === 'basketball') return 'nba';
  if (s === 'football') return 'nfl';
  return null;
}

function abbrevMapFor(league: 'mlb' | 'nba' | 'nfl'): Record<string, string> {
  return league === 'mlb' ? MLB_ABBREV : league === 'nba' ? NBA_ABBREV : NFL_ABBREV;
}

export interface TeamLogo {
  src: string;
  alt: string;
}

/**
 * Resolve one or more logos for a team label. Combined slots like
 * "Pirates/White Sox" return two logos. Unknown labels return [].
 */
export function getTeamLogos(label: string, sport: string | undefined): TeamLogo[] {
  const league = leagueFor(sport);
  if (!league) return [];
  const map = abbrevMapFor(league);
  const parts = label.split('/').map(p => p.trim()).filter(Boolean);
  const logos: TeamLogo[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    const abbrev = map[key];
    if (!abbrev) continue;
    logos.push({
      src: `https://a.espncdn.com/i/teamlogos/${league}/500/${abbrev}.png`,
      alt: part,
    });
  }
  return logos;
}
