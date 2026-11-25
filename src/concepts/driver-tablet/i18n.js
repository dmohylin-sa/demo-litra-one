// Driver tablet language: EN / NO (Bokmål) / SV. Deliberately small: no library, no key catalogue.
// UI text is written in English in the components and passed through t('…'); NO and SV come from the table below,
// one row per text: [English, Norwegian, Swedish]. A text with no row falls back to English.
// t('{n} deliveries today', { n: 2 }) fills {placeholders}. t.num / t.day / t.longDate / t.dayTime / t.monthYear /
// t.dur format numbers, dates and durations for the language.
// What is translated: the driver workflows (My trips, pre-trip, loading, delivery, POD, issues). What is not: master
// and order data shown as entered (site and product names, terminal rules, customer instructions), the issued e-CMR
// content, and the journey data the tablet records (read by planning and back office in English).
// tests/concept-driver.test.js checks that every t('…') text in DriverTablet.jsx and every model label has a row.
// Assumption: translations are UX drafts for the demo, to be reviewed by a native speaker and Litra's driver terms.

import { D } from '../../domain/util.js';
import 'dayjs/locale/nb.js';
import 'dayjs/locale/sv.js';

export const LANGS = [
  { code: 'en', label: 'EN', name: 'English', locale: 'en-GB', dayjs: 'en' },
  { code: 'nb', label: 'NO', name: 'Norsk', locale: 'nb-NO', dayjs: 'nb' },
  { code: 'sv', label: 'SV', name: 'Svenska', locale: 'sv-SE', dayjs: 'sv' },
];

// Device preference, like the theme: kept across steps, refreshes and Reset demo (localStorage).
export const LANG_KEY = 'litra-ux-driver-tablet-lang';
export function savedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.some((l) => l.code === v) ? v : 'en';
  } catch {
    return 'en';
  }
}
export function saveLang(code) {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* storage unavailable: the choice holds for this page */
  }
}

