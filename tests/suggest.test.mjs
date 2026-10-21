import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandForPhoton,
  parseQuery,
  placeBias,
  rankCandidates,
  scoreCandidate,
  suggestAddresses,
  tokenize,
} from '../src/server/live/suggest.ts';

const cand = (house, street, city, zip, source = 'osm', state = 'NY') => ({ house, street, city, zip, state, source });

test('tokenize canonicalizes street types, directions and ordinals', () => {
  assert.deepEqual(tokenize('West 42nd Street'), ['w', '42nd', 'st']);
  assert.deepEqual(tokenize('W. 42 St.'), ['w', '42nd', 'st']);
  assert.deepEqual(tokenize('Fifth Avenue'), ['5th', 'ave']);
  assert.deepEqual(tokenize('5 AVENUE'), ['5th', 'ave']);
  assert.deepEqual(tokenize("Saint Mark's Place"), ['st', 'marks', 'pl']);
});

test('parseQuery splits house number, words, ZIP and a trailing state', () => {
  assert.deepEqual(parseQuery('10 State St, Albany, NY 12207'), { house: '10', words: ['state', 'st', 'albany'], zip: '12207', state: 'NY' });
  assert.deepEqual(parseQuery('120-55 Queens Blvd'), { house: '120-55', words: ['queens', 'blvd'], zip: null, state: null });
  assert.equal(parseQuery('40 S Broadway Yonkers').house, '40', 'a direction is not a house-number suffix');
  assert.equal(parseQuery('10b Main St').house, '10b');
  assert.equal(parseQuery('5th Ave').house, null);
  // "New York" stays: it is Manhattan's postal city.
  assert.deepEqual(parseQuery('350 5th Ave New York').words, ['5th', 'ave', 'new', 'york']);
  // US scope recognises any state; NY scope only strips "NY".
  assert.equal(parseQuery('100 N High St Columbus OH', 'US').state, 'OH');
  assert.equal(parseQuery('100 N High St Columbus OH', 'NY').state, null);
});

test('expandForPhoton spells out abbreviations OSM stores in full, but keeps "St" = Saint', () => {
  assert.equal(expandForPhoton('10 State St Albany'), '10 State Street Albany');
  assert.equal(expandForPhoton('40 S Broadway Yonkers'), '40 South Broadway Yonkers');
  assert.equal(expandForPhoton('65 Niagara Sq, Buffalo'), '65 Niagara Square, Buffalo');
  assert.equal(expandForPhoton('10 St Marks Pl'), '10 St Marks Place');
});

test('placeBias recognises a typed NY city', () => {
  assert.deepEqual(placeBias(parseQuery('10 State St Albany').words).map(Math.round), [43, -74]);
  assert.equal(placeBias(['main', 'st']), null);
  assert.ok(placeBias(parseQuery('1 Main St White Plains').words));
});

test('scoring: exact house + street + city beats a prefix house, a wrong street is dropped', () => {
  const q = parseQuery('10 State St Albany');
  const exact = scoreCandidate(q, cand('10', 'State St', 'Albany', '12207', 'nys'));
  const longer = scoreCandidate(q, cand('100', 'State Street', 'Albany', '12244'));
  const wrong = scoreCandidate(q, cand('10 B', 'Airline Drive', 'Colonie', '12205'));
  const cityOnly = scoreCandidate(q, cand('10', 'Albany Street', 'Saratoga Springs', '12866'));
  assert.equal(exact.houseMatch, 'exact');
  assert.equal(longer.houseMatch, 'prefix');
  assert.ok(exact.score > longer.score);
  assert.equal(exact.keep, true);
  assert.equal(wrong.keep, false);
  assert.equal(cityOnly.keep, false, '"Albany Street" is not "State St, Albany"');
});

test('ranking reproduces the "10 State St Albany" fix', () => {
  const q = parseQuery('10 State St Albany');
  const before = [
    cand('10 B', 'Airline Drive', 'Colonie', '12205'),
    cand('10', 'North Main Avenue', 'Albany', '12203'),
    cand('10', 'St Thomas Lane', 'Colonie', '12304'),
    cand('10', 'Stephen Street', 'Albany', '12202'),
    cand('10', 'State St', 'Albany', '12207', 'nys'),
  ];
  assert.deepEqual(rankCandidates(q, before).map((s) => s.address), ['10 State St, Albany, NY 12207']);
});

