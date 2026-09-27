/* ===================== City Builder v2 — configuration ===================== */

export const CFG = {
  W: 72,
  H: 72,
  START_MONEY: 40000,
  TAX_DEFAULT: 9,
  TICK_SECONDS: 2.0,
  AUTOSAVE_MONTHS: 12,
  SAVE_KEY: 'citybuilder.save.v3',
  DATE0: { m: 3, y: 2026 },

  // road hierarchy — cost per tile, traffic capacity, speed factor
  ROAD: {
    1: { id: 1, key: 'street',  name: 'Street',  cost: 20,  cap: 100, speed: 1.0,  upkeep: 0.08 },
    2: { id: 2, key: 'avenue',  name: 'Avenue',  cost: 60,  cap: 320, speed: 1.15, upkeep: 0.30 },
    3: { id: 3, key: 'highway', name: 'Highway', cost: 120, cap: 900, speed: 1.6,  upkeep: 0.80 },
  },

  ZONES: {
    res:    { id: 1, name: 'Residential', cost: 5, icon: '🏠', color: '#4ade80' },
    com:    { id: 2, name: 'Commercial',  cost: 5, icon: '🏬', color: '#60a5fa' },
    ind:    { id: 3, name: 'Industrial',  cost: 5, icon: '🏭', color: '#facc15' },
    office: { id: 4, name: 'Office',      cost: 8, icon: '🏢', color: '#22d3ee' },
  },

  BUILDS: {
    coal:     { cat: 'power',   name: 'Coal plant',    icon: '⚡', cost: 3000, upkeep: 60, cap: 140, poll: 34 },
    wind:     { cat: 'power',   name: 'Wind turbine',  icon: '🌀', cost: 1400, upkeep: 15, cap: 30,  poll: 2 },
    solar:    { cat: 'power',   name: 'Solar farm',    icon: '🔆', cost: 2600, upkeep: 28, cap: 45,  poll: 0 },
    police:   { cat: 'service', name: 'Police station',icon: '🚓', cost: 1200, upkeep: 35, service: 'safety', radius: 14 },
    fire:     { cat: 'service', name: 'Fire station',  icon: '🚒', cost: 1000, upkeep: 30, service: 'safety', radius: 14 },
    hospital: { cat: 'service', name: 'Hospital',      icon: '🏥', cost: 1600, upkeep: 50, service: 'health', radius: 14 },
    school:   { cat: 'service', name: 'School',        icon: '🏫', cost: 1500, upkeep: 42, service: 'education', radius: 12 },
    park:     { cat: 'park',    name: 'Small park',    icon: '🌳', cost: 150,  upkeep: 2,  service: 'park', radius: 3 },
    plaza:    { cat: 'park',    name: 'City plaza',    icon: '⛲', cost: 600,  upkeep: 8,  service: 'park', radius: 4 },
  },

  POWER_USE: { res: [2, 4, 8], com: [3, 6, 12], ind: [5, 12, 22], office: [4, 8, 16] },
  POP_CAP: [0, 8, 22, 48],
  JOB_CAP: { com: [0, 8, 18, 34], ind: [0, 12, 26, 45], office: [0, 10, 22, 38] },

  SERVICE_RADIUS: 14,
  MILESTONES: [
    { pop: 100,   name: 'Hamlet',     grant: 2000 },
    { pop: 500,   name: 'Village',    grant: 3000 },
    { pop: 1500,  name: 'Town',       grant: 5000 },
    { pop: 5000,  name: 'City',       grant: 10000 },
    { pop: 15000, name: 'Metropolis', grant: 25000 },
  ],
};

export const TOOL_CATEGORIES = [
  { id: 'roads',    name: 'Roads',     icon: '🛣️' },
  { id: 'zones',    name: 'Zones',     icon: '🏗️' },
  { id: 'power',    name: 'Electricity', icon: '⚡' },
  { id: 'service',  name: 'Health & Safety', icon: '🚨' },
  { id: 'park',     name: 'Parks',     icon: '🌳' },
];

