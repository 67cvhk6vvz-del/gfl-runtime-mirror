import fs from 'node:fs';
import crypto from 'node:crypto';

const [srcPath, outPath] = process.argv.slice(2);
if (!srcPath || !outPath) throw new Error('usage: validate-and-publish.mjs <source> <output>');

const raw = fs.readFileSync(srcPath, 'utf8');
let doc;

try {
  doc = JSON.parse(raw);
} catch {
  throw new Error('SOURCE_NOT_JSON');
}
// The chat-compact transport wraps the canonical ESPN state in `state`.
if (doc?.state && typeof doc.state === 'object') {
  doc = doc.state;
}
const normalizeNum = (v) =>
  typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;

const leagueId = normalizeNum(
  doc.leagueId ?? doc.league?.id ?? doc.meta?.leagueId ?? doc.validation?.leagueId
);

const seasonCandidates = [
  doc.season,
  doc.seasonId,
  doc.league?.season,
  doc.league?.seasonId,
  doc.meta?.season,
  doc.meta?.seasonId,
  doc.validation?.season,
  doc.validation?.seasonId,
  doc.validation?.league?.season,
  doc.validation?.league?.seasonId
];

const season = seasonCandidates
  .map(normalizeNum)
  .find((v) => Number.isInteger(v) && v >= 2000 && v <= 2100);
);

if (leagueId !== 233137) throw new Error(`WRONG_LEAGUE:${leagueId}`);
if (season !== 2026) throw new Error(`WRONG_SEASON:${season}`);

const fetchedAt =
  doc.fetchedAt ??
  doc.stateFetchedAt ??
  doc.sourceFetchedAt ??
  doc.meta?.fetchedAt ??
  doc.provenance?.fetchedAt;

if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) {
  throw new Error('MISSING_FETCHED_AT');
}

const forbiddenKey =
  /(^|_)(cookie|cookies|token|tokens|authorization|password|secret|espn_s2|espns2|swid)(_|$)/i;

const hiddenBidKey =
  /(pending.*bid|bid.*pending|cancel(?:ed|led).*bid|bid.*cancel(?:ed|led)|hidden.*bid|blind.*bid.*pending|pending.*offer|cancel(?:ed|led).*offer)/i;

function scan(value, path = '$') {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${path}[${i}]`));
    return;
  }

  for (const [k, v] of Object.entries(value)) {
    if (forbiddenKey.test(k)) {
      throw new Error(`FORBIDDEN_SECRET_FIELD:${path}.${k}`);
    }
    if (hiddenBidKey.test(k)) {
      throw new Error(`FORBIDDEN_PRIVATE_BID_FIELD:${path}.${k}`);
    }
    scan(v, `${path}.${k}`);
  }
}

scan(doc);

const teams =
  doc.teams ??
  doc.franchises ??
  doc.league?.teams ??
  doc.state?.teams;

if (!Array.isArray(teams) || teams.length !== 12) {
  throw new Error(
    `BAD_FRANCHISE_COUNT:${Array.isArray(teams) ? teams.length : 'missing'}`
  );
}

const olCo = teams.find(
  (t) =>
    t?.canonicalFranchiseKey === 'Oc' ||
    t?.canonicalKey === 'Oc' ||
    t?.abbrev === 'Oc' ||
    t?.name === "Ol' Co" ||
    t?.teamName === "Ol' Co"
);

if (!olCo) throw new Error('OL_CO_NOT_IDENTIFIED');

const validationStatus =
  doc.validation?.status ??
  doc.validationStatus ??
  doc.status?.validation ??
  doc.meta?.validationStatus ??
  null;

if (
  validationStatus &&
  !/PASS|VALID|CERTIFIED/i.test(String(validationStatus))
) {
  throw new Error(`VALIDATION_NOT_PASS:${validationStatus}`);
}

const published = {
  mirror: {
    schema: 'GFL_RUNTIME_MIRROR_1.0',
    publishedAt: new Date().toISOString(),
    source: 'gfl-live-transport/gfl-espn-automation-state',
    sourceSha256: crypto.createHash('sha256').update(raw).digest('hex')
  },
  state: doc
};

fs.writeFileSync(outPath, JSON.stringify(published));

console.log(
  JSON.stringify({
    status: 'PASS',
    leagueId,
    season,
    fetchedAt,
    franchises: teams.length,
    olCo: olCo?.canonicalFranchiseKey ?? olCo?.name ?? olCo?.teamName,
    validationStatus
  })
);