test('ranking: conflicting street type or direction is a different street', () => {
  const ter = parseQuery('10 Richmond Ter Staten');
  assert.deepEqual(
    rankCandidates(ter, [cand('10', 'Richmond Pl', 'Staten Island', '10309', 'nys'), cand('10', 'Richmond Terrace', 'Staten Island', '10301', 'nyc')]).map((s) => s.address),
    ['10 Richmond Terrace, Staten Island, NY 10301'],
  );
  const dir = parseQuery('40 S Broadway Yonkers');
  assert.deepEqual(
    rankCandidates(dir, [cand('40', 'North Broadway', 'Yonkers', '10701'), cand('40', 'South Broadway', 'Yonkers', '10701')]).map((s) => s.address),
    ['40 South Broadway, Yonkers, NY 10701'],
  );
});

test('ranking: partial typing matches word prefixes and spelled-out ordinals', () => {
  const q = parseQuery('350 fift');
  const out = rankCandidates(q, [cand('350', 'Fifth Avenue', 'New York', '10118', 'nyc'), cand('350', 'Grand Street', 'New York', '10002', 'nyc')]);
  assert.deepEqual(out.map((s) => s.address), ['350 Fifth Avenue, New York, NY 10118']);
  const ord = rankCandidates(parseQuery('350 5th Ave New York'), [cand('350', '5 Avenue', 'New York', '10118', 'nyc')]);
  assert.equal(ord.length, 1);
});

test('ranking dedupes across providers, keeping the better-scoring copy, and respects the limit', () => {
  const q = parseQuery('65 Niagara Sq Buffalo');
  const out = rankCandidates(q, [
    cand('65', 'Niagara Square', 'Buffalo', '14202'),
    cand('65', 'Niagara Sq', 'Buffalo', '14202', 'nys'),
    cand('65', 'Niagara Square', 'Buffalo', '14202'),
  ]);
  assert.deepEqual(out, [{ address: '65 Niagara Sq, Buffalo, NY 14202', detail: 'Buffalo, NY 14202', source: 'nys' }]);
  const many = Array.from({ length: 10 }, (_, i) => cand('1', 'Main Street', `Town ${i}`, `1300${i}`));
  assert.equal(rankCandidates(parseQuery('1 Main St'), many).length, 6);
});

test('ranking: a typed state that differs drops the candidate', () => {
  const q = parseQuery('100 N High St Columbus OH', 'US');
  assert.equal(scoreCandidate(q, cand('100', 'N High St', 'Columbus', '43215', 'census', 'OH')).keep, true);
  assert.equal(scoreCandidate(q, cand('100', 'N High St', 'Columbus', '13033', 'nys', 'NY')).keep, false);
});

/** Fake upstream services keyed by host. */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const host = new URL(url).host;
    const body = routes[host];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (body instanceof Error) throw body;
    return Response.json(typeof body === 'function' ? body(url) : body);
  };
  return { f, calls };
}
const photonFeature = (p) => ({ properties: { countrycode: 'US', ...p } });

test('suggestAddresses (NY scope) merges GeoSearch, NYS ITS and Photon and ranks them', async () => {
  const { f, calls } = fakeFetch({
    'geosearch.planninglabs.nyc': { features: [] },
    'gisservices.its.ny.gov': {
      candidates: [
        { address: '10 State St, Albany, NY, 12207', score: 100, attributes: { Loc_name: '3A_SS_ZipName', Addr_type: 'StreetAddress' } },
        { address: '10 State St, Albany, NY, 12209', score: 100, attributes: { Loc_name: '3B_SS_CTName', Addr_type: 'StreetAddress' } },
      ],
    },
    'photon.komoot.io': {
      features: [
        photonFeature({ housenumber: '10 B', street: 'Airline Drive', city: 'Colonie', state: 'New York', postcode: '12205' }),
        photonFeature({ housenumber: '100', street: 'State Street', city: 'Albany', state: 'New York', postcode: '12244' }),
        photonFeature({ housenumber: '10', street: 'Main Street', city: 'Newark', state: 'New Jersey', postcode: '07102' }),
      ],
    },
  });
  const out = await suggestAddresses('10 State St Albany', { scope: 'NY', fetch: f });
  assert.deepEqual(out.map((s) => s.address), ['10 State St, Albany, NY 12207']);
  const photonUrl = new URL(calls.find((u) => u.includes('photon')));
  assert.equal(photonUrl.searchParams.get('q'), '10 State Street Albany');
  assert.equal(photonUrl.searchParams.get('bbox'), '-79.77,40.49,-71.85,45.02');
  assert.ok(photonUrl.searchParams.get('lat'), 'biased toward Albany');
  assert.equal(calls.some((u) => u.includes('census.gov')), false, 'no Census in NY scope');
});

