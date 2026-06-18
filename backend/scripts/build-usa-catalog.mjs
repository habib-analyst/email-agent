/**
 * One-time / dev script: merge curated USA list + Carnegie extract + extra seeds → catalog JSON.
 * Run: node backend/scripts/build-usa-catalog.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { USA_TARGET_UNIVERSITIES } from '../src/learning/usaTargetUniversities.js';
import { loadUserMajorsFromFile } from '../src/learning/userMajorsFile.js';
import { buildUniversityEntry } from '../src/learning/universityStrengths.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '../../..');
const CARNEGIE_TXT = resolve(__dir, '../data/carnegie_institutions.txt');
const OUT = resolve(__dir, '../data/usa_universities_catalog.json');

/** Additional research universities / institutes (beyond Carnegie extract). */
const EXTRA_NAMES = [
  'Stanford University', 'MIT', 'Carnegie Mellon University', 'Caltech', 'Georgia Institute of Technology',
  'University of Chicago', 'Northwestern University', 'University of Notre Dame', 'Boston College',
  'Brandeis University', 'Case Western Reserve University', 'Carnegie Mellon University',
  'University of Rochester', 'Rensselaer Polytechnic Institute', 'Stevens Institute of Technology',
  'Worcester Polytechnic Institute', 'Clarkson University', 'Rochester Institute of Technology',
  'SUNY Stony Brook', 'SUNY Albany', 'SUNY Buffalo', 'Binghamton University',
  'University at Albany', 'University at Buffalo', 'Florida Institute of Technology',
  'Embry-Riddle Aeronautical University', 'Naval Postgraduate School', 'Air Force Institute of Technology',
  'Illinois Institute of Technology', 'Missouri University of Science and Technology',
  'New Jersey Institute of Technology', 'Florida Institute of Technology', 'Kettering University',
  'Lawrence Technological University', 'Milwaukee School of Engineering', 'Olin College of Engineering',
  'Rose-Hulman Institute of Technology', 'Santa Clara University', 'Seattle Pacific University',
  'Southern Illinois University Carbondale', 'Southern Illinois University Edwardsville',
  'University of Alabama Huntsville', 'University of Alabama in Huntsville', 'University of Arkansas Fayetteville',
  'University of Central Oklahoma', 'University of Colorado Colorado Springs', 'University of Louisiana Monroe',
  'University of Massachusetts Boston', 'University of Massachusetts Medical School',
  'University of Missouri Columbia', 'University of Missouri Kansas City', 'University of Missouri Rolla',
  'University of North Texas', 'University of South Alabama', 'University of South Dakota',
  'University of Texas at Dallas', 'University of Texas at Tyler', 'University of Texas Health Science Center Houston',
  'University of Texas Medical Branch', 'University of Texas Southwestern Medical Center',
  'University of the Sciences', 'University of Tulsa', 'University of Vermont',
  'Washington University in St. Louis', 'Wichita State University', 'Wright State University',
  'Yeshiva University', 'American University', 'Georgetown University', 'Howard University',
  'Tennessee Technological University', 'Texas Tech University', 'Texas State University',
  'University of Texas at Austin', 'University of Illinois Chicago', 'University of Illinois Springfield',
  'University of Memphis', 'University of Nevada Las Vegas', 'University of New Orleans',
  'University of North Dakota', 'University of Northern Colorado', 'University of Rhode Island',
  'University of San Francisco', 'University of South Carolina Upstate', 'University of Southern Maine',
  'University of Texas Rio Grande Valley', 'University of Toledo', 'University of Wyoming',
  'Utah State University', 'Virginia State University', 'West Virginia University',
  'Western Michigan University', 'Western Washington University', 'Wichita State University',
  'Worcester Polytechnic Institute', 'Yale University', 'Baylor University', 'Binghamton University',
  'Brigham Young University', 'California Institute of Technology', 'Chapman University',
  'Claremont Graduate University', 'Colorado School of Mines', 'Creighton University',
  'Drexel University', 'Florida A&M University', 'Florida Institute of Technology',
  'George Mason University', 'Georgia State University', 'Hofstra University', 'Iowa State University',
  'Kansas State University', 'Kent State University', 'Lamar University', 'Lehigh University',
  'Louisiana Tech University', 'Marquette University', 'Miami University', 'Michigan Technological University',
  'Mississippi State University', 'Montana Technological University', 'New Mexico Institute of Mining and Technology',
  'North Dakota State University', 'Northern Arizona University', 'Ohio State University',
  'Oklahoma State University', 'Old Dominion University', 'Oregon Health & Science University',
  'Portland State University', 'Princeton University', 'Rice University', 'Rutgers University',
  'San Diego State University', 'San Jose State University', 'South Dakota State University',
  'Southern Methodist University', 'Stony Brook University', 'Swarthmore College', 'Temple University',
  'Texas A&M University', 'The Ohio State University', 'Tufts University', 'Tulane University',
  'University of Arizona', 'University of California Berkeley', 'University of California Irvine',
  'University of California San Diego', 'University of California Santa Barbara',
  'University of Cincinnati', 'University of Connecticut', 'University of Delaware',
  'University of Denver', 'University of Florida', 'University of Georgia', 'University of Houston',
  'University of Idaho', 'University of Illinois Urbana-Champaign', 'University of Iowa',
  'University of Kansas', 'University of Kentucky', 'University of Louisville', 'University of Maryland',
  'University of Massachusetts Amherst', 'University of Miami', 'University of Michigan',
  'University of Minnesota Twin Cities', 'University of Mississippi', 'University of Missouri',
  'University of Nebraska Lincoln', 'University of Nevada Reno', 'University of New Mexico',
  'University of North Carolina Chapel Hill', 'University of North Carolina Charlotte',
  'University of Notre Dame', 'University of Oklahoma', 'University of Oregon',
  'University of Pennsylvania', 'University of Pittsburgh', 'University of South Carolina',
  'University of South Florida', 'University of Southern California', 'University of Tennessee',
  'University of Texas Austin', 'University of Utah', 'University of Vermont',
  'University of Virginia', 'University of Washington', 'University of Wisconsin Madison',
  'University of Wyoming', 'Vanderbilt University', 'Villanova University', 'Virginia Tech',
  'Wake Forest University', 'Washington State University', 'Wayne State University',
  'West Virginia University', 'Western Kentucky University', 'Wichita State University',
  'Worcester Polytechnic Institute', 'Yale University',
];

