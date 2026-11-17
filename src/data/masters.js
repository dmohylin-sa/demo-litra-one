// Mocked master data. Customer names, people and figures are fictional; geography, ADR/UN data
// and product physics are realistic so the flows behave like the real operation.

export const COMPANIES = [
  { id: 'MTN', name: 'Martinsen Transport AS', short: 'Martinsen NO', country: 'NO', currency: 'NOK', vat: 0.25, lang: 'nb', invoicePrefix: 'MTN', orgNo: 'NO 950 118 204', focus: 'Tank: liquid fuels', active: true, wave: 'Pilot' },
  { id: 'LGN', name: 'Litra Gass AS', short: 'Litra Gass NO', country: 'NO', currency: 'NOK', vat: 0.25, lang: 'nb', invoicePrefix: 'LGN', orgNo: 'NO 917 330 562', focus: 'LPG, LNG & biogas', active: true, wave: 'Pilot' },
  { id: 'LGS', name: 'Litra Gas AB', short: 'Litra Gas SE', country: 'SE', currency: 'SEK', vat: 0.25, lang: 'sv', invoicePrefix: 'LGS', orgNo: 'SE 556 784-1290', focus: 'Bulk gas & fuel', active: true, wave: 'Wave 2' },
  { id: 'LDK', name: 'Litra Danmark A/S', short: 'Litra DK', country: 'DK', currency: 'DKK', vat: 0.25, lang: 'da', invoicePrefix: 'LDK', orgNo: 'DK 38 51 22 90', focus: 'Cross-border energy', active: false, wave: 'Wave 3' },
  { id: 'LFI', name: 'Litra Finland OY', short: 'Litra FI', country: 'FI', currency: 'EUR', vat: 0.255, lang: 'fi', invoicePrefix: 'LFI', orgNo: 'FI 3104 5520', focus: 'Gas & industrial energy', active: false, wave: 'Wave 3' },
];