test('suggestAddresses tolerates provider failures and skips the state locator for a bare prefix', async () => {
  const { f, calls } = fakeFetch({
    'geosearch.planninglabs.nyc': {
      features: [
        { geometry: { coordinates: [-73.98, 40.75] }, properties: { housenumber: '350', street: 'GD CONCOURSE', borough: 'Bronx', postalcode: '10451' } },
        { geometry: { coordinates: [-73.98, 40.75] }, properties: { housenumber: '350', street: 'GRAND CONCOURSE', borough: 'Bronx', postalcode: '10451' } },
      ],
    },
    'photon.komoot.io': new Error('offline'),
  });
  const out = await suggestAddresses('350 grand conc', { fetch: f });
  assert.deepEqual(out, [{ address: '350 Grand Concourse, Bronx, NY 10451', detail: 'Bronx, NY 10451', source: 'nyc' }]);
  assert.equal(calls.some((u) => u.includes('its.ny.gov')), true);
  const short = fakeFetch({ 'geosearch.planninglabs.nyc': { features: [] }, 'photon.komoot.io': { features: [] } });
  await suggestAddresses('350 fift', { fetch: short.f });
  assert.equal(short.calls.some((u) => u.includes('its.ny.gov')), false);
  assert.deepEqual(await suggestAddresses('ab', { fetch: short.f }), []);
});

test('suggestAddresses (US scope) uses Photon nationwide and Census for complete addresses', async () => {
  const { f, calls } = fakeFetch({
    'photon.komoot.io': {
      features: [
        photonFeature({ housenumber: '100', street: 'North High Street', city: 'Columbus', state: 'Ohio', postcode: '43215' }),
        { properties: { countrycode: 'CA', housenumber: '100', street: 'High Street', city: 'Columbus', state: 'Ontario' } },
      ],
    },
    'geocoding.geo.census.gov': {
      result: { addressMatches: [{ matchedAddress: '100 N HIGH ST, COLUMBUS, OH, 43215', addressComponents: {} }] },
    },
  });
  const out = await suggestAddresses('100 N High St Columbus OH', { scope: 'US', fetch: f });
  assert.deepEqual(out.map((s) => s.address), ['100 N High St, Columbus, OH 43215']);
  assert.equal(calls.some((u) => u.includes('geosearch')), false, 'a non-NY state skips the NY-only services');
  assert.equal(new URL(calls.find((u) => u.includes('photon'))).searchParams.get('bbox'), null);
});

test('ranking: a partly typed city after house + street is a city prefix', () => {
  const q = parseQuery('1100 Congress Ave Aus');
  const out = rankCandidates(q, [
    cand('1100', 'Congress Avenue', 'Aurora', '44202', 'osm', 'OH'),
    cand('1100', 'Congress Avenue', 'Tampa', '33602', 'osm', 'FL'),
    cand('1100', 'Congress Avenue', 'Austin', '78701', 'census', 'TX'),
  ]);
  assert.deepEqual(out.map((s) => s.address), ['1100 Congress Avenue, Austin, TX 78701']);
  // multi-word city prefixes, and a trailing direction is not a city
  const fw = rankCandidates(parseQuery('500 Main St Fort Wor'), [cand('500', 'Main Street', 'Fort Worth', '76102', 'osm', 'TX'), cand('500', 'Main Street', 'Fort Wayne', '46802', 'osm', 'IN')]);
  assert.deepEqual(fw.map((s) => s.address), ['500 Main Street, Fort Worth, TX 76102']);
  const dir = rankCandidates(parseQuery('100 Park Ave S'), [cand('100', 'Park Avenue South', 'New York', '10017', 'nyc')]);
  assert.equal(dir.length, 1);
  // a borough typed in place of the postal city still matches through the detail line
  const bk = rankCandidates(parseQuery('100 Smith St Manh'), [{ ...cand('100', 'Smith Street', 'New York', '10001', 'nyc'), detail: 'Manhattan, NY 10001' }]);
  assert.equal(bk.length, 1);
});
