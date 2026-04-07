const PSA_API_BASE = 'https://api.psacard.com/publicapi';

export interface PSACert {
  CertNumber: string;
  SpecID: number;
  SpecNumber: string;
  LabelType: string;
  Year: string;
  Brand: string;
  Category: string;
  CardNumber: string;
  Subject: string;
  Variety: string;
  IsPSADNA: boolean;
  IsDualCert: boolean;
  GradeDescription: string;
  CardGrade: string;
  TotalPopulation: number;
  TotalPopulationWithQualifier: number;
  PopulationHigher: number;
  ItemStatus: string;
}

export interface PSACertResponse {
  PSACert: PSACert;
}

export async function getCertByNumber(certNumber: string): Promise<PSACertResponse> {
  const key = process.env.PSA_API_KEY;
  if (!key) throw new Error('PSA_API_KEY not configured');

  const res = await fetch(`${PSA_API_BASE}/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`, {
    headers: { Authorization: `bearer ${key}` },
    // PSA responses are cacheable — 1 hour is fine
    next: { revalidate: 3600 },
  });

  if (res.status === 404) throw new Error('PSA cert not found');
  if (!res.ok) throw new Error(`PSA API error: ${res.status}`);

  return res.json();
}