function parseCarnegieNames(text) {
  const names = new Set();
  const flat = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
  const re = /([A-Z][A-Za-z&'.ʻ–\- ]+?(?:University|College|Institute|School)[A-Za-z &'.–\-]*?)\s+[A-Z]{2}\s+(?:19|20)\d{2}/g;
  let m;
  while ((m = re.exec(flat)) !== null) {
    let name = m[1].trim().replace(/\s+/g, ' ');
    name = name.replace(/^The /, 'The '); // keep The
    if (name.length < 8) continue;
    if (/Community College|Canyons|Wright College/i.test(name) && !/State University/i.test(name)) continue;
    names.add(name);
  }
  return names;
}

function generateBulkStateUniversities() {
  const names = new Set();
  for (const [s, cities] of Object.entries(STATE_CITIES)) {
    names.add(`University of ${s}`);
    names.add(`${s} State University`);
    if (s !== 'Alaska' && s !== 'Hawaii') names.add(`${s} Institute of Technology`);
    names.add(`University of ${s} at ${s.split(' ')[0]}`);
    for (const c of cities) {
      names.add(`University of ${s} at ${c}`);
      names.add(`${s} State University ${c}`);
      names.add(`${s} Technical University ${c}`);
      names.add(`${c} Institute of Technology`);
      names.add(`${c} University`);
      names.add(`${c} College of Engineering`);
    }
  }

  const csu = ['Bakersfield', 'Chico', 'Dominguez Hills', 'East Bay', 'Fresno', 'Fullerton', 'Long Beach',
    'Los Angeles', 'Monterey Bay', 'Northridge', 'Sacramento', 'San Bernardino', 'San Jose', 'San Marcos', 'Stanislaus'];
  for (const c of csu) names.add(`California State University, ${c}`);

  const ut = ['Austin', 'Dallas', 'Arlington', 'San Antonio', 'El Paso', 'Tyler', 'Rio Grande Valley', 'Permian Basin'];
  for (const c of ut) names.add(`University of Texas at ${c}`);

  const um = ['Ann Arbor', 'Dearborn', 'Flint'];
  for (const c of um) names.add(`University of Michigan–${c}`);

  const uw = ['Madison', 'Milwaukee', 'Green Bay', 'Eau Claire', 'La Crosse', 'Oshkosh', 'Platteville', 'Stout', 'Whitewater', 'Parkside', 'Superior'];
  for (const c of uw) if (c === 'Madison') names.add('University of Wisconsin–Madison');
  else names.add(`University of Wisconsin–${c}`);

  const suny = ['Albany', 'Binghamton', 'Buffalo', 'Stony Brook', 'New Paltz', 'Oswego', 'Plattsburgh', 'Potsdam', 'Cortland', 'Geneseo', 'Fredonia', 'Oneonta'];
  for (const c of suny) names.add(`SUNY ${c}`);

  const priv = [
    'Auburn University', 'Boston University', 'Boston College', 'Brigham Young University', 'Chapman University',
    'Clark University', 'Dartmouth College', 'Fordham University', 'Fordham University', 'George Mason University',
    'Georgia State University', 'Hofstra University', 'Indiana State University', 'Iowa State University',
    'James Madison University', 'Kansas State University', 'Kent State University', 'Loyola University Chicago',
    'Loyola Marymount University', 'Marquette University', 'Miami University', 'Michigan Technological University',
    'Mississippi State University', 'Montana State University', 'New Mexico State University', 'North Carolina State University',
    'Northern Arizona University', 'Ohio University', 'Oklahoma State University', 'Oregon State University',
    'Penn State Harrisburg', 'Penn State Erie', 'Portland State University', 'Purdue University Fort Wayne',
    'Purdue University Northwest', 'Rochester Institute of Technology', 'Rutgers University', 'San Francisco State University',
    'San Jose State University', 'Southern Illinois University', 'Southern Methodist University', 'Stevens Institute of Technology',
    'Syracuse University', 'Texas A&M University', 'Texas Tech University', 'Texas State University',
    'University of Central Florida', 'University of Central Oklahoma', 'University of Colorado Denver',
    'University of Hartford', 'University of Hartford', 'University of Houston Clear Lake', 'University of Houston Victoria',
    'University of Illinois Springfield', 'University of Massachusetts Boston', 'University of Massachusetts Lowell',
    'University of Missouri Kansas City', 'University of Missouri St Louis', 'University of Nebraska Omaha',
    'University of Nevada Las Vegas', 'University of New Hampshire', 'University of New Mexico',
    'University of North Carolina Greensboro', 'University of North Dakota', 'University of North Florida',
    'University of Northern Iowa', 'University of Oklahoma', 'University of Oregon', 'University of Portland',
    'University of Rhode Island', 'University of San Diego', 'University of San Francisco', 'University of South Alabama',
    'University of South Dakota', 'University of Southern Mississippi', 'University of Tampa', 'University of Texas Health Science Center',
    'University of the Pacific', 'University of Toledo', 'University of Tulsa', 'University of Vermont',
    'University of West Georgia', 'Valparaiso University', 'Villanova University', 'Virginia Commonwealth University',
    'Washington State University', 'Wayne State University', 'West Chester University', 'Western Michigan University',
    'Wichita State University', 'Wright State University', 'Yeshiva University',
    'Illinois State University', 'Indiana University Bloomington', 'Indiana University Purdue University Indianapolis',
    'University of Illinois Urbana-Champaign', 'University of California Berkeley', 'University of California Davis',
    'University of California Irvine', 'University of California Los Angeles', 'University of California Riverside',
    'University of California San Diego', 'University of California Santa Barbara', 'University of California Santa Cruz',
    'University of Southern California', 'University of Washington', 'University of Virginia', 'University of Pennsylvania',
    'Johns Hopkins University', 'Massachusetts Institute of Technology', 'Harvard University', 'Yale University',
    'Princeton University', 'Columbia University', 'Cornell University', 'Brown University', 'Duke University',
    'Emory University', 'Vanderbilt University', 'Wake Forest University', 'Georgetown University', 'American University',
    'Howard University', 'Tulane University', 'Rice University', 'Baylor University', 'Texas A&M University',
    'University of Notre Dame', 'University of Chicago', 'Northwestern University', 'Washington University in St. Louis',
    'Carnegie Mellon University', 'Georgia Institute of Technology', 'Virginia Polytechnic Institute and State University',
    'North Carolina State University', 'Clemson University', 'University of Georgia', 'University of Florida',
    'University of Miami', 'University of South Florida', 'Florida International University', 'Florida State University',
    'University of Arizona', 'Arizona State University', 'University of Utah', 'Utah State University', 'Colorado State University',
    'University of Colorado Boulder', 'University of Oregon', 'Oregon State University', 'University of Idaho',
    'Boise State University', 'Montana State University', 'University of Montana', 'University of Wyoming',
    'University of Nebraska Lincoln', 'University of Kansas', 'Kansas State University', 'University of Missouri',
    'University of Arkansas', 'Louisiana State University', 'University of Alabama', 'University of Alabama Birmingham',
    'University of Mississippi', 'University of Kentucky', 'University of Louisville', 'University of Tennessee',
    'University of South Carolina', 'University of North Carolina Chapel Hill', 'University of North Carolina Charlotte',
    'Appalachian State University', 'East Carolina University', 'West Virginia University', 'University of Pittsburgh',
    'Temple University', 'Drexel University', 'Lehigh University', 'Villanova University', 'University of Delaware',
    'University of Maryland College Park', 'George Washington University', 'University of Connecticut', 'University of Massachusetts Amherst',
  ];
  for (const p of priv) names.add(p);

  return [...names];
}

