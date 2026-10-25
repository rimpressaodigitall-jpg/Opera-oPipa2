export type TruckStatus = 'IDLE' | 'IN_ROUTE' | 'ARRIVED';
export type DeliveryStatus = 'PENDING' | 'IN_ROUTE' | 'DELIVERED';

export interface Driver {
  id: string;
  name: string;
  phone: string;
  sector?: string; // Setor, sítio ou região de atuação
  address?: string; // Endereço do motorista
  homeSitio?: string; // Local onde mora (Sítio / Povoado / Comunidade)
  homeLat?: number; // Latitude do sítio da residência (capturado via GPS do celular)
  homeLng?: number; // Longitude do sítio da residência (capturado via GPS do celular)
  homeGpsSavedAt?: string; // Data e hora em que a localização GPS foi salva
  homeGpsAccuracy?: number; // Precisão do GPS em metros
}

export interface Truck {
  id: string;
  plate: string;
  driverName: string;
  driverId?: string;
  lastLat?: number;
  lastLng?: number;
  lastUpdate?: string;
  status: TruckStatus;
  sector?: string; // Setor ou região do caminhão/motorista
  driverHomeSitio?: string; // Sítio onde o motorista mora
  driverHomeLat?: number;
  driverHomeLng?: number;
}

export interface Delivery {
  id: string;
  truckId: string;
  residentName: string;
  residentId?: string;
  address: string;
  neighborhood?: string;
  sector?: string; // Setor ou sítio da entrega
  referencePoint: string;
  phone?: string;
  councilman: string;
  status: DeliveryStatus;
  lat: number;
  lng: number;
  createdAt: string;
  photo?: string; // base64 photo for delivery confirmation
}

export interface SitioType_Alias {}

export type SitioType = 'WATER' | 'FUEL' | 'OTHER' | 'SCHOOL' | 'DAYCARE';
export type FuelType = 'DIESEL' | 'GASOLINE' | 'NONE';

export interface Sitio {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  type: SitioType;
  fuelType?: FuelType;
  referencePoint?: string;
}

export interface Resident {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  phone?: string;
  lat?: number;
  lng?: number;
  referencePoint?: string;
  councilman?: string;
  category?: 'RESIDENT' | 'SCHOOL' | 'DAYCARE';
  sector?: string; // Setor do morador
  preferredDriver?: string; // Motorista indicado/vinculado a este morador ou setor
}

export interface AdminConfig {
  password: string;
  updatedAt: string;
}

export interface Councilman {
  id: string;
  name: string;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  role: 'admin' | 'driver';
  name: string;
}

export type FuelLogType = 'DIESEL_S10' | 'DIESEL_COMUM' | 'GASOLINA' | 'ARLA_32';

export interface FuelLog {
  id: string;
  truckId: string;
  plate: string;
  driverName: string;
  sector: string; // Setor atendido pelo caminhão (ex: "Setor 01 - Serra do Meio", "Setor 02 - Promissão", "Sítio Alagoinha", etc.)
  date: string; // Data e hora do abastecimento (ISO string)
  liters: number; // Quantidade de litros abastecidos
  pricePerLiter?: number; // Preço do litro em R$
  totalCost?: number; // Valor total do abastecimento em R$
  fuelType: FuelLogType;
  currentKm: number; // Odômetro / KM atual no momento do abastecimento
  previousKm?: number; // Odômetro do abastecimento anterior
  distanceKm: number; // KM rodados desde o último abastecimento (currentKm - previousKm)
  kmPerLiter: number; // Consumo Médio (km / litro)
  litersPerKm: number; // Consumo em litros por KM (liters / distanceKm)
  costPerKm?: number; // Custo por KM (totalCost / distanceKm)
  gasStation?: string; // Posto de combustível / Fornecedor
  invoiceNumber?: string; // Número da Nota Fiscal ou Cupom / Requisição
  photoReceipt?: string; // Foto do comprovante ou da bomba
  notes?: string; // Observações
  createdAt: string;
  createdBy?: string;
}