// [English, Norsk, Svenska]
export const TEXTS = [
  // ---- tablet frame, navigation
  ['My trips', 'Mine turer', 'Mina turer'],
  ['Trip', 'Tur', 'Tur'],
  ['Online', 'Tilkoblet', 'Ansluten'],
  ['Language', 'Språk', 'Språk'],
  ['Day', 'Dag', 'Dag'],
  ['Night', 'Natt', 'Natt'],
  ['Switch to day mode', 'Bytt til dagmodus', 'Byt till dagläge'],
  ['Switch to night mode', 'Bytt til nattmodus', 'Byt till nattläge'],
  ['Driver navigation', 'Sjåførnavigasjon', 'Förarnavigering'],
  ['Close', 'Lukk', 'Stäng'],
  ['Done', 'Ferdig', 'Klar'],
  ['Now', 'Nå', 'Nu'],
  ['None', 'Ingen', 'Inga'],
  ['Stop', 'Stopp', 'Stopp'],
  ['Map', 'Kart', 'Karta'],
  ['Back to current stop', 'Tilbake til aktivt stopp', 'Tillbaka till aktuellt stopp'],
  ['Less: {what}', 'Mindre: {what}', 'Mindre: {what}'],
  ['More: {what}', 'Mer: {what}', 'Mer: {what}'],
  ['{done} of {n}', '{done} av {n}', '{done} av {n}'],
  ['All OK', 'Alt OK', 'Allt OK'],

  // ---- messages
  ['Trip confirmed. Planning can see it.', 'Turen er bekreftet. Disponenten ser det.', 'Turen är bekräftad. Trafikledningen ser det.'],
  ['Pre-trip check complete', 'Avgangskontroll fullført', 'Avgångskontroll klar'],
  ['e-CMR issued', 'e-CMR utstedt', 'e-CMR utfärdad'],
  ['Delivery at {site} signed off', 'Levering på {site} kvittert', 'Leverans vid {site} kvitterad'],
  ['Trip completed. Invoice started → reconciliation', 'Turen er fullført. Fakturering startet → avstemming', 'Turen är klar. Fakturering påbörjad → avstämning'],
  ['Planning notified: {issue}', 'Disponent varslet: {issue}', 'Trafikledningen meddelad: {issue}'],
  ['Route to {site} sent to the truck navigation', 'Rute til {site} sendt til bilens navigasjon', 'Rutt till {site} skickad till bilens navigering'],
  ['Calling {name}', 'Ringer {name}', 'Ringer {name}'],
  ['the site contact', 'kontaktpersonen på stedet', 'kontaktpersonen på plats'],

  // ---- My trips
  ['Good morning, {name}', 'God morgen, {name}', 'God morgon, {name}'],
  ['Good afternoon, {name}', 'God ettermiddag, {name}', 'God eftermiddag, {name}'],
  ['Good evening, {name}', 'God kveld, {name}', 'God kväll, {name}'],
  ['{time} driving left', '{time} kjøretid igjen', '{time} körtid kvar'],
  ['ADR valid to {date}', 'ADR gyldig til {date}', 'ADR giltigt till {date}'],
  ['No trip yet', 'Ingen tur ennå', 'Ingen tur än'],
  ['New trip', 'Ny tur', 'Ny tur'],
  ['New trip · not confirmed', 'Ny tur · ikke bekreftet', 'Ny tur · inte bekräftad'],
  ['Confirmed · pre-trip check', 'Bekreftet · avgangskontroll', 'Bekräftad · avgångskontroll'],
  ['Completed', 'Fullført', 'Klar'],
  ['In progress', 'Pågår', 'Pågår'],
  ['No trip sent to you yet', 'Ingen tur er sendt til deg ennå', 'Ingen tur har skickats till dig än'],
  ['Planning sends your trip to this tablet when it is dispatched.', 'Disponenten sender turen til nettbrettet når den er klar.', 'Trafikledningen skickar turen till surfplattan när den är klar.'],
  ['{n} deliveries today', '{n} leveringer i dag', '{n} leveranser i dag'],
  ['{n} deliveries', '{n} leveringer', '{n} leveranser'],
  ['Load at {site}', 'Last på {site}', 'Lasta vid {site}'],
  ['Verify the load at {site}', 'Kontroller lasten på {site}', 'Kontrollera lasten vid {site}'],
  ['Next: {site}', 'Neste: {site}', 'Nästa: {site}'],
  ['Return to {site}', 'Tilbake til {site}', 'Tillbaka till {site}'],
  ['All {n} deliveries done', 'Alle {n} leveringer utført', 'Alla {n} leveranser klara'],
  ['Review trip', 'Se gjennom turen', 'Granska turen'],
  ['Open trip', 'Åpne turen', 'Öppna turen'],
  ['View trip', 'Vis turen', 'Visa turen'],
  ['Continue trip', 'Fortsett turen', 'Fortsätt turen'],
  ['Start', 'Start', 'Start'],
  ['Back', 'Tilbake', 'Tillbaka'],
  ['Distance', 'Distanse', 'Sträcka'],
  ['Sent', 'Sendt', 'Skickad'],
  ['Finished', 'Ferdig', 'Klar'],
  ['Delivered', 'Levert', 'Levererat'],
  ['Planned arrival', 'Planlagt ankomst', 'Planerad ankomst'],
  ['Driving left', 'Kjøretid igjen', 'Körtid kvar'],
  ['Deliveries', 'Leveringer', 'Leveranser'],
  ['Load', 'Last', 'Last'],
  ['1 issue reported to planning', '1 avvik meldt til disponent', '1 avvikelse rapporterad till trafikledningen'],
  ['{n} issues reported to planning', '{n} avvik meldt til disponent', '{n} avvikelser rapporterade till trafikledningen'],
  ['Later', 'Senere', 'Senare'],
  ['from {time}', 'fra {time}', 'från {time}'],
  ['Planned · not sent yet', 'Planlagt · ikke sendt ennå', 'Planerad · inte skickad än'],

  // ---- trip: stops
  ['{done} of {n} delivered', '{done} av {n} levert', '{done} av {n} levererade'],
  ['Pre-trip check done · {time}', 'Avgangskontroll utført · {time}', 'Avgångskontroll klar · {time}'],
  ['Trip completed · {time}', 'Tur fullført · {time}', 'Tur klar · {time}'],
  ['Loaded · e-CMR issued {time}', 'Lastet · e-CMR utstedt {time}', 'Lastad · e-CMR utfärdad {time}'],
  ['Loaded · verify manifest', 'Lastet · kontroller lasten', 'Lastad · kontrollera lasten'],
  ['Arrive {time}', 'Ankomst {time}', 'Ankomst {time}'],
  ['Issue or quantity difference', 'Avvik eller mengdeforskjell', 'Avvikelse eller mängdskillnad'],
  ['Delivery {n} of {total}', 'Levering {n} av {total}', 'Leverans {n} av {total}'],
  ['Loading', 'Lasting', 'Lastning'],
  ['Trip start', 'Turstart', 'Turstart'],
  ['Trip end', 'Turslutt', 'Turslut'],
  ['Departure', 'Avgang', 'Avgång'],
  ['Delivery window', 'Leveringsvindu', 'Leveransfönster'],
  ['Navigate', 'Naviger', 'Navigera'],
  ['Call', 'Ring', 'Ring'],
  ['No pump on site: use the truck pump and meter', 'Ingen pumpe på stedet: bruk bilens pumpe og måler', 'Ingen pump på plats: använd bilens pump och mätare'],
  ['No pump on site: use the truck pump', 'Ingen pumpe på stedet: bruk bilens pumpe', 'Ingen pump på plats: använd bilens pump'],
  ['about {min} min', 'ca. {min} min', 'ca {min} min'],
  ['reported {time}, planning notified', 'meldt {time}, disponent varslet', 'rapporterad {time}, trafikledningen meddelad'],
  ['planning notified', 'disponent varslet', 'trafikledningen meddelad'],
  ['Site information', 'Informasjon om stedet', 'Information om platsen'],
  ['Opening hours', 'Åpningstider', 'Öppettider'],
  ['Open 24 hours', 'Åpent hele døgnet', 'Öppet dygnet runt'],
  ['Vehicle length', 'Vogntoglengde', 'Ekipagelängd'],
  ['Max {max} m · yours {yours} m', 'Maks {max} m · ditt {yours} m', 'Max {max} m · ditt {yours} m'],
  ['Tanks', 'Tanker', 'Tankar'],
  ['Class 3 · {uns} · tunnel D/E', 'Klasse 3 · {uns} · tunnel D/E', 'Klass 3 · {uns} · tunnel D/E'],
  ['Terminal rules', 'Terminalregler', 'Terminalregler'],
  ['{km} km from previous stop', '{km} km fra forrige stopp', '{km} km från föregående stopp'],
  ['Time on site', 'Tid på stedet', 'Tid på plats'],
  ['Customer ref.', 'Kundens ref.', 'Kundens ref.'],
  ['Your trip', 'Din tur', 'Din tur'],
  ['End of trip', 'Slutt på turen', 'Turens slut'],
  ['Planned', 'Planlagt', 'Planerat'],
  ['Vehicle', 'Kjøretøy', 'Fordon'],
  ['Pre-trip check', 'Avgangskontroll', 'Avgångskontroll'],
  ['All groups OK · {time}', 'Alle grupper OK · {time}', 'Alla grupper OK · {time}'],
  ['Check the stops on the left, then confirm the trip below.', 'Se over stoppene til venstre, og bekreft turen nedenfor.', 'Gå igenom stoppen till vänster och bekräfta turen nedan.'],
  ['Deliver', 'Lever', 'Leverera'],
  ['{qty} L total', '{qty} L totalt', '{qty} L totalt'],
  ['loaded at 15 °C', 'lastet ved 15 °C', 'lastat vid 15 °C'],
  ['Compartment {no} · order {order}', 'Kammer {no} · ordre {order}', 'Fack {no} · order {order}'],
  ['Compartment details', 'Kammerdetaljer', 'Fackdetaljer'],
  ['{n} compartments', '{n} kammer', '{n} fack'],
  ['for {site}', 'til {site}', 'till {site}'],
  ['Order {order}', 'Ordre {order}', 'Order {order}'],
  ['order {order}', 'ordre {order}', 'order {order}'],
  ['Trailer {reg} · {n} compartments', 'Tilhenger {reg} · {n} kammer', 'Släp {reg} · {n} fack'],
  ['Loaded at 15 °C', 'Lastet ved 15 °C', 'Lastat vid 15 °C'],
  ['{qty} L at {temp} °C', '{qty} L ved {temp} °C', '{qty} L vid {temp} °C'],
  ['e-CMR issued {time} · manifest verified', 'e-CMR utstedt {time} · last kontrollert', 'e-CMR utfärdad {time} · last kontrollerad'],
  ['e-CMR not issued yet', 'e-CMR er ikke utstedt ennå', 'e-CMR är inte utfärdad än'],
  ['Verify the manifest to issue it', 'Kontroller lasten for å utstede den', 'Kontrollera lasten för att utfärda den'],
  ['View e-CMR', 'Vis e-CMR', 'Visa e-CMR'],
  ['POD {time}', 'Kvittert {time}', 'Kvitterad {time}'],
  ['Meter ticket {no}', 'Målerutskrift {no}', 'Mätarkvitto {no}'],
  ['{diff} L ({pct}) vs loaded', '{diff} L ({pct}) mot lastet', '{diff} L ({pct}) mot lastat'],
  ['Extra operations', 'Tilleggstjenester', 'Tilläggstjänster'],
  ['Billable', 'Fakturerbar', 'Debiterbar'],
  ['Proof of delivery', 'Leveringsbevis', 'Leveransbevis'],
  ['Signed by {name}', 'Signert av {name}', 'Signerad av {name}'],
  ['Photo, no receiver on site', 'Foto, ingen mottaker på stedet', 'Foto, ingen mottagare på plats'],

  // ---- trip completed
  ['Invoice started → reconciliation', 'Fakturering startet → avstemming', 'Fakturering påbörjad → avstämning'],
  ['Trip completed {time}. Delivery data, e-CMR and PODs are with back office. Nothing to hand in.', 'Turen ble fullført {time}. Leveringsdata, e-CMR og leveringsbevis er hos kontoret. Ingenting å levere inn.', 'Turen avslutades {time}. Leveransdata, e-CMR och leveransbevis finns hos kontoret. Inget att lämna in.'],
  ['After the trip', 'Etter turen', 'Efter turen'],
  ['{done} of {n} deliveries signed', '{done} av {n} leveringer kvittert', '{done} av {n} leveranser kvitterade'],
  ['Trip completed', 'Tur fullført', 'Tur klar'],
  ['Invoice started', 'Fakturering startet', 'Fakturering påbörjad'],
  ['Reconciliation', 'Avstemming', 'Avstämning'],
  ['Back office', 'Kontoret', 'Kontoret'],
  ['Waybill', 'Fraktbrev', 'Fraktsedel'],
  ['{km} km planned', '{km} km planlagt', '{km} km planerat'],

  // ---- action bar
  ['No trip assigned', 'Ingen tur tildelt', 'Ingen tur tilldelad'],
  ['Review your trip, then confirm', 'Se gjennom turen og bekreft', 'Granska turen och bekräfta'],
  ['Confirm trip', 'Bekreft tur', 'Bekräfta tur'],
  ['Before departure', 'Før avgang', 'Före avgång'],
  ['Pre-trip check at {site}', 'Avgangskontroll på {site}', 'Avgångskontroll vid {site}'],
  ['Depart {time}', 'Avgang {time}', 'Avgång {time}'],
  ['Start pre-trip check', 'Start avgangskontroll', 'Starta avgångskontroll'],
  ['Register loading', 'Registrer lasting', 'Registrera lastning'],
  ['Verify the load, then issue the e-CMR', 'Kontroller lasten og utsted e-CMR', 'Kontrollera lasten och utfärda e-CMR'],
  ['Verify manifest', 'Kontroller lasten', 'Kontrollera lasten'],
  ['Deliver at {site}', 'Lever på {site}', 'Leverera vid {site}'],
  ['Planned arrival {time}', 'Planlagt ankomst {time}', 'Planerad ankomst {time}'],
  ['Start delivery', 'Start levering', 'Starta leverans'],
  ['All deliveries done', 'Alle leveringer utført', 'Alla leveranser klara'],
  ['Finish trip', 'Avslutt tur', 'Avsluta tur'],
  ['Finished {time}', 'Ferdig {time}', 'Klar {time}'],
  ['Back to my trips', 'Tilbake til mine turer', 'Tillbaka till mina turer'],
  ['Report issue', 'Meld avvik', 'Rapportera avvikelse'],
  ['Call the site manager 30 min before arrival', 'Ring anleggslederen 30 min før ankomst', 'Ring platschefen 30 min före ankomst'],

  // ---- pre-trip check
  ['Pre-trip safety check', 'Sikkerhetskontroll før avgang', 'Säkerhetskontroll före avgång'],
  ['{truck} + {trailer} · checklist for this vehicle and cargo', '{truck} + {trailer} · sjekkliste for dette kjøretøyet og lasten', '{truck} + {trailer} · checklista för detta fordon och denna last'],
  ['{done} of {n} checked', '{done} av {n} kontrollert', '{done} av {n} kontrollerade'],
  ['Complete check', 'Fullfør kontrollen', 'Slutför kontrollen'],
  ['ADR equipment', 'ADR-utstyr', 'ADR-utrustning'],
  ['Documents on board', 'Dokumenter om bord', 'Dokument ombord'],
  ['Tyres and wheel nuts', 'Dekk og hjulmuttere', 'Däck och hjulmuttrar'],
  ['Lights and indicators', 'Lys og blinklys', 'Lampor och körriktningsvisare'],
  ['Brakes and air pressure', 'Bremser og lufttrykk', 'Bromsar och lufttryck'],
  ['Mirrors, windscreen and wipers', 'Speil, frontrute og vindusviskere', 'Speglar, vindruta och torkare'],
  ['Tachograph card inserted', 'Sjåførkort i fartsskriveren', 'Förarkort i färdskrivaren'],
  ['Fire extinguishers: 2, sealed and in date', 'Brannslukkere: 2, plombert og kontrollert', 'Brandsläckare: 2, plomberade och kontrollerade'],
  ['Wheel chock', 'Hjulkloss', 'Stoppkloss'],
  ['Two self-standing warning signs', 'To frittstående varselskilt', 'Två fristående varningsskyltar'],
  ['Eye rinsing liquid', 'Øyeskyllevæske', 'Ögonsköljvätska'],
  ['Spill kit: drain seal, shovel, collecting container', 'Spillutstyr: kumtetting, spade, oppsamlingsbeholder', 'Saneringsutrustning: brunnstätning, spade, uppsamlingskärl'],
  ['Orange plates with hazard ID and UN number', 'Oransje skilt med farenummer og UN-nummer', 'Orange skyltar med farlighetsnummer och UN-nummer'],
  ['Earthing cable', 'Jordingskabel', 'Jordningskabel'],
  ['Hoses and couplings', 'Slanger og koblinger', 'Slangar och kopplingar'],
  ['Pressure gauge reading normal', 'Manometeret viser normalt', 'Manometern visar normalt'],
  ['Valves and emergency shut-off tested', 'Ventiler og nødstopp testet', 'Ventiler och nödstopp testade'],
  ['Cryogenic gloves and face shield', 'Kryohansker og ansiktsskjerm', 'Kryohandskar och ansiktsskydd'],
  ['ADR driver training certificate', 'ADR-kompetansebevis', 'ADR-intyg för föraren'],
  ['Instructions in writing (ADR 5.4.3)', 'Skriftlige instrukser (ADR 5.4.3)', 'Skriftliga instruktioner (ADR 5.4.3)'],
  ['ADR certificate of approval for the vehicle', 'ADR-godkjenningsattest for kjøretøyet', 'ADR-godkännandeintyg för fordonet'],
  ['Fuel tank (ADR FL)', 'Drivstofftank (ADR FL)', 'Bränsletank (ADR FL)'],
  ['Aviation tank (dedicated)', 'Flydrivstofftank (dedikert)', 'Flygbränsletank (dedikerad)'],
  ['LPG pressure tank', 'LPG-trykktank', 'Gasoltrycktank'],
  ['Cryogenic tank', 'Kryotank', 'Kryotank'],

  // ---- loading at 15 °C
  ['Quantities from the gantry bill of lading {bol}. Check them against the printed BOL.', 'Mengder fra lasteseddelen {bol}. Kontroller dem mot den utskrevne lasteseddelen.', 'Mängder från lastsedeln {bol}. Kontrollera dem mot den utskrivna lastsedeln.'],
  ['Standard litres at 15 °C (ASTM D1250 / ISO 91)', 'Standardliter ved 15 °C (ASTM D1250 / ISO 91)', 'Standardliter vid 15 °C (ASTM D1250 / ISO 91)'],
  ['Confirm loaded quantities', 'Bekreft lastede mengder', 'Bekräfta lastade mängder'],
  ['Loaded quantities', 'Lastede mengder', 'Lastade mängder'],
  ['Comp.', 'Kammer', 'Fack'],
  ['Product', 'Produkt', 'Produkt'],
  ['Observed', 'Målt', 'Uppmätt'],
  ['Temp.', 'Temp.', 'Temp.'],
  ['At 15 °C', 'Ved 15 °C', 'Vid 15 °C'],
  ['Observed C{no}', 'Målt C{no}', 'Uppmätt C{no}'],
  ['Temperature C{no}', 'Temperatur C{no}', 'Temperatur C{no}'],
  ['weigh-in', 'veiing', 'vägning'],

  // ---- manifest, e-CMR
  ['Verify the load', 'Kontroller lasten', 'Kontrollera lasten'],
  ['Manifest check at {site}. The e-CMR is issued when everything matches.', 'Lastkontroll på {site}. e-CMR utstedes når alt stemmer.', 'Lastkontroll vid {site}. e-CMR utfärdas när allt stämmer.'],
  ['Report mismatch', 'Meld avvik', 'Rapportera avvikelse'],
  ['Confirm and issue e-CMR', 'Bekreft og utsted e-CMR', 'Bekräfta och utfärda e-CMR'],
  ['Manifest', 'Lastkontroll', 'Lastkontroll'],
  ['Loaded', 'Lastet', 'Lastat'],
  ['Product in each compartment matches the order', 'Produktet i hvert kammer stemmer med ordren', 'Produkten i varje fack stämmer med ordern'],
  ['Quantities match the loading document (BOL)', 'Mengdene stemmer med lasteseddelen (BOL)', 'Mängderna stämmer med lastsedeln (BOL)'],
  ['Compartments and valves closed and sealed', 'Kammer og ventiler lukket og plombert', 'Fack och ventiler stängda och plomberade'],
  ['ADR transport document on board', 'ADR-transportdokument om bord', 'ADR-transporthandling ombord'],
  ['Instructions in writing on board', 'Skriftlige instrukser om bord', 'Skriftliga instruktioner ombord'],
  ['Electronic consignment note {no}', 'Elektronisk fraktbrev {no}', 'Elektronisk fraktsedel {no}'],
  ['Electronic consignment note · international carriage of goods by road', 'Elektronisk fraktbrev · internasjonal godstransport på vei', 'Elektronisk fraktsedel · internationell godstransport på väg'],
  ['Issued {time}', 'Utstedt {time}', 'Utfärdad {time}'],
  ['Sender (consignor)', 'Avsender', 'Avsändare'],
  ['Carrier', 'Transportør', 'Transportör'],
  ['Consignee', 'Mottaker', 'Mottagare'],
  ['Vehicle / driver', 'Kjøretøy / sjåfør', 'Fordon / förare'],
  ['Place of delivery', 'Leveringssted', 'Leveransplats'],
  ['Place and date of taking over', 'Sted og dato for mottak', 'Plats och datum för mottagande'],
  ['6–9 Goods (ADR 5.4.1.1.1)', '6–9 Gods (ADR 5.4.1.1.1)', '6–9 Gods (ADR 5.4.1.1.1)'],
  ['11–12 Quantity', '11–12 Mengde', '11–12 Mängd'],
  ['Signature of sender', 'Avsenders underskrift', 'Avsändarens underskrift'],
  ['Signature of carrier', 'Transportørens underskrift', 'Transportörens underskrift'],
  ['Goods received', 'Gods mottatt', 'Gods mottaget'],

  // ---- delivery, POD
  ['{qty} L15 delivered', '{qty} L15 levert', '{qty} L15 levererat'],
  ['Received from the truck meter {time} · temperature-compensated', 'Mottatt fra bilens måler {time} · temperaturkompensert', 'Mottaget från bilens mätare {time} · temperaturkompenserat'],
  ['Tap what you did. Billed to the customer by contract.', 'Trykk på det du har gjort. Faktureres kunden etter avtale.', 'Tryck på det du har gjort. Debiteras kunden enligt avtal.'],
  ['Meter: {qty} {unit}', 'Måler: {qty} {unit}', 'Mätare: {qty} {unit}'],
  ['Truck pump', 'Bilpumpe', 'Bilpump'],
  ['Pumping time', 'Pumpetid', 'Pumptid'],
  ['Extra hose', 'Ekstra slange', 'Extra slang'],
  ['Over 30 m', 'Over 30 m', 'Över 30 m'],
  ['Tank dip', 'Peiling', 'Pejling'],
  ['Manual dip', 'Manuell peiling av tanken', 'Manuell pejling av tanken'],
  ['Sign off delivery', 'Kvitter levering', 'Kvittera leverans'],
  ['Receiver signs', 'Mottaker signerer', 'Mottagaren signerar'],
  ['No receiver on site', 'Ingen mottaker på stedet', 'Ingen mottagare på plats'],
  ['Receiver name', 'Mottakers navn', 'Mottagarens namn'],
  ['Signature pad', 'Signaturfelt', 'Signaturfält'],
  ['Signature captured', 'Signatur registrert', 'Signatur registrerad'],
  ['Receiver signs with a finger in the box', 'Mottaker signerer med fingeren i feltet', 'Mottagaren signerar med fingret i rutan'],
  ['Clear', 'Tøm', 'Rensa'],
  ['Unattended delivery: take a photo of the tank and fill point after filling.', 'Levering uten mottaker: ta bilde av tanken og påfyllingspunktet etter fylling.', 'Leverans utan mottagare: fotografera tanken och påfyllningspunkten efter påfyllning.'],
  ['Photo of tank and fill point', 'Bilde av tank og påfyllingspunkt', 'Foto av tank och påfyllningspunkt'],
  ['Retake', 'Ta nytt bilde', 'Ta om'],
  ['Stored with the POD', 'Lagres med leveringsbeviset', 'Sparas med leveransbeviset'],
  ['Orders', 'Ordrer', 'Order'],
  ['Time · GPS', 'Tid · GPS', 'Tid · GPS'],

  // ---- issues
  ['Report an issue', 'Meld et avvik', 'Rapportera en avvikelse'],
  ['At {site}. Planning is notified and the issue is shown on the stop.', 'På {site}. Disponenten varsles, og avviket vises på stoppet.', 'Vid {site}. Trafikledningen meddelas och avvikelsen visas på stoppet.'],
  ['Send to planning', 'Send til disponent', 'Skicka till trafikledningen'],
  ['Reported {time}', 'Meldt {time}', 'Rapporterad {time}'],
  ['Expected wait', 'Forventet ventetid', 'Förväntad väntetid'],
  ['Describe the issue (required)', 'Beskriv avviket (påkrevd)', 'Beskriv avvikelsen (obligatoriskt)'],
  ['Add a note for planning (optional)', 'Legg til et notat til disponenten (valgfritt)', 'Lägg till en kommentar till trafikledningen (valfritt)'],
  ['Queue at terminal', 'Kø på terminalen', 'Kö vid terminalen'],
  ['Trucks ahead at the loading gantry', 'Biler foran ved lasteplassen', 'Bilar före vid lastplatsen'],
  ['Cannot access site', 'Kommer ikke frem', 'Kommer inte fram'],
  ['Road closed, gate locked, no room for the truck', 'Veien stengt, porten låst, ikke plass til bilen', 'Vägen avstängd, grinden låst, ingen plats för bilen'],
  ['Quantity differs', 'Avvik i mengde', 'Avvikande mängd'],
  ['Loaded or delivered quantity is not as planned', 'Lastet eller levert mengde er ikke som planlagt', 'Lastad eller levererad mängd är inte som planerat'],
  ['Customer not ready', 'Kunden er ikke klar', 'Kunden är inte redo'],
  ['Waiting on site before unloading can start', 'Venter på stedet før lossing kan starte', 'Väntar på plats innan lossningen kan börja'],
  ['Delivery refused', 'Levering avvist', 'Leverans nekad'],
  ['Receiver refuses all or part of the delivery', 'Mottaker avviser hele eller deler av leveringen', 'Mottagaren nekar hela eller delar av leveransen'],
  ['Other issue', 'Annet avvik', 'Annan avvikelse'],
  ['Anything else planning should know', 'Alt annet disponenten bør vite', 'Allt annat trafikledningen bör veta'],

  // ---- task views: level 1 trip progress, level 2 task progress, navigation
  ['Trip progress', 'Turforløp', 'Turförlopp'],
  ['Task progress', 'Oppgaveforløp', 'Uppgiftsförlopp'],
  ['Delivery {n}', 'Levering {n}', 'Leverans {n}'],
  ['Return to depot', 'Tilbake til depot', 'Tillbaka till depån'],
  ['{task} · depart {time}', '{task} · avgang {time}', '{task} · avgång {time}'],
  ['{task} · arrive {time}', '{task} · ankomst {time}', '{task} · ankomst {time}'],
  ['{task} · arrive {time} · window {window}', '{task} · ankomst {time} · tidsvindu {window}', '{task} · ankomst {time} · tidsfönster {window}'],
  ['{task} · POD {time}', '{task} · kvittert {time}', '{task} · kvitterad {time}'],
  ['Checklist', 'Sjekkliste', 'Checklista'],
  ['Confirmation', 'Bekreftelse', 'Bekräftelse'],
  ['Enter quantities', 'Registrer mengder', 'Registrera mängder'],
  ['e-CMR', 'e-CMR', 'e-CMR'],
  ['Delivered quantity', 'Levert mengde', 'Levererad mängd'],
  ['Complete', 'Fullført', 'Klar'],
  ['Continue', 'Fortsett', 'Fortsätt'],
  ['Back to trip', 'Tilbake til turen', 'Tillbaka till turen'],
  ['Confirm the pre-trip check', 'Bekreft avgangskontrollen', 'Bekräfta avgångskontrollen'],
  ['Completed {time}', 'Fullført {time}', 'Klar {time}'],
  ['Your confirmation is recorded with the trip and the time.', 'Bekreftelsen lagres med turen og tidspunktet.', 'Bekräftelsen sparas med turen och tidpunkten.'],
  ['{done} of {n} OK', '{done} av {n} OK', '{done} av {n} OK'],
  ['Checked by', 'Kontrollert av', 'Kontrollerad av'],
  ['Truck and trailer', 'Bil og henger', 'Bil och släp'],
  ['Trip overview', 'Turoversikt', 'Turöversikt'],
  ['View check', 'Vis kontrollen', 'Visa kontrollen'],
  ['Delivery summary', 'Leveringssammendrag', 'Leveranssammanfattning'],
  ['Register loaded quantities', 'Registrer lastede mengder', 'Registrera lastade mängder'],
  ['Recorded {time}', 'Registrert {time}', 'Registrerad {time}'],
  ['{qty} L15 total', '{qty} L15 totalt', '{qty} L15 totalt'],
  ['Verified {time}', 'Kontrollert {time}', 'Kontrollerad {time}'],
  ['Total', 'Totalt', 'Totalt'],
  ['Difference', 'Avvik', 'Avvikelse'],
  ['No extra operations', 'Ingen tilleggstjenester', 'Inga tilläggstjänster'],
  ['Not done', 'Ikke utført', 'Inte utfört'],
  ['Ready to sign off', 'Klar til kvittering', 'Redo att kvittera'],
  ['Delivery complete', 'Levering fullført', 'Leverans klar'],
  ['Signed off {time} · delivery data sent to back office', 'Kvittert {time} · leveringsdata sendt til kontoret', 'Kvitterad {time} · leveransdata skickad till kontoret'],
  ['Delivery {n} of {total} done', 'Levering {n} av {total} utført', 'Leverans {n} av {total} klar'],
];