const STATE_CITIES = {
  Alabama: ['Birmingham', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Montgomery', 'Auburn', 'Troy', 'Florence', 'Jacksonville', 'Normal'],
  Alaska: ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Kenai'],
  Arizona: ['Phoenix', 'Tucson', 'Tempe', 'Flagstaff', 'Mesa', 'Glendale', 'Prescott', 'Yuma', 'Chandler', 'Scottsdale'],
  Arkansas: ['Fayetteville', 'Little Rock', 'Jonesboro', 'Conway', 'Pine Bluff', 'Fort Smith', 'Russellville', 'Magnolia'],
  California: ['Berkeley', 'Los Angeles', 'San Diego', 'Irvine', 'Davis', 'Santa Barbara', 'Santa Cruz', 'Riverside', 'Merced', 'San Jose', 'San Francisco', 'Long Beach', 'Fresno', 'Fullerton', 'Pomona', 'Sacramento'],
  Colorado: ['Boulder', 'Denver', 'Colorado Springs', 'Fort Collins', 'Pueblo', 'Greeley', 'Golden', 'Aurora', 'Grand Junction'],
  Connecticut: ['Storrs', 'New Haven', 'Hartford', 'Bridgeport', 'Fairfield', 'Waterbury', 'New Britain', 'Danbury'],
  Delaware: ['Newark', 'Dover', 'Wilmington', 'Georgetown'],
  Florida: ['Gainesville', 'Tallahassee', 'Miami', 'Orlando', 'Tampa', 'Boca Raton', 'Jacksonville', 'Fort Myers', 'Pensacola', 'Daytona Beach'],
  Georgia: ['Atlanta', 'Athens', 'Savannah', 'Augusta', 'Statesboro', 'Kennesaw', 'Macon', 'Valdosta', 'Carrollton'],
  Hawaii: ['Manoa', 'Hilo', 'West Oahu', 'Honolulu', 'Kaneohe'],
  Idaho: ['Moscow', 'Boise', 'Pocatello', 'Idaho Falls', 'Nampa', 'Lewiston'],
  Illinois: ['Urbana', 'Chicago', 'Springfield', 'Normal', 'Carbondale', 'Edwardsville', 'DeKalb', 'Peoria', 'Naperville'],
  Indiana: ['Bloomington', 'West Lafayette', 'Indianapolis', 'Notre Dame', 'Muncie', 'Terre Haute', 'Fort Wayne', 'Evansville'],
  Iowa: ['Ames', 'Iowa City', 'Cedar Falls', 'Des Moines', 'Dubuque', 'Davenport'],
  Kansas: ['Lawrence', 'Manhattan', 'Wichita', 'Topeka', 'Hays', 'Emporia', 'Pittsburg'],
  Kentucky: ['Lexington', 'Louisville', 'Bowling Green', 'Murray', 'Richmond', 'Morehead', 'Highland Heights'],
  Louisiana: ['Baton Rouge', 'New Orleans', 'Lafayette', 'Monroe', 'Ruston', 'Hammond', 'Natchitoches'],
  Maine: ['Orono', 'Portland', 'Farmington', 'Augusta', 'Presque Isle', 'Fort Kent'],
  Maryland: ['College Park', 'Baltimore', 'Towson', 'Bowie', 'Frostburg', 'Salisbury', 'Princess Anne'],
  Massachusetts: ['Cambridge', 'Amherst', 'Boston', 'Lowell', 'Worcester', 'Medford', 'Springfield', 'Fitchburg'],
  Michigan: ['Ann Arbor', 'East Lansing', 'Dearborn', 'Flint', 'Detroit', 'Kalamazoo', 'Houghton', 'Mount Pleasant'],
  Minnesota: ['Twin Cities', 'Duluth', 'Mankato', 'Moorhead', 'St Cloud', 'Winona', 'Bemidji'],
  Mississippi: ['Oxford', 'Starkville', 'Jackson', 'Hattiesburg', 'Cleveland', 'Itta Bena', 'Alcorn'],
  Missouri: ['Columbia', 'St Louis', 'Kansas City', 'Rolla', 'Springfield', 'Cape Girardeau', 'Kirksville'],
  Montana: ['Missoula', 'Bozeman', 'Billings', 'Butte', 'Helena', 'Great Falls'],
  Nebraska: ['Lincoln', 'Omaha', 'Kearney', 'Wayne', 'Chadron', 'Peru'],
  Nevada: ['Reno', 'Las Vegas', 'Henderson', 'Elko'],
  'New Hampshire': ['Durham', 'Manchester', 'Keene', 'Plymouth', 'Hanover'],
  'New Jersey': ['New Brunswick', 'Newark', 'Princeton', 'Hoboken', 'Glassboro', 'Montclair', 'Jersey City'],
  'New Mexico': ['Albuquerque', 'Las Cruces', 'Socorro', 'Portales', 'Silver City', 'Highlands'],
  'New York': ['Ithaca', 'New York', 'Buffalo', 'Stony Brook', 'Albany', 'Binghamton', 'Rochester', 'Syracuse', 'Troy', 'Potsdam'],
  'North Carolina': ['Chapel Hill', 'Raleigh', 'Charlotte', 'Durham', 'Greensboro', 'Boone', 'Wilmington', 'Greenville'],
  'North Dakota': ['Grand Forks', 'Fargo', 'Minot', 'Bismarck', 'Dickinson', 'Mayville'],
  Ohio: ['Columbus', 'Cleveland', 'Cincinnati', 'Dayton', 'Athens', 'Akron', 'Toledo', 'Kent', 'Bowling Green'],
  Oklahoma: ['Norman', 'Stillwater', 'Tulsa', 'Edmond', 'Weatherford', 'Langston'],
  Oregon: ['Eugene', 'Corvallis', 'Portland', 'Ashland', 'Monmouth', 'Klamath Falls'],
  Pennsylvania: ['State College', 'Pittsburgh', 'Philadelphia', 'Bethlehem', 'Erie', 'Harrisburg', 'Villanova', 'Lancaster'],
  'Rhode Island': ['Providence', 'Kingston', 'Newport', 'Smithfield'],
  'South Carolina': ['Columbia', 'Clemson', 'Charleston', 'Greenville', 'Rock Hill', 'Orangeburg'],
  'South Dakota': ['Vermillion', 'Brookings', 'Rapid City', 'Aberdeen', 'Madison'],
  Tennessee: ['Knoxville', 'Nashville', 'Memphis', 'Chattanooga', 'Murfreesboro', 'Cookeville', 'Johnson City'],
  Texas: ['Austin', 'College Station', 'Dallas', 'Houston', 'Arlington', 'San Antonio', 'El Paso', 'Lubbock', 'Denton', 'Richardson', 'Waco'],
  Utah: ['Salt Lake City', 'Logan', 'Provo', 'Ogden', 'Orem', 'Cedar City'],
  Vermont: ['Burlington', 'Middlebury', 'Northfield', 'Castleton', 'Johnson'],
  Virginia: ['Charlottesville', 'Blacksburg', 'Richmond', 'Fairfax', 'Norfolk', 'Williamsburg', 'Harrisonburg', 'Lynchburg'],
  Washington: ['Seattle', 'Pullman', 'Tacoma', 'Bellingham', 'Cheney', 'Bothell', 'Spokane'],
  'West Virginia': ['Morgantown', 'Huntington', 'Institute', 'Fairmont', 'Shepherdstown'],
  Wisconsin: ['Madison', 'Milwaukee', 'La Crosse', 'Eau Claire', 'Oshkosh', 'Whitewater', 'Stout', 'Platteville'],
  Wyoming: ['Laramie', 'Cheyenne', 'Casper', 'Powell'],
};

function inferState(name) {
  const low = name.toLowerCase();
  for (const [state, cities] of Object.entries(STATE_CITIES)) {
    const sLow = state.toLowerCase();
    if (low.includes(sLow)) return state;
    if (cities.some(c => low.includes(c.toLowerCase()))) return state;
  }
  return 'Unknown';
}

function popularityScore(entry) {
  const n = entry.name.toLowerCase();
  let score = 50;
  if (/stanford|mit|massachusetts institute|carnegie mellon|berkeley|caltech|harvard|princeton|yale|cornell|columbia/.test(n)) score += 45;
  if (/university of|state university|institute of technology|polytechnic|tech/.test(n)) score += 20;
  if (/medical|health|biomedical|clinic|hospital/.test(n)) score += 10;
  if (/community college|seminary|theological/.test(n)) score -= 25;
  score += Math.min(25, entry.strengths.length / 4);
  return Math.max(1, Math.round(score));
}

function loadCarnegieNames() {
  if (!existsSync(CARNEGIE_TXT)) return [];
  return parseCarnegieNames(readFileSync(CARNEGIE_TXT, 'utf8'));
}

const majorLines = loadUserMajorsFromFile();
const byName = new Map();

for (const u of USA_TARGET_UNIVERSITIES) {
  byName.set(u.name.toLowerCase(), { ...u });
}

for (const name of [...loadCarnegieNames(), ...EXTRA_NAMES, ...generateBulkStateUniversities()]) {
  const key = name.toLowerCase();
  if (!byName.has(key)) byName.set(key, buildUniversityEntry(name, majorLines));
}

const catalog = [...byName.values()]
  .map(entry => ({
    ...entry,
    state: entry.state || inferState(entry.name),
    popularity: entry.popularity || popularityScore(entry),
  }))
  .sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name))
  .map((entry, idx) => ({ ...entry, rank: idx + 1 }))
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), count: catalog.length, universities: catalog }, null, 0));

console.log(`USA catalog: ${catalog.length} universities → ${OUT}`);