export const LOCATIONS = [
  // Depots
  { id: 'D-RUD', kind: 'depot', name: 'Rudshøgda depot (HQ)', lat: 60.879, lng: 10.716, country: 'NO' },
  { id: 'D-OSL', kind: 'depot', name: 'Oslo Alnabru depot', lat: 59.931, lng: 10.844, country: 'NO' },
  { id: 'D-KAR', kind: 'depot', name: 'Karlstad depot', lat: 59.389, lng: 13.47, country: 'SE' },
  // Terminals (third-party owned)
  { id: 'T-SJU', kind: 'terminal', name: 'Sjursøya fuel terminal', lat: 59.893, lng: 10.765, country: 'NO', owner: 'Oil company JV', hours: '00:00-24:00', products: ['DIESEL', 'PETROL', 'HVO', 'HEATOIL', 'JET', 'ADBLUE'], rules: ['Terminal safety pass (SafeLoad) required', 'Bottom loading with vapour recovery', 'Bill of lading printed at gantry'], active: true },
  { id: 'T-RAF', kind: 'terminal', name: 'Rafnes LPG terminal', lat: 59.098, lng: 9.594, country: 'NO', owner: 'Petrochemical operator', hours: '05:00-22:00', products: ['PROPANE'], rules: ['Gas-free certificate check', 'Weigh-in / weigh-out on bridge scale'], active: true },
  { id: 'T-FRE', kind: 'terminal', name: 'Fredrikstad LNG terminal', lat: 59.189, lng: 10.953, country: 'NO', owner: 'LNG distributor', hours: '04:00-23:00', products: ['LNG'], rules: ['Cryogenic PPE', 'Weigh-in / weigh-out on bridge scale'], active: true },
  { id: 'T-GJB', kind: 'terminal', name: 'Gjøvik biogas plant (LBG)', lat: 60.77, lng: 10.64, country: 'NO', owner: 'Biogas producer', hours: '06:00-20:00', products: ['LBG'], rules: ['Weigh-in / weigh-out on bridge scale'], active: true },
  { id: 'T-KAR', kind: 'terminal', name: 'Karlstad oil harbour', lat: 59.372, lng: 13.515, country: 'SE', owner: 'Port terminal operator', hours: '04:00-22:00', products: ['DIESEL', 'PETROL', 'HVO'], rules: ['Terminal ID card', 'Bottom loading'], active: true },
  { id: 'T-GBG', kind: 'terminal', name: 'Göteborg gas terminal', lat: 57.695, lng: 11.87, country: 'SE', owner: 'Gas importer', hours: '05:00-21:00', products: ['PROPANE'], rules: ['Weigh-in / weigh-out on bridge scale'], active: true },
  // Customer delivery sites
  { id: 'S-NOR-HAM', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Hamar Furuberget', lat: 60.803, lng: 11.102, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 40 m³, 95 30 m³' },
  { id: 'S-NOR-BRU', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Brumunddal', lat: 60.884, lng: 10.94, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 30 m³, 95 30 m³' },
  { id: 'S-NOR-GJO', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Gjøvik', lat: 60.796, lng: 10.693, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: 95 40 m³' },
  { id: 'S-NOR-LIL', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Lillehammer sentrum', lat: 61.115, lng: 10.466, country: 'NO', hours: '05:00-22:00', maxLength: 12, equipment: [], tanks: 'Underground: D 20 m³, 95 20 m³', access: 'City-centre site: rigid trucks only (max 12 m)' },
  { id: 'S-NOR-ELV', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Elverum', lat: 60.883, lng: 11.563, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 30 m³, 95 25 m³' },
  { id: 'S-NOR-KON', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Kongsvinger', lat: 60.19, lng: 11.997, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 30 m³, HVO 20 m³' },
  { id: 'S-NOR-JES', kind: 'site', customerId: 'C-NOR', name: 'Nordlys Jessheim', lat: 60.142, lng: 11.175, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 40 m³, 95 30 m³' },
  { id: 'S-MJO-MOE', kind: 'site', customerId: 'C-MJO', name: 'Moelv bridge construction site', lat: 60.933, lng: 10.697, country: 'NO', hours: '06:00-18:00', maxLength: 16.5, equipment: ['PUMP', 'METER'], tanks: 'Mobile site tank 10 m³ (no pump)', access: 'Gravel access road, max 16.5 m' },
  { id: 'S-MJO-RUD', kind: 'site', customerId: 'C-MJO', name: 'E6 roadworks Rudshøgda', lat: 60.889, lng: 10.74, country: 'NO', hours: '06:00-18:00', maxLength: 16.5, equipment: ['PUMP', 'METER'], tanks: 'Mobile site tank 8 m³ (no pump)' },
  { id: 'S-HED-STA', kind: 'site', customerId: 'C-HED', name: 'Stange farm tank', lat: 60.716, lng: 11.19, country: 'NO', hours: '07:00-17:00', maxLength: 12, equipment: ['PUMP', 'METER'], tanks: 'Above-ground farm tank 5 m³', access: 'Farm road, rigid trucks only' },
  { id: 'S-HED-LOT', kind: 'site', customerId: 'C-HED', name: 'Løten grain dryer', lat: 60.818, lng: 11.34, country: 'NO', hours: '07:00-17:00', maxLength: 16.5, equipment: ['PUMP', 'METER'], tanks: 'Heating oil tank 12 m³' },
  { id: 'S-AER-FAG', kind: 'site', customerId: 'C-AER', name: 'Fagernes Leirin airport fuel farm', lat: 61.015, lng: 9.288, country: 'NO', hours: '06:00-20:00', maxLength: 18.75, equipment: [], tanks: 'Jet A-1 fuel farm 60 m³', access: 'Airside security pass required' },
  { id: 'S-AER-HAM', kind: 'site', customerId: 'C-AER', name: 'Hamar Stafsberg airfield', lat: 60.818, lng: 11.068, country: 'NO', hours: '07:00-19:00', maxLength: 18.75, equipment: [], tanks: 'Jet A-1 tank 25 m³' },
  { id: 'S-FJG-KON', kind: 'site', customerId: 'C-FJG', name: 'Kongsvinger industrial LPG tank', lat: 60.205, lng: 12.03, country: 'NO', hours: '06:00-20:00', maxLength: 18.75, equipment: ['PUMP'], tanks: 'LPG bullet tank 60 m³' },
  { id: 'S-FJG-ELV', kind: 'site', customerId: 'C-FJG', name: 'Elverum sawmill LPG tank', lat: 60.87, lng: 11.59, country: 'NO', hours: '06:00-18:00', maxLength: 18.75, equipment: ['PUMP'], tanks: 'LPG bullet tank 40 m³' },
  { id: 'S-FJG-HAM', kind: 'site', customerId: 'C-FJG', name: 'Hamar greenhouse LPG tank', lat: 60.77, lng: 11.03, country: 'NO', hours: '06:00-18:00', maxLength: 18.75, equipment: ['PUMP'], tanks: 'LPG bullet tank 45 m³' },
  { id: 'S-INB-HAM', kind: 'site', customerId: 'C-INB', name: 'Hamar bus depot LBG station', lat: 60.796, lng: 11.08, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'LNG/LBG tank 80 m³' },
  { id: 'S-INB-LIL', kind: 'site', customerId: 'C-INB', name: 'Lillehammer bus depot LBG station', lat: 61.1, lng: 10.48, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'LNG/LBG tank 60 m³' },
  { id: 'S-SVE-ARV', kind: 'site', customerId: 'C-SVE', name: 'Svea Arvika', lat: 59.655, lng: 12.591, country: 'SE', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 30 m³, 95 30 m³' },
  { id: 'S-SVE-KRI', kind: 'site', customerId: 'C-SVE', name: 'Svea Kristinehamn', lat: 59.31, lng: 14.108, country: 'SE', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 40 m³, 95 30 m³' },
  { id: 'S-SVE-SAF', kind: 'site', customerId: 'C-SVE', name: 'Svea Säffle', lat: 59.133, lng: 12.93, country: 'SE', hours: '00:00-24:00', maxLength: 18.75, equipment: [], tanks: 'Underground: D 30 m³, HVO 20 m³' },
  { id: 'S-VIG-KAR', kind: 'site', customerId: 'C-VIG', name: 'Karlstad paper mill LPG', lat: 59.4, lng: 13.58, country: 'SE', hours: '06:00-20:00', maxLength: 18.75, equipment: ['PUMP'], tanks: 'LPG bullet tank 80 m³' },
];

// ADR transport document descriptions per ADR 5.4.1.1.1: UN no., proper shipping name, class, PG, tunnel code.
export const PRODUCTS = [
  { id: 'DIESEL', name: 'Diesel (B7)', un: '1202', properName: 'DIESEL FUEL', adrClass: '3', pg: 'III', tunnel: '(D/E)', unit: 'L', density: 0.835, vcfAlpha: 0.00083, trailerTypes: ['TANK'], family: 'LIQUID', color: '#D4A017' },
  { id: 'PETROL', name: 'Petrol 95 E10', un: '1203', properName: 'MOTOR SPIRIT', adrClass: '3', pg: 'II', tunnel: '(D/E)', unit: 'L', density: 0.745, vcfAlpha: 0.0012, trailerTypes: ['TANK'], family: 'LIQUID', color: '#2E7D32' },
  { id: 'HVO', name: 'HVO100 renewable diesel', un: '1202', properName: 'DIESEL FUEL', adrClass: '3', pg: 'III', tunnel: '(D/E)', unit: 'L', density: 0.78, vcfAlpha: 0.0008, trailerTypes: ['TANK'], family: 'LIQUID', color: '#00897B' },
  { id: 'HEATOIL', name: 'Heating oil (light)', un: '1202', properName: 'HEATING OIL, LIGHT', adrClass: '3', pg: 'III', tunnel: '(D/E)', unit: 'L', density: 0.845, vcfAlpha: 0.00083, trailerTypes: ['TANK'], family: 'LIQUID', color: '#8D6E63' },
  { id: 'JET', name: 'Jet A-1', un: '1863', properName: 'FUEL, AVIATION, TURBINE ENGINE', adrClass: '3', pg: 'III', tunnel: '(D/E)', unit: 'L', density: 0.8, vcfAlpha: 0.0009, trailerTypes: ['JET'], family: 'JET', color: '#5C6BC0', dedicated: true },
  { id: 'ADBLUE', name: 'AdBlue (AUS 32)', un: null, properName: 'Not subject to ADR', adrClass: null, pg: null, tunnel: null, unit: 'L', density: 1.09, vcfAlpha: 0.0003, trailerTypes: ['TANK'], family: 'ADBLUE', color: '#1E88E5', incompatible: ['DIESEL', 'PETROL', 'HVO', 'HEATOIL'] },
  { id: 'PROPANE', name: 'Propane (LPG)', un: '1978', properName: 'PROPANE', adrClass: '2.1', pg: null, tunnel: '(B/D)', unit: 'kg', density: 0.51, vcfAlpha: 0, trailerTypes: ['LPG'], family: 'LPG', color: '#E65100' },
  { id: 'LNG', name: 'LNG', un: '1972', properName: 'METHANE, REFRIGERATED LIQUID', adrClass: '2.1', pg: null, tunnel: '(B/D)', unit: 'kg', density: 0.45, vcfAlpha: 0, trailerTypes: ['LNG'], family: 'LNG', color: '#6A1B9A' },
  { id: 'LBG', name: 'Liquid biogas (LBG)', un: '1972', properName: 'METHANE, REFRIGERATED LIQUID', adrClass: '2.1', pg: null, tunnel: '(B/D)', unit: 'kg', density: 0.45, vcfAlpha: 0, trailerTypes: ['LNG'], family: 'LNG', color: '#2E7D32' },
];

export const TRAILER_TYPES = {
  TANK: 'Fuel tank (ADR FL)',
  JET: 'Aviation tank (dedicated)',
  LPG: 'LPG pressure tank',
  LNG: 'Cryogenic tank',
};

const comp = (...caps) => caps;
export const TRAILERS = [
  { id: 'TR-01', reg: 'TA 6021', companyId: 'MTN', type: 'TANK', rigid: false, compartments: comp(9000, 8500, 8500, 8500, 8500), unit: 'L', adrApprovalUntil: '2027-06-30', comboLength: 16.5, status: 'Active' },
  { id: 'TR-02', reg: 'TA 6034', companyId: 'MTN', type: 'TANK', rigid: false, compartments: comp(9000, 8500, 8500, 8500, 8500), unit: 'L', adrApprovalUntil: '2027-03-31', comboLength: 16.5, status: 'Active' },
  { id: 'TR-03', reg: 'TA 6047', companyId: 'MTN', type: 'TANK', rigid: false, compartments: comp(10000, 10000, 9000, 9000), unit: 'L', adrApprovalUntil: '2027-09-30', comboLength: 16.5, status: 'Active' },
  { id: 'TR-04', reg: 'TA 6058', companyId: 'MTN', type: 'TANK', rigid: false, compartments: comp(9000, 8500, 8500, 8500, 8500), unit: 'L', adrApprovalUntil: '2027-01-31', comboLength: 16.5, status: 'Active' },
  { id: 'TR-05', reg: 'EB 41346 (body)', companyId: 'MTN', type: 'TANK', rigid: true, compartments: comp(7000, 6000, 5000), unit: 'L', adrApprovalUntil: '2027-05-31', comboLength: 10.8, status: 'Active' },
  { id: 'TR-06', reg: 'TA 6090', companyId: 'MTN', type: 'JET', rigid: false, compartments: comp(10000, 10000, 9000, 9000), unit: 'L', adrApprovalUntil: '2027-08-31', comboLength: 16.5, status: 'Active' },
  { id: 'TR-07', reg: 'TA 6102', companyId: 'MTN', type: 'TANK', rigid: false, compartments: comp(9000, 8500, 8500, 8500, 8500), unit: 'L', adrApprovalUntil: '2027-04-30', comboLength: 16.5, status: 'Active' },
  { id: 'TR-08', reg: 'EB 41411 (body)', companyId: 'MTN', type: 'TANK', rigid: true, compartments: comp(6000, 6000, 5000), unit: 'L', adrApprovalUntil: '2027-10-31', comboLength: 10.5, status: 'Active' },
  { id: 'TR-21', reg: 'TC 7110', companyId: 'LGN', type: 'LPG', rigid: false, compartments: comp(24000), unit: 'kg', adrApprovalUntil: '2027-02-28', comboLength: 16.5, status: 'Active' },
  { id: 'TR-22', reg: 'TC 7124', companyId: 'LGN', type: 'LNG', rigid: false, compartments: comp(20000), unit: 'kg', adrApprovalUntil: '2027-07-31', comboLength: 16.5, status: 'Active' },
  { id: 'TR-23', reg: 'TC 7139', companyId: 'LGN', type: 'LNG', rigid: false, compartments: comp(20000), unit: 'kg', adrApprovalUntil: '2027-11-30', comboLength: 16.5, status: 'Active' },
  { id: 'TR-24', reg: 'TC 7145', companyId: 'LGN', type: 'LPG', rigid: false, compartments: comp(24000), unit: 'kg', adrApprovalUntil: '2027-05-31', comboLength: 16.5, status: 'Active' },
  { id: 'TR-41', reg: 'XHT 31B', companyId: 'LGS', type: 'TANK', rigid: false, compartments: comp(10000, 10000, 9000, 9000), unit: 'L', adrApprovalUntil: '2027-06-30', comboLength: 16.5, status: 'Active' },
  { id: 'TR-42', reg: 'XHT 47C', companyId: 'LGS', type: 'TANK', rigid: false, compartments: comp(9000, 8500, 8500, 8500, 8500), unit: 'L', adrApprovalUntil: '2027-04-30', comboLength: 16.5, status: 'Active' },
  { id: 'TR-43', reg: 'XHT 52D', companyId: 'LGS', type: 'LPG', rigid: false, compartments: comp(24000), unit: 'kg', adrApprovalUntil: '2027-09-30', comboLength: 16.5, status: 'Active' },
];

export const TRUCKS = [
  { id: 'TK-01', reg: 'EB 41237', model: 'Scania R 500', fuel: 'HVO', companyId: 'MTN', homeBase: 'D-RUD', telematicsId: 'rFMS-SCA-41237', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-01' },
  { id: 'TK-02', reg: 'EB 41255', model: 'Volvo FH 500', fuel: 'DIESEL', companyId: 'MTN', homeBase: 'D-OSL', telematicsId: 'rFMS-VOL-41255', provider: 'Volvo Connect (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-02' },
  { id: 'TK-03', reg: 'EB 41302', model: 'Scania R 460 LBG', fuel: 'LBG', companyId: 'MTN', homeBase: 'D-OSL', telematicsId: 'rFMS-SCA-41302', provider: 'Scania (rFMS)', status: 'Active', hasPump: false, hasMeter: true, defaultTrailerId: 'TR-03' },
  { id: 'TK-04', reg: 'EB 41318', model: 'Scania G 410', fuel: 'HVO', companyId: 'MTN', homeBase: 'D-OSL', telematicsId: 'rFMS-SCA-41318', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-04' },
  { id: 'TK-05', reg: 'EB 41346', model: 'Volvo FM 460 rigid', fuel: 'HVO', companyId: 'MTN', homeBase: 'D-RUD', telematicsId: 'rFMS-VOL-41346', provider: 'Volvo Connect (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-05' },
  { id: 'TK-06', reg: 'EB 41377', model: 'Scania R 500', fuel: 'HVO', companyId: 'MTN', homeBase: 'D-OSL', telematicsId: 'rFMS-SCA-41377', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-06' },
  { id: 'TK-07', reg: 'EB 41390', model: 'Volvo FH 540', fuel: 'DIESEL', companyId: 'MTN', homeBase: 'D-OSL', telematicsId: 'rFMS-VOL-41390', provider: 'Volvo Connect (rFMS)', status: 'In maintenance', maintenanceNote: 'Brake service, back 3 Dec', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-07' },
  { id: 'TK-08', reg: 'EB 41411', model: 'Scania P 410 rigid', fuel: 'LBG', companyId: 'MTN', homeBase: 'D-RUD', telematicsId: 'rFMS-SCA-41411', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-08' },
  { id: 'TK-21', reg: 'EC 52114', model: 'Scania R 450 LBG', fuel: 'LBG', companyId: 'LGN', homeBase: 'D-OSL', telematicsId: 'rFMS-SCA-52114', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-21' },
  { id: 'TK-22', reg: 'EC 52136', model: 'Volvo FH 460 LNG', fuel: 'LBG', companyId: 'LGN', homeBase: 'D-OSL', telematicsId: 'rFMS-VOL-52136', provider: 'Volvo Connect (rFMS)', status: 'Active', hasPump: false, hasMeter: true, defaultTrailerId: 'TR-22' },
  { id: 'TK-23', reg: 'EC 52158', model: 'Scania G 410 LBG', fuel: 'LBG', companyId: 'LGN', homeBase: 'D-RUD', telematicsId: 'rFMS-SCA-52158', provider: 'Scania (rFMS)', status: 'Active', hasPump: false, hasMeter: true, defaultTrailerId: 'TR-23' },
  { id: 'TK-24', reg: 'EC 52170', model: 'Scania R 450', fuel: 'HVO', companyId: 'LGN', homeBase: 'D-RUD', telematicsId: 'rFMS-SCA-52170', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-24' },
  { id: 'TK-41', reg: 'MLR 482', model: 'Volvo FH 500', fuel: 'HVO', companyId: 'LGS', homeBase: 'D-KAR', telematicsId: 'DYN-VOL-482', provider: 'Dynafleet (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-41' },
  { id: 'TK-42', reg: 'MLR 517', model: 'Scania R 500', fuel: 'DIESEL', companyId: 'LGS', homeBase: 'D-KAR', telematicsId: 'rFMS-SCA-517', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-42' },
  { id: 'TK-43', reg: 'MLR 553', model: 'Scania R 450 LBG', fuel: 'LBG', companyId: 'LGS', homeBase: 'D-KAR', telematicsId: 'rFMS-SCA-553', provider: 'Scania (rFMS)', status: 'Active', hasPump: true, hasMeter: true, defaultTrailerId: 'TR-43' },
];

// tachoLeftMin: remaining daily driving time today per tachograph download (EU 561/2006: 9h, 10h twice a week).
export const DRIVERS = [
  { id: 'DR-01', name: 'Lars Bakken', companyId: 'MTN', homeBase: 'D-RUD', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2028-05-19' }, phone: '+47 913 22 401', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-02', name: 'Kari Haugen', companyId: 'MTN', homeBase: 'D-OSL', licence: ['C', 'CE'], adr: { tank: true, class2: false, expires: '2027-09-02' }, phone: '+47 913 22 402', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-03', name: 'Erik Lunde', companyId: 'MTN', homeBase: 'D-RUD', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2026-11-28' }, phone: '+47 913 22 403', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-04', name: 'Magnus Dahl', companyId: 'MTN', homeBase: 'D-OSL', licence: ['C', 'CE'], adr: { tank: true, class2: false, expires: '2026-12-18' }, phone: '+47 913 22 404', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-05', name: 'Sigrid Moen', companyId: 'MTN', homeBase: 'D-OSL', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2029-01-10' }, phone: '+47 913 22 405', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-06', name: 'Thomas Berg', companyId: 'MTN', homeBase: 'D-OSL', licence: ['C', 'CE'], adr: { tank: true, class2: false, expires: '2027-04-22' }, phone: '+47 913 22 406', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-07', name: 'Jonas Hagen', companyId: 'MTN', homeBase: 'D-RUD', licence: ['C', 'CE'], adr: { tank: true, class2: false, expires: '2028-11-30' }, phone: '+47 913 22 407', pin: '1234', tachoLeftMin: 540, absent: ['2026-12-02'] },
  { id: 'DR-08', name: 'Nils Eriksen', companyId: 'MTN', homeBase: 'D-RUD', licence: ['C'], adr: { tank: true, class2: false, expires: '2027-06-14' }, phone: '+47 913 22 408', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-21', name: 'Marte Johansen', companyId: 'LGN', homeBase: 'D-OSL', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2028-02-01' }, phone: '+47 913 22 421', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-22', name: 'Ola Sæther', companyId: 'LGN', homeBase: 'D-OSL', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2027-12-12' }, phone: '+47 913 22 422', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-23', name: 'Anders Viken', companyId: 'LGN', homeBase: 'D-RUD', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2028-08-08' }, phone: '+47 913 22 423', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-24', name: 'Hilde Brekke', companyId: 'LGN', homeBase: 'D-RUD', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2027-03-03' }, phone: '+47 913 22 424', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-41', name: 'Johan Lindqvist', companyId: 'LGS', homeBase: 'D-KAR', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2028-06-06' }, phone: '+46 70 412 2041', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-42', name: 'Emma Karlsson', companyId: 'LGS', homeBase: 'D-KAR', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2027-10-10' }, phone: '+46 70 412 2042', pin: '1234', tachoLeftMin: 540, absent: [] },
  { id: 'DR-43', name: 'Oskar Nilsson', companyId: 'LGS', homeBase: 'D-KAR', licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '2028-01-20' }, phone: '+46 70 412 2043', pin: '1234', tachoLeftMin: 540, absent: [] },
];

export const CUSTOMERS = [
  { id: 'C-NOR', name: 'Nordlys Energi AS', orgNo: '921 448 302', companyId: 'MTN', channel: 'EDI', ediFormat: 'EDIFACT IFTMIN D.96A', ubwNo: '10211', contractId: 'K-NOR', status: 'Active', contacts: [{ name: 'Trond Aasland', role: 'Supply planner', email: 'supply@nordlys-energi.example', phone: '+47 400 11 200', channels: ['email', 'sms'], lang: 'nb' }] },
  { id: 'C-MJO', name: 'Mjøsa Bygg & Anlegg AS', orgNo: '934 102 776', companyId: 'MTN', channel: 'Phone', ubwNo: '10388', contractId: 'K-MJO', status: 'Active', contacts: [{ name: 'Siri Holm', role: 'Site manager', email: 'siri.holm@mjosabygg.example', phone: '+47 400 22 310', channels: ['sms'], lang: 'nb' }] },
  { id: 'C-HED', name: 'Hedmark Landbruk SA', orgNo: '948 557 120', companyId: 'MTN', channel: 'Email', ubwNo: '10457', contractId: 'K-HED', status: 'Active', ubwBlocked: true, contacts: [{ name: 'Per Ivar Nøkleby', role: 'Purchasing', email: 'innkjop@hedmarklandbruk.example', phone: '+47 400 33 115', channels: ['email'], lang: 'nb' }] },
  { id: 'C-AER', name: 'Aero Fuel Norge AS', orgNo: '915 330 441', companyId: 'MTN', channel: 'API', ubwNo: '10502', contractId: 'K-AER', status: 'Active', contacts: [{ name: 'Linn Haraldsen', role: 'Fuel ops', email: 'ops@aerofuel.example', phone: '+47 400 44 900', channels: ['email'], lang: 'en' }] },
  { id: 'C-FJG', name: 'Fjordgass AS', orgNo: '987 220 019', companyId: 'LGN', channel: 'API', ubwNo: '20114', contractId: 'K-FJG', status: 'Active', contacts: [{ name: 'Morten Vik', role: 'Logistics', email: 'logistikk@fjordgass.example', phone: '+47 400 55 120', channels: ['email', 'sms'], lang: 'nb' }] },
  { id: 'C-INB', name: 'Innlandet Bussdrift AS', orgNo: '926 441 870', companyId: 'LGN', channel: 'Email', ubwNo: '20171', contractId: 'K-INB', status: 'Active', contacts: [{ name: 'Guro Lien', role: 'Depot manager', email: 'depot@innlandetbuss.example', phone: '+47 400 66 210', channels: ['sms'], lang: 'nb' }] },
  { id: 'C-SVE', name: 'Svea Bränsle AB', orgNo: '559 112-4410', companyId: 'LGS', channel: 'EDI', ediFormat: 'EDIFACT IFTMIN D.96A', ubwNo: '30045', contractId: 'K-SVE', status: 'Active', contacts: [{ name: 'Anna Berglund', role: 'Supply', email: 'supply@sveabransle.example', phone: '+46 70 555 1200', channels: ['email'], lang: 'sv' }] },
  { id: 'C-VIG', name: 'Värmlands Industrigas AB', orgNo: '556 870-2214', companyId: 'LGS', channel: 'Phone', ubwNo: '30061', contractId: 'K-VIG', status: 'Active', contacts: [{ name: 'Erik Sundin', role: 'Mill energy', email: 'energi@vig.example', phone: '+46 70 555 3400', channels: ['sms'], lang: 'sv' }] },
  { id: 'C-GUD', name: 'Gudbrandsdal Varme AS', orgNo: '912 004 556', companyId: 'MTN', channel: 'Email', ubwNo: '10133', contractId: null, status: 'Inactive', contacts: [] },
];

export const EXTRA_OPS = [
  { id: 'PUMP', name: 'Truck pump use', unit: 'min' },
  { id: 'HOSE', name: 'Extra hose (> 30 m)', unit: 'pcs' },
  { id: 'SAMPLE', name: 'Aviation quality sampling', unit: 'pcs' },
  { id: 'HANDLING', name: 'Manual handling / tank dip', unit: 'min' },
];

// Rate cards: three pricing models seen in tank & gas haulage.
export const RATE_CARDS = [
  {
    id: 'RC-NOR-26', name: 'Nordlys 2026 - volume by zone', model: 'VOLUME_ZONE', currency: 'NOK', validFrom: '2026-01-01', validTo: '2026-12-31',
    zones: [{ maxKm: 50, rate: 92 }, { maxKm: 100, rate: 118 }, { maxKm: 150, rate: 142 }, { maxKm: 9999, rate: 165 }],
    stopFee: 590, waiting: { freeMin: 30, perHour: 1260 }, ops: { PUMP: { fixed: 450, perMin: 14 }, HOSE: { fixed: 350 }, HANDLING: { perMin: 12 } },
    surcharges: { fuelPct: 0.058, adrPct: 0, weekendPct: 0.25 }, minCharge: 0, fees: { lateCancel: 2800, failedDelivery: 3500 },
  },
  {
    id: 'RC-MJO-26', name: 'Mjøsa Bygg - km & hour', model: 'KM_HOUR', currency: 'NOK', validFrom: '2026-01-01', validTo: '2027-06-30',
    perKm: 31.5, perHour: 1180, stopFee: 0, waiting: { freeMin: 20, perHour: 1140 }, ops: { PUMP: { fixed: 450, perMin: 14 }, HOSE: { fixed: 350 }, HANDLING: { perMin: 12 } },
    surcharges: { fuelPct: 0.058, adrPct: 0.04, weekendPct: 0.25 }, minCharge: 2400, fees: { lateCancel: 2500, failedDelivery: 3000 },
  },
  {
    id: 'RC-HED-26', name: 'Hedmark Landbruk - small drops', model: 'VOLUME_ZONE', currency: 'NOK', validFrom: '2026-01-01', validTo: '2026-12-31',
    zones: [{ maxKm: 50, rate: 165 }, { maxKm: 100, rate: 198 }, { maxKm: 150, rate: 236 }, { maxKm: 9999, rate: 270 }],
    stopFee: 450, waiting: { freeMin: 30, perHour: 1140 }, ops: { PUMP: { fixed: 450, perMin: 14 }, HOSE: { fixed: 350 }, HANDLING: { perMin: 12 } },
    surcharges: { fuelPct: 0.058, adrPct: 0, weekendPct: 0.25 }, minCharge: 2400, fees: { lateCancel: 1800, failedDelivery: 2400 },
  },
  {
    id: 'RC-AER-26', name: 'Aero Fuel - dedicated km & hour', model: 'KM_HOUR', currency: 'NOK', validFrom: '2026-04-01', validTo: '2027-03-31',
    perKm: 34.0, perHour: 1240, stopFee: 0, waiting: { freeMin: 45, perHour: 1240 }, ops: { SAMPLE: { fixed: 950 }, HOSE: { fixed: 350 } },
    surcharges: { fuelPct: 0.058, adrPct: 0.04, weekendPct: 0.3 }, minCharge: 0, fees: { lateCancel: 4000, failedDelivery: 5000 },
  },
  {
    id: 'RC-FJG-26', name: 'Fjordgass - tonne by zone', model: 'TONNE_ZONE', currency: 'NOK', validFrom: '2026-01-01', validTo: '2026-12-31',
    zones: [{ maxKm: 100, rate: 310 }, { maxKm: 200, rate: 385 }, { maxKm: 300, rate: 455 }, { maxKm: 9999, rate: 540 }],
    stopFee: 750, waiting: { freeMin: 30, perHour: 1300 }, ops: { PUMP: { fixed: 0, perMin: 9 }, HOSE: { fixed: 350 } },
    surcharges: { fuelPct: 0.058, adrPct: 0.05, weekendPct: 0.25 }, minCharge: 0, fees: { lateCancel: 3000, failedDelivery: 4000 },
  },
  {
    id: 'RC-INB-26', name: 'Innlandet Bussdrift - LBG tonne by zone', model: 'TONNE_ZONE', currency: 'NOK', validFrom: '2026-01-01', validTo: '2027-12-31',
    zones: [{ maxKm: 100, rate: 290 }, { maxKm: 200, rate: 360 }, { maxKm: 9999, rate: 430 }],
    stopFee: 600, waiting: { freeMin: 30, perHour: 1300 }, ops: {},
    surcharges: { fuelPct: 0.04, adrPct: 0.05, weekendPct: 0.25 }, minCharge: 0, fees: { lateCancel: 3000, failedDelivery: 4000 },
  },
  {
    id: 'RC-SVE-26', name: 'Svea Bränsle - km & hour', model: 'KM_HOUR', currency: 'SEK', validFrom: '2026-01-01', validTo: '2026-12-31',
    perKm: 29.0, perHour: 1050, stopFee: 450, waiting: { freeMin: 30, perHour: 1000 }, ops: { PUMP: { fixed: 400, perMin: 12 } },
    surcharges: { fuelPct: 0.061, adrPct: 0.04, weekendPct: 0.25 }, minCharge: 0, fees: { lateCancel: 2500, failedDelivery: 3000 },
  },
  {
    id: 'RC-VIG-26', name: 'Värmlands Industrigas - tonne by zone', model: 'TONNE_ZONE', currency: 'SEK', validFrom: '2026-01-01', validTo: '2026-12-31',
    zones: [{ maxKm: 150, rate: 340 }, { maxKm: 300, rate: 420 }, { maxKm: 9999, rate: 510 }],
    stopFee: 700, waiting: { freeMin: 30, perHour: 1100 }, ops: { PUMP: { fixed: 0, perMin: 8 } },
    surcharges: { fuelPct: 0.061, adrPct: 0.05, weekendPct: 0.25 }, minCharge: 0, fees: { lateCancel: 2800, failedDelivery: 3500 },
  },
];

export const CONTRACTS = [
  { id: 'K-NOR', customerId: 'C-NOR', companyId: 'MTN', rateCardId: 'RC-NOR-26', validFrom: '2026-01-01', validTo: '2026-12-31', currency: 'NOK', invoicing: 'PER_TRIP', autoApprove: true, terms: '30 days net' },
  { id: 'K-MJO', customerId: 'C-MJO', companyId: 'MTN', rateCardId: 'RC-MJO-26', validFrom: '2026-01-01', validTo: '2027-06-30', currency: 'NOK', invoicing: 'PER_TRIP', autoApprove: false, terms: '14 days net' },
  { id: 'K-HED', customerId: 'C-HED', companyId: 'MTN', rateCardId: 'RC-HED-26', validFrom: '2026-01-01', validTo: '2026-12-31', currency: 'NOK', invoicing: 'PER_TRIP', autoApprove: true, terms: '30 days net' },
  { id: 'K-AER', customerId: 'C-AER', companyId: 'MTN', rateCardId: 'RC-AER-26', validFrom: '2026-04-01', validTo: '2027-03-31', currency: 'NOK', invoicing: 'MONTHLY', autoApprove: false, terms: '30 days net' },
  { id: 'K-FJG', customerId: 'C-FJG', companyId: 'LGN', rateCardId: 'RC-FJG-26', validFrom: '2026-01-01', validTo: '2026-12-31', currency: 'NOK', invoicing: 'PER_TRIP', autoApprove: true, terms: '30 days net' },
  { id: 'K-INB', customerId: 'C-INB', companyId: 'LGN', rateCardId: 'RC-INB-26', validFrom: '2026-01-01', validTo: '2027-12-31', currency: 'NOK', invoicing: 'PER_TRIP', autoApprove: true, terms: '30 days net' },
  { id: 'K-SVE', customerId: 'C-SVE', companyId: 'LGS', rateCardId: 'RC-SVE-26', validFrom: '2026-01-01', validTo: '2026-12-31', currency: 'SEK', invoicing: 'PER_TRIP', autoApprove: false, terms: '30 days net' },
  { id: 'K-VIG', customerId: 'C-VIG', companyId: 'LGS', rateCardId: 'RC-VIG-26', validFrom: '2026-01-01', validTo: '2026-12-31', currency: 'SEK', invoicing: 'PER_TRIP', autoApprove: true, terms: '30 days net' },
];

// GLEC Framework v3 / ISO 14083 style well-to-wheel factors (illustrative values for the demo).
export const FUELS = {
  DIESEL: { name: 'Diesel (B7)', unit: 'L', perKm: 0.36, co2ePerUnit: 3.17 },
  HVO: { name: 'HVO100', unit: 'L', perKm: 0.37, co2ePerUnit: 0.52 },
  LBG: { name: 'Bio-LNG (LBG)', unit: 'kg', perKm: 0.31, co2ePerUnit: 0.74 },
};

export const USERS = [
  { id: 'U-PLN', name: 'Ingrid Solberg', role: 'planner', title: 'Fleet Planner', email: 'ingrid.solberg@litra.example', companies: ['MTN', 'LGN'], active: true },
  { id: 'U-PL2', name: 'Kjetil Nygård', role: 'planner', title: 'Fleet Planner', email: 'kjetil.nygard@litra.example', companies: ['LGS'], active: true },
  { id: 'U-BO', name: 'Henrik Lie', role: 'backoffice', title: 'Back-Office Specialist', email: 'henrik.lie@litra.example', companies: ['MTN', 'LGN', 'LGS'], active: true },
  { id: 'U-MGR', name: 'Kristin Aasen', role: 'manager', title: 'Operations Director', email: 'kristin.aasen@litra.example', companies: ['MTN', 'LGN', 'LGS'], active: true },
  { id: 'U-ADM', name: 'Ole Martin Rustad', role: 'admin', title: 'Administrator', email: 'olemartin.rustad@litra.example', companies: ['MTN', 'LGN', 'LGS', 'LDK', 'LFI'], active: true },
  { id: 'U-TRM', name: 'Sjursøya gate team', role: 'terminal', title: 'Terminal Operator', email: 'gate@terminal.example', companies: ['MTN'], active: true },
  { id: 'U-OLD', name: 'Bjørn Tveit', role: 'planner', title: 'Fleet Planner (left)', email: 'bjorn.tveit@litra.example', companies: ['MTN'], active: false },
];
