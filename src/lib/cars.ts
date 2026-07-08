// Curated, broad car makes → models database. Bundled locally so
// autocomplete is instant and offline everywhere it's needed (onboarding
// "dream car", search…). Not every trim ever built, but wide coverage of the
// world's notable makes and their key models — supercars, performance,
// mainstream and classics. Extend freely: add a make key or a model string.

export const CARS: Record<string, string[]> = {
  Ferrari: ['F40', 'F50', 'Enzo', 'LaFerrari', 'F8 Tributo', '488 GTB', '488 Pista', '296 GTB', 'SF90 Stradale', '812 Superfast', '812 GTS', 'Roma', 'Portofino', 'California', 'California T', '458 Italia', '458 Speciale', 'F12berlinetta', '599 GTB Fiorano', '575M Maranello', '550 Maranello', 'F355', '360 Modena', 'F430', 'Testarossa', '308 GTB', '328 GTB', '348', 'Mondial', 'Daytona SP3', 'Monza SP1', 'Monza SP2', 'Purosangue', 'GTC4Lusso', 'FF', '250 GTO'],
  Lamborghini: ['Revuelto', 'Aventador', 'Aventador SVJ', 'Huracán', 'Huracán EVO', 'Huracán STO', 'Huracán Tecnica', 'Huracán Sterrato', 'Urus', 'Urus Performante', 'Gallardo', 'Murciélago', 'Diablo', 'Countach', 'Miura', 'Espada', 'Jarama', 'Jalpa', 'Sián', 'Veneno', 'Centenario', 'Reventón', 'Essenza SCV12'],
  Porsche: ['911 Carrera', '911 Carrera S', '911 Turbo', '911 Turbo S', '911 GT3', '911 GT3 RS', '911 GT2 RS', '911 Targa', '911 Dakar', '918 Spyder', 'Carrera GT', '959', '718 Cayman', '718 Cayman GT4', '718 Boxster', '718 Spyder', 'Taycan', 'Taycan Turbo S', 'Panamera', 'Macan', 'Cayenne', 'Cayenne Coupé', '944', '928', '968', '356'],
  Maserati: ['MC20', 'MC20 Cielo', 'GranTurismo', 'GranCabrio', 'Ghibli', 'Quattroporte', 'Levante', 'Grecale', 'MC12', '3200 GT', 'Coupé', 'Spyder', 'Bora', 'Merak', 'Khamsin', 'Shamal'],
  McLaren: ['P1', 'F1', 'Senna', 'Speedtail', 'Elva', 'Artura', '720S', '750S', '765LT', '600LT', '620R', '570S', '570GT', '540C', '650S', '675LT', '12C', 'GT', 'Sabre', 'Solus GT'],
  'Aston Martin': ['Vantage', 'DB11', 'DB12', 'DBS Superleggera', 'DBS', 'DB9', 'DB7', 'DB5', 'DBX', 'Vanquish', 'Valkyrie', 'Valhalla', 'Valour', 'Victor', 'One-77', 'Vulcan', 'V8 Vantage', 'Rapide', 'Virage'],
  Bugatti: ['Chiron', 'Chiron Super Sport', 'Chiron Pur Sport', 'Veyron', 'Veyron Super Sport', 'Divo', 'Centodieci', 'La Voiture Noire', 'Bolide', 'Mistral', 'W16 Mistral', 'Tourbillon', 'EB110'],
  Koenigsegg: ['Jesko', 'Jesko Absolut', 'Regera', 'Agera', 'Agera RS', 'One:1', 'CCX', 'CCR', 'Gemera', 'CC850'],
  Pagani: ['Huayra', 'Huayra BC', 'Huayra Roadster', 'Zonda', 'Zonda F', 'Zonda R', 'Zonda Cinque', 'Utopia'],
  Mercedes: ['A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'CLA', 'CLS', 'GLA', 'GLB', 'GLC', 'GLC Coupé', 'GLE', 'GLE Coupé', 'GLS', 'G-Class', 'SL', 'SLC', 'EQS', 'EQE', 'EQA', 'EQB', 'CLK', 'SLK', 'SLS AMG', 'AMG GT', 'AMG GT 63', 'AMG GT R', 'AMG ONE', 'AMG C 63', 'AMG E 63', 'AMG A 45', 'AMG CLA 45', 'AMG G 63', 'AMG GLE 63', 'AMG SL 63', '190E', '300SL', 'CLK GTR'],
  BMW: ['1 Series', '2 Series', '2 Series Gran Coupé', '3 Series', '4 Series', '4 Series Gran Coupé', '5 Series', '6 Series', '7 Series', '8 Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM', 'Z3', 'Z4', 'Z8', 'i3', 'i4', 'i5', 'i7', 'iX', 'M2', 'M3', 'M4', 'M5', 'M8', 'M240i', 'M340i', 'M550i', 'X3 M', 'X5 M', 'X6 M', '1M', 'M1', '2002', '507'],
  Audi: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'e-tron GT', 'TT', 'TT RS', 'R8', 'R8 V10', 'S3', 'S4', 'S5', 'RS 3', 'RS 4', 'RS 5', 'RS 6 Avant', 'RS 7', 'RS Q8', 'RS e-tron GT', 'Sport quattro', 'quattro'],
  Volkswagen: ['Golf', 'Golf GTI', 'Golf R', 'Polo', 'Polo GTI', 'Passat', 'Arteon', 'Scirocco', 'Beetle', 'Up', 'T-Roc', 'Tiguan', 'Touareg', 'ID.3', 'ID.4', 'ID.5', 'ID.Buzz', 'Corrado', 'Golf GTI Clubsport'],
  Toyota: ['GR Supra', 'Supra', 'GR Yaris', 'GR86', '86', 'GR Corolla', 'Corolla', 'Yaris', 'Camry', 'Prius', 'RAV4', 'C-HR', 'Land Cruiser', 'Hilux', 'Mirai', 'MR2', 'Celica', 'Century', '2000GT', 'AE86'],
  Nissan: ['GT-R', 'GT-R R35', 'GT-R R34', 'GT-R R33', 'GT-R R32', 'Skyline', '370Z', '350Z', 'Z', 'Fairlady Z', 'Silvia', 'S15', '240SX', 'Juke', 'Qashqai', 'X-Trail', 'Micra', 'Leaf', 'Ariya', '200SX', 'Pulsar GTI-R'],
  Honda: ['NSX', 'Civic', 'Civic Type R', 'Integra', 'Integra Type R', 'S2000', 'S660', 'Prelude', 'Accord', 'CR-X', 'Jazz', 'CR-V', 'HR-V', 'e', 'Beat'],
  Mazda: ['RX-7', 'RX-8', 'MX-5', 'MX-5 Miata', 'Mazda3', 'Mazda6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'MX-30', '787B', 'Cosmo'],
  Subaru: ['WRX', 'WRX STI', 'Impreza', 'BRZ', 'Legacy', 'Forester', 'Outback', 'XV', 'Levorg', 'SVX', '22B STI'],
  Ford: ['Mustang', 'Mustang GT', 'Mustang Shelby GT500', 'Mustang Mach-E', 'GT', 'GT40', 'Focus', 'Focus RS', 'Focus ST', 'Fiesta', 'Fiesta ST', 'Puma', 'Ranger', 'F-150', 'F-150 Raptor', 'Bronco', 'Escort', 'Sierra Cosworth', 'RS200'],
  Chevrolet: ['Corvette', 'Corvette C8', 'Corvette C7', 'Corvette C6', 'Corvette Z06', 'Corvette ZR1', 'Camaro', 'Camaro ZL1', 'Camaro SS', 'Silverado', 'Blazer', 'Tahoe', 'Suburban', 'Impala', 'Bel Air', 'Chevelle', 'El Camino'],
  Dodge: ['Challenger', 'Challenger SRT Hellcat', 'Challenger Demon', 'Charger', 'Charger SRT Hellcat', 'Viper', 'Durango', 'Ram 1500', 'Dart'],
  Tesla: ['Model S', 'Model S Plaid', 'Model 3', 'Model X', 'Model Y', 'Roadster', 'Cybertruck', 'Semi'],
  Alpine: ['A110', 'A110 S', 'A110 R', 'A310', 'A610', 'A290', 'GTA'],
  'Alfa Romeo': ['Giulia', 'Giulia Quadrifoglio', 'Stelvio', 'Stelvio Quadrifoglio', 'Tonale', '4C', '8C Competizione', 'Giulietta', 'GT', 'GTV', 'Spider', 'Brera', 'MiTo', '33 Stradale', '155', '156', '159'],
  Bentley: ['Continental GT', 'Continental GTC', 'Flying Spur', 'Bentayga', 'Mulsanne', 'Azure', 'Arnage', 'Brooklands', 'Bacalar', 'Batur'],
  'Rolls-Royce': ['Phantom', 'Ghost', 'Wraith', 'Dawn', 'Cullinan', 'Spectre', 'Silver Shadow', 'Silver Cloud', 'Corniche', 'Boat Tail'],
  Jaguar: ['F-Type', 'E-Type', 'XE', 'XF', 'XJ', 'XK', 'F-Pace', 'E-Pace', 'I-Pace', 'XKR', 'XJ220', 'D-Type', 'C-X75'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Range Rover Velar', 'Range Rover Evoque', 'Freelander'],
  Lotus: ['Emira', 'Evora', 'Elise', 'Exige', 'Esprit', 'Elan', 'Europa', 'Evija', 'Eletre', 'Seven'],
  Lexus: ['LFA', 'LC 500', 'LC', 'IS', 'IS F', 'GS', 'GS F', 'ES', 'LS', 'RC', 'RC F', 'UX', 'NX', 'RX', 'GX', 'LX', 'RZ', 'SC430'],
  Hyundai: ['i20 N', 'i30 N', 'Ioniq 5', 'Ioniq 5 N', 'Ioniq 6', 'Kona', 'Tucson', 'Santa Fe', 'Elantra', 'Elantra N', 'Veloster N', 'N Vision 74'],
  Kia: ['EV6', 'EV6 GT', 'Stinger', 'Ceed', 'ProCeed', 'Sportage', 'Sorento', 'Picanto', 'Niro', 'Telluride', 'EV9'],
  Peugeot: ['205 GTI', '208', '208 GTi', '308', '308 GTi', '3008', '5008', '2008', '406', '407', '508', 'RCZ', '406 Coupé', '106 Rallye'],
  Renault: ['Clio', 'Clio RS', 'Mégane', 'Mégane RS', 'Twingo', 'Captur', 'Kadjar', 'Scénic', 'Zoe', 'Espace', '5', '5 Turbo', 'Alpine A110', 'Sport Spider'],
  Citroën: ['C1', 'C3', 'C4', 'C5', 'C5 X', 'C5 Aircross', 'DS3', 'DS4', 'Saxo VTS', 'Xsara', 'AX GT', 'SM', '2CV', 'DS'],
  Skoda: ['Fabia', 'Fabia Monte Carlo', 'Octavia', 'Octavia RS', 'Superb', 'Scala', 'Kamiq', 'Karoq', 'Kodiaq', 'Enyaq'],
  Seat: ['Ibiza', 'Ibiza Cupra', 'Leon', 'Leon Cupra', 'Ateca', 'Arona', 'Tarraco', 'Cupra Formentor', 'Cupra Born'],
  Volvo: ['S60', 'S90', 'V60', 'V90', 'XC40', 'XC60', 'XC90', 'C40', 'EX30', 'EX90', '240', 'P1800', 'C30'],
  Mini: ['Cooper', 'Cooper S', 'John Cooper Works', 'Clubman', 'Countryman', 'Convertible', 'Paceman', 'Electric'],
  Fiat: ['500', '500 Abarth', '595 Abarth', 'Panda', 'Tipo', '124 Spider', 'Punto', 'Barchetta', 'Coupé', '131 Abarth'],
  Abarth: ['595', '695', '124 Spider', '500e', 'Abarth 500'],
  Cupra: ['Formentor', 'Leon', 'Born', 'Ateca', 'Tavascan'],
  Genesis: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80'],
  Cadillac: ['CT4', 'CT4-V', 'CT5', 'CT5-V Blackwing', 'Escalade', 'Lyriq', 'XLR', 'CTS-V'],
  Pontiac: ['Firebird', 'GTO', 'Trans Am', 'Solstice'],
  Acura: ['NSX', 'Integra', 'RSX', 'TLX', 'TL Type-S', 'RDX', 'MDX'],
  Infiniti: ['Q50', 'Q60', 'QX55', 'QX80', 'G37'],
  Mitsubishi: ['Lancer Evolution', 'Lancer Evo', 'Eclipse', 'Eclipse Cross', '3000GT', 'GTO', 'Outlander', 'ASX', 'Shogun'],
  Suzuki: ['Swift', 'Swift Sport', 'Jimny', 'Vitara', 'Ignis', 'Cappuccino'],
  Polestar: ['Polestar 1', 'Polestar 2', 'Polestar 3', 'Polestar 4', 'Polestar 5'],
  Rimac: ['Nevera', 'Concept One', 'Concept Two'],
  Lucid: ['Air', 'Air Sapphire', 'Gravity'],
  Opel: ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Manta', 'Speedster', 'GT'],
  DS: ['DS 3', 'DS 4', 'DS 7', 'DS 9'],
  Morgan: ['Plus Four', 'Plus Six', 'Super 3', 'Aero 8'],
  Caterham: ['Seven', 'Seven 620R', 'Seven 310'],
  TVR: ['Griffith', 'Sagaris', 'Tuscan', 'Cerbera', 'Chimaera'],
  Noble: ['M600', 'M12'],
  Ariel: ['Atom', 'Nomad'],
  GMC: ['Sierra', 'Yukon', 'Hummer EV', 'Canyon'],
  Jeep: ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Compass', 'Renegade', 'Gladiator', 'Wagoneer'],
}

// Iconic defaults shown when the field is empty.
const POPULAR = [
  'Ferrari F40',
  'Lamborghini Huracán',
  'Porsche 911 GT3 RS',
  'Maserati MC20',
  'McLaren 720S',
  'Nissan GT-R R34',
  'Aston Martin Vantage',
  'Bugatti Chiron',
]

export const CAR_MAKES = Object.keys(CARS).sort()

const norm = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Autocomplete over the whole DB. Matches on "Make Model", on the make alone
// (typing "Maserati" surfaces its models) and on the model. Ranked so the most
// relevant prefix matches come first. Returns "Make Model" strings.
export function searchCars(query: string, limit = 8): string[] {
  const q = norm(query)
  if (!q) return POPULAR.slice(0, limit)
  const out: { label: string; score: number; idx: number }[] = []
  for (const make of CAR_MAKES) {
    const makeL = norm(make)
    const makeStarts = makeL.startsWith(q)
    const makeHas = makeL.includes(q)
    const models = CARS[make]
    for (let idx = 0; idx < models.length; idx += 1) {
      const model = models[idx]
      const label = `${make} ${model}`
      const fullL = norm(label)
      const modelL = norm(model)
      let score = -1
      if (fullL.startsWith(q)) score = 100
      else if (makeStarts) score = 90
      else if (modelL.startsWith(q)) score = 80
      else if (fullL.includes(q)) score = 60
      else if (makeHas || modelL.includes(q)) score = 40
      if (score >= 0) out.push({ label, score, idx })
    }
  }
  // Score first, then the authored model order (notable models come first in
  // each make's array), then alphabetical as a final tiebreak.
  out.sort(
    (a, b) => b.score - a.score || a.idx - b.idx || a.label.localeCompare(b.label),
  )
  return out.slice(0, limit).map((r) => r.label)
}

// Resolve a free-typed brand to a canonical make key ("mercedes-amg" →
// "Mercedes", "citroen" → "Citroën"). Exact, then prefix, then contains.
export function findMake(brand: string): string | null {
  const b = norm(brand)
  if (!b) return null
  return (
    CAR_MAKES.find((m) => norm(m) === b) ??
    CAR_MAKES.find((m) => norm(m).startsWith(b) || b.startsWith(norm(m))) ??
    CAR_MAKES.find((m) => norm(m).includes(b) || b.includes(norm(m))) ??
    null
  )
}

// Models of a given make, optionally filtered by a typed query. Empty if the
// make isn't in the DB.
export function modelsForMake(brand: string, query = '', limit = 8): string[] {
  const key = findMake(brand)
  if (!key) return []
  const q = norm(query)
  const models = CARS[key]
  return (q ? models.filter((m) => norm(m).includes(q)) : models).slice(0, limit)
}