const DICT = { nb: new Map(TEXTS.map(([en, nb]) => [en, nb])), sv: new Map(TEXTS.map(([en, , sv]) => [en, sv])) };

// Date patterns per language (Norwegian writes the day with a full stop: "2. desember").
const DATES = {
  en: { long: 'dddd D MMMM', day: 'ddd D MMM', dayTime: 'D MMM, HH:mm', monthYear: 'MMM YYYY' },
  nb: { long: 'dddd D. MMMM', day: 'ddd D. MMM', dayTime: 'D. MMM HH:mm', monthYear: 'MMM YYYY' },
  sv: { long: 'dddd D MMMM', day: 'ddd D MMM', dayTime: 'D MMM HH:mm', monthYear: 'MMM YYYY' },
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// t(text, vars) for a language code ('en' | 'nb' | 'sv'), with formatting helpers attached.
export function translator(code) {
  const lang = LANGS.find((l) => l.code === code) || LANGS[0];
  const dict = DICT[lang.code];
  const t = (text, vars) => {
    const s = dict?.get(text) ?? text;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
  };
  const date = (iso, kind) => (iso ? cap(D(iso).locale(lang.dayjs).format(DATES[lang.code][kind])) : '-');
  t.lang = lang.code;
  t.num = (n, digits = 0) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '-' : Number(n).toLocaleString(lang.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  t.longDate = (iso) => date(iso, 'long');
  t.day = (iso) => date(iso, 'day');
  t.dayTime = (iso) => date(iso, 'dayTime');
  t.monthYear = (iso) => date(iso, 'monthYear');
  t.dur = (min) => {
    if (min === null || min === undefined) return '-';
    const m = Math.round(Math.abs(min));
    const h = Math.floor(m / 60);
    const r = String(m % 60).padStart(2, '0');
    if (lang.code === 'en') return h ? `${h}h ${r}m` : `${m % 60}m`;
    const hu = lang.code === 'nb' ? 't' : 'h';
    return h ? `${h} ${hu} ${r} min` : `${m % 60} min`;
  };
  return t;
}
