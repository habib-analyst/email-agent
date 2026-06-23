import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import XLSX from 'xlsx';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/build-global-ranking-catalog.mjs <qs-2026.csv>');

const countries = {
  usa: ['United States of America'],
  canada: ['Canada'],
  uk: ['United Kingdom'],
  germany: ['Germany'],
  france: ['France'],
  netherlands: ['Netherlands'],
  switzerland: ['Switzerland'],
  sweden: ['Sweden'],
  italy: ['Italy'],
  spain: ['Spain'],
  austria: ['Austria'],
  ireland: ['Ireland'],
  finland: ['Finland'],
  china: ['China (Mainland)'],
  japan: ['Japan'],
  'south-korea': ['Republic of Korea'],
  singapore: ['Singapore'],
  malaysia: ['Malaysia'],
  'hong-kong': ['Hong Kong SAR, China'],
  taiwan: ['Taiwan'],
  australia: ['Australia'],
  'new-zealand': ['New Zealand'],
};

const labels = {
  usa: 'USA', canada: 'Canada', uk: 'UK', germany: 'Germany', france: 'France',
  netherlands: 'Netherlands', switzerland: 'Switzerland', sweden: 'Sweden',
  italy: 'Italy', spain: 'Spain', austria: 'Austria', ireland: 'Ireland',
  finland: 'Finland', china: 'China', japan: 'Japan', 'south-korea': 'South Korea',
  singapore: 'Singapore', malaysia: 'Malaysia', 'hong-kong': 'Hong Kong',
  taiwan: 'Taiwan', australia: 'Australia', 'new-zealand': 'New Zealand',
};

const byCountryName = new Map();
for (const [id, names] of Object.entries(countries)) {
  for (const name of names) byCountryName.set(name, id);
}

const workbook = XLSX.readFile(input);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
const output = {};
for (const id of Object.keys(countries)) output[id] = [];

for (const row of rows) {
  const countryId = byCountryName.get(String(row['Country/Territory'] || '').trim());
  if (!countryId) continue;
  output[countryId].push({
    name: String(row['Institution Name'] || '').trim(),
    rank: String(row['2026 Rank'] || '').trim(),
    previousRank: String(row['Previous Rank'] || '').trim(),
    score: row['Overall SCORE'] === undefined ? null : Number(row['Overall SCORE']),
    country: labels[countryId],
    countryId,
    region: String(row.Region || '').trim(),
  });
}

const result = {
  ranking: 'QS World University Rankings 2026',
  year: 2026,
  officialUrl: 'https://www.topuniversities.com/qs-world-university-rankings',
  datasetUrl: 'https://www.kaggle.com/datasets/akashbommidi/2026-qs-world-university-rankings',
  generatedAt: new Date().toISOString(),
  countries: output,
};
const destination = resolve(import.meta.dirname, '../data/global_universities_qs_2026.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(result));
console.log(`Global QS 2026 catalog written to ${destination}`);