export const TOOLS = [
  { id: 'pan',          cat: null,     name: 'Pan',          icon: '🖐️', cost: 0,   key: 'q', hint: 'Drag to move · right-drag to orbit · scroll to zoom. Click a building for details.' },
  { id: 'road_street',  cat: 'roads',  name: 'Street',       icon: '🛣️', cost: 20,  key: '1', hint: 'Basic two-lane street. Buildings grow next to streets and avenues — not highways. Roads carry power.' },
  { id: 'road_avenue',  cat: 'roads',  name: 'Avenue',       icon: '🛣️', cost: 60,  key: '2', hint: 'Wide four-lane avenue: three times the traffic capacity. Zone commercial along these.' },
  { id: 'road_highway', cat: 'roads',  name: 'Highway',      icon: '🛣️', cost: 120, key: '3', hint: 'High-speed, huge capacity. Your city MUST be connected to the highway stub at the map edge or nobody moves in!' },
  { id: 'zone_res',     cat: 'zones',  name: 'Residential',  icon: '🏠', cost: 5,   key: '4', hint: 'Homes grow when housing demand (R) is high and the zone touches a street/avenue with power.' },
  { id: 'zone_com',     cat: 'zones',  name: 'Commercial',   icon: '🏬', cost: 5,   key: '5', hint: 'Shops hire workers and serve your population. Best along avenues.' },
  { id: 'zone_ind',     cat: 'zones',  name: 'Industrial',   icon: '🏭', cost: 5,   key: '6', hint: 'Lots of jobs — but heavy pollution. Keep industry downwind of homes.' },
  { id: 'zone_office',  cat: 'zones',  name: 'Office',       icon: '🏢', cost: 8,   key: '7', hint: 'Clean, well-paid jobs. Offices need educated workers — build schools first.' },
  { id: 'coal',         cat: 'power',  name: 'Coal plant',   icon: '⚡', cost: 3000, key: '8', hint: '140 power units, but pollutes the neighbourhood. Connect it to the road grid.' },
  { id: 'wind',         cat: 'power',  name: 'Wind turbine', icon: '🌀', cost: 1400, key: '9', hint: 'Clean 30 units. Works best in chains along the coast.' },
  { id: 'solar',        cat: 'power',  name: 'Solar farm',   icon: '🔆', cost: 2600, key: '0', hint: 'Clean 45 units, no pollution, pricier upkeep than wind.' },
  { id: 'police',       cat: 'service', name: 'Police',      icon: '🚓', cost: 1200, key: null, hint: 'Raises safety within ~14 road tiles. Safety feeds happiness and land value.' },
  { id: 'fire',         cat: 'service', name: 'Fire station',icon: '🚒', cost: 1000, key: null, hint: 'Fires are rare here, but stations boost safety like police. Coverage matters.' },
  { id: 'hospital',     cat: 'service', name: 'Hospital',    icon: '🏥', cost: 1600, key: null, hint: 'Health coverage in a radius around roads. Big happiness boost for residents.' },
  { id: 'school',       cat: 'service', name: 'School',      icon: '🏫', cost: 1500, key: null, hint: 'Educates nearby homes. Offices will only grow where schools cover.' },
  { id: 'park',         cat: 'park',   name: 'Small park',   icon: '🌳', cost: 150, key: null, hint: 'Cheap happiness + land value for everything within 3 tiles.' },
  { id: 'plaza',        cat: 'park',   name: 'City plaza',   icon: '⛲', cost: 600, key: null, hint: 'Fancy fountain plaza: stronger boost, wider radius. Place downtown.' },
  { id: 'bulldoze',     cat: null,     name: 'Bulldoze',     icon: '💥', cost: 2,   key: 'x', hint: 'Demolish buildings, roads and zones. Careful with the highway link!' },
];

export const OVERLAYS = [
  { id: 'power',     name: 'Power grid',    icon: '⚡' },
  { id: 'pollution', name: 'Pollution',     icon: '☣️' },
  { id: 'happy',     name: 'Happiness',     icon: '😊' },
  { id: 'land',      name: 'Land value',    icon: '💎' },
  { id: 'traffic',   name: 'Traffic',       icon: '🚗' },
  { id: 'coverage',  name: 'Services',      icon: '🚨' },
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ZONE_NAME = [null, 'Residential', 'Commercial', 'Industrial', 'Office'];
export const TERRAIN_NAME = ['Water', 'Sand', 'Grass'];
export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
