export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
}

export const AIRPORTS: Airport[] = [
  // ── Brasil ───────────────────────────────────────────────────────────────────
  { iata: "GRU", name: "Guarulhos Intl", city: "São Paulo", country: "BR" },
  { iata: "CGH", name: "Congonhas", city: "São Paulo", country: "BR" },
  { iata: "VCP", name: "Viracopos", city: "Campinas", country: "BR" },
  { iata: "GIG", name: "Galeão Intl", city: "Rio de Janeiro", country: "BR" },
  { iata: "SDU", name: "Santos Dumont", city: "Rio de Janeiro", country: "BR" },
  { iata: "BSB", name: "Presidente JK Intl", city: "Brasília", country: "BR" },
  { iata: "SSA", name: "Deputado Luís Eduardo Magalhães", city: "Salvador", country: "BR" },
  { iata: "FOR", name: "Pinto Martins Intl", city: "Fortaleza", country: "BR" },
  { iata: "REC", name: "Guararapes Intl", city: "Recife", country: "BR" },
  { iata: "POA", name: "Salgado Filho Intl", city: "Porto Alegre", country: "BR" },
  { iata: "CWB", name: "Afonso Pena Intl", city: "Curitiba", country: "BR" },
  { iata: "BEL", name: "Val de Cans Intl", city: "Belém", country: "BR" },
  { iata: "MAO", name: "Eduardo Gomes Intl", city: "Manaus", country: "BR" },
  { iata: "NAT", name: "Augusto Severo Intl", city: "Natal", country: "BR" },
  { iata: "MCZ", name: "Zumbi dos Palmares", city: "Maceió", country: "BR" },
  { iata: "AJU", name: "Santa Maria", city: "Aracaju", country: "BR" },
  { iata: "THE", name: "Petrônio Portela", city: "Teresina", country: "BR" },
  { iata: "GYN", name: "Santa Genoveva", city: "Goiânia", country: "BR" },
  { iata: "CGR", name: "Campo Grande Intl", city: "Campo Grande", country: "BR" },
  { iata: "CGB", name: "Marechal Rondon Intl", city: "Cuiabá", country: "BR" },
  { iata: "FLN", name: "Hercílio Luz Intl", city: "Florianópolis", country: "BR" },
  { iata: "VIX", name: "Eurico de Aguiar Salles", city: "Vitória", country: "BR" },
  // ── Europa — Hubs transatlânticos ────────────────────────────────────────────
  { iata: "MAD", name: "Adolfo Suárez Barajas", city: "Madrid", country: "ES" },
  { iata: "LIS", name: "Humberto Delgado", city: "Lisboa", country: "PT" },
  { iata: "CDG", name: "Charles de Gaulle", city: "Paris", country: "FR" },
  { iata: "AMS", name: "Schiphol", city: "Amsterdam", country: "NL" },
  { iata: "FCO", name: "Leonardo da Vinci", city: "Roma", country: "IT" },
  { iata: "MXP", name: "Malpensa", city: "Milão", country: "IT" },
  { iata: "LHR", name: "Heathrow", city: "Londres", country: "GB" },
  { iata: "FRA", name: "Frankfurt Intl", city: "Frankfurt", country: "DE" },
  { iata: "MUC", name: "Franz Josef Strauss", city: "Munique", country: "DE" },
  { iata: "ZRH", name: "Zurique Kloten", city: "Zurique", country: "CH" },
  // ── Europa — Destinos ────────────────────────────────────────────────────────
  { iata: "BCN", name: "El Prat", city: "Barcelona", country: "ES" },
  { iata: "SVQ", name: "San Pablo", city: "Sevilha", country: "ES" },
  { iata: "AGP", name: "Costa del Sol", city: "Málaga", country: "ES" },
  { iata: "VLC", name: "Manises", city: "Valência", country: "ES" },
  { iata: "OPO", name: "Francisco Sá Carneiro", city: "Porto", country: "PT" },
  { iata: "FAO", name: "Faro", city: "Faro", country: "PT" },
  { iata: "ORY", name: "Orly", city: "Paris", country: "FR" },
  { iata: "NCE", name: "Côte d'Azur", city: "Nice", country: "FR" },
  { iata: "LYS", name: "Saint-Exupéry", city: "Lyon", country: "FR" },
  { iata: "MRS", name: "Provence", city: "Marselha", country: "FR" },
  { iata: "VCE", name: "Marco Polo", city: "Veneza", country: "IT" },
  { iata: "NAP", name: "Capodichino", city: "Nápoles", country: "IT" },
  { iata: "LIN", name: "Linate", city: "Milão", country: "IT" },
  { iata: "BGY", name: "Bergamo Orio al Serio", city: "Bérgamo", country: "IT" },
  { iata: "PMO", name: "Falcone–Borsellino", city: "Palermo", country: "IT" },
  { iata: "LGW", name: "Gatwick", city: "Londres", country: "GB" },
  { iata: "STN", name: "Stansted", city: "Londres", country: "GB" },
  { iata: "EDI", name: "Edinburgh", city: "Edimburgo", country: "GB" },
  { iata: "BHX", name: "Birmingham", city: "Birmingham", country: "GB" },
  { iata: "MAN", name: "Manchester", city: "Manchester", country: "GB" },
  { iata: "DUB", name: "Dublin", city: "Dublin", country: "IE" },
  { iata: "BRU", name: "Brussels", city: "Bruxelas", country: "BE" },
  { iata: "ATH", name: "Eleftherios Venizelos", city: "Atenas", country: "GR" },
  { iata: "HER", name: "Nikos Kazantzakis", city: "Heraklion", country: "GR" },
  { iata: "SKG", name: "Makedonia", city: "Tessalônica", country: "GR" },
  { iata: "RHO", name: "Diagoras", city: "Rodes", country: "GR" },
  { iata: "CFU", name: "Ioannis Kapodistrias", city: "Corfu", country: "GR" },
  { iata: "VIE", name: "Wien Schwechat", city: "Viena", country: "AT" },
  { iata: "PRG", name: "Václav Havel", city: "Praga", country: "CZ" },
  { iata: "BUD", name: "Ferenc Liszt Intl", city: "Budapeste", country: "HU" },
  { iata: "WAW", name: "Chopin", city: "Varsóvia", country: "PL" },
  { iata: "KRK", name: "Balice", city: "Cracóvia", country: "PL" },
  { iata: "CPH", name: "Kastrup", city: "Copenhague", country: "DK" },
  { iata: "ARN", name: "Arlanda", city: "Estocolmo", country: "SE" },
  { iata: "OSL", name: "Gardermoen", city: "Oslo", country: "NO" },
  { iata: "HEL", name: "Vantaa", city: "Helsinque", country: "FI" },
  { iata: "DUS", name: "Düsseldorf Intl", city: "Düsseldorf", country: "DE" },
  { iata: "HAM", name: "Hamburg Intl", city: "Hamburgo", country: "DE" },
  { iata: "BER", name: "Brandenburg", city: "Berlim", country: "DE" },
  { iata: "TXL", name: "Tegel", city: "Berlim", country: "DE" },
  { iata: "STR", name: "Stuttgart", city: "Stuttgart", country: "DE" },
  { iata: "GVA", name: "Genebra Cointrin", city: "Genebra", country: "CH" },
  { iata: "BSL", name: "EuroAirport", city: "Basileia", country: "CH" },
  { iata: "LJU", name: "Jože Pučnik", city: "Liubliana", country: "SI" },
  { iata: "ZAG", name: "Franjo Tuđman", city: "Zagreb", country: "HR" },
  { iata: "SPU", name: "Split", city: "Split", country: "HR" },
  { iata: "DBV", name: "Čilipi", city: "Dubrovnik", country: "HR" },
  { iata: "SOF", name: "Sofia", city: "Sofia", country: "BG" },
  { iata: "OTP", name: "Henri Coandă", city: "Bucareste", country: "RO" },
  { iata: "BEG", name: "Nikola Tesla", city: "Belgrado", country: "RS" },
  { iata: "SKP", name: "Aleksandar Veliki", city: "Skopje", country: "MK" },
  { iata: "TIA", name: "Nënë Tereza", city: "Tirana", country: "AL" },
  { iata: "LCA", name: "Larnaca Intl", city: "Larnaca", country: "CY" },
  { iata: "TLV", name: "Ben Gurion", city: "Tel Aviv", country: "IL" },
  { iata: "IST", name: "Istanbul", city: "Istambul", country: "TR" },
  { iata: "SAW", name: "Sabiha Gökçen", city: "Istambul", country: "TR" },
  { iata: "AYT", name: "Antalya", city: "Antalya", country: "TR" },
];

export function searchAirports(query: string, limit = 8): Airport[] {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase().trim();
  const results: Array<{ airport: Airport; score: number }> = [];

  for (const a of AIRPORTS) {
    const iata = a.iata.toLowerCase();
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();
    const country = a.country.toLowerCase();

    let score = 0;
    if (iata === q) score = 100;
    else if (iata.startsWith(q)) score = 80;
    else if (city.startsWith(q)) score = 70;
    else if (city.includes(q)) score = 50;
    else if (name.includes(q)) score = 30;
    else if (country === q) score = 20;
    else continue;

    results.push({ airport: a, score });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.airport);
}
