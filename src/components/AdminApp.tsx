import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { 
  collection, 
  query, 
  onSnapshot, 
  getDocs,
  addDoc, 
  orderBy,
  deleteDoc,
  doc,
  updateDoc,
  writeBatch,
  getDoc,
  setDoc
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { 
  Truck, 
  Delivery, 
  Sitio, 
  Resident, 
  Councilman, 
  DeliveryStatus, 
  TruckStatus,
  AdminConfig,
  Driver,
  FuelLog,
  FuelLogType
} from '../types';
import MapContainer from './MapContainer';
import CouncilmanPerformanceSection from './CouncilmanPerformanceSection';
import ThemeSelector from './ThemeSelector';
import { fetchRoadRoute, WATER_SUPPLY_POINT, isRoadRoute, getHaversineDistanceKm } from '../lib/routing';
import { 
  Truck as TruckIcon, 
  Droplet, 
  Plus, 
  MapPin, 
  ClipboardList,
  Clock,
  LayoutDashboard,
  Compass,
  Map as MapIcon,
  LogOut,
  Users,
  UserCheck,
  X,
  Navigation,
  Smartphone,
  Image as ImageIcon,
  Settings,
  Shield,
  Key,
  Save,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit2,
  Database,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Volume2,
  VolumeX,
  Bell,
  BellRing,
  Download,
  ShieldCheck,
  Zap,
  Send,
  Phone,
  Sparkles,
  Home,
  School,
  Baby,
  LocateFixed,
  Search,
  ArrowLeft,
  Lock,
  Filter,
  Layers,
  ChevronDown,
  ChevronUp,
  Fuel,
  Gauge,
  TrendingUp,
  DollarSign,
  Calendar,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playDeliveryCompletedChime, playTestChime } from '../lib/audioNotification';
import { 
  checkFirebaseConnection, 
  downloadFirebaseJsonBackup, 
  FirebaseConnectionStatus 
} from '../lib/firebaseService';
import AndroidInstallBanner from './AndroidInstallBanner';

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Earth's radius in kilometers
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function AdminApp({ 
  onTrocarAcesso, 
  userRole = 'secretary' 
}: { 
  onTrocarAcesso?: () => void; 
  userRole?: 'admin' | 'secretary';
} = {}) {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [sitios, setSitios] = useState<Sitio[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [councilmen, setCouncilmen] = useState<Councilman[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'operational' | 'map' | 'deliveries' | 'fuel' | 'sitios' | 'residents' | 'settings' | 'sync' | 'trucks'>('operational');

  // Fuel Logs & Consumption by Sector State
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [showAddFuelModal, setShowAddFuelModal] = useState(false);
  const [editingFuelLog, setEditingFuelLog] = useState<FuelLog | null>(null);
  const [fuelSectorFilter, setFuelSectorFilter] = useState<string>('ALL');
  const [fuelTruckFilter, setFuelTruckFilter] = useState<string>('ALL');
  const [fuelPeriodFilter, setFuelPeriodFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');
  const [fuelSearch, setFuelSearch] = useState<string>('');
  const [fuelFormError, setFuelFormError] = useState<string>('');
  const [isSavingFuelLog, setIsSavingFuelLog] = useState(false);
  const [fuelDeleteConfirm, setFuelDeleteConfirm] = useState<FuelLog | null>(null);

  // Form data for Fuel Log Modal
  const [fuelFormData, setFuelFormData] = useState({
    truckId: '',
    plate: '',
    driverName: '',
    sector: '',
    date: new Date().toISOString().slice(0, 16),
    liters: '' as string | number,
    pricePerLiter: '' as string | number,
    totalCost: '' as string | number,
    fuelType: 'DIESEL_S10' as FuelLogType,
    currentKm: '' as string | number,
    previousKm: '' as string | number,
    gasStation: 'Posto Central Inhapi',
    invoiceNumber: '',
    photoReceipt: '',
    notes: ''
  });
  const [operationalStatusFilter, setOperationalStatusFilter] = useState<'ALL' | 'PENDING' | 'IN_ROUTE' | 'DELIVERED_TODAY'>('ALL');
  const [operationalSearch, setOperationalSearch] = useState('');
  const [operationalSectorFilter, setOperationalSectorFilter] = useState('');
  const [deviceSyncStatuses, setDeviceSyncStatuses] = useState<any[]>([]);
  const [activeCadastroSubTab, setActiveCadastroSubTab] = useState<'resident' | 'truck' | 'driver' | 'councilman'>('resident');
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [showAddTruck, setShowAddTruck] = useState(false);
  const [showAddDelivery, setShowAddDelivery] = useState(false);
  const [showAddSitio, setShowAddSitio] = useState(false);
  const [editingSitio, setEditingSitio] = useState<Sitio | null>(null);
  const [showAddResident, setShowAddResident] = useState(false);
  const [showAddCouncilman, setShowAddCouncilman] = useState(false);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const [selectedSitio, setSelectedSitio] = useState<Sitio | null>(null);
  const [plannedRoute, setPlannedRoute] = useState<[number, number][] | undefined>(undefined);
  const [adminToast, setAdminToast] = useState<{ show: boolean, message: string }>({ show: false, message: '' });
  const [activeDashboardModal, setActiveDashboardModal] = useState<'completed' | 'active_trucks' | 'pending' | 'in_service' | null>(null);
  const [trucksModalFilter, setTrucksModalFilter] = useState<'all' | 'in_route' | 'idle' | 'gps_active'>('all');
  const [trucksModalSearch, setTrucksModalSearch] = useState('');
  const [inServiceModalFilter, setInServiceModalFilter] = useState<'in_service' | 'all'>('in_service');

  // Complete list of all registered drivers (from trucks & drivers collection)
  const allRegisteredDrivers = useMemo(() => {
    const list: Array<{
      id: string;
      driverName: string;
      plate: string;
      phone?: string;
      status: TruckStatus;
      hasGPS: boolean;
      lastLat?: number;
      lastLng?: number;
      lastUpdate?: string;
      truck?: Truck;
      activeDelivery?: Delivery;
    }> = [];
    const seenNames = new Set<string>();

    trucks.forEach(t => {
      const activeDelivery = deliveries.find(d => d.truckId === t.id && (d.status === 'IN_ROUTE' || d.status === 'PENDING'));
      const matchingDriver = drivers.find(d => d.name?.trim().toLowerCase() === t.driverName?.trim().toLowerCase());
      const hasGPS = typeof t.lastLat === 'number' && typeof t.lastLng === 'number';
      
      list.push({
        id: t.id,
        driverName: t.driverName || 'Motorista Não Identificado',
        plate: t.plate || 'SEM PLACA',
        phone: matchingDriver?.phone,
        status: t.status || 'IDLE',
        hasGPS,
        lastLat: t.lastLat,
        lastLng: t.lastLng,
        lastUpdate: t.lastUpdate,
        truck: t,
        activeDelivery
      });

      if (t.driverName) {
        seenNames.add(t.driverName.trim().toLowerCase());
      }
    });

    drivers.forEach(d => {
      if (d.name && !seenNames.has(d.name.trim().toLowerCase())) {
        list.push({
          id: 'driver-' + d.id,
          driverName: d.name,
          plate: 'Sem caminhão',
          phone: d.phone,
          status: 'IDLE',
          hasGPS: false,
          activeDelivery: undefined
        });
      }
    });

    return list;
  }, [trucks, drivers, deliveries]);

  const filteredDriversForModal = useMemo(() => {
    return allRegisteredDrivers.filter(d => {
      if (trucksModalFilter === 'in_route' && d.status !== 'IN_ROUTE') return false;
      if (trucksModalFilter === 'idle' && d.status === 'IN_ROUTE') return false;
      if (trucksModalFilter === 'gps_active' && !d.hasGPS) return false;
      if (trucksModalSearch.trim()) {
        const q = trucksModalSearch.toLowerCase().trim();
        const nameMatch = (d.driverName || '').toLowerCase().includes(q);
        const plateMatch = (d.plate || '').toLowerCase().includes(q);
        const phoneMatch = (d.phone || '').toLowerCase().includes(q);
        return nameMatch || plateMatch || phoneMatch;
      }
      return true;
    });
  }, [allRegisteredDrivers, trucksModalFilter, trucksModalSearch]);

  // Real-time calculated dashboard statistics for the map monitoring tab
  const todayStr = new Date().toLocaleDateString('en-CA');
  const deliveriesCompletedToday = deliveries.filter(d => {
    if (d.status !== 'DELIVERED' || !d.createdAt) return false;
    try {
      const dDateStr = new Date(d.createdAt).toLocaleDateString('en-CA');
      return dDateStr === todayStr;
    } catch (e) {
      return d.createdAt.startsWith(todayStr);
    }
  }).length;

  const totalCompletedDeliveries = deliveries.filter(d => d.status === 'DELIVERED').length;
  const trucksInRoute = trucks.filter(t => t.status === 'IN_ROUTE').length;
  const pendingDeliveries = deliveries.filter(d => d.status === 'PENDING').length;

  const activeInServiceDrivers = useMemo(() => {
    return allRegisteredDrivers.filter(d => d.status === 'IN_ROUTE' || d.status === 'ARRIVED' || d.activeDelivery || d.hasGPS);
  }, [allRegisteredDrivers]);

  const displayedInServiceDrivers = useMemo(() => {
    return inServiceModalFilter === 'in_service' ? activeInServiceDrivers : allRegisteredDrivers;
  }, [inServiceModalFilter, activeInServiceDrivers, allRegisteredDrivers]);

  // Lista de setores/sítios únicos para filtragem rápida no Monitoramento Operacional
  const operationalSectors = useMemo(() => {
    const s = new Set<string>();
    deliveries.forEach(d => {
      const sec = (d.sector || d.neighborhood || '').trim();
      if (sec) s.add(sec);
    });
    residents.forEach(r => {
      const sec = (r.sector || r.neighborhood || '').trim();
      if (sec) s.add(sec);
    });
    return Array.from(s).sort();
  }, [deliveries, residents]);

  // Pedidos de água filtrados para exibição no Monitoramento Operacional
  const filteredOperationalDeliveries = useMemo(() => {
    return deliveries.filter(d => {
      // Filtro de Status
      if (operationalStatusFilter === 'PENDING' && d.status !== 'PENDING') return false;
      if (operationalStatusFilter === 'IN_ROUTE' && d.status !== 'IN_ROUTE') return false;
      if (operationalStatusFilter === 'DELIVERED_TODAY') {
        if (d.status !== 'DELIVERED' || !d.createdAt) return false;
        try {
          const dDateStr = new Date(d.createdAt).toLocaleDateString('en-CA');
          if (dDateStr !== todayStr) return false;
        } catch {
          if (!d.createdAt.startsWith(todayStr)) return false;
        }
      }

      // Filtro de Setor / Sítio
      if (operationalSectorFilter) {
        const sec = (d.sector || d.neighborhood || '').toLowerCase();
        if (!sec.includes(operationalSectorFilter.toLowerCase())) return false;
      }

      // Busca por texto livre (morador, endereço, sítio, vereador, motorista, placa)
      if (operationalSearch.trim()) {
        const q = operationalSearch.toLowerCase().trim();
        const resMatch = (d.residentName || '').toLowerCase().includes(q);
        const addrMatch = (d.address || '').toLowerCase().includes(q);
        const neighMatch = (d.neighborhood || '').toLowerCase().includes(q);
        const refMatch = (d.referencePoint || '').toLowerCase().includes(q);
        const councilMatch = (d.councilman || '').toLowerCase().includes(q);
        const truckMatch = trucks.some(t => t.id === d.truckId && (
          (t.driverName || '').toLowerCase().includes(q) || 
          (t.plate || '').toLowerCase().includes(q)
        ));
        return resMatch || addrMatch || neighMatch || refMatch || councilMatch || truckMatch;
      }

      return true;
    });
  }, [deliveries, operationalStatusFilter, operationalSectorFilter, operationalSearch, todayStr, trucks]);

  // New Item states
  const [newTruck, setNewTruck] = useState({ plate: '', driverName: '', sector: '' });
  const [newDelivery, setNewDelivery] = useState<{ 
    truckId: string; 
    residentId?: string;
    residentName: string; 
    address: string; 
    neighborhood?: string;
    sector?: string;
    referencePoint: string; 
    phone?: string;
    councilman: string; 
    lat: number; 
    lng: number; 
  }>({ 
    truckId: '', 
    residentId: '',
    residentName: '', 
    address: '', 
    neighborhood: '',
    sector: '',
    referencePoint: '', 
    phone: '',
    councilman: '', 
    lat: -9.2201, 
    lng: -36.3503 
  });
  const [selectedResidentObj, setSelectedResidentObj] = useState<Resident | null>(null);
  const [newSitio, setNewSitio] = useState({ 
    name: '', 
    description: '', 
    lat: -9.2201, 
    lng: -36.3503, 
    rawCoords: '-9.2201, -36.3503',
    type: 'RESIDENT' as 'RESIDENT' | 'SCHOOL' | 'DAYCARE' | 'WATER' | 'FUEL' | 'OTHER',
    fuelType: 'NONE' as 'DIESEL' | 'GASOLINE' | 'NONE'
  });
  const [newResident, setNewResident] = useState<{
    name: string;
    address: string;
    neighborhood: string;
    phone: string;
    referencePoint: string;
    councilman: string;
    category: 'RESIDENT' | 'SCHOOL' | 'DAYCARE';
    preferredDriver?: string;
    sector?: string;
  }>({ 
    name: '', 
    address: '', 
    neighborhood: '', 
    phone: '', 
    referencePoint: '',
    councilman: '',
    category: 'RESIDENT',
    preferredDriver: '',
    sector: ''
  });
  const [residentCategoryFilter, setResidentCategoryFilter] = useState<'ALL' | 'RESIDENT' | 'SCHOOL' | 'DAYCARE'>('ALL');
  const [residentFormError, setResidentFormError] = useState('');
  const [isSavingResident, setIsSavingResident] = useState(false);
  const [showNameAutocomplete, setShowNameAutocomplete] = useState(false);
  const [duplicateWarningAcknowledged, setDuplicateWarningAcknowledged] = useState(false);

  // Deliveries Grouping & Sector Filters
  const [deliveryViewMode, setDeliveryViewMode] = useState<'ALL' | 'BY_SECTOR' | 'BY_DRIVER'>('BY_SECTOR');
  const [selectedDeliverySectorFilter, setSelectedDeliverySectorFilter] = useState<string>('ALL');
  const [selectedDeliveryDriverFilter, setSelectedDeliveryDriverFilter] = useState<string>('ALL');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<'ALL' | 'PENDING' | 'IN_ROUTE' | 'DELIVERED'>('ALL');
  const [deliverySearchQuery, setDeliverySearchQuery] = useState<string>('');
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});
  const [expandedDrivers, setExpandedDrivers] = useState<Record<string, boolean>>({});

  // Helper inteligente para mapear o setor e o motorista indicado/notificado de cada morador
  const getResidentSectorAndDriver = useCallback((resident: Resident) => {
    // 1. Extração do setor do morador
    const rawSector = (resident.sector || resident.neighborhood || '').trim();
    const sectorName = rawSector || (resident.address ? resident.address.split('-')[0].trim() : 'Inhapi (Centro)');
    const cleanSector = sectorName.toLowerCase();
    const cleanAddress = (resident.address || '').toLowerCase();

    // 2. Cálculo de Proximidade por GPS do Sítio do Motorista
    let closestDriverByGps: {
      driver: Driver;
      truck?: Truck;
      distanceKm: number;
    } | null = null;

    if (resident.lat && resident.lng) {
      const driversWithGps = drivers
        .filter(d => d.homeLat && d.homeLng)
        .map(d => {
          const dist = getHaversineDistanceKm(resident.lat!, resident.lng!, d.homeLat!, d.homeLng!);
          const trk = trucks.find(t => t.driverName.toLowerCase() === d.name.toLowerCase());
          return {
            driver: d,
            truck: trk,
            distanceKm: dist
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);

      if (driversWithGps.length > 0) {
        closestDriverByGps = driversWithGps[0];
      }
    }

    // 3. Se o morador tem motorista preferencial definido explicitamente
    if (resident.preferredDriver) {
      const directTruck = trucks.find(t => 
        t.driverName.toLowerCase() === resident.preferredDriver?.toLowerCase() ||
        t.id === resident.preferredDriver
      );
      const directDriver = drivers.find(d => 
        d.name.toLowerCase() === resident.preferredDriver?.toLowerCase() ||
        d.id === resident.preferredDriver
      );
      if (directTruck || directDriver) {
        return {
          truckId: directTruck?.id || '',
          driverName: directTruck?.driverName || directDriver?.name || resident.preferredDriver,
          plate: directTruck?.plate || '',
          driverPhone: directDriver?.phone || '',
          sectorName,
          reason: 'assigned' as const,
          reasonText: 'Motorista vinculado diretamente no cadastro do morador',
          closestDriverByGps
        };
      }
    }

    // 3. Cruzamento por Setor/Endereço configurado no Caminhão ou no Motorista
    if (cleanSector || cleanAddress) {
      // Verificar se algum caminhão tem este setor atribuído
      const truckWithSector = trucks.find(t => {
        const tSector = (t.sector || '').toLowerCase();
        return tSector && (
          (cleanSector && (tSector.includes(cleanSector) || cleanSector.includes(tSector))) ||
          (cleanAddress && (tSector.includes(cleanAddress) || cleanAddress.includes(tSector)))
        );
      });
      if (truckWithSector) {
        const drv = drivers.find(d => d.name.toLowerCase() === truckWithSector.driverName.toLowerCase());
        return {
          truckId: truckWithSector.id,
          driverName: truckWithSector.driverName,
          plate: truckWithSector.plate,
          driverPhone: drv?.phone || '',
          sectorName,
          reason: 'sector' as const,
          reasonText: `Caminhão (${truckWithSector.plate}) alocado no setor "${sectorName}"`,
          closestDriverByGps
        };
      }

      // Verificar se algum motorista tem este setor ou endereço cadastrado
      const driverWithSector = drivers.find(d => {
        const dSector = (d.sector || '').toLowerCase();
        const dAddr = (d.address || '').toLowerCase();
        return (
          (dSector && cleanSector && (dSector.includes(cleanSector) || cleanSector.includes(dSector))) ||
          (dAddr && cleanSector && (dAddr.includes(cleanSector) || cleanSector.includes(dAddr))) ||
          (dSector && cleanAddress && (dSector.includes(cleanAddress) || cleanAddress.includes(dSector))) ||
          (dAddr && cleanAddress && (dAddr.includes(cleanAddress) || cleanAddress.includes(dAddr)))
        );
      });
      if (driverWithSector) {
        const truckForDriver = trucks.find(t => t.driverName.toLowerCase() === driverWithSector.name.toLowerCase());
        return {
          truckId: truckForDriver?.id || '',
          driverName: driverWithSector.name,
          plate: truckForDriver?.plate || '',
          driverPhone: driverWithSector.phone || '',
          sectorName,
          reason: 'sector' as const,
          reasonText: `Motorista atende setor / base: "${driverWithSector.sector || driverWithSector.address || sectorName}"`,
          closestDriverByGps
        };
      }
    }

    // 4. Aprendizado pelo histórico de entregas anteriores neste endereço ou morador
    const relevantDeliveries = deliveries.filter(d => {
      const matchResident = (d.residentId && d.residentId === resident.id) ||
        (d.residentName && d.residentName.trim().toLowerCase() === resident.name.trim().toLowerCase());
      const matchLoc = cleanSector && (
        (d.neighborhood && d.neighborhood.toLowerCase().includes(cleanSector)) ||
        (d.address && d.address.toLowerCase().includes(cleanSector))
      );
      return matchResident || matchLoc;
    });

    if (relevantDeliveries.length > 0) {
      const counts: Record<string, number> = {};
      for (const d of relevantDeliveries) {
        if (d.truckId) {
          counts[d.truckId] = (counts[d.truckId] || 0) + 1;
        }
      }
      const sortedTruckIds = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (sortedTruckIds.length > 0) {
        const bestTruckId = sortedTruckIds[0];
        const bestTruck = trucks.find(t => t.id === bestTruckId);
        if (bestTruck) {
          const drv = drivers.find(d => d.name.toLowerCase() === bestTruck.driverName.toLowerCase());
          return {
            truckId: bestTruck.id,
            driverName: bestTruck.driverName,
            plate: bestTruck.plate,
            driverPhone: drv?.phone || '',
            sectorName,
            reason: 'history' as const,
            historyCount: counts[bestTruckId],
            reasonText: `Mais realizou entregas neste setor (${counts[bestTruckId]} ${counts[bestTruckId] === 1 ? 'abastecimento' : 'abastecimentos'})`,
            closestDriverByGps
          };
        }
      }
    }

    // 5. Se não houver vínculo específico, recomendar o motorista mais próximo por GPS
    if (closestDriverByGps) {
      return {
        truckId: closestDriverByGps.truck?.id || '',
        driverName: closestDriverByGps.driver.name,
        plate: closestDriverByGps.truck?.plate || '',
        driverPhone: closestDriverByGps.driver.phone || '',
        sectorName,
        reason: 'proximity' as any,
        reasonText: `Mais próximo por GPS: Mora no ${closestDriverByGps.driver.homeSitio || 'Sítio'} a ${closestDriverByGps.distanceKm.toFixed(1)} km`,
        closestDriverByGps
      };
    }

    return {
      truckId: '',
      driverName: '',
      plate: '',
      driverPhone: '',
      sectorName,
      reason: 'none' as const,
      reasonText: 'Nenhum motorista fixado para este setor',
      closestDriverByGps: null
    };
  }, [trucks, drivers, deliveries]);

  // Extrair setor canônico de uma entrega
  const getDeliverySector = useCallback((delivery: Delivery) => {
    return (delivery.sector || delivery.neighborhood || (delivery.address ? delivery.address.split('-')[0].trim() : '') || 'Inhapi (Centro)').trim();
  }, []);

  // Encontrar o motorista/caminhão responsável pelo setor
  const getSectorResponsibleDriver = useCallback((sectorName: string) => {
    const cleanSector = sectorName.toLowerCase().trim();
    if (!cleanSector) return null;

    // 1. Procurar em trucks por setor
    const t = trucks.find(trk => (trk.sector || '').toLowerCase().includes(cleanSector));
    if (t) {
      const drv = drivers.find(d => d.name.toLowerCase() === t.driverName.toLowerCase());
      return { driverName: t.driverName, plate: t.plate, phone: drv?.phone || '', address: drv?.address || '', truckId: t.id };
    }

    // 2. Procurar em drivers por setor ou endereço
    const drv = drivers.find(d => {
      const s = (d.sector || '').toLowerCase();
      const a = (d.address || '').toLowerCase();
      return (s && (s.includes(cleanSector) || cleanSector.includes(s))) ||
             (a && (a.includes(cleanSector) || cleanSector.includes(a)));
    });
    if (drv) {
      const trk = trucks.find(t => t.driverName.toLowerCase() === drv.name.toLowerCase());
      return { driverName: drv.name, plate: trk?.plate || '', phone: drv.phone || '', address: drv.address || '', truckId: trk?.id || '' };
    }

    // 3. Procurar em moradores daquele setor se tem preferredDriver
    const resWithDriver = residents.find(r => {
      const rSec = (r.sector || r.neighborhood || '').toLowerCase();
      return rSec && (rSec.includes(cleanSector) || cleanSector.includes(rSec)) && r.preferredDriver;
    });
    if (resWithDriver && resWithDriver.preferredDriver) {
      const trk = trucks.find(t => t.driverName.toLowerCase() === resWithDriver.preferredDriver?.toLowerCase());
      const drvObj = drivers.find(d => d.name.toLowerCase() === resWithDriver.preferredDriver?.toLowerCase());
      return { driverName: resWithDriver.preferredDriver, plate: trk?.plate || '', phone: drvObj?.phone || '', address: drvObj?.address || '', truckId: trk?.id || '' };
    }

    return null;
  }, [trucks, drivers, residents]);

  // Lista unificada e ordenada de setores existentes no município
  const sectorsList = useMemo(() => {
    const set = new Set<string>();
    residents.forEach(r => {
      const s = (r.sector || r.neighborhood || '').trim();
      if (s) set.add(s);
    });
    deliveries.forEach(d => {
      const s = (d.sector || d.neighborhood || '').trim();
      if (s) set.add(s);
    });
    trucks.forEach(t => {
      if (t.sector) t.sector.split(',').forEach(x => { if (x.trim()) set.add(x.trim()); });
    });
    drivers.forEach(d => {
      if (d.sector) d.sector.split(',').forEach(x => { if (x.trim()) set.add(x.trim()); });
      if (d.address) d.address.split(',').forEach(x => { if (x.trim()) set.add(x.trim()); });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [residents, deliveries, trucks, drivers]);

  // Entregas filtradas conforme busca, setor, motorista e status
  const filteredDeliveriesForView = useMemo(() => {
    return deliveries.filter(d => {
      // Filtro de status
      if (deliveryStatusFilter !== 'ALL' && d.status !== deliveryStatusFilter) return false;

      // Filtro de setor
      const sec = getDeliverySector(d);
      if (selectedDeliverySectorFilter !== 'ALL' && sec.toLowerCase() !== selectedDeliverySectorFilter.toLowerCase()) {
        return false;
      }

      // Filtro de motorista / caminhão
      if (selectedDeliveryDriverFilter !== 'ALL') {
        const assignedTruck = trucks.find(t => t.id === d.truckId);
        const isTruckMatch = d.truckId === selectedDeliveryDriverFilter;
        const isDriverNameMatch = assignedTruck && assignedTruck.driverName.toLowerCase() === selectedDeliveryDriverFilter.toLowerCase();
        if (!isTruckMatch && !isDriverNameMatch) return false;
      }

      // Busca textual
      if (deliverySearchQuery.trim()) {
        const q = deliverySearchQuery.toLowerCase().trim();
        const residentMatch = (d.residentName || '').toLowerCase().includes(q);
        const addressMatch = (d.address || '').toLowerCase().includes(q);
        const sectorMatch = sec.toLowerCase().includes(q);
        const assignedTruck = trucks.find(t => t.id === d.truckId);
        const driverMatch = assignedTruck ? (assignedTruck.driverName || '').toLowerCase().includes(q) : false;
        const councilmanMatch = (d.councilman || '').toLowerCase().includes(q);
        return residentMatch || addressMatch || sectorMatch || driverMatch || councilmanMatch;
      }

      return true;
    });
  }, [deliveries, deliveryStatusFilter, selectedDeliverySectorFilter, selectedDeliveryDriverFilter, deliverySearchQuery, getDeliverySector, trucks]);

  // Agrupamento de entregas por Setor / Região com motorista responsável indicado
  const sectorGroupedDeliveries = useMemo(() => {
    const groups: Record<string, { sectorName: string; deliveries: Delivery[]; responsibleDriver: ReturnType<typeof getSectorResponsibleDriver> }> = {};
    
    filteredDeliveriesForView.forEach(d => {
      const sec = getDeliverySector(d);
      if (!groups[sec]) {
        groups[sec] = {
          sectorName: sec,
          deliveries: [],
          responsibleDriver: getSectorResponsibleDriver(sec)
        };
      }
      groups[sec].deliveries.push(d);
    });

    return Object.values(groups).sort((a, b) => a.sectorName.localeCompare(b.sectorName));
  }, [filteredDeliveriesForView, getDeliverySector, getSectorResponsibleDriver]);

  // Agrupamento de entregas por Motorista com base em seu caminhão, setor e endereço
  const driverGroupedDeliveries = useMemo(() => {
    const groups: Array<{
      truck: Truck;
      driver: Driver | null;
      deliveries: Delivery[];
    }> = [];

    const handledTruckIds = new Set<string>();

    trucks.forEach(t => {
      handledTruckIds.add(t.id);
      const drv = drivers.find(d => d.name.toLowerCase() === t.driverName.toLowerCase()) || null;
      const dels = filteredDeliveriesForView.filter(d => d.truckId === t.id);
      groups.push({
        truck: t,
        driver: drv,
        deliveries: dels
      });
    });

    const otherDeliveries = filteredDeliveriesForView.filter(d => !handledTruckIds.has(d.truckId));

    return { groups, otherDeliveries };
  }, [trucks, drivers, filteredDeliveriesForView]);

  const residentNameSuggestions = useMemo(() => {
    const q = newResident.name.trim().toLowerCase();
    if (q.length < 2) return [];
    return residents
      .filter(r => (r.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [residents, newResident.name]);

  const exactDuplicateResident = useMemo(() => {
    const q = newResident.name.trim().toLowerCase();
    if (!q) return null;
    return residents.find(r => (r.name || '').trim().toLowerCase() === q) || null;
  }, [residents, newResident.name]);

  const [isAddingCouncilmanInResident, setIsAddingCouncilmanInResident] = useState(false);
  const [inlineCouncilmanName, setInlineCouncilmanName] = useState('');
  const [newDriver, setNewDriver] = useState({ 
    name: '', 
    phone: '', 
    sector: '', 
    address: '',
    homeSitio: '',
    homeLat: 0,
    homeLng: 0
  });
  const [newCouncilman, setNewCouncilman] = useState({ name: '' });

  // Settings State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  // Delete Delivery History Password Confirmation State
  const [actualAdminPassword, setActualAdminPassword] = useState('123456');
  const [showDeleteDeliveriesModal, setShowDeleteDeliveriesModal] = useState(false);
  const [deleteHistoryPassword, setDeleteHistoryPassword] = useState('');
  const [deleteHistoryError, setDeleteHistoryError] = useState('');

  // Finish Route Password Confirmation State
  const [showFinishRouteModal, setShowFinishRouteModal] = useState(false);
  const [routeToFinishTruck, setRouteToFinishTruck] = useState<Truck | null>(null);
  const [finishRoutePassword, setFinishRoutePassword] = useState('');
  const [finishRouteError, setFinishRouteError] = useState('');

  // Firebase State
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseConnectionStatus | null>(null);
  const [isCheckingFirebase, setIsCheckingFirebase] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);

  // Sound Notification State
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('admin_delivery_sound');
    return saved !== 'false';
  });
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    localStorage.setItem('admin_delivery_sound', soundEnabled ? 'true' : 'false');
  }, [soundEnabled]);

  // Realtime Delivery Completed Alert Banner
  const [completedDeliveryAlert, setCompletedDeliveryAlert] = useState<{
    show: boolean;
    residentName: string;
    driverName?: string;
    plate?: string;
    timestamp: string;
  } | null>(null);

  const prevDeliveriesMapRef = useRef<Map<string, DeliveryStatus>>(new Map());
  const isInitialDeliveriesLoadRef = useRef(true);
  const trucksRef = useRef<Truck[]>([]);
  useEffect(() => {
    trucksRef.current = trucks;
  }, [trucks]);

  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    if (nextVal) {
      playTestChime();
      setAdminToast({ show: true, message: 'Notificações sonoras ATIVADAS 🔊' });
    } else {
      setAdminToast({ show: true, message: 'Notificações sonoras DESATIVADAS 🔇' });
    }
    setTimeout(() => setAdminToast({ show: false, message: '' }), 2500);
  };

  const handleCheckFirebase = async () => {
    setIsCheckingFirebase(true);
    try {
      const res = await checkFirebaseConnection();
      setFirebaseStatus(res);
    } catch (e: any) {
      setFirebaseStatus({ 
        connected: false, 
        message: e?.message || 'Erro ao checar Firestore',
        projectId: 'ai-studio-dad26a59-43f1-4ca1-9d3e-846540128eb8',
        databaseId: '(default)',
        timestamp: new Date().toLocaleTimeString('pt-BR')
      });
    } finally {
      setIsCheckingFirebase(false);
    }
  };

  const handleExportFirebaseBackup = () => {
    setIsExportingBackup(true);
    try {
      downloadFirebaseJsonBackup({
        trucks,
        deliveries,
        sitios,
        residents,
        councilmen,
        drivers
      });
      setAdminToast({ show: true, message: 'Backup JSON das coleções do Firebase exportado com sucesso! 📥' });
    } catch (err: any) {
      setAdminToast({ show: true, message: 'Erro ao gerar backup: ' + (err?.message || err) });
    } finally {
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      setIsExportingBackup(false);
    }
  };

  useEffect(() => {
    handleCheckFirebase();
  }, []);

  useEffect(() => {
    const handleErr = (name: string) => (err: any) => {
      console.warn(`Firestore onSnapshot error for ${name}:`, err);
      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted') || err?.message?.toLowerCase().includes('exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    };

    const qTrucks = query(collection(db, 'trucks'));
    const unsubTrucks = onSnapshot(qTrucks, (snap) => {
      setTrucks(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Truck)));
    }, handleErr('trucks'));

    const qDeliveries = query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'));
    const unsubDeliveries = onSnapshot(qDeliveries, (snap) => {
      const currentDeliveries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delivery));
      setDeliveries(currentDeliveries);

      if (isInitialDeliveriesLoadRef.current) {
        // Inicialização inicial: guarda o estado atual sem disparar som
        currentDeliveries.forEach(d => {
          prevDeliveriesMapRef.current.set(d.id, d.status);
        });
        isInitialDeliveriesLoadRef.current = false;
      } else {
        // Monitoramento em tempo real de novas conclusões feitas por motoristas
        currentDeliveries.forEach(d => {
          const prevStatus = prevDeliveriesMapRef.current.get(d.id);
          // Se a entrega não era concluída e agora passou a ser DELIVERED (Concluída)
          if (d.status === 'DELIVERED' && prevStatus && prevStatus !== 'DELIVERED') {
            const matchedTruck = trucksRef.current.find(t => t.id === d.truckId);
            
            // Dispara o alerta sonoro se estiver ativado
            if (soundEnabledRef.current) {
              playDeliveryCompletedChime();
            }

            // Exibe notificação visual em tempo real no topo
            const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            setCompletedDeliveryAlert({
              show: true,
              residentName: d.residentName,
              driverName: matchedTruck?.driverName,
              plate: matchedTruck?.plate,
              timestamp: timeStr
            });

            // Esconde após 7 segundos
            setTimeout(() => {
              setCompletedDeliveryAlert(prev => (prev?.residentName === d.residentName ? null : prev));
            }, 7000);
          }
          prevDeliveriesMapRef.current.set(d.id, d.status);
        });
      }
    }, handleErr('deliveries'));

    const qSitios = query(collection(db, 'sitios'));
    const unsubSitios = onSnapshot(qSitios, (snap) => {
      setSitios(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sitio)));
    }, handleErr('sitios'));

    const qResidents = query(collection(db, 'residents'), orderBy('name', 'asc'));
    const unsubResidents = onSnapshot(qResidents, (snap) => {
      setResidents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Resident)));
    }, handleErr('residents'));

    const qCouncilmen = query(collection(db, 'councilmen'), orderBy('name', 'asc'));
    const unsubCouncilmen = onSnapshot(qCouncilmen, (snap) => {
      setCouncilmen(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Councilman)));
    }, handleErr('councilmen'));

    const qDrivers = query(collection(db, 'drivers'), orderBy('name', 'asc'));
    const unsubDrivers = onSnapshot(qDrivers, (snap) => {
      setDrivers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Driver)));
    }, handleErr('drivers'));

    const qFuelLogs = query(collection(db, 'fuel_logs'), orderBy('date', 'desc'));
    const unsubFuelLogs = onSnapshot(qFuelLogs, (snap) => {
      setFuelLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FuelLog)));
    }, handleErr('fuel_logs'));

    const qDeviceSync = query(collection(db, 'device_sync_status'), orderBy('lastUpdate', 'desc'));
    const unsubDeviceSync = onSnapshot(qDeviceSync, (snap) => {
      setDeviceSyncStatuses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, handleErr('device_sync_status'));

    const unsubAdminConfig = onSnapshot(doc(db, 'config', 'admin'), (snap) => {
      if (snap.exists() && snap.data().secretaryPassword) {
        setActualAdminPassword(snap.data().secretaryPassword);
      } else if (snap.exists() && snap.data().password) {
        setActualAdminPassword(snap.data().password);
      } else {
        setActualAdminPassword('123456');
      }
    }, handleErr('config/admin'));

    return () => {
      unsubTrucks();
      unsubDeliveries();
      unsubSitios();
      unsubResidents();
      unsubCouncilmen();
      unsubDrivers();
      unsubFuelLogs();
      unsubDeviceSync();
      unsubAdminConfig();
    };
  }, []);

  const handleAddTruck = async () => {
    if (!newTruck.plate || !newTruck.driverName) return;
    const payload = {
      plate: newTruck.plate.trim(),
      driverName: newTruck.driverName.trim(),
      sector: newTruck.sector ? newTruck.sector.trim() : '',
      status: 'IDLE' as TruckStatus,
      lastUpdate: new Date().toISOString()
    };
    try {
      await addDoc(collection(db, 'trucks'), payload);
      setAdminToast({ show: true, message: 'Caminhão cadastrado com sucesso no Firebase!' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (err: any) {
      console.error("Firestore save failed:", err);
      // Fallback local memory state to let them continue
      const tempId = 'temp-truck-' + Date.now();
      const tObj: Truck = { id: tempId, ...payload };
      setTrucks(prev => [...prev, tObj]);
      setAdminToast({ show: true, message: 'Salvo localmente (Operando em Contingência)' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    } finally {
      setNewTruck({ plate: '', driverName: '', sector: '' });
      setShowAddTruck(false);
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthlyDeliveries = deliveries.filter(d => {
      const dDate = new Date(d.createdAt || '');
      return dDate.getMonth() === currentMonth && dDate.getFullYear() === currentYear;
    });

    const tableColumn = ["Morador", "Endereço", "Indicação", "Status"];
    const tableRows = monthlyDeliveries.map(d => [
      d.residentName,
      d.address,
      d.councilman || '—',
      d.status === 'DELIVERED' ? 'ENTREGUE' : d.status === 'IN_ROUTE' ? 'EM ROTA' : 'PENDENTE'
    ]);

    doc.text(`Relatório de Entregas - ${now.toLocaleString('pt-BR', { month: 'long' })}/${currentYear}`, 14, 15);
    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 20,
    });
    doc.save(`relatorio-entregas-${currentMonth + 1}-${currentYear}.pdf`);
  };

  const escapeCsvField = (value: any): string => {
    const str = String(value ?? '').replace(/\r?\n|\r/g, ' ').trim();
    return `"${str.replace(/"/g, '""')}"`;
  };

  const downloadCsvFile = (csvContent: string, filename: string) => {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportDeliveriesCSV = () => {
    const now = new Date();
    const dateStamp = now.toISOString().split('T')[0];

    const headers = [
      'ID',
      'Morador',
      'Endereço',
      'Bairro / Sítio',
      'Ponto de Referência',
      'Telefone',
      'Indicação (Vereador)',
      'Caminhão (Placa / Motorista)',
      'Status',
      'Data',
      'Hora',
      'Latitude',
      'Longitude'
    ];

    const rows = deliveries.map(d => {
      const truckObj = trucks.find(t => t.id === d.truckId);
      const truckLabel = truckObj ? `${truckObj.plate} - ${truckObj.driverName}` : (d.truckId || '—');
      const statusLabel = d.status === 'DELIVERED' ? 'ENTREGUE' : d.status === 'IN_ROUTE' ? 'EM ROTA' : 'PENDENTE';
      const dDate = d.createdAt ? new Date(d.createdAt) : null;
      const dateStr = dDate && !isNaN(dDate.getTime()) ? dDate.toLocaleDateString('pt-BR') : '—';
      const timeStr = dDate && !isNaN(dDate.getTime()) ? dDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

      return [
        d.id,
        d.residentName,
        d.address,
        d.neighborhood || '—',
        d.referencePoint || '—',
        d.phone || '—',
        d.councilman || 'Sem indicação',
        truckLabel,
        statusLabel,
        dateStr,
        timeStr,
        d.lat ?? '',
        d.lng ?? ''
      ].map(escapeCsvField).join(';');
    });

    const csvString = [headers.map(escapeCsvField).join(';'), ...rows].join('\r\n');
    downloadCsvFile(csvString, `relatorio-entregas-${dateStamp}.csv`);
  };

  const handleExportResidentsCSV = () => {
    const now = new Date();
    const dateStamp = now.toISOString().split('T')[0];

    const headers = [
      'ID',
      'Nome / Instituição',
      'Categoria',
      'Endereço',
      'Bairro / Sítio',
      'Ponto de Referência',
      'Telefone',
      'Indicação (Vereador)',
      'Total de Entregas',
      'Entregas Concluídas',
      'Latitude',
      'Longitude'
    ];

    const rows = residents.map(r => {
      const categoryLabel = r.category === 'SCHOOL' ? 'ESCOLA' : r.category === 'DAYCARE' ? 'CRECHE' : 'MORADOR';
      const resDeliveries = deliveries.filter(d =>
        (d.residentId && d.residentId === r.id) ||
        (d.residentName && d.residentName.trim().toLowerCase() === r.name.trim().toLowerCase())
      );
      const deliveredCount = resDeliveries.filter(d => d.status === 'DELIVERED').length;

      return [
        r.id,
        r.name,
        categoryLabel,
        r.address || '—',
        r.neighborhood || '—',
        r.referencePoint || '—',
        r.phone || '—',
        r.councilman || 'Sem indicação',
        resDeliveries.length,
        deliveredCount,
        r.lat ?? '',
        r.lng ?? ''
      ].map(escapeCsvField).join(';');
    });

    const csvString = [headers.map(escapeCsvField).join(';'), ...rows].join('\r\n');
    downloadCsvFile(csvString, `lista-moradores-${dateStamp}.csv`);
  };

  const handleSelectResident = (resident: Resident | null) => {
    if (!resident) {
      setSelectedResidentObj(null);
      setNewDelivery(prev => ({
        ...prev,
        residentId: '',
        residentName: '',
        address: '',
        neighborhood: '',
        referencePoint: '',
        phone: '',
        councilman: '',
        lat: -9.2201,
        lng: -36.3503
      }));
      return;
    }

    setSelectedResidentObj(resident);

    // Mapear setor e identificar o motorista responsável/recomendado
    const sectorMatch = getResidentSectorAndDriver(resident);
    const matchedTruck = sectorMatch.truckId ? trucks.find(t => t.id === sectorMatch.truckId) : null;
    const fallbackTruck = trucks.find(t => t.status === 'IDLE') || trucks[0];
    const targetTruckId = matchedTruck ? matchedTruck.id : (newDelivery.truckId || fallbackTruck?.id || '');

    // Buscar histórico de entregas anteriores deste morador para obter dados complementares (ex: coordenadas verificadas ou indicação habitual)
    const prevDeliveries = deliveries.filter(d => 
      (d.residentId && d.residentId === resident.id) || 
      (d.residentName && d.residentName.trim().toLowerCase() === resident.name.trim().toLowerCase())
    );
    const lastDeliveryWithCouncilman = prevDeliveries.find(d => d.councilman && d.councilman.trim() !== '');
    const lastDeliveryWithCoords = prevDeliveries.find(d => d.lat && d.lng && (d.lat !== -9.2201 || d.lng !== -36.3503));

    // Montar endereço completo e legível: se o bairro/sítio não estiver no endereço, concatenar
    let fullAddress = (resident.address || '').trim();
    const neighborhood = (resident.neighborhood || '').trim();
    if (neighborhood && !fullAddress.toLowerCase().includes(neighborhood.toLowerCase())) {
      fullAddress = fullAddress ? `${fullAddress} - ${neighborhood}` : neighborhood;
    }

    // Coordenadas: prioridade cadastro do morador > última entrega realizada > centro de Inhapi
    const chosenLat = (resident.lat !== undefined && resident.lat !== 0)
      ? resident.lat
      : (lastDeliveryWithCoords?.lat || -9.2201);
    const chosenLng = (resident.lng !== undefined && resident.lng !== 0)
      ? resident.lng
      : (lastDeliveryWithCoords?.lng || -36.3503);

    const chosenCouncilman = resident.councilman || lastDeliveryWithCouncilman?.councilman || '';

    setNewDelivery(prev => ({
      ...prev,
      truckId: targetTruckId,
      residentId: resident.id,
      residentName: resident.name,
      address: fullAddress,
      neighborhood: resident.neighborhood || '',
      sector: sectorMatch.sectorName,
      referencePoint: resident.referencePoint || '',
      phone: resident.phone || '',
      councilman: chosenCouncilman || prev.councilman,
      lat: chosenLat,
      lng: chosenLng
    }));
  };

  const handleQuickDispatchForResident = (resident: Resident) => {
    handleSelectResident(resident);
    const sectorMatch = getResidentSectorAndDriver(resident);
    if (sectorMatch.truckId) {
      setNewDelivery(prev => ({ ...prev, truckId: sectorMatch.truckId }));
    }
    setShowAddDelivery(true);
  };

  const handleAddDelivery = async () => {
    if (!newDelivery.truckId || !newDelivery.residentName || !newDelivery.address) {
      setAdminToast({ show: true, message: 'Selecione um caminhão, morador e endereço.' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return;
    }

    const selectedTruckObj = trucks.find(t => t.id === newDelivery.truckId);
    const finalSector = (newDelivery.sector || newDelivery.neighborhood || (selectedResidentObj?.neighborhood) || 'Inhapi').trim();

    const payload: any = {
      truckId: newDelivery.truckId,
      residentName: newDelivery.residentName,
      address: newDelivery.address,
      neighborhood: newDelivery.neighborhood || finalSector,
      sector: finalSector,
      referencePoint: newDelivery.referencePoint || '',
      councilman: newDelivery.councilman || '',
      lat: Number(newDelivery.lat) || -9.2201,
      lng: Number(newDelivery.lng) || -36.3503,
      status: 'PENDING' as DeliveryStatus,
      createdAt: new Date().toISOString()
    };
    if (newDelivery.residentId) payload.residentId = newDelivery.residentId;
    if (newDelivery.phone) payload.phone = newDelivery.phone;

    try {
      await addDoc(collection(db, 'deliveries'), payload);

      // Sincronizar e manter dados atualizados no cadastro do morador no banco
      if (newDelivery.residentId) {
        try {
          const updatePayload: any = {
            referencePoint: newDelivery.referencePoint || '',
            phone: newDelivery.phone || '',
            lat: Number(newDelivery.lat) || -9.2201,
            lng: Number(newDelivery.lng) || -36.3503,
            lastDeliveryAt: new Date().toISOString(),
            sector: finalSector
          };
          if (selectedTruckObj) {
            updatePayload.preferredDriver = selectedTruckObj.driverName;
          }
          await updateDoc(doc(db, 'residents', newDelivery.residentId), updatePayload);
        } catch (e) {
          console.warn("Could not sync to resident document:", e);
        }
      }
      
      const truck = selectedTruckObj;
      setAdminToast({ 
        show: true, 
        message: `Entrega despachada para ${newDelivery.residentName}! Motorista ${truck ? truck.driverName : 'responsável'} (${finalSector}) notificado.` 
      });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
    } catch (err: any) {
      console.error("Firestore save failed:", err);
      const tempId = 'temp-del-' + Date.now();
      const dObj: Delivery = { id: tempId, ...payload } as Delivery;
      setDeliveries(prev => [dObj, ...prev]);
      setAdminToast({ show: true, message: 'Despachado localmente (Operando em Contingência)' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    } finally {
      setSelectedResidentObj(null);
      setNewDelivery({ 
        truckId: '', 
        residentId: '',
        residentName: '', 
        address: '', 
        neighborhood: '',
        referencePoint: '', 
        phone: '',
        councilman: '', 
        lat: -9.2201, 
        lng: -36.3503 
      });
      setShowAddDelivery(false);
    }
  };

  const handleAddSitio = async () => {
    const trimmedName = newSitio.name.trim();
    if (!trimmedName) {
      const typeLabel = newSitio.type === 'SCHOOL' ? 'da escola' : newSitio.type === 'DAYCARE' ? 'da creche' : newSitio.type === 'RESIDENT' ? 'do morador' : 'do local';
      setAdminToast({ show: true, message: `Por favor, informe o nome ${typeLabel}!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return;
    }

    const finalLat = Number(newSitio.lat) || -9.2201;
    const finalLng = Number(newSitio.lng) || -36.3503;
    
    const payload = {
      ...newSitio,
      name: trimmedName,
      lat: finalLat,
      lng: finalLng,
      fuelType: newSitio.type === 'FUEL' ? newSitio.fuelType : 'NONE'
    };

    try {
      if (editingSitio) {
        await updateDoc(doc(db, 'sitios', editingSitio.id), payload);
        setAdminToast({ show: true, message: 'Ponto atualizado com sucesso no Firebase!' });
      } else {
        await addDoc(collection(db, 'sitios'), payload);

        // Se for Morador, Escola ou Creche, cadastra também em residents para disponibilizar para entregas
        if (newSitio.type === 'RESIDENT' || newSitio.type === 'SCHOOL' || newSitio.type === 'DAYCARE') {
          try {
            await addDoc(collection(db, 'residents'), {
              name: trimmedName,
              address: newSitio.description || trimmedName,
              neighborhood: newSitio.description || 'Inhapi',
              phone: '',
              referencePoint: newSitio.description || '',
              councilman: '',
              category: newSitio.type,
              lat: finalLat,
              lng: finalLng,
              createdAt: new Date().toISOString()
            });
          } catch (resErr) {
            console.warn("Could not sync sitio to residents collection:", resErr);
          }
        }

        setAdminToast({ show: true, message: 'Ponto cadastrado com sucesso no Firebase!' });
      }
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (err: any) {
      console.error("Firestore save failed:", err);
      const tempId = editingSitio ? editingSitio.id : 'temp-sitio-' + Date.now();
      const sObj = { id: tempId, ...payload } as Sitio;
      if (editingSitio) {
        setSitios(prev => prev.map(s => s.id === editingSitio.id ? sObj : s));
      } else {
        setSitios(prev => [...prev, sObj]);
      }
      setAdminToast({ show: true, message: 'Salvo localmente (Operando em Contingência)' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4500);
      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    } finally {
      setNewSitio({ 
        name: '', 
        description: '', 
        lat: -9.2201, 
        lng: -36.3503,
        rawCoords: '-9.2201, -36.3503',
        type: 'RESIDENT',
        fuelType: 'NONE'
      });
      setEditingSitio(null);
      setShowAddSitio(false);
    }
  };

  const handleQuickAddCouncilman = async (name: string): Promise<string> => {
    const trimmed = name.trim();
    if (!trimmed) return '';
    try {
      const docRef = await addDoc(collection(db, 'councilmen'), { name: trimmed });
      const newObj: Councilman = { id: docRef.id, name: trimmed };
      setCouncilmen(prev => prev.some(c => c.name.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, newObj]);
      setAdminToast({ show: true, message: `Vereador "${trimmed}" cadastrado no Firebase!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return trimmed;
    } catch (err: any) {
      console.error("Failed to add councilman:", err);
      const tempId = 'temp-coun-' + Date.now();
      const newObj: Councilman = { id: tempId, name: trimmed };
      setCouncilmen(prev => [...prev, newObj]);
      setAdminToast({ show: true, message: `Vereador "${trimmed}" salvo localmente!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return trimmed;
    }
  };

  const handleAddResident = async () => {
    const trimmedName = newResident.name.trim();
    const category = newResident.category || 'RESIDENT';
    const categoryTitle = 
      category === 'SCHOOL' ? 'Escola' :
      category === 'DAYCARE' ? 'Creche' : 'Morador';

    if (!trimmedName) {
      const label = category === 'SCHOOL' ? 'da escola' : category === 'DAYCARE' ? 'da creche' : 'do morador';
      setResidentFormError(`Por favor, digite o nome ${label}.`);
      setAdminToast({ show: true, message: `Informe o nome ${label}!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return;
    }

    // Checagem de duplicata com aviso antes de salvar
    const exactMatch = residents.find(r => (r.name || '').trim().toLowerCase() === trimmedName.toLowerCase());
    if (exactMatch && !duplicateWarningAcknowledged) {
      setResidentFormError(`Atenção: Já existe um cadastro com o nome "${exactMatch.name}" no sítio "${exactMatch.neighborhood || exactMatch.address || 'Inhapi'}". Se deseja salvar mesmo assim, clique em Salvar novamente ou edite o cadastro existente.`);
      setDuplicateWarningAcknowledged(true);
      setAdminToast({ show: true, message: `Atenção: "${exactMatch.name}" já está cadastrado!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4500);
      return;
    }

    setResidentFormError('');
    setIsSavingResident(true);

    const trimmedNeighborhood = newResident.neighborhood.trim();
    let finalAddress = newResident.address.trim();
    if (!finalAddress) {
      finalAddress = trimmedNeighborhood ? `Sítio ${trimmedNeighborhood}` : 'Inhapi';
    }

    const payload: any = {
      name: trimmedName,
      address: finalAddress,
      neighborhood: trimmedNeighborhood || 'Inhapi',
      sector: newResident.sector?.trim() || trimmedNeighborhood || 'Inhapi',
      preferredDriver: newResident.preferredDriver?.trim() || '',
      phone: newResident.phone.trim(),
      referencePoint: newResident.referencePoint.trim(),
      councilman: newResident.councilman.trim(),
      category: category,
      lat: -9.2201,
      lng: -36.3503,
      createdAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'residents'), payload);

      // Se for Escola ou Creche, cadastra também em 'sitios' para aparecer fixo no mapa operacional
      if (category === 'SCHOOL' || category === 'DAYCARE') {
        try {
          await addDoc(collection(db, 'sitios'), {
            name: trimmedName,
            description: `${categoryTitle} cadastrada pela Secretaria${trimmedNeighborhood ? ` - Sítio ${trimmedNeighborhood}` : ''}`,
            lat: -9.2201,
            lng: -36.3503,
            type: category,
            fuelType: 'NONE',
            referencePoint: newResident.referencePoint.trim()
          });
        } catch (sitioErr) {
          console.warn("Could not sync to sitios:", sitioErr);
        }
      }

      setAdminToast({ show: true, message: `${categoryTitle} "${trimmedName}" cadastrado(a) com sucesso!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3500);
      setShowAddResident(false);
      setShowNameAutocomplete(false);
      setDuplicateWarningAcknowledged(false);
      setNewResident({ 
        name: '', 
        address: '', 
        neighborhood: '', 
        phone: '', 
        referencePoint: '', 
        councilman: '',
        category: 'RESIDENT',
        preferredDriver: '',
        sector: ''
      });
      setIsAddingCouncilmanInResident(false);
      setInlineCouncilmanName('');
    } catch (err: any) {
      console.error("Firestore save failed:", err);
      const tempId = 'temp-res-' + Date.now();
      const rObj = { id: tempId, ...payload } as Resident;
      setResidents(prev => [...prev, rObj]);

      if (category === 'SCHOOL' || category === 'DAYCARE') {
        const sObj: Sitio = {
          id: 'temp-sitio-' + Date.now(),
          name: trimmedName,
          description: `${categoryTitle} - ${trimmedNeighborhood || 'Inhapi'}`,
          lat: -9.2201,
          lng: -36.3503,
          type: category,
          fuelType: 'NONE',
          referencePoint: newResident.referencePoint.trim()
        };
        setSitios(prev => [...prev, sObj]);
      }

      setAdminToast({ show: true, message: `${categoryTitle} salvo(a) localmente (Operando em Contingência)` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      setShowAddResident(false);
      setShowNameAutocomplete(false);
      setDuplicateWarningAcknowledged(false);
      setNewResident({ 
        name: '', 
        address: '', 
        neighborhood: '', 
        phone: '', 
        referencePoint: '', 
        councilman: '',
        category: 'RESIDENT'
      });
      setIsAddingCouncilmanInResident(false);
      setInlineCouncilmanName('');

      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    } finally {
      setIsSavingResident(false);
    }
  };

  const handleAddCouncilman = async () => {
    if (!newCouncilman.name) return;
    try {
      await addDoc(collection(db, 'councilmen'), newCouncilman);
      setAdminToast({ show: true, message: 'Vereador cadastrado com sucesso no Firebase!' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (err: any) {
      console.error("Firestore save failed:", err);
      const tempId = 'temp-coun-' + Date.now();
      const cObj = { id: tempId, ...newCouncilman } as Councilman;
      setCouncilmen(prev => [...prev, cObj]);
      setAdminToast({ show: true, message: 'Salvo localmente (Operando em Contingência)' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    } finally {
      setNewCouncilman({ name: '' });
      setShowAddCouncilman(false);
    }
  };

  const handleAddDriver = async () => {
    if (!newDriver.name || !newDriver.phone) return;
    const payload: any = {
      name: newDriver.name.trim(),
      phone: newDriver.phone.trim(),
      sector: newDriver.sector ? newDriver.sector.trim() : '',
      address: newDriver.address ? newDriver.address.trim() : '',
      homeSitio: newDriver.homeSitio ? newDriver.homeSitio.trim() : ''
    };
    if (newDriver.homeLat && newDriver.homeLng) {
      payload.homeLat = Number(newDriver.homeLat);
      payload.homeLng = Number(newDriver.homeLng);
      payload.homeGpsSavedAt = new Date().toISOString();
      payload.homeGpsAccuracy = 10;
    }
    try {
      await addDoc(collection(db, 'drivers'), payload);
      setAdminToast({ show: true, message: 'Motorista cadastrado com sucesso no Firebase!' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (err: any) {
      console.error("Firestore save failed:", err);
      const tempId = 'temp-drv-' + Date.now();
      const drvObj = { id: tempId, ...payload } as Driver;
      setDrivers(prev => [...prev, drvObj]);
      setAdminToast({ show: true, message: 'Salvo localmente (Operando em Contingência)' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      if (err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('resource-exhausted')) {
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
      }
    } finally {
      setNewDriver({ name: '', phone: '', sector: '', address: '', homeSitio: '', homeLat: 0, homeLng: 0 });
      setShowAddDriver(false);
    }
  };

  // ==========================================
  // ABASTECIMENTO E CONSUMO DE COMBUSTÍVEL POR SETOR
  // ==========================================

  // Abre modal para novo registro de abastecimento
  const handleOpenAddFuelModal = (suggestedTruckId?: string) => {
    setEditingFuelLog(null);
    setFuelFormError('');

    const targetTruckId = suggestedTruckId || (trucks.length > 0 ? trucks[0].id : '');
    const selectedTruck = trucks.find(t => t.id === targetTruckId);
    
    // Procura último abastecimento desse caminhão para sugerir o odômetro anterior
    const truckLogs = fuelLogs.filter(f => f.truckId === targetTruckId);
    const lastKm = truckLogs.length > 0 ? truckLogs[0].currentKm : '';

    setFuelFormData({
      truckId: targetTruckId,
      plate: selectedTruck?.plate || '',
      driverName: selectedTruck?.driverName || '',
      sector: selectedTruck?.sector || '',
      date: new Date().toISOString().slice(0, 16),
      liters: '',
      pricePerLiter: '6.45',
      totalCost: '',
      fuelType: 'DIESEL_S10',
      currentKm: '',
      previousKm: lastKm,
      gasStation: 'Posto Central Inhapi',
      invoiceNumber: '',
      photoReceipt: '',
      notes: ''
    });
    setShowAddFuelModal(true);
  };

  // Abre modal para edição
  const handleOpenEditFuelModal = (log: FuelLog) => {
    setEditingFuelLog(log);
    setFuelFormError('');
    setFuelFormData({
      truckId: log.truckId || '',
      plate: log.plate || '',
      driverName: log.driverName || '',
      sector: log.sector || '',
      date: log.date ? new Date(log.date).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
      liters: log.liters ?? '',
      pricePerLiter: log.pricePerLiter ?? '',
      totalCost: log.totalCost ?? '',
      fuelType: log.fuelType || 'DIESEL_S10',
      currentKm: log.currentKm ?? '',
      previousKm: log.previousKm ?? '',
      gasStation: log.gasStation || 'Posto Central Inhapi',
      invoiceNumber: log.invoiceNumber || '',
      photoReceipt: log.photoReceipt || '',
      notes: log.notes || ''
    });
    setShowAddFuelModal(true);
  };

  // Seleção de caminhão no formulário
  const handleTruckSelectionInFuelForm = (targetTruckId: string) => {
    const selectedTruck = trucks.find(t => t.id === targetTruckId);
    const truckLogs = fuelLogs.filter(f => f.truckId === targetTruckId && (!editingFuelLog || f.id !== editingFuelLog.id));
    const lastKm = truckLogs.length > 0 ? truckLogs[0].currentKm : '';

    setFuelFormData(prev => ({
      ...prev,
      truckId: targetTruckId,
      plate: selectedTruck?.plate || '',
      driverName: selectedTruck?.driverName || prev.driverName,
      sector: selectedTruck?.sector || prev.sector,
      previousKm: prev.previousKm !== '' ? prev.previousKm : lastKm
    }));
  };

  // Salvar Abastecimento (Novo ou Edição)
  const handleSaveFuelLog = async () => {
    if (!fuelFormData.truckId) {
      setFuelFormError('Selecione um caminhão-pipa.');
      return;
    }
    const litersNum = Number(fuelFormData.liters);
    if (!litersNum || litersNum <= 0) {
      setFuelFormError('Informe a quantidade de litros abastecidos (maior que zero).');
      return;
    }
    const currentKmNum = Number(fuelFormData.currentKm);
    if (fuelFormData.currentKm === '' || isNaN(currentKmNum) || currentKmNum < 0) {
      setFuelFormError('Informe a quilometragem atual do odômetro.');
      return;
    }
    const prevKmNum = fuelFormData.previousKm !== '' ? Number(fuelFormData.previousKm) : 0;
    if (prevKmNum > 0 && currentKmNum < prevKmNum) {
      setFuelFormError(`O odômetro atual (${currentKmNum} km) não pode ser inferior ao anterior (${prevKmNum} km).`);
      return;
    }

    const distanceKm = Math.max(0, currentKmNum - prevKmNum);
    const kmPerLiter = distanceKm > 0 && litersNum > 0 ? Number((distanceKm / litersNum).toFixed(2)) : 0;
    const litersPerKm = distanceKm > 0 && litersNum > 0 ? Number((litersNum / distanceKm).toFixed(3)) : 0;

    let pricePerLiterNum = Number(fuelFormData.pricePerLiter) || 0;
    let totalCostNum = Number(fuelFormData.totalCost) || 0;

    if (totalCostNum <= 0 && pricePerLiterNum > 0 && litersNum > 0) {
      totalCostNum = Number((pricePerLiterNum * litersNum).toFixed(2));
    } else if (pricePerLiterNum <= 0 && totalCostNum > 0 && litersNum > 0) {
      pricePerLiterNum = Number((totalCostNum / litersNum).toFixed(2));
    }

    const costPerKm = distanceKm > 0 && totalCostNum > 0 ? Number((totalCostNum / distanceKm).toFixed(2)) : 0;

    const payload: Omit<FuelLog, 'id'> = {
      truckId: fuelFormData.truckId,
      plate: (fuelFormData.plate || 'SEM PLACA').toUpperCase(),
      driverName: fuelFormData.driverName || 'Motorista Não Identificado',
      sector: fuelFormData.sector.trim() || 'Inhapi (Centro)',
      date: fuelFormData.date ? new Date(fuelFormData.date).toISOString() : new Date().toISOString(),
      liters: litersNum,
      pricePerLiter: pricePerLiterNum,
      totalCost: totalCostNum,
      fuelType: fuelFormData.fuelType || 'DIESEL_S10',
      currentKm: currentKmNum,
      previousKm: prevKmNum,
      distanceKm,
      kmPerLiter,
      litersPerKm,
      costPerKm,
      gasStation: fuelFormData.gasStation.trim() || 'Posto de Inhapi',
      invoiceNumber: fuelFormData.invoiceNumber.trim(),
      photoReceipt: fuelFormData.photoReceipt || '',
      notes: fuelFormData.notes.trim(),
      createdAt: editingFuelLog?.createdAt || new Date().toISOString()
    };

    setIsSavingFuelLog(true);
    setFuelFormError('');
    try {
      if (editingFuelLog) {
        await updateDoc(doc(db, 'fuel_logs', editingFuelLog.id), payload);
        setAdminToast({ show: true, message: 'Abastecimento atualizado com sucesso!' });
      } else {
        await addDoc(collection(db, 'fuel_logs'), payload);
        setAdminToast({ show: true, message: 'Abastecimento registrado com sucesso no Firebase!' });
      }
      setShowAddFuelModal(false);
      setEditingFuelLog(null);
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (err: any) {
      console.error("Firestore save fuel log failed:", err);
      const tempId = editingFuelLog ? editingFuelLog.id : 'temp-fuel-' + Date.now();
      const localObj = { id: tempId, ...payload } as FuelLog;
      if (editingFuelLog) {
        setFuelLogs(prev => prev.map(f => f.id === editingFuelLog.id ? localObj : f));
      } else {
        setFuelLogs(prev => [localObj, ...prev]);
      }
      setAdminToast({ show: true, message: 'Salvo localmente (Modo Contingência)' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
      setShowAddFuelModal(false);
      setEditingFuelLog(null);
    } finally {
      setIsSavingFuelLog(false);
    }
  };

  // Excluir Abastecimento
  const handleDeleteFuelLog = async (logId: string) => {
    try {
      await deleteDoc(doc(db, 'fuel_logs', logId));
      setAdminToast({ show: true, message: 'Registro de abastecimento excluído.' });
    } catch (e: any) {
      console.warn("Could not delete fuel log from firestore:", e);
      setFuelLogs(prev => prev.filter(f => f.id !== logId));
      setAdminToast({ show: true, message: 'Registro removido localmente.' });
    }
    setFuelDeleteConfirm(null);
    setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
  };

  // Exportar Relatório de Abastecimento e Consumo por Setor em CSV
  const handleExportFuelLogsCSV = () => {
    if (fuelLogs.length === 0) {
      setAdminToast({ show: true, message: 'Nenhum registro de abastecimento para exportar.' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return;
    }
    const headers = [
      'Data/Hora',
      'Placa',
      'Motorista',
      'Setor',
      'Tipo de Combustivel',
      'Litros Abastecidos',
      'Odometro Anterior (KM)',
      'Odometro Atual (KM)',
      'Distancia Percorrida (KM)',
      'Consumo Medio (KM/L)',
      'Consumo (Litros/KM)',
      'Preco por Litro (R$)',
      'Valor Total (R$)',
      'Custo por KM (R$/KM)',
      'Posto / Fornecedor',
      'Nota Fiscal / Requisicao',
      'Observacoes'
    ];
    const rows = fuelLogs.map(l => [
      l.date ? new Date(l.date).toLocaleString('pt-BR') : '',
      l.plate || '',
      `"${(l.driverName || '').replace(/"/g, '""')}"`,
      `"${(l.sector || '').replace(/"/g, '""')}"`,
      l.fuelType || 'DIESEL_S10',
      l.liters || 0,
      l.previousKm || 0,
      l.currentKm || 0,
      l.distanceKm || 0,
      l.kmPerLiter || 0,
      l.litersPerKm || 0,
      (l.pricePerLiter || 0).toFixed(2),
      (l.totalCost || 0).toFixed(2),
      (l.costPerKm || 0).toFixed(2),
      `"${(l.gasStation || '').replace(/"/g, '""')}"`,
      `"${(l.invoiceNumber || '').replace(/"/g, '""')}"`,
      `"${(l.notes || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `abastecimento_consumo_setores_inhapi_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setAdminToast({ show: true, message: 'Relatório CSV de combustível exportado com sucesso!' });
    setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
  };

  // Métricas Consolidadas de Consumo por Setor
  const sectorConsumptionStats = useMemo(() => {
    const sectorMap: Record<string, {
      sector: string;
      totalLiters: number;
      totalDistanceKm: number;
      totalCost: number;
      logCount: number;
      trucks: Set<string>;
      drivers: Set<string>;
      logs: FuelLog[];
    }> = {};

    fuelLogs.forEach(log => {
      const sec = (log.sector || 'Inhapi (Centro)').trim();
      if (!sectorMap[sec]) {
        sectorMap[sec] = {
          sector: sec,
          totalLiters: 0,
          totalDistanceKm: 0,
          totalCost: 0,
          logCount: 0,
          trucks: new Set(),
          drivers: new Set(),
          logs: []
        };
      }
      sectorMap[sec].totalLiters += Number(log.liters) || 0;
      sectorMap[sec].totalDistanceKm += Number(log.distanceKm) || 0;
      sectorMap[sec].totalCost += Number(log.totalCost) || 0;
      sectorMap[sec].logCount += 1;
      if (log.plate) sectorMap[sec].trucks.add(log.plate);
      if (log.driverName) sectorMap[sec].drivers.add(log.driverName);
      sectorMap[sec].logs.push(log);
    });

    return Object.values(sectorMap).map(item => {
      const avgKmPerLiter = item.totalLiters > 0 && item.totalDistanceKm > 0 
        ? Number((item.totalDistanceKm / item.totalLiters).toFixed(2)) 
        : 0;
      const avgLitersPerKm = item.totalDistanceKm > 0 && item.totalLiters > 0 
        ? Number((item.totalLiters / item.totalDistanceKm).toFixed(3)) 
        : 0;
      const avgCostPerKm = item.totalDistanceKm > 0 && item.totalCost > 0 
        ? Number((item.totalCost / item.totalDistanceKm).toFixed(2)) 
        : 0;
      
      let efficiency: 'EXCELLENT' | 'NORMAL' | 'WARNING' = 'NORMAL';
      if (avgKmPerLiter >= 2.8) efficiency = 'EXCELLENT';
      else if (avgKmPerLiter > 0 && avgKmPerLiter < 2.2) efficiency = 'WARNING';

      return {
        ...item,
        avgKmPerLiter,
        avgLitersPerKm,
        avgCostPerKm,
        efficiency,
        trucksList: Array.from(item.trucks),
        driversList: Array.from(item.drivers)
      };
    }).sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);
  }, [fuelLogs]);

  // KPIs Totais da Frota de Caminhões-Pipa
  const fleetFuelKPIs = useMemo(() => {
    let totalLiters = 0;
    let totalDistanceKm = 0;
    let totalCost = 0;

    fuelLogs.forEach(f => {
      totalLiters += Number(f.liters) || 0;
      totalDistanceKm += Number(f.distanceKm) || 0;
      totalCost += Number(f.totalCost) || 0;
    });

    const avgKmPerLiter = totalLiters > 0 && totalDistanceKm > 0 
      ? Number((totalDistanceKm / totalLiters).toFixed(2)) 
      : 0;
    const avgLitersPerKm = totalDistanceKm > 0 && totalLiters > 0 
      ? Number((totalLiters / totalDistanceKm).toFixed(3)) 
      : 0;
    const avgCostPerKm = totalDistanceKm > 0 && totalCost > 0 
      ? Number((totalCost / totalDistanceKm).toFixed(2)) 
      : 0;

    return {
      totalLogs: fuelLogs.length,
      totalLiters: Math.round(totalLiters),
      totalDistanceKm: Math.round(totalDistanceKm),
      totalCost,
      avgKmPerLiter,
      avgLitersPerKm,
      avgCostPerKm
    };
  }, [fuelLogs]);

  // Registros de Abastecimento Filtrados
  const filteredFuelLogs = useMemo(() => {
    return fuelLogs.filter(log => {
      if (fuelSectorFilter !== 'ALL' && (log.sector || '').toLowerCase() !== fuelSectorFilter.toLowerCase()) {
        return false;
      }
      if (fuelTruckFilter !== 'ALL' && log.truckId !== fuelTruckFilter && log.plate !== fuelTruckFilter) {
        return false;
      }
      if (fuelPeriodFilter === 'TODAY') {
        const logDateStr = new Date(log.date).toLocaleDateString('en-CA');
        if (logDateStr !== todayStr) return false;
      } else if (fuelPeriodFilter === 'WEEK') {
        const logTime = new Date(log.date).getTime();
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (logTime < weekAgo) return false;
      } else if (fuelPeriodFilter === 'MONTH') {
        const logTime = new Date(log.date).getTime();
        const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        if (logTime < monthAgo) return false;
      }
      if (fuelSearch.trim()) {
        const q = fuelSearch.toLowerCase().trim();
        const plateMatch = (log.plate || '').toLowerCase().includes(q);
        const driverMatch = (log.driverName || '').toLowerCase().includes(q);
        const sectorMatch = (log.sector || '').toLowerCase().includes(q);
        const stationMatch = (log.gasStation || '').toLowerCase().includes(q);
        const invoiceMatch = (log.invoiceNumber || '').toLowerCase().includes(q);
        return plateMatch || driverMatch || sectorMatch || stationMatch || invoiceMatch;
      }
      return true;
    });
  }, [fuelLogs, fuelSectorFilter, fuelTruckFilter, fuelPeriodFilter, fuelSearch, todayStr]);

  const [deleteConfirm, setDeleteConfirm] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const handleDelete = (collectionName: string, id: string) => {
    setDeleteConfirm({
      show: true,
      title: 'Excluir Item',
      message: 'Tem certeza que deseja excluir este item permanentemente? Esta ação não poderá ser desfeita.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, collectionName, id));
          setAdminToast({ show: true, message: 'Item excluído com sucesso!' });
          setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
        } catch (e: any) {
          setAdminToast({ show: true, message: 'Erro ao excluir item: ' + e.message });
          setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
        }
      }
    });
  };

  const handleDeleteAll = (collectionName: string, items: any[]) => {
    if (!items || items.length === 0) {
      setAdminToast({ show: true, message: 'Não há itens para apagar.' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      return;
    }
    
    const translateCol: Record<string, string> = {
      residents: 'moradores',
      trucks: 'caminhões',
      drivers: 'motoristas',
      councilmen: 'vereadores',
      deliveries: 'entregas',
      sitios: 'pontos de abastecimento'
    };
    const colLabel = translateCol[collectionName] || collectionName;

    setDeleteConfirm({
      show: true,
      title: 'Apagar Todos os Registros',
      message: `ATENÇÃO: Isso apagará permanentemente todos os ${items.length} itens de ${colLabel}. Deseja prosseguir com a exclusão em massa?`,
      onConfirm: async () => {
        const batch = writeBatch(db);
        items.forEach(item => {
          if (item && item.id) {
            batch.delete(doc(db, collectionName, item.id));
          }
        });

        try {
          await batch.commit();
          setAdminToast({ show: true, message: `Todos os itens de ${colLabel} foram apagados.` });                
          setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);                
        } catch (e: any) {
          setAdminToast({ show: true, message: 'Erro ao apagar todos: ' + e.message });
          setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);
        }
      }
    });
  };

  const DeleteConfirmationModal = () => {
    if (!deleteConfirm) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <div className="bg-white rounded-[32px] p-6 max-w-sm w-full border border-slate-100 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <Trash2 size={24} />
            </div>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft size={15} />
            </button>
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900">{deleteConfirm.title}</h3>
            <p className="text-sm text-slate-500 mt-1">{deleteConfirm.message}</p>
          </div>
          <div className="flex gap-2.5 mt-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="flex-1 bg-slate-100 py-3 rounded-xl font-bold text-slate-600 text-sm hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                deleteConfirm.onConfirm();
                setDeleteConfirm(null);
              }}
              className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-red-700 transition-colors"
            >
              Excluir
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleDeleteAllDeliveries = async () => {
    if (deleteHistoryPassword !== actualAdminPassword) {
      setDeleteHistoryError('Senha incorreta.');
      return;
    }

    if (deliveries.length === 0) {
      setDeleteHistoryError('Não há entregas para apagar.');
      return;
    }

    try {
      const batch = writeBatch(db);
      deliveries.forEach(delivery => {
        batch.delete(doc(db, 'deliveries', delivery.id));
      });
      await batch.commit();

      setAdminToast({ show: true, message: 'Histórico de entregas apagado com sucesso!' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
      setShowDeleteDeliveriesModal(false);
      setDeleteHistoryPassword('');
      setDeleteHistoryError('');
    } catch (e: any) {
      setDeleteHistoryError('Erro ao apagar histórico: ' + e.message);
    }
  };

  const handleFinishRouteWithPassword = async () => {
    if (!routeToFinishTruck) return;
    if (finishRoutePassword !== actualAdminPassword) {
      setFinishRouteError('Senha de administrador incorreta.');
      return;
    }

    try {
      await updateDoc(doc(db, 'trucks', routeToFinishTruck.id), {
        status: 'IDLE',
        lastUpdate: new Date().toISOString()
      });

      const truckDeliveries = deliveries.filter(d => d.truckId === routeToFinishTruck.id && d.status === 'IN_ROUTE');
      for (const d of truckDeliveries) {
        await updateDoc(doc(db, 'deliveries', d.id), {
          status: 'DELIVERED',
          createdAt: d.createdAt || new Date().toISOString()
        });
      }

      setAdminToast({ show: true, message: `Rota do motorista ${routeToFinishTruck.driverName} finalizada com sucesso!` });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 4000);

      setShowFinishRouteModal(false);
      setRouteToFinishTruck(null);
      setFinishRoutePassword('');
      setFinishRouteError('');
    } catch (e: any) {
      setFinishRouteError('Erro ao finalizar rota: ' + (e?.message || e));
    }
  };

  const FinishRouteModal = () => {
    if (!showFinishRouteModal || !routeToFinishTruck) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <div className="bg-white rounded-[32px] p-6 max-w-sm w-full border border-slate-100 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <Lock size={24} />
            </div>
            <button
              onClick={() => {
                setShowFinishRouteModal(false);
                setRouteToFinishTruck(null);
                setFinishRoutePassword('');
                setFinishRouteError('');
              }}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft size={15} />
            </button>
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900">Finalizar Rota</h3>
            <p className="text-sm text-slate-500 mt-1">
              Deseja finalizar a rota do motorista <strong>{routeToFinishTruck.driverName}</strong> ({routeToFinishTruck.plate})? Digite a senha administrativa para confirmar:
            </p>
          </div>
          
          <div className="flex flex-col gap-1">
            <input
              type="password"
              placeholder="Senha de Secretário"
              value={finishRoutePassword}
              onChange={e => {
                setFinishRoutePassword(e.target.value);
                setFinishRouteError('');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleFinishRouteWithPassword();
                }
              }}
              className="bg-slate-100 px-4 py-3 rounded-xl text-sm outline-none border border-transparent focus:border-red-500 focus:bg-white transition-all text-center font-mono tracking-widest"
              autoFocus
            />
            {finishRouteError && (
              <p className="text-red-500 text-xs font-bold px-1 mt-1 uppercase tracking-wider">
                ⚠️ {finishRouteError}
              </p>
            )}
          </div>

          <div className="flex gap-2.5 mt-2">
            <button
              onClick={() => {
                setShowFinishRouteModal(false);
                setRouteToFinishTruck(null);
                setFinishRoutePassword('');
                setFinishRouteError('');
              }}
              className="flex-1 bg-slate-100 py-3 rounded-xl font-bold text-slate-600 text-sm hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleFinishRouteWithPassword}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-red-600/20 transition-colors"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const DeleteDeliveriesModal = () => {
    if (!showDeleteDeliveriesModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <div className="bg-white rounded-[32px] p-6 max-w-sm w-full border border-slate-100 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <Trash2 size={24} />
            </div>
            <button
              onClick={() => {
                setShowDeleteDeliveriesModal(false);
                setDeleteHistoryPassword('');
                setDeleteHistoryError('');
              }}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft size={15} />
            </button>
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900">Confirmar Exclusão</h3>
            <p className="text-sm text-slate-500 mt-1">
              Esta ação apagará <strong>permanentemente</strong> todas as {deliveries.length} entregas do histórico. Digite a senha administrativa do sistema para confirmar:
            </p>
          </div>
          
          <div className="flex flex-col gap-1">
            <input
              type="password"
              placeholder="Senha de Secretário"
              value={deleteHistoryPassword}
              onChange={e => {
                setDeleteHistoryPassword(e.target.value);
                setDeleteHistoryError('');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleDeleteAllDeliveries();
                }
              }}
              className="bg-slate-100 px-4 py-3 rounded-xl text-sm outline-none border border-transparent focus:border-red-500 focus:bg-white transition-all text-center font-mono tracking-widest"
              autoFocus
            />
            {deleteHistoryError && (
              <p className="text-red-500 text-xs font-bold px-1 mt-1 uppercase tracking-wider">
                ⚠️ {deleteHistoryError}
              </p>
            )}
          </div>

          <div className="flex gap-2.5 mt-2">
            <button
              onClick={() => {
                setShowDeleteDeliveriesModal(false);
                setDeleteHistoryPassword('');
                setDeleteHistoryError('');
              }}
              className="flex-1 bg-slate-100 py-3 rounded-xl font-bold text-slate-600 text-sm hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleDeleteAllDeliveries}
              className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-red-700 transition-colors"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const [editItem, setEditItem] = useState<{ collectionName: string, item: any } | null>(null);
  const [residentSearch, setResidentSearch] = useState('');
  const [statusConfirmationModal, setStatusConfirmationModal] = useState<{ delivery: Delivery } | null>(null);
  
  const handleEdit = (collectionName: string, item: any) => {
    setEditItem({ collectionName, item });
  };

  const handleUpdate = async (collectionName: string, id: string, data: any) => {
    try {
      await updateDoc(doc(db, collectionName, id), data);
      setEditItem(null);
      setAdminToast({ show: true, message: 'Item atualizado!' });
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (e: any) {
      alert('Erro ao atualizar item: ' + e.message);
    }
  };

  const EditModal = () => {
    if (!editItem) return null;
    const { collectionName, item } = editItem;
    const [fields, setFields] = useState({ ...item });
    const [isAddingCouncilmanEdit, setIsAddingCouncilmanEdit] = useState(false);
    const [inlineCouncilmanEdit, setInlineCouncilmanEdit] = useState('');
    
    return (
      <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-[2000] flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white p-4.5 md:p-6 rounded-2xl w-full max-w-md shadow-xl border-2 border-brand-dark/10 max-h-[92vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-black uppercase tracking-tight">
              Editar {
                collectionName === 'residents' ? 'Morador' :
                collectionName === 'trucks' ? 'Caminhão' :
                collectionName === 'drivers' ? 'Motorista' : 'Vereador'
              }
            </h3>
            <button
              onClick={() => setEditItem(null)}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft size={15} />
            </button>
          </div>
          
          <div className="space-y-4">
            {collectionName === 'residents' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Tipo / Categoria</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setFields({ ...fields, category: 'RESIDENT' })}
                      className={`py-2 rounded-xl text-xs font-bold uppercase transition-all border flex items-center justify-center gap-1 cursor-pointer ${
                        (!fields.category || fields.category === 'RESIDENT')
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Home size={12} /> Morador
                    </button>
                    <button
                      type="button"
                      onClick={() => setFields({ ...fields, category: 'SCHOOL' })}
                      className={`py-2 rounded-xl text-xs font-bold uppercase transition-all border flex items-center justify-center gap-1 cursor-pointer ${
                        fields.category === 'SCHOOL'
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <School size={12} /> Escola
                    </button>
                    <button
                      type="button"
                      onClick={() => setFields({ ...fields, category: 'DAYCARE' })}
                      className={`py-2 rounded-xl text-xs font-bold uppercase transition-all border flex items-center justify-center gap-1 cursor-pointer ${
                        fields.category === 'DAYCARE'
                          ? 'bg-pink-600 border-pink-500 text-white shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Baby size={12} /> Creche
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Nome {fields.category === 'SCHOOL' ? 'da Escola' : fields.category === 'DAYCARE' ? 'da Creche' : 'Completo do Morador'}
                  </label>
                  <input 
                    type="text" 
                    value={fields.name || ''} 
                    onChange={e => setFields({ ...fields, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Endereço</label>
                  <input 
                    type="text" 
                    value={fields.address || ''} 
                    onChange={e => setFields({ ...fields, address: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Bairro / Sítio</label>
                  <input 
                    type="text" 
                    value={fields.neighborhood || ''} 
                    onChange={e => setFields({ ...fields, neighborhood: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Telefone</label>
                  <input 
                    type="text" 
                    value={fields.phone || ''} 
                    onChange={e => setFields({ ...fields, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Ponto de Referência</label>
                  <input 
                    type="text" 
                    value={fields.referencePoint || ''} 
                    onChange={e => setFields({ ...fields, referencePoint: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Vereador / Indicação</label>
                    {!isAddingCouncilmanEdit && (
                      <button
                        type="button"
                        onClick={() => { setIsAddingCouncilmanEdit(true); setInlineCouncilmanEdit(''); }}
                        className="text-[10px] font-black text-purple-600 hover:text-purple-700 flex items-center gap-0.5 active:scale-95 transition-all"
                      >
                        <Plus size={10} /> Novo Vereador
                      </button>
                    )}
                  </div>
                  {!isAddingCouncilmanEdit ? (
                    <select 
                      value={fields.councilman || ''} 
                      onChange={e => {
                        if (e.target.value === '__ADD_NEW__') {
                          setIsAddingCouncilmanEdit(true);
                          setInlineCouncilmanEdit('');
                        } else {
                          setFields({ ...fields, councilman: e.target.value });
                        }
                      }}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                    >
                      <option value="">Nenhum / Não informado</option>
                      {councilmen.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      <option value="__ADD_NEW__" className="text-purple-600 font-bold">➕ Adicionar Novo Vereador...</option>
                    </select>
                  ) : (
                    <div className="p-2.5 bg-purple-50/70 border border-purple-200 rounded-xl space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-purple-800 uppercase tracking-wider">Novo Vereador</span>
                        <button
                          type="button"
                          onClick={() => { setIsAddingCouncilmanEdit(false); setInlineCouncilmanEdit(''); }}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Nome do Vereador"
                          value={inlineCouncilmanEdit}
                          onChange={e => setInlineCouncilmanEdit(e.target.value)}
                          className="flex-1 bg-white border border-purple-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-purple-500"
                        />
                        <button
                          type="button"
                          disabled={!inlineCouncilmanEdit.trim()}
                          onClick={async () => {
                            if (inlineCouncilmanEdit.trim()) {
                              const saved = await handleQuickAddCouncilman(inlineCouncilmanEdit);
                              setFields({ ...fields, councilman: saved });
                              setIsAddingCouncilmanEdit(false);
                              setInlineCouncilmanEdit('');
                            }
                          }}
                          className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold active:scale-95 transition-all"
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Setor / Região Específica
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={fields.sector || ''} 
                    onChange={e => setFields({ ...fields, sector: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Motorista Vinculado / Notificado para este Morador
                  </label>
                  <select 
                    value={fields.preferredDriver || ''} 
                    onChange={e => setFields({ ...fields, preferredDriver: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm font-semibold"
                  >
                    <option value="">Detecção Automática (pelo Sítio/Histórico)</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.name}>
                        🚛 {d.name} {d.sector ? `(Setor: ${d.sector})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 pl-1 font-medium">
                    Ao definir, o secretário verá a notificação indicando este motorista para entregas deste morador.
                  </p>
                </div>
              </>
            )}

            {collectionName === 'trucks' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Placa</label>
                  <input 
                    type="text" 
                    value={fields.plate || ''} 
                    onChange={e => setFields({ ...fields, plate: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm font-mono uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Motorista</label>
                  <select 
                    value={fields.driverName || ''} 
                    onChange={e => setFields({ ...fields, driverName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  >
                    <option value="">Selecionar Motorista...</option>
                    {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Setor / Bairros / Sítios de Atuação
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={fields.sector || ''} 
                    onChange={e => setFields({ ...fields, sector: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
              </>
            )}

            {collectionName === 'drivers' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Nome do Motorista</label>
                  <input 
                    type="text" 
                    value={fields.name || ''} 
                    onChange={e => setFields({ ...fields, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Telefone</label>
                  <input 
                    type="text" 
                    value={fields.phone || ''} 
                    onChange={e => setFields({ ...fields, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Setor / Sítios / Região Atendida
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={fields.sector || ''} 
                    onChange={e => setFields({ ...fields, sector: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Endereço / Base do Motorista
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ex: Centro, Rua São Vicente"
                    value={fields.address || ''} 
                    onChange={e => setFields({ ...fields, address: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Sítio onde Mora (Residência)
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={fields.homeSitio || ''} 
                    onChange={e => setFields({ ...fields, homeSitio: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">
                    Coordenadas GPS da Residência ({fields.homeGpsSavedAt ? '✅ Salvo via Celular' : 'Não capturado'})
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="number" 
                      step="any"
                      placeholder="Latitude"
                      value={fields.homeLat ?? ''} 
                      onChange={e => setFields({ ...fields, homeLat: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-3 py-2 text-xs font-mono"
                    />
                    <input 
                      type="number" 
                      step="any"
                      placeholder="Longitude"
                      value={fields.homeLng ?? ''} 
                      onChange={e => setFields({ ...fields, homeLng: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </div>
              </>
            )}

            {collectionName === 'councilmen' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 font-mono">Nome do Vereador</label>
                  <input 
                    type="text" 
                    value={fields.name || ''} 
                    onChange={e => setFields({ ...fields, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-brand-primary outline-none rounded-xl px-4 py-3 text-sm"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-4 mt-8">
            <button 
              onClick={() => setEditItem(null)} 
              className="flex-1 py-3.5 rounded-xl border border-slate-200 text-xs font-bold uppercase transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={() => {
                const { id, ...payload } = fields;
                handleUpdate(collectionName, item.id, payload);
              }} 
              className="flex-1 py-3.5 rounded-xl bg-brand-dark text-white text-xs font-black uppercase shadow-lg shadow-brand-dark/20 hover:scale-[1.02] transition-transform active:scale-95"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const StatusConfirmationModal = () => {
    if (!statusConfirmationModal) return null;
    const { delivery } = statusConfirmationModal;
    
    const getNextStatus = (currentStatus: string) => {
      if (currentStatus === 'PENDING') return 'IN_ROUTE';
      if (currentStatus === 'IN_ROUTE') return 'DELIVERED';
      return null;
    };

    const nextStatus = getNextStatus(delivery.status);
    
    const handleConfirm = async () => {
      if (!nextStatus) return;
      try {
        await updateDoc(doc(db, 'deliveries', delivery.id), { status: nextStatus });
        setAdminToast({ show: true, message: `Status alterado para ${nextStatus === 'IN_ROUTE' ? 'Em Rota' : 'Entregue'}!` });
        setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
        setStatusConfirmationModal(null);
      } catch (e: any) {
        alert('Erro ao atualizar status: ' + e.message);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/50 z-[2000] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-3xl w-full max-w-sm shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-black">Confirmar Alteração</h3>
            <button
              onClick={() => setStatusConfirmationModal(null)}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft size={15} />
            </button>
          </div>
          <p className="text-slate-500 mb-6">Deseja alterar o status da entrega de <span className="font-bold">{delivery.residentName}</span> para <span className="font-bold">{nextStatus === 'IN_ROUTE' ? 'Em Rota' : 'Entregue'}</span>?</p>
          <div className="flex gap-4">
            <button onClick={() => setStatusConfirmationModal(null)} className="flex-1 bg-slate-100 py-3 rounded-xl font-bold hover:bg-slate-200">Cancelar</button>
            <button onClick={handleConfirm} className="flex-1 bg-brand-dark text-white py-3 rounded-xl font-bold hover:bg-indigo-900">Confirmar</button>
          </div>
        </div>
      </div>
    );
  };


  const handleResetAppData = async () => {
    if (resetPasswordInput !== 'admin') {
      alert('Senha incorreta.');
      return;
    }
    
    if (!confirm('TEM CERTEZA? Isso apagará todos os dados de forma irreversível.')) return;

    try {
      const collectionsToReset = ['residents', 'trucks', 'drivers', 'councilmen', 'deliveries', 'sitios'];
      for (const colName of collectionsToReset) {
        const q = query(collection(db, colName));
        const snap = await getDocs(q);
        for (const docSnap of snap.docs) {
          await deleteDoc(doc(db, colName, docSnap.id));
        }
      }
      alert('Dados resetados com sucesso.');
      setResetPasswordInput('');
      setShowResetConfirmation(false);
    } catch (e: any) {
      alert('Erro ao resetar: ' + e.message);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 4) {
      setSettingsError('A senha deve ter pelo menos 4 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSettingsError('As senhas não coincidem');
      return;
    }

    setSettingsLoading(true);
    setSettingsError('');
    try {
      await setDoc(doc(db, 'config', 'admin'), {
        password: newPassword,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setSettingsSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (e) {
      setSettingsError('Erro ao salvar nova senha');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleResetAdminPasswordToDefault = async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      await setDoc(doc(db, 'config', 'admin'), {
        password: '123456',
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setActualAdminPassword('123456');
      setSettingsSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      setAdminToast({ show: true, message: 'Senha do administrador restaurada para 123456!' });
      setTimeout(() => setSettingsSuccess(false), 3000);
      setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
    } catch (e: any) {
      setSettingsError('Erro ao restaurar senha: ' + (e?.message || e));
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleOptimizeRoute = async () => {
    if (!selectedTruck || !selectedTruck.lastLat || !selectedTruck.lastLng) return;

    const truckDeliveries = deliveries.filter(d => 
      d.truckId === selectedTruck.id && 
      (d.status === 'IN_ROUTE' || d.status === 'PENDING')
    );

    if (truckDeliveries.length === 0) {
      alert('Não há entregas para otimizar.');
      return;
    }

    // Simple Nearest Neighbor Algorithm starting from truck current position
    const unvisited = [...truckDeliveries];
    const optimizedSequence: Delivery[] = [];
    let currentPos: [number, number] = [selectedTruck.lastLat, selectedTruck.lastLng];

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const d = unvisited[i];
        const dist = Math.sqrt(Math.pow(d.lat - currentPos[0], 2) + Math.pow(d.lng - currentPos[1], 2));
        if (dist < minDistance) {
          minDistance = dist;
          nearestIdx = i;
        }
      }

      const nearest = unvisited.splice(nearestIdx, 1)[0];
      optimizedSequence.push(nearest);
      currentPos = [nearest.lat, nearest.lng];
    }

    // Creating the waypoints: Current Position -> All Deliveries -> Water Supply Point
    const waypoints: [number, number][] = [
      [selectedTruck.lastLat, selectedTruck.lastLng],
      ...optimizedSequence.map(d => [d.lat, d.lng] as [number, number]),
      WATER_SUPPLY_POINT
    ];

    setSettingsLoading(true);
    const roadRoute = await fetchRoadRoute(waypoints);
    setSettingsLoading(false);

    if (roadRoute && isRoadRoute(roadRoute)) {
      setPlannedRoute(roadRoute);
      setActiveTab('map');
      setSelectedTruck(null);
    } else {
      alert('Não foi possível calcular o traçado real pelas vias no momento. Nenhuma rota em linha reta será traçada.');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <div 
        className="fixed inset-0 z-[-10] opacity-10 bg-center bg-cover" 
        style={{ backgroundImage: 'url(https://i.ibb.co/v4vWjP3B/caminhao-pipa-inhapi-OMZpj2.jpg)' }} 
      />
      <EditModal />
      <StatusConfirmationModal />
      <DeleteConfirmationModal />
      <DeleteDeliveriesModal />
      <FinishRouteModal />
      
      {/* Realtime Delivery Completed Audio Alert Banner */}
      <AnimatePresence>
        {completedDeliveryAlert && completedDeliveryAlert.show && (
          <motion.div
            initial={{ y: -100, scale: 0.9, opacity: 0 }}
            animate={{ y: 24, scale: 1, opacity: 1 }}
            exit={{ y: -100, scale: 0.9, opacity: 0 }}
            className="fixed top-0 left-1/2 -translate-x-1/2 z-[2500] w-[92%] max-w-md bg-emerald-700 text-white p-4 rounded-3xl shadow-2xl border-2 border-emerald-400/40 flex items-center gap-3.5 backdrop-blur-md"
          >
            <div className="w-11 h-11 bg-white/20 rounded-2xl flex items-center justify-center shrink-0 animate-bounce">
              <BellRing size={24} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/80 px-2 py-0.5 rounded-md">
                  Entrega Concluída 💧
                </span>
                <span className="text-[10px] text-emerald-200 font-mono ml-auto">
                  {completedDeliveryAlert.timestamp}
                </span>
              </div>
              <h4 className="font-black text-sm text-white truncate mt-0.5">
                {completedDeliveryAlert.residentName}
              </h4>
              <p className="text-[11px] text-emerald-100 font-medium truncate">
                {completedDeliveryAlert.driverName ? `Motorista: ${completedDeliveryAlert.driverName}` : 'Abastecimento registrado com sucesso'}
                {completedDeliveryAlert.plate ? ` (${completedDeliveryAlert.plate})` : ''}
              </p>
            </div>
            <button
              onClick={() => setCompletedDeliveryAlert(null)}
              className="p-1.5 hover:bg-white/20 rounded-xl transition-colors text-white/80 hover:text-white"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Toast */}
      <AnimatePresence>
        {adminToast.show && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 16, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-0 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[2000] bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center justify-center gap-2 text-xs sm:text-sm font-bold text-center max-w-md mx-auto"
          >
            <CheckCircle2 size={18} className="shrink-0" />
            <span className="leading-snug">{adminToast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Header */}
      <header className="lg:hidden bg-white border-b border-slate-200 px-3 py-2 sm:p-4 flex items-center justify-between sticky top-0 z-[1001] shadow-sm safe-area-top">
        <div className="flex items-center gap-2 min-w-0">
          {activeTab !== 'map' && (
            <button
              onClick={() => setActiveTab('map')}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 shrink-0 cursor-pointer border border-slate-200/80"
              title="Voltar para o Painel Inicial"
              aria-label="Voltar para o Painel Inicial"
            >
              <ArrowLeft size={15} />
            </button>
          )}
          <img 
            src="/brasao-inhapi.svg" 
            alt="Brasão da Prefeitura de Inhapi" 
            className="w-10 h-10 sm:w-11 sm:h-11 object-contain flex-shrink-0 drop-shadow-sm" 
            onError={(e) => { e.currentTarget.src = '/logo-inhapi.png'; }} 
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-black text-[11px] sm:text-sm uppercase tracking-tight truncate leading-tight">
                {userRole === 'admin' ? 'Administração' : 'Secretaria'}
              </h1>
              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${userRole === 'admin' ? 'bg-red-500/10 text-red-600 border border-red-200' : 'bg-blue-500/10 text-blue-600 border border-blue-200'}`}>
                {userRole === 'admin' ? 'ADM' : 'SEC'}
              </span>
            </div>
            <p className="text-[7px] sm:text-[9px] font-black text-brand-teal tracking-widest uppercase leading-none">Operação Pipa</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ThemeSelector variant="compact-light" />
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-slate-50 rounded-xl text-slate-600 active:scale-90 transition-all border border-slate-100 cursor-pointer"
            title="Abrir Menu"
          >
            <div className="flex flex-col gap-0.5 w-4 h-4 items-center justify-center">
              <div className="w-3.5 h-0.5 bg-brand-dark rounded-full" />
              <div className="w-3.5 h-0.5 bg-brand-dark rounded-full" />
              <div className="w-3.5 h-0.5 bg-brand-dark rounded-full" />
            </div>
          </button>
        </div>
      </header>

      {/* Sidebar / Drawer */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onClick={() => setIsSidebarOpen(false)} 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1002] lg:hidden" 
          />
        )}
      </AnimatePresence>
      
      <aside 
        className={`
          fixed inset-y-0 left-0 w-72 bg-white z-[1003] shadow-2xl p-5 sm:p-6 flex flex-col gap-6 transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0 lg:z-0 lg:w-64 lg:shadow-none lg:border-r lg:border-slate-200/80
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3 min-w-0">
            <img 
              src="/brasao-inhapi.svg" 
              alt="Brasão da Prefeitura de Inhapi" 
              className="w-11 h-11 object-contain shrink-0 drop-shadow-sm" 
              onError={(e) => { e.currentTarget.src = '/logo-inhapi.png'; }} 
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-sm tracking-tight text-slate-900 truncate">Operação Pipa</h1>
                <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${userRole === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {userRole === 'admin' ? 'Admin' : 'Secr.'}
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400 truncate">Prefeitura de Inhapi / AL</p>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {[
            { id: 'operational', icon: LayoutDashboard, label: 'Monitoramento Operacional' },
            { id: 'map', icon: Compass, label: 'Monitoramento via Mapa' },
            { id: 'deliveries', icon: ClipboardList, label: 'Relatórios & Histórico' },
            { id: 'fuel', icon: Fuel, label: 'Abastecimento & Consumo' },
            { id: 'sitios', icon: MapPin, label: 'Pontos de Captação' },
            { id: 'residents', icon: Users, label: 'Cadastros' },
            { id: 'sync', icon: Database, label: 'Sincronização' },
            { id: 'settings', icon: Settings, label: 'Ajustes' },
          ].map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button 
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as any);
                  setIsSidebarOpen(false);
                }}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-blue-50 text-blue-700 shadow-xs border border-blue-100' 
                    : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <item.icon size={17} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                  <span className="truncate">{item.label}</span>
                </div>
                
                {item.id === 'operational' && pendingDeliveries > 0 && (
                  <span className="flex items-center justify-center bg-rose-500 text-white font-mono text-[10px] min-w-[20px] h-5 px-1.5 rounded-full shadow-xs tabular-nums" title={`${pendingDeliveries} pedidos pendentes`}>
                    {pendingDeliveries}
                  </span>
                )}

                {item.id === 'deliveries' && totalCompletedDeliveries > 0 && (
                  <span className="flex items-center justify-center bg-emerald-500 text-white font-mono text-[10px] min-w-[20px] h-5 px-1.5 rounded-full shadow-xs tabular-nums">
                    {totalCompletedDeliveries}
                  </span>
                )}

                {item.id === 'fuel' && fuelLogs.length > 0 && (
                  <span className="flex items-center justify-center bg-amber-500 text-white font-mono text-[10px] min-w-[20px] h-5 px-1.5 rounded-full shadow-xs tabular-nums" title={`${fuelLogs.length} abastecimentos registrados`}>
                    {fuelLogs.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 pt-4 border-t border-slate-100">
          {/* Audio Notification Quick Toggle in Sidebar */}
          <button
            onClick={handleToggleSound}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
              soundEnabled
                ? 'bg-emerald-50 border-emerald-200/80 text-emerald-800'
                : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Ativar/desativar aviso sonoro de entregas"
          >
            <span className="flex items-center gap-2 text-xs">
              {soundEnabled ? <Volume2 size={15} className="text-emerald-600" /> : <VolumeX size={15} className="text-slate-400" />}
              Som de Entregas
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${soundEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
              {soundEnabled ? 'Ativo' : 'Mudo'}
            </span>
          </button>

          <div className="pt-0.5">
            <ThemeSelector variant="sidebar" />
          </div>

          <div className="pt-0.5">
            <AndroidInstallBanner variant="button" className="w-full justify-center" />
          </div>

          {onTrocarAcesso && (
            <button 
              onClick={() => {
                onTrocarAcesso();
                setIsSidebarOpen(false);
              }}
              className="flex items-center gap-2.5 px-3 py-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl w-full transition-all text-xs font-semibold cursor-pointer"
            >
              <Smartphone size={16} /> Visão do Motorista
            </button>
          )}

          <button 
            onClick={() => auth.signOut()}
            className="flex items-center gap-2.5 px-3 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl w-full transition-all text-xs font-semibold cursor-pointer"
          >
            <LogOut size={16} /> Sair da Conta
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto flex flex-col pb-0 relative z-0">
        {/* 1. MONITORAMENTO OPERACIONAL - Lista de Pedidos de Água de Moradores */}
        {activeTab === 'operational' && (
          <div className="p-2.5 sm:p-5 lg:p-6 min-h-full flex flex-col gap-3 sm:gap-4 lg:gap-5">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 sm:gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                    <LayoutDashboard size={18} />
                  </span>
                  <h2 className="text-base sm:text-xl font-bold tracking-tight text-slate-900">
                    Monitoramento Operacional
                  </h2>
                </div>
                <p className="text-slate-500 text-[11px] sm:text-xs mt-1 leading-snug">
                  Gestão em tempo real dos pedidos de abastecimento de água de moradores, escolas e localidades.
                </p>
              </div>

              <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setActiveTab('map')}
                  className="h-9 sm:h-10 px-2 sm:px-3.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all duration-200 active:scale-[0.97] cursor-pointer"
                  title="Abrir a tela de Monitoramento via Mapa"
                >
                  <Compass size={14} className="shrink-0" />
                  <span className="truncate">Monitoramento via Mapa</span>
                </button>
                <button
                  onClick={() => {
                    setInServiceModalFilter('in_service');
                    setActiveDashboardModal('in_service');
                  }}
                  className="h-9 sm:h-10 px-2 sm:px-3.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all duration-200 active:scale-[0.97] cursor-pointer"
                  title="Ver Caminhões e Motoristas Em Serviço"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="truncate">Em Serviço ({activeInServiceDrivers.length})</span>
                </button>
                <button 
                  onClick={() => setShowAddDelivery(true)}
                  className="h-9 sm:h-10 px-2 sm:px-3.5 bg-blue-600 hover:bg-blue-700 text-white border border-transparent rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all duration-200 active:scale-[0.97] cursor-pointer"
                >
                  <Plus size={14} className="shrink-0" /> 
                  <span className="truncate">Novo Pedido</span>
                </button>
              </div>
            </header>

            {/* Dashboard Consolidado do Dia */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {/* Card 1: Entregas Concluídas */}
              <button
                onClick={() => setActiveDashboardModal('completed')}
                className="bg-white hover:bg-emerald-50/30 border border-slate-200/80 hover:border-emerald-300 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98] text-left group cursor-pointer gap-1"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                  <span className="text-[10px] sm:text-xs font-semibold text-slate-600 group-hover:text-emerald-700 transition-colors leading-tight block">
                    Concluídas
                  </span>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-lg sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight leading-none">
                      {deliveriesCompletedToday}
                    </span>
                    <span className="text-[10px] sm:text-xs text-emerald-600 font-semibold">Hoje</span>
                  </div>
                  <p className="hidden md:block text-[11px] text-slate-400 font-normal">
                    {totalCompletedDeliveries} acumuladas no total
                  </p>
                </div>
                <div className="hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 items-center justify-center shrink-0 ml-1 group-hover:scale-105 transition-transform">
                  <CheckCircle2 size={20} className="stroke-[2.2]" />
                </div>
              </button>

              {/* Card 2: Caminhões em Rota */}
              <button
                onClick={() => {
                  setActiveDashboardModal('active_trucks');
                  setTrucksModalFilter('all');
                  setTrucksModalSearch('');
                }}
                className="bg-white hover:bg-blue-50/30 border border-slate-200/80 hover:border-blue-300 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98] text-left group cursor-pointer gap-1"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                  <span className="text-[10px] sm:text-xs font-semibold text-slate-600 group-hover:text-blue-700 transition-colors leading-tight block">
                    Rastrear Frota
                  </span>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-lg sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight leading-none">
                      {trucksInRoute}
                    </span>
                    <span className="text-[10px] sm:text-xs text-blue-600 font-semibold">Rota</span>
                  </div>
                  <p className="hidden md:block text-[11px] text-slate-400 font-normal">
                    {allRegisteredDrivers.length} motoristas cadastrados
                  </p>
                </div>
                <div className="hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-blue-500/10 text-blue-600 border border-blue-500/20 items-center justify-center shrink-0 ml-1 group-hover:scale-105 transition-transform">
                  <TruckIcon size={20} className="stroke-[2.2]" />
                </div>
              </button>

              {/* Card 3: Pedidos Pendentes */}
              <button
                onClick={() => setActiveDashboardModal('pending')}
                className="bg-white hover:bg-amber-50/30 border border-slate-200/80 hover:border-amber-300 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98] text-left group cursor-pointer gap-1"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                  <span className="text-[10px] sm:text-xs font-semibold text-slate-600 group-hover:text-amber-700 transition-colors leading-tight block">
                    Pendentes
                  </span>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-lg sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight leading-none">
                      {pendingDeliveries}
                    </span>
                    <span className="text-[10px] sm:text-xs text-amber-600 font-semibold">Fila</span>
                  </div>
                  <p className="hidden md:block text-[11px] text-slate-400 font-normal">
                    Aguardando liberação de rota
                  </p>
                </div>
                <div className="hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20 items-center justify-center shrink-0 ml-1 group-hover:scale-105 transition-transform">
                  <Clock size={20} className="stroke-[2.2]" />
                </div>
              </button>
            </div>

            {/* LISTA DE PEDIDOS DE ÁGUA DE MORADORES */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-5 shadow-sm space-y-4">
              {/* Barra de Filtros e Busca */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                {/* Search Bar */}
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={operationalSearch}
                    onChange={(e) => setOperationalSearch(e.target.value)}
                    placeholder="Buscar por morador, sítio, endereço, vereador ou motorista..."
                    className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-blue-500 outline-none transition-all"
                  />
                  {operationalSearch && (
                    <button
                      onClick={() => setOperationalSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Filtro por Setor / Sítio */}
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1 font-mono">
                    <Filter size={12} /> Setor:
                  </label>
                  <select
                    value={operationalSectorFilter}
                    onChange={(e) => setOperationalSectorFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:bg-white"
                  >
                    <option value="">Todos os Sítios / Setores</option>
                    {operationalSectors.map((sec) => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setOperationalStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    operationalStatusFilter === 'ALL'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>Todos os Pedidos</span>
                  <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${operationalStatusFilter === 'ALL' ? 'bg-blue-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    {deliveries.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setOperationalStatusFilter('PENDING')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    operationalStatusFilter === 'PENDING'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/60'
                  }`}
                >
                  <Clock size={13} className="shrink-0" />
                  <span>Pendentes na Fila</span>
                  <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${operationalStatusFilter === 'PENDING' ? 'bg-amber-700 text-white' : 'bg-amber-200 text-amber-900'}`}>
                    {pendingDeliveries}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setOperationalStatusFilter('IN_ROUTE')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    operationalStatusFilter === 'IN_ROUTE'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60'
                  }`}
                >
                  <TruckIcon size={13} className="shrink-0" />
                  <span>Em Rota / A Caminho</span>
                  <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${operationalStatusFilter === 'IN_ROUTE' ? 'bg-blue-800 text-white' : 'bg-blue-200 text-blue-900'}`}>
                    {deliveries.filter(d => d.status === 'IN_ROUTE').length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setOperationalStatusFilter('DELIVERED_TODAY')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    operationalStatusFilter === 'DELIVERED_TODAY'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60'
                  }`}
                >
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>Concluídas Hoje</span>
                  <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${operationalStatusFilter === 'DELIVERED_TODAY' ? 'bg-emerald-800 text-white' : 'bg-emerald-200 text-emerald-900'}`}>
                    {deliveriesCompletedToday}
                  </span>
                </button>
              </div>

              {/* Lista dos Pedidos de Água */}
              {filteredOperationalDeliveries.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center px-4 space-y-3">
                  <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                    <Droplet size={28} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Nenhum pedido de água encontrado</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      {operationalSearch || operationalSectorFilter || operationalStatusFilter !== 'ALL'
                        ? 'Nenhum pedido corresponde aos filtros aplicados. Tente limpar os filtros de busca.'
                        : 'Não há pedidos registrados no momento. Clique no botão abaixo para adicionar um novo pedido.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAddDelivery(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Plus size={14} /> Novo Pedido de Água
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredOperationalDeliveries.map((delivery) => {
                    const assignedTruckObj = trucks.find(t => t.id === delivery.truckId);
                    const matchingResident = residents.find(r => 
                      (delivery.residentId && r.id === delivery.residentId) || 
                      (delivery.residentName && r.name.toLowerCase() === delivery.residentName.toLowerCase())
                    );
                    const category = matchingResident?.category || 'RESIDENT';
                    const categoryEmoji = category === 'SCHOOL' ? '🏫' : category === 'DAYCARE' ? '👶' : '👤';
                    const categoryBadge = category === 'SCHOOL' ? 'Escola' : category === 'DAYCARE' ? 'Creche' : 'Morador';

                    const hasGps = (typeof delivery.lat === 'number' && typeof delivery.lng === 'number' && (delivery.lat !== -9.2201 || delivery.lng !== -36.3503)) ||
                                   (typeof (delivery as any).deliveredLat === 'number' && typeof (delivery as any).deliveredLng === 'number');

                    const formattedDate = delivery.createdAt ? (() => {
                      try {
                        const d = new Date(delivery.createdAt);
                        return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                      } catch {
                        return delivery.createdAt;
                      }
                    })() : '—';

                    return (
                      <div
                        key={delivery.id}
                        className={`rounded-2xl border p-4 transition-all duration-200 flex flex-col justify-between gap-3 shadow-xs hover:shadow-md ${
                          delivery.status === 'DELIVERED'
                            ? 'bg-emerald-50/20 border-emerald-200 hover:border-emerald-300'
                            : delivery.status === 'IN_ROUTE'
                            ? 'bg-blue-50/25 border-blue-200 hover:border-blue-300'
                            : 'bg-white border-slate-200/90 hover:border-slate-300'
                        }`}
                      >
                        {/* Top: Header with resident name and status badge */}
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs">{categoryEmoji}</span>
                                <h4 className="font-extrabold text-sm text-slate-900 truncate">
                                  {delivery.residentName}
                                </h4>
                                <span className="text-[9px] font-bold px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded-md uppercase">
                                  {categoryBadge}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                                📍 {delivery.address || 'Endereço não informado'}
                              </p>
                            </div>

                            {/* Status badge */}
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 flex items-center gap-1 ${
                              delivery.status === 'DELIVERED'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : delivery.status === 'IN_ROUTE'
                                ? 'bg-blue-100 text-blue-800 border border-blue-300 animate-pulse'
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                            }`}>
                              {delivery.status === 'DELIVERED' && <CheckCircle2 size={11} className="shrink-0" />}
                              {delivery.status === 'IN_ROUTE' && <TruckIcon size={11} className="shrink-0" />}
                              {delivery.status === 'PENDING' && <Clock size={11} className="shrink-0" />}
                              <span>
                                {delivery.status === 'DELIVERED' ? 'Entregue' : delivery.status === 'IN_ROUTE' ? 'Em Rota' : 'Pendente'}
                              </span>
                            </span>
                          </div>

                          {/* Extra info pills */}
                          <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-600">
                            {delivery.neighborhood && (
                              <span className="px-2 py-0.5 bg-slate-100 rounded-md font-medium text-slate-600">
                                Sítio: <strong>{delivery.neighborhood}</strong>
                              </span>
                            )}
                            {delivery.referencePoint && (
                              <span className="px-2 py-0.5 bg-slate-100 rounded-md font-medium text-slate-600">
                                Ref: <strong>{delivery.referencePoint}</strong>
                              </span>
                            )}
                            {delivery.councilman && (
                              <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200/60 rounded-md font-bold">
                                Indicação: {delivery.councilman}
                              </span>
                            )}
                          </div>

                          {/* Caminhão e Motorista Atribuído */}
                          <div className="bg-slate-50/90 border border-slate-100 rounded-xl p-2.5 flex items-center justify-between text-xs">
                            <div className="min-w-0 flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                                <TruckIcon size={14} />
                              </div>
                              <div className="min-w-0">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block leading-none">
                                  Caminhão / Motorista
                                </span>
                                <p className="font-bold text-slate-800 text-xs truncate mt-0.5">
                                  {assignedTruckObj
                                    ? `${assignedTruckObj.plate} • ${assignedTruckObj.driverName || 'Motorista'}`
                                    : (delivery.truckId ? `Caminhão #${delivery.truckId}` : 'Não atribuído')}
                                </p>
                              </div>
                            </div>

                            {/* GPS Status Indicator */}
                            <div className="text-right shrink-0">
                              {hasGps ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100/70 border border-emerald-200 px-2 py-0.5 rounded-md">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  GPS Salvo
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium">
                                  Sem GPS
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-[10px] text-slate-400 font-mono">
                            Data do Pedido: {formattedDate}
                          </div>
                        </div>

                        {/* Bottom Actions */}
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5">
                          {/* Botão Ver no Mapa */}
                          <button
                            onClick={() => {
                              if (assignedTruckObj) setSelectedTruck(assignedTruckObj);
                              setActiveTab('map');
                            }}
                            className="flex-1 py-1.5 px-2 bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer"
                            title="Visualizar a entrega e o caminhão diretamente no Monitoramento via Mapa"
                          >
                            <Compass size={13} className="shrink-0 text-cyan-600" />
                            <span>Ver no Mapa</span>
                          </button>

                          {/* Foto Comprovante */}
                          {delivery.photo && (
                            <button
                              onClick={() => setSelectedPhoto(delivery.photo || null)}
                              className="py-1.5 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer shrink-0"
                              title="Ver foto do comprovante de entrega"
                            >
                              <ImageIcon size={13} className="shrink-0" />
                              <span className="hidden sm:inline">Foto</span>
                            </button>
                          )}

                          {/* Alterar Status */}
                          <button
                            onClick={() => setStatusConfirmationModal({ delivery })}
                            className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                            title="Alterar status deste pedido (Pendente, Em Rota, Entregue)"
                          >
                            Status
                          </button>

                          {/* Editar */}
                          <button
                            onClick={() => handleEdit('deliveries', delivery)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer shrink-0"
                            title="Editar Dados do Pedido"
                          >
                            <Edit2 size={14} />
                          </button>

                          {/* Excluir */}
                          <button
                            onClick={() => handleDelete('deliveries', delivery.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer shrink-0"
                            title="Excluir Pedido"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. MONITORAMENTO VIA MAPA - Tela Exclusiva com Mapa em Tela Cheia */}
        {activeTab === 'map' && (
          <div className="p-2.5 sm:p-5 lg:p-6 min-h-full lg:h-full flex flex-col gap-2.5 sm:gap-4 lg:gap-5">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 sm:gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-cyan-100 text-cyan-800 rounded-lg">
                    <Compass size={18} />
                  </span>
                  <h2 className="text-base sm:text-xl font-bold tracking-tight text-slate-900">
                    Monitoramento via Mapa
                  </h2>
                </div>
                <p className="text-slate-500 text-[11px] sm:text-xs mt-1 leading-snug">
                  Visualização geográfica em tempo real da frota de caminhões-pipa, sítios, escolas e moradores mapeados via satélite/GPS.
                </p>
              </div>

              <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setActiveTab('operational')}
                  className="h-9 sm:h-10 px-2 sm:px-3.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all duration-200 active:scale-[0.97] cursor-pointer"
                  title="Voltar para a Lista de Pedidos de Água de Moradores"
                >
                  <LayoutDashboard size={14} className="shrink-0" />
                  <span className="truncate">Lista de Pedidos</span>
                </button>
                <button
                  onClick={() => {
                    setInServiceModalFilter('in_service');
                    setActiveDashboardModal('in_service');
                  }}
                  className="h-9 sm:h-10 px-2 sm:px-3.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all duration-200 active:scale-[0.97] cursor-pointer"
                  title="Ver Caminhões e Motoristas Em Serviço"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="truncate">Em Serviço ({activeInServiceDrivers.length})</span>
                </button>
                <button 
                  onClick={() => setShowAddDelivery(true)}
                  className="h-9 sm:h-10 px-2 sm:px-3.5 bg-blue-600 hover:bg-blue-700 text-white border border-transparent rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all duration-200 active:scale-[0.97] cursor-pointer"
                >
                  <Plus size={14} className="shrink-0" /> 
                  <span className="truncate">Nova Entrega</span>
                </button>
                <div className="hidden sm:block">
                  <button 
                    onClick={() => auth.signOut()}
                    className="h-10 px-3.5 bg-white hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-xl border border-slate-200 hover:border-red-200 transition-all duration-200 active:scale-[0.97] cursor-pointer shadow-xs flex items-center justify-center gap-1.5 text-xs font-bold"
                    title="Sair da Conta"
                  >
                    <LogOut size={14} /> 
                    <span>Sair</span>
                  </button>
                </div>
              </div>
            </header>

            {/* Dashboard Consolidado do Dia - Otimizado para telas pequenas sem cortes */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {/* Card 1: Entregas Concluídas */}
              <button
                onClick={() => setActiveDashboardModal('completed')}
                className="bg-white hover:bg-emerald-50/30 border border-slate-200/80 hover:border-emerald-300 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98] text-left group cursor-pointer gap-1"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                  <span className="text-[10px] sm:text-xs font-semibold text-slate-600 group-hover:text-emerald-700 transition-colors leading-tight block">
                    Concluídas
                  </span>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-lg sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight leading-none">
                      {deliveriesCompletedToday}
                    </span>
                    <span className="text-[10px] sm:text-xs text-emerald-600 font-semibold">Hoje</span>
                  </div>
                  <p className="hidden md:block text-[11px] text-slate-400 font-normal">
                    {totalCompletedDeliveries} acumuladas no total
                  </p>
                </div>
                <div className="hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 items-center justify-center shrink-0 ml-1 group-hover:scale-105 transition-transform">
                  <CheckCircle2 size={20} className="stroke-[2.2]" />
                </div>
              </button>

              {/* Card 2: Caminhões em Rota / Rastrear Motoristas */}
              <button
                onClick={() => {
                  setActiveDashboardModal('active_trucks');
                  setTrucksModalFilter('all');
                  setTrucksModalSearch('');
                }}
                className="bg-white hover:bg-blue-50/30 border border-slate-200/80 hover:border-blue-300 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98] text-left group cursor-pointer gap-1"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                  <span className="text-[10px] sm:text-xs font-semibold text-slate-600 group-hover:text-blue-700 transition-colors leading-tight block">
                    Rastrear Frota
                  </span>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-lg sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight leading-none">
                      {trucksInRoute}
                    </span>
                    <span className="text-[10px] sm:text-xs text-blue-600 font-semibold">Rota</span>
                  </div>
                  <p className="hidden md:block text-[11px] text-slate-400 font-normal">
                    {allRegisteredDrivers.length} motoristas cadastrados
                  </p>
                </div>
                <div className="hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-blue-500/10 text-blue-600 border border-blue-500/20 items-center justify-center shrink-0 ml-1 group-hover:scale-105 transition-transform">
                  <TruckIcon size={20} className="stroke-[2.2]" />
                </div>
              </button>

              {/* Card 3: Águas Pendentes */}
              <button
                onClick={() => setActiveDashboardModal('pending')}
                className="bg-white hover:bg-amber-50/30 border border-slate-200/80 hover:border-amber-300 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98] text-left group cursor-pointer gap-1"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                  <span className="text-[10px] sm:text-xs font-semibold text-slate-600 group-hover:text-amber-700 transition-colors leading-tight block">
                    Pendentes
                  </span>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-lg sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight leading-none">
                      {pendingDeliveries}
                    </span>
                    <span className="text-[10px] sm:text-xs text-amber-600 font-semibold">Fila</span>
                  </div>
                  <p className="hidden md:block text-[11px] text-slate-400 font-normal">
                    Aguardando liberação de rota
                  </p>
                </div>
                <div className="hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20 items-center justify-center shrink-0 ml-1 group-hover:scale-105 transition-transform">
                  <Clock size={20} className="stroke-[2.2]" />
                </div>
              </button>
            </div>

            <div className="flex-1 min-h-[440px] sm:min-h-[540px] lg:min-h-0 flex flex-col relative z-0">
              <MapContainer 
                trucks={trucks} 
                deliveries={deliveries} 
                sitios={sitios}
                drivers={drivers}
                residents={residents}
                onSelectResidentForDelivery={(res) => {
                  handleSelectResident(res);
                  setShowAddDelivery(true);
                }}
                route={plannedRoute}
                selectedTruckId={selectedTruck?.id}
                onOpenDriverSelector={() => {
                  setActiveDashboardModal('active_trucks');
                  setTrucksModalFilter('all');
                  setTrucksModalSearch('');
                }}
                newPoint={
                  showAddSitio && newSitio.lat !== 0 ? [newSitio.lat, newSitio.lng] : 
                  showAddDelivery && newDelivery.lat !== 0 ? [newDelivery.lat, newDelivery.lng] : null
                }
                onSitioClick={(sitio) => setSelectedSitio(sitio)}
                onMapClick={(lat, lng) => {
                  setNewDelivery(prev => ({ ...prev, lat, lng }));
                  setNewSitio(prev => ({ ...prev, lat, lng, rawCoords: `${lat}, ${lng}` }));
                  // If on map tab and sitting modal open, update coordinates
                  if (showAddSitio || showAddDelivery) {
                    setAdminToast({ show: true, message: 'Coordenadas capturadas do mapa!' });
                    setTimeout(() => setAdminToast({ show: false, message: '' }), 2000);
                  }
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'trucks' && (
          <div className="p-2.5 sm:p-4 lg:p-5 max-w-4xl mx-auto w-full">
             <header className="flex justify-between items-center mb-4 lg:mb-6">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setActiveTab('map')}
                  className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar para o Painel"
                  aria-label="Voltar para o Painel"
                >
                  <ArrowLeft size={16} />
                </button>
                <h2 className="text-2xl lg:text-3xl font-black uppercase tracking-tight">Frota</h2>
              </div>
              <button 
                onClick={() => setShowAddTruck(true)}
                className="bg-brand-dark text-white px-5 py-2.5 rounded-xl font-black uppercase tracking-wider text-xs flex items-center gap-2 shadow-lg shadow-brand-dark/20"
              >
                <Plus size={18} /> Adicionar
              </button>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
              {trucks.map(truck => (
                <div 
                  key={truck.id} 
                  onClick={() => setSelectedTruck(truck)}
                  className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200 cursor-pointer hover:border-brand-dark hover:shadow-lg transition-all active:scale-95 group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-slate-100 rounded-2xl text-slate-600 group-hover:bg-brand-dark group-hover:text-white transition-colors">
                      <TruckIcon size={24} />
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-tighter ${
                      truck.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-600' : 
                      truck.status === 'ARRIVED' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {truck.status === 'IN_ROUTE' ? 'EM ROTA' : truck.status === 'ARRIVED' ? 'NO LOCAL' : 'DISPONÍVEL'}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold mb-1">{truck.driverName}</h3>
                  <p className="text-slate-500 font-mono text-sm mb-3">{truck.plate}</p>

                  {truck.status === 'IN_ROUTE' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRouteToFinishTruck(truck);
                        setFinishRoutePassword('');
                        setFinishRouteError('');
                        setShowFinishRouteModal(true);
                      }}
                      className="w-full mb-3 bg-red-600 hover:bg-red-700 text-white font-black text-[11px] uppercase tracking-wider py-2 px-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Lock size={13} /> Finalizar Rota (Senha)
                    </button>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock size={14} /> {new Date(truck.lastUpdate || '').toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'deliveries' && (
          <div className="p-4 lg:p-8 max-w-5xl mx-auto w-full">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 lg:mb-8">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <button
                    onClick={() => setActiveTab('map')}
                    className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar para o Painel"
                    aria-label="Voltar para o Painel"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-black uppercase tracking-tight text-brand-dark">Histórico de Entregas</h2>
                </div>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Histórico e relatórios de abastecimento de moradias</p>
              </div>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
                <button 
                  onClick={() => {
                    setDeleteHistoryPassword('');
                    setDeleteHistoryError('');
                    setShowDeleteDeliveriesModal(true);
                  }}
                  className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200/50 px-2.5 sm:px-3.5 py-2.5 rounded-xl font-black uppercase tracking-wider text-[10px] sm:text-[11px] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={14} className="shrink-0" /> <span className="truncate">Apagar Histórico</span>
                </button>
                <button 
                  onClick={handleExportResidentsCSV}
                  className="bg-emerald-600 text-white px-2.5 sm:px-3.5 py-2.5 rounded-xl font-black uppercase tracking-wider text-[10px] sm:text-[11px] flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-colors"
                  title="Exportar cadastro completo de moradores para planilha CSV/Excel"
                >
                  <Download size={14} className="shrink-0" /> <span className="truncate">CSV Moradores</span>
                </button>
                <button 
                  onClick={handleExportDeliveriesCSV}
                  className="bg-sky-600 text-white px-2.5 sm:px-3.5 py-2.5 rounded-xl font-black uppercase tracking-wider text-[10px] sm:text-[11px] flex items-center justify-center gap-1.5 shadow-lg shadow-sky-600/20 hover:bg-sky-700 transition-colors"
                  title="Exportar histórico de entregas para planilha CSV/Excel"
                >
                  <Download size={14} className="shrink-0" /> <span className="truncate">CSV Entregas</span>
                </button>
                <button 
                  onClick={handleExportPDF}
                  className="bg-brand-teal text-white px-2.5 sm:px-3.5 py-2.5 rounded-xl font-black uppercase tracking-wider text-[10px] sm:text-[11px] flex items-center justify-center gap-1.5 shadow-lg shadow-brand-teal/20 hover:bg-brand-teal/80 transition-colors"
                >
                  <span className="truncate">Exportar PDF</span>
                </button>
              </div>
            </header>
            
            {/* Gráfico Comparativo e Desempenho por Indicação (Vereadores) com Filtro Mensal */}
            <CouncilmanPerformanceSection 
              deliveries={deliveries}
              councilmen={councilmen}
              residents={residents}
              onViewPhoto={setSelectedPhoto}
            />

            {/* Gráfico Diário dos Últimos 7 Dias */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Volume Diário de Entregas (Últimos 7 Dias)
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Frequência diária geral de abastecimentos realizados
                  </p>
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(() => {
                    const data = [];
                    for (let i = 6; i >= 0; i--) {
                      const date = new Date();
                      date.setDate(date.getDate() - i);
                      const dateString = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                      data.push({
                        date: dateString,
                        count: deliveries.filter(d => {
                          const dDate = new Date(d.createdAt || '');
                          return dDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) === dateString;
                        }).length
                      });
                    }
                    return data;
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fontWeight: 700 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            {/* Barra de Filtros e Modo de Visualização: Por Setor, Por Motorista ou Geral */}
            <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-sm mb-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 block">
                    Modo de Organização das Entregas
                  </span>
                  <h3 className="text-base sm:text-lg font-black text-brand-dark uppercase tracking-tight">
                    Distribuição Operacional das Entregas
                  </h3>
                </div>

                {/* Switcher de Modos: Por Setor, Por Motorista, Lista Geral */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setDeliveryViewMode('BY_SECTOR')}
                    className={`flex-1 md:flex-initial px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      deliveryViewMode === 'BY_SECTOR'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <MapPin size={13} />
                    <span>Por Setor / Região</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryViewMode('BY_DRIVER')}
                    className={`flex-1 md:flex-initial px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      deliveryViewMode === 'BY_DRIVER'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <TruckIcon size={13} />
                    <span>Por Motorista</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryViewMode('ALL')}
                    className={`flex-1 md:flex-initial px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      deliveryViewMode === 'ALL'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <Layers size={13} />
                    <span>Lista Geral ({deliveries.length})</span>
                  </button>
                </div>
              </div>

              {/* Filtros de Busca, Setor, Motorista e Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {/* Campo de Busca Geral */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar morador, sítio ou endereço..."
                    value={deliverySearchQuery}
                    onChange={e => setDeliverySearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all font-medium"
                  />
                  {deliverySearchQuery && (
                    <button
                      onClick={() => setDeliverySearchQuery('')}
                      className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Filtro de Setor */}
                <div>
                  <select
                    value={selectedDeliverySectorFilter}
                    onChange={e => setSelectedDeliverySectorFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold"
                  >
                    <option value="ALL">📍 Todos os Setores / Sítios</option>
                    {sectorsList.map(sec => (
                      <option key={sec} value={sec}>
                        📍 {sec} ({deliveries.filter(d => getDeliverySector(d).toLowerCase() === sec.toLowerCase()).length})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filtro de Motorista */}
                <div>
                  <select
                    value={selectedDeliveryDriverFilter}
                    onChange={e => setSelectedDeliveryDriverFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold"
                  >
                    <option value="ALL">🚛 Todos os Motoristas / Caminhões</option>
                    {trucks.map(t => (
                      <option key={t.id} value={t.id}>
                        🚛 {t.driverName} ({t.plate})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filtro de Status */}
                <div>
                  <select
                    value={deliveryStatusFilter}
                    onChange={e => setDeliveryStatusFilter(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold"
                  >
                    <option value="ALL">Todos os Status ({deliveries.length})</option>
                    <option value="PENDING">⏳ Pendentes ({deliveries.filter(d => d.status === 'PENDING').length})</option>
                    <option value="IN_ROUTE">🚚 Em Rota ({deliveries.filter(d => d.status === 'IN_ROUTE').length})</option>
                    <option value="DELIVERED">✅ Entregues ({deliveries.filter(d => d.status === 'DELIVERED').length})</option>
                  </select>
                </div>
              </div>

              {/* Informação sobre filtros ativos */}
              {(deliverySearchQuery || selectedDeliverySectorFilter !== 'ALL' || selectedDeliveryDriverFilter !== 'ALL' || deliveryStatusFilter !== 'ALL') && (
                <div className="flex items-center justify-between text-xs text-slate-500 bg-blue-50/60 border border-blue-200/60 rounded-xl px-3 py-1.5">
                  <span>
                    Exibindo <strong>{filteredDeliveriesForView.length}</strong> de <strong>{deliveries.length}</strong> entregas filtradas.
                  </span>
                  <button
                    onClick={() => {
                      setDeliverySearchQuery('');
                      setSelectedDeliverySectorFilter('ALL');
                      setSelectedDeliveryDriverFilter('ALL');
                      setDeliveryStatusFilter('ALL');
                    }}
                    className="text-blue-600 hover:text-blue-800 font-bold uppercase text-[10px] tracking-wider cursor-pointer"
                  >
                    Limpar Filtros
                  </button>
                </div>
              )}
            </div>

            {/* VISUALIZAÇÃO 1: POR SETOR / REGIÃO */}
            {deliveryViewMode === 'BY_SECTOR' && (
              <div className="space-y-5">
                {sectorGroupedDeliveries.length === 0 ? (
                  <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center text-slate-400">
                    <MapPin size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-sm">Nenhuma entrega encontrada para os filtros selecionados.</p>
                  </div>
                ) : (
                  sectorGroupedDeliveries.map(group => {
                    const isCollapsed = expandedSectors[group.sectorName] === false;
                    const pendingCount = group.deliveries.filter(d => d.status === 'PENDING').length;
                    const inRouteCount = group.deliveries.filter(d => d.status === 'IN_ROUTE').length;
                    const deliveredCount = group.deliveries.filter(d => d.status === 'DELIVERED').length;

                    return (
                      <div key={group.sectorName} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                        {/* Cabeçalho do Setor */}
                        <div 
                          onClick={() => setExpandedSectors(prev => ({ ...prev, [group.sectorName]: !prev[group.sectorName] }))}
                          className="p-4 sm:p-5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/80 transition-colors"
                        >
                          <div className="flex items-start sm:items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-blue-500/20">
                              <MapPin size={18} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-brand-dark uppercase tracking-tight text-base sm:text-lg">
                                  {group.sectorName}
                                </h3>
                                <span className="bg-blue-100 text-blue-800 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                                  {group.deliveries.length} {group.deliveries.length === 1 ? 'Entrega' : 'Entregas'}
                                </span>
                              </div>

                              {/* Notificação do Motorista Responsável por este Setor */}
                              {group.responsibleDriver ? (
                                <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-900 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-xl w-fit">
                                  <Bell size={12} className="text-amber-600 shrink-0" />
                                  <span className="font-bold">
                                    Motorista do Setor: <strong>{group.responsibleDriver.driverName}</strong>
                                    {group.responsibleDriver.plate ? ` (${group.responsibleDriver.plate})` : ''}
                                  </span>
                                  {group.responsibleDriver.address && (
                                    <span className="text-[10px] text-slate-500 font-medium">
                                      • Base: {group.responsibleDriver.address}
                                    </span>
                                  )}
                                  {group.responsibleDriver.phone && (
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      • {group.responsibleDriver.phone}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-400 italic mt-0.5">
                                  Nenhum motorista fixado exclusivamente para este setor
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            {/* Badges de Contagem */}
                            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider">
                              {pendingCount > 0 && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-lg border border-slate-200">
                                  {pendingCount} Pendente{pendingCount > 1 ? 's' : ''}
                                </span>
                              )}
                              {inRouteCount > 0 && (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg border border-amber-200">
                                  {inRouteCount} Em Rota
                                </span>
                              )}
                              {deliveredCount > 0 && (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200">
                                  {deliveredCount} Concluída{deliveredCount > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>

                            {/* Ação rápida: Despachar entrega neste setor */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setNewDelivery(prev => ({
                                  ...prev,
                                  sector: group.sectorName,
                                  neighborhood: group.sectorName,
                                  truckId: group.responsibleDriver?.truckId || prev.truckId
                                }));
                                setShowAddDelivery(true);
                              }}
                              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-xs transition-all active:scale-95 cursor-pointer"
                              title={`Criar nova entrega para o setor ${group.sectorName}`}
                            >
                              <Plus size={11} /> Nova Entrega
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedSectors(prev => ({ ...prev, [group.sectorName]: !prev[group.sectorName] }));
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"
                            >
                              {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </button>
                          </div>
                        </div>

                        {/* Lista de Entregas do Setor */}
                        {!isCollapsed && (
                          <div className="divide-y divide-slate-100">
                            {group.deliveries.map(delivery => {
                              const assignedTruck = trucks.find(t => t.id === delivery.truckId);
                              return (
                                <div key={delivery.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="space-y-1 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-black text-brand-dark uppercase tracking-tight text-sm">
                                        {delivery.residentName}
                                      </h4>
                                      {delivery.councilman && (
                                        <span className="text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/60">
                                          🏛️ {delivery.councilman}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
                                      <MapPin size={12} className="text-slate-400 shrink-0" />
                                      <span>{delivery.address}</span>
                                    </p>
                                    {delivery.referencePoint && (
                                      <p className="text-[11px] text-slate-500 font-sans italic">
                                        Ref: {delivery.referencePoint}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 pt-0.5">
                                      <span>
                                        Caminhão / Motorista: <strong className="text-slate-700">{assignedTruck ? assignedTruck.driverName : 'Não atribuído'}</strong>
                                        {assignedTruck?.plate ? ` (${assignedTruck.plate})` : ''}
                                      </span>
                                      <span>•</span>
                                      <span>{new Date(delivery.createdAt || '').toLocaleDateString('pt-BR')}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                    {delivery.photo && (
                                      <button 
                                        onClick={() => setSelectedPhoto(delivery.photo!)}
                                        className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all active:scale-95"
                                        title="Ver Comprovante"
                                      >
                                        <ImageIcon size={16} />
                                      </button>
                                    )}

                                    <button 
                                      onClick={() => setStatusConfirmationModal({ delivery })} 
                                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border cursor-pointer ${
                                        delivery.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                        delivery.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-700 border-amber-200' : 
                                        'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                      }`}
                                    >
                                      {delivery.status === 'DELIVERED' ? 'ENTREGUE' : delivery.status === 'IN_ROUTE' ? 'EM ROTA' : 'PENDENTE'}
                                    </button>

                                    <button 
                                      onClick={() => handleDelete('deliveries', delivery.id)}
                                      className="p-2 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-colors cursor-pointer"
                                      title="Excluir Entrega"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* VISUALIZAÇÃO 2: POR MOTORISTA / CAMINHÃO */}
            {deliveryViewMode === 'BY_DRIVER' && (
              <div className="space-y-5">
                {driverGroupedDeliveries.groups.map(group => {
                  const isCollapsed = expandedDrivers[group.truck.id] === false;
                  const pendingCount = group.deliveries.filter(d => d.status === 'PENDING').length;
                  const inRouteCount = group.deliveries.filter(d => d.status === 'IN_ROUTE').length;
                  const deliveredCount = group.deliveries.filter(d => d.status === 'DELIVERED').length;

                  return (
                    <div key={group.truck.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                      {/* Cabeçalho do Motorista */}
                      <div 
                        onClick={() => setExpandedDrivers(prev => ({ ...prev, [group.truck.id]: !prev[group.truck.id] }))}
                        className="p-4 sm:p-5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex items-start sm:items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-500/20">
                            <TruckIcon size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-black text-brand-dark uppercase tracking-tight text-base sm:text-lg">
                                {group.truck.driverName}
                              </h3>
                              <span className="font-mono text-xs font-bold bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded-lg">
                                {group.truck.plate}
                              </span>
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                group.truck.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-800' :
                                group.truck.status === 'ARRIVED' ? 'bg-emerald-100 text-emerald-800' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {group.truck.status === 'IN_ROUTE' ? 'Em Rota' : group.truck.status === 'ARRIVED' ? 'No Local' : 'Disponível'}
                              </span>
                            </div>

                            {/* Informações de Endereço/Base e Setores atendidos */}
                            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mt-1">
                              {(group.driver?.sector || group.truck.sector) && (
                                <span className="flex items-center gap-1 font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200/60">
                                  <MapPin size={11} /> Setor: {group.driver?.sector || group.truck.sector}
                                </span>
                              )}
                              {group.driver?.address && (
                                <span className="text-[11px] text-slate-500">
                                  Base/Endereço: <strong>{group.driver.address}</strong>
                                </span>
                              )}
                              {group.driver?.phone && (
                                <span className="font-mono text-[11px] text-slate-500">
                                  Tel: {group.driver.phone}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {/* Badges de Contagem */}
                          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg">
                              {group.deliveries.length} Total
                            </span>
                            {pendingCount > 0 && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg">
                                {pendingCount} Pendentes
                              </span>
                            )}
                            {deliveredCount > 0 && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg">
                                {deliveredCount} Entregues
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedDrivers(prev => ({ ...prev, [group.truck.id]: !prev[group.truck.id] }));
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"
                          >
                            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                          </button>
                        </div>
                      </div>

                      {/* Lista de Entregas do Motorista */}
                      {!isCollapsed && (
                        <div>
                          {group.deliveries.length === 0 ? (
                            <div className="p-6 text-center text-xs text-slate-400 font-medium">
                              Nenhuma entrega atribuída a este motorista com os filtros atuais.
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-100">
                              {group.deliveries.map(delivery => (
                                <div key={delivery.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="space-y-1 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-black text-brand-dark uppercase tracking-tight text-sm">
                                        {delivery.residentName}
                                      </h4>
                                      <span className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md">
                                        📍 {getDeliverySector(delivery)}
                                      </span>
                                      {delivery.councilman && (
                                        <span className="text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/60">
                                          🏛️ {delivery.councilman}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
                                      <MapPin size={12} className="text-slate-400 shrink-0" />
                                      <span>{delivery.address}</span>
                                    </p>
                                    {delivery.referencePoint && (
                                      <p className="text-[11px] text-slate-500 font-sans italic">
                                        Ref: {delivery.referencePoint}
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                    {delivery.photo && (
                                      <button 
                                        onClick={() => setSelectedPhoto(delivery.photo!)}
                                        className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all active:scale-95"
                                        title="Ver Comprovante"
                                      >
                                        <ImageIcon size={16} />
                                      </button>
                                    )}

                                    <button 
                                      onClick={() => setStatusConfirmationModal({ delivery })} 
                                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border cursor-pointer ${
                                        delivery.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                        delivery.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-700 border-amber-200' : 
                                        'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                      }`}
                                    >
                                      {delivery.status === 'DELIVERED' ? 'ENTREGUE' : delivery.status === 'IN_ROUTE' ? 'EM ROTA' : 'PENDENTE'}
                                    </button>

                                    <button 
                                      onClick={() => handleDelete('deliveries', delivery.id)}
                                      className="p-2 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-colors cursor-pointer"
                                      title="Excluir Entrega"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* VISUALIZAÇÃO 3: LISTA GERAL COMPLETA */}
            {deliveryViewMode === 'ALL' && (
              <>
                {/* Desktop Table */}
                <div className="hidden lg:block bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-sm">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h3 className="font-black text-brand-dark uppercase tracking-tight text-lg">
                        Relação Geral de Entregas Cadastradas
                      </h3>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                        {filteredDeliveriesForView.length} registros exibidos
                      </p>
                    </div>
                  </div>
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-widest">
                      <tr>
                        <th className="px-6 py-4">Morador</th>
                        <th className="px-6 py-4">Setor / Região</th>
                        <th className="px-6 py-4">Endereço</th>
                        <th className="px-6 py-4">Motorista / Caminhão</th>
                        <th className="px-6 py-4">Indicação (Vereador)</th>
                        <th className="px-6 py-4 text-center">Foto</th>
                        <th className="px-6 py-4 text-center">Status</th>
                        <th className="px-6 py-4 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDeliveriesForView.length === 0 ? (
                        <tr><td colSpan={8} className="p-10 text-center text-slate-400">Nenhuma entrega encontrada para os filtros selecionados.</td></tr>
                      ) : (
                        filteredDeliveriesForView.map(delivery => {
                          const assignedTruck = trucks.find(t => t.id === delivery.truckId);
                          const sector = getDeliverySector(delivery);
                          return (
                            <tr key={delivery.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-5 font-black text-brand-dark uppercase tracking-tight">{delivery.residentName}</td>
                              <td className="px-6 py-5">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200/60">
                                  <MapPin size={11} /> {sector}
                                </span>
                              </td>
                              <td className="px-6 py-5 text-sm text-slate-600">{delivery.address}</td>
                              <td className="px-6 py-5 text-sm">
                                {assignedTruck ? (
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-800 text-xs">{assignedTruck.driverName}</span>
                                    <span className="font-mono text-[10px] text-slate-400">{assignedTruck.plate}</span>
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-xs italic">Não atribuído</span>
                                )}
                              </td>
                              <td className="px-6 py-5 text-sm">
                                {delivery.councilman ? (
                                  <span className="font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg text-xs border border-purple-200/60 inline-flex items-center gap-1">
                                    🏛️ {delivery.councilman}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-xs italic font-medium">Sem indicação</span>
                                )}
                              </td>
                              <td className="px-6 py-5 text-center">
                                {delivery.photo ? (
                                  <button 
                                    onClick={() => setSelectedPhoto(delivery.photo!)}
                                    className="p-3 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-600 hover:text-white transition-all active:scale-90"
                                    title="Ver Comprovante"
                                  >
                                    <ImageIcon size={20} />
                                  </button>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                              <td className="px-6 py-5 text-center">
                                <button onClick={() => setStatusConfirmationModal({ delivery })} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                  delivery.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                                  delivery.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                                }`}>
                                  {delivery.status === 'DELIVERED' ? 'ENTREGUE' : delivery.status === 'IN_ROUTE' ? 'EM ROTA' : 'PENDENTE'}
                                </button>
                              </td>
                              <td className="px-6 py-5 text-center">
                                <button 
                                  onClick={() => handleDelete('deliveries', delivery.id)}
                                  className="p-2 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="lg:hidden space-y-3">
                  {filteredDeliveriesForView.map(delivery => {
                    const assignedTruck = trucks.find(t => t.id === delivery.truckId);
                    const sector = getDeliverySector(delivery);
                    return (
                      <div key={delivery.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">
                                📍 {sector}
                              </span>
                            </div>
                            <h3 className="font-black text-brand-dark uppercase tracking-tight leading-tight">{delivery.residentName}</h3>
                            {delivery.councilman && (
                              <span className="text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-full inline-block mt-1 border border-purple-200/50">
                                🏛️ Indicação: {delivery.councilman}
                              </span>
                            )}
                          </div>
                          <button onClick={() => setStatusConfirmationModal({ delivery })} className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                            delivery.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-600' :
                            delivery.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {delivery.status === 'DELIVERED' ? 'ENTREGUE' : delivery.status === 'IN_ROUTE' ? 'EM ROTA' : 'PENDENTE'}
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 font-bold mb-2">{delivery.address}</p>
                        <div className="text-[10px] text-slate-500 font-medium mb-3">
                          Motorista: <strong className="text-slate-800">{assignedTruck ? assignedTruck.driverName : 'Não atribuído'}</strong>
                          {assignedTruck?.plate ? ` (${assignedTruck.plate})` : ''}
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <Clock size={12} /> {new Date(delivery.createdAt || '').toLocaleDateString()} • {new Date(delivery.createdAt || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          {delivery.photo && (
                            <button 
                              onClick={() => setSelectedPhoto(delivery.photo!)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-tight active:scale-95 transition-all"
                            >
                              <ImageIcon size={14} /> Foto
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ABASTECIMENTO & CONSUMO DE COMBUSTÍVEL POR SETOR */}
        {activeTab === 'fuel' && (
          <div className="p-3 sm:p-5 lg:p-6 max-w-7xl mx-auto w-full flex flex-col gap-5">
            {/* Top Header */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setActiveTab('operational')}
                    className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar para o Painel Operacional"
                    aria-label="Voltar para o Painel"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="p-2 bg-amber-500/10 text-amber-600 rounded-xl border border-amber-500/20">
                      <Fuel size={20} />
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                      Abastecimento & Consumo de Combustível
                    </h2>
                  </div>
                </div>
                <p className="text-slate-500 text-xs mt-1 font-medium pl-11">
                  Controle e auditoria do consumo médio por km rodado em cada setor de Inhapi/AL ({userRole === 'admin' ? 'Visão Administrador' : 'Visão Secretário'}).
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleExportFuelLogsCSV}
                  className="flex-1 sm:flex-initial h-10 px-3.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-xs"
                  title="Exportar registros de combustível em planilha CSV"
                >
                  <Download size={14} />
                  <span>Exportar CSV</span>
                </button>
                <button
                  onClick={() => handleOpenAddFuelModal()}
                  className="flex-1 sm:flex-initial h-10 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs flex items-center justify-center gap-1.5 shadow-md shadow-amber-600/20 transition-all active:scale-95 cursor-pointer"
                >
                  <Plus size={16} />
                  <span>Novo Abastecimento</span>
                </button>
              </div>
            </header>

            {/* KPIs Globais da Frota de Caminhões-Pipa */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-4">
              {/* Card 1: Litros Abastecidos */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Abastecido</span>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <Fuel size={16} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    {fleetFuelKPIs.totalLiters.toLocaleString('pt-BR')} <span className="text-xs font-bold text-slate-500">L</span>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                    Volume acumulado na frota
                  </span>
                </div>
              </div>

              {/* Card 2: KM Rodados */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">KM Percorridos</span>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                    <Gauge size={16} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    {fleetFuelKPIs.totalDistanceKm.toLocaleString('pt-BR')} <span className="text-xs font-bold text-slate-500">km</span>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                    Distância entre abastecimentos
                  </span>
                </div>
              </div>

              {/* Card 3: Consumo Médio da Frota (KM/L) */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Consumo Médio</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <TrendingUp size={16} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-xl sm:text-2xl font-black text-emerald-700 tracking-tight">
                    {fleetFuelKPIs.avgKmPerLiter > 0 ? `${fleetFuelKPIs.avgKmPerLiter} ` : '— '}
                    <span className="text-xs font-bold text-slate-500">km/L</span>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                    {fleetFuelKPIs.avgLitersPerKm > 0 ? `${fleetFuelKPIs.avgLitersPerKm} litros por km` : 'Aguardando dados'}
                  </span>
                </div>
              </div>

              {/* Card 4: Gasto Total com Combustível */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Gasto Total</span>
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                    <DollarSign size={16} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                    {fleetFuelKPIs.totalCost > 0 ? fleetFuelKPIs.totalCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'}
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                    {fleetFuelKPIs.avgCostPerKm > 0 ? `Média: R$ ${fleetFuelKPIs.avgCostPerKm.toFixed(2)} / km` : 'Custo do diesel'}
                  </span>
                </div>
              </div>

              {/* Card 5: Setores Atendidos e Eficiência */}
              <div className="col-span-2 lg:col-span-1 bg-gradient-to-br from-amber-50 to-orange-50/60 p-3.5 sm:p-4 rounded-2xl border border-amber-200/80 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-800">Setores c/ Dados</span>
                  <span className="text-[10px] font-bold bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full">
                    {sectorConsumptionStats.length} Setores
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-xl sm:text-2xl font-black text-amber-950 tracking-tight">
                    {fuelLogs.length} <span className="text-xs font-bold text-amber-700">abastecimentos</span>
                  </div>
                  <span className="text-[10px] font-semibold text-amber-800 mt-0.5 block">
                    Frota auditada em tempo real
                  </span>
                </div>
              </div>
            </div>

            {/* SEÇÃO 1: CONTROLE DE CONSUMO MÉDIO POR KM PERCORRIDO EM CADA SETOR */}
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                    <h3 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
                      Consumo Médio por KM Percorrido em Cada Setor
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Acompanhamento setorizado do rendimento da frota. Detecta trechos com maior consumo de diesel devido a relevo e estradas vicinais.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                  <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">
                    🟢 Ótimo (&ge; 2.8 km/L)
                  </span>
                  <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                    🟡 Normal (2.2 - 2.8)
                  </span>
                  <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-1 rounded-md border border-rose-200">
                    🔴 Atenção (&lt; 2.2)
                  </span>
                </div>
              </div>

              {/* Grid de Cards dos Setores */}
              {sectorConsumptionStats.length === 0 ? (
                <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center gap-2">
                  <Fuel size={36} className="text-amber-400/80 stroke-[1.5]" />
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Nenhum abastecimento registrado até o momento
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-sm">
                    Clique no botão acima para registrar o primeiro abastecimento com odômetro e litros para que o sistema calcule automaticamente o consumo por setor.
                  </p>
                  <button
                    onClick={() => handleOpenAddFuelModal()}
                    className="mt-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                  >
                    + Registrar Primeiro Abastecimento
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {sectorConsumptionStats.map((item) => {
                    const isGood = item.efficiency === 'EXCELLENT';
                    const isWarning = item.efficiency === 'WARNING';
                    return (
                      <div
                        key={item.sector}
                        className={`rounded-2xl p-4 border transition-all hover:shadow-md ${
                          isGood 
                            ? 'bg-emerald-50/30 border-emerald-200/80 hover:border-emerald-300' 
                            : isWarning 
                              ? 'bg-rose-50/30 border-rose-200/80 hover:border-rose-300'
                              : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {/* Top Setor e Badge */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="min-w-0">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                              Setor / Região
                            </span>
                            <h4 className="font-black text-sm text-slate-900 uppercase tracking-tight truncate" title={item.sector}>
                              {item.sector}
                            </h4>
                          </div>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 border ${
                            isGood 
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                              : isWarning 
                                ? 'bg-rose-100 text-rose-800 border-rose-300' 
                                : 'bg-amber-100 text-amber-800 border-amber-300'
                          }`}>
                            {isGood ? '🟢 Ótimo' : isWarning ? '🔴 Alto Consumo' : '🟡 Moderado'}
                          </span>
                        </div>

                        {/* Métrica Principal: Consumo Médio KM/L */}
                        <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-xs mb-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                              Consumo Médio
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {item.avgLitersPerKm > 0 ? `${item.avgLitersPerKm} L / km` : ''}
                            </span>
                          </div>
                          <div className="flex items-baseline gap-1 mt-1">
                            <span className={`text-2xl font-black tracking-tight ${
                              isGood ? 'text-emerald-600' : isWarning ? 'text-rose-600' : 'text-slate-800'
                            }`}>
                              {item.avgKmPerLiter > 0 ? item.avgKmPerLiter : '0.00'}
                            </span>
                            <span className="text-xs font-bold text-slate-400">km por litro</span>
                          </div>

                          {/* Barra de rendimento proporcional (base 4.0 km/l) */}
                          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                isGood ? 'bg-emerald-500' : isWarning ? 'bg-rose-500' : 'bg-amber-500'
                              }`}
                              style={{ width: `${Math.min(100, (item.avgKmPerLiter / 4.0) * 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Dados Detalhados do Setor */}
                        <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
                          <div className="bg-white/80 p-2 rounded-lg border border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">KM Rodados</span>
                            <strong className="font-black text-slate-800 font-mono text-xs">
                              {item.totalDistanceKm.toLocaleString('pt-BR')} km
                            </strong>
                          </div>
                          <div className="bg-white/80 p-2 rounded-lg border border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Combustível</span>
                            <strong className="font-black text-slate-800 font-mono text-xs">
                              {Math.round(item.totalLiters).toLocaleString('pt-BR')} L
                            </strong>
                          </div>
                          <div className="bg-white/80 p-2 rounded-lg border border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Custo Total</span>
                            <strong className="font-black text-slate-800 font-mono text-xs">
                              R$ {item.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </strong>
                          </div>
                          <div className="bg-white/80 p-2 rounded-lg border border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Custo por KM</span>
                            <strong className="font-black text-slate-800 font-mono text-xs">
                              {item.avgCostPerKm > 0 ? `R$ ${item.avgCostPerKm.toFixed(2)}/km` : '—'}
                            </strong>
                          </div>
                        </div>

                        {/* Caminhões e Ação Rápida de Filtro */}
                        <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px]">
                          <div className="truncate mr-2 text-slate-500">
                            <span className="font-bold">Caminhões: </span>
                            {item.trucksList.length > 0 ? item.trucksList.join(', ') : 'N/D'}
                          </div>
                          <button
                            onClick={() => {
                              setFuelSectorFilter(item.sector);
                              const el = document.getElementById('fuel-history-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="text-amber-700 hover:text-amber-800 font-bold underline whitespace-nowrap cursor-pointer shrink-0"
                          >
                            Ver {item.logCount} registros &darr;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SEÇÃO 2: HISTÓRICO COMPLETO DE ABASTECIMENTOS COM FILTROS */}
            <div id="fuel-history-section" className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
                    Histórico de Abastecimentos dos Caminhões
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {filteredFuelLogs.length} abastecimentos encontrados com base nos filtros atuais
                  </p>
                </div>

                {/* Filtro de Período Rápido */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                  {[
                    { id: 'ALL', label: 'Todos' },
                    { id: 'TODAY', label: 'Hoje' },
                    { id: 'WEEK', label: '7 Dias' },
                    { id: 'MONTH', label: '30 Dias' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setFuelPeriodFilter(p.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        fuelPeriodFilter === p.id
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Barra de Filtros: Setor, Caminhão e Campo de Busca */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Filtro de Setor */}
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1 pl-1">
                    Filtrar por Setor
                  </label>
                  <select
                    value={fuelSectorFilter}
                    onChange={(e) => setFuelSectorFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-amber-500 focus:bg-white transition-all"
                  >
                    <option value="ALL">📍 Todos os Setores</option>
                    {sectorsList.map((sec) => (
                      <option key={sec} value={sec}>
                        📍 {sec}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filtro de Caminhão */}
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1 pl-1">
                    Filtrar por Caminhão / Placa
                  </label>
                  <select
                    value={fuelTruckFilter}
                    onChange={(e) => setFuelTruckFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-amber-500 focus:bg-white transition-all"
                  >
                    <option value="ALL">🚛 Todos os Caminhões-Pipa</option>
                    {trucks.map((t) => (
                      <option key={t.id} value={t.id}>
                        🚛 {t.driverName} ({t.plate})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Campo de Busca Livre */}
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1 pl-1">
                    Buscar Texto
                  </label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Placa, motorista, posto, nota..."
                      value={fuelSearch}
                      onChange={(e) => setFuelSearch(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-8 py-2 text-xs font-medium text-slate-800 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                    {fuelSearch && (
                      <button
                        onClick={() => setFuelSearch('')}
                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabela de Abastecimentos (Desktop) */}
              <div className="hidden lg:block overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Data / Hora</th>
                      <th className="px-4 py-3">Caminhão & Motorista</th>
                      <th className="px-4 py-3">Setor Atendido</th>
                      <th className="px-4 py-3">Combustível</th>
                      <th className="px-4 py-3 text-right">Litros</th>
                      <th className="px-4 py-3 text-right">Odômetro (KM)</th>
                      <th className="px-4 py-3 text-center">Consumo Médio</th>
                      <th className="px-4 py-3 text-right">Total (R$)</th>
                      <th className="px-4 py-3">Posto / Nota</th>
                      <th className="px-4 py-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredFuelLogs.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                          Nenhum abastecimento encontrado para os filtros selecionados.
                        </td>
                      </tr>
                    ) : (
                      filteredFuelLogs.map((log) => {
                        return (
                          <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap text-slate-600">
                              {log.date ? new Date(log.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-black text-slate-900 uppercase">
                                {log.driverName || 'Motorista Não Identificado'}
                              </div>
                              <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 uppercase font-bold">
                                {log.plate}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-800">
                              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200/80 px-2 py-0.5 rounded-lg text-[10px] uppercase">
                                📍 {log.sector || 'Centro'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-600">
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                {log.fuelType === 'DIESEL_S10' ? 'Diesel S-10' :
                                 log.fuelType === 'DIESEL_COMUM' ? 'Diesel Comum' :
                                 log.fuelType === 'GASOLINA' ? 'Gasolina' : 'Arla 32'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-black font-mono text-slate-900 text-sm whitespace-nowrap">
                              {Number(log.liters).toLocaleString('pt-BR')} L
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-[11px]">
                              <div className="font-bold text-slate-800">{log.currentKm.toLocaleString('pt-BR')} km</div>
                              {log.previousKm !== undefined && (
                                <span className="text-[9px] text-slate-400 block">
                                  +{(log.distanceKm || 0).toLocaleString('pt-BR')} km rodados
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              {log.kmPerLiter > 0 ? (
                                <div className="inline-flex flex-col items-center">
                                  <span className={`px-2 py-0.5 rounded-lg font-black font-mono text-xs ${
                                    log.kmPerLiter >= 2.8 
                                      ? 'bg-emerald-100 text-emerald-800' 
                                      : log.kmPerLiter < 2.2 
                                        ? 'bg-rose-100 text-rose-800' 
                                        : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {log.kmPerLiter.toFixed(2)} km/L
                                  </span>
                                  <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                                    {(log.litersPerKm || 0).toFixed(3)} L/km
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                              <div className="font-black text-slate-900">
                                {log.totalCost ? log.totalCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                              </div>
                              {log.pricePerLiter ? (
                                <span className="text-[9px] text-slate-400 block">
                                  R$ {log.pricePerLiter.toFixed(2)}/L
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-slate-600 text-[11px] max-w-[140px] truncate" title={`${log.gasStation || ''} ${log.invoiceNumber ? `NF: ${log.invoiceNumber}` : ''}`}>
                              <span className="font-semibold block truncate">{log.gasStation || '—'}</span>
                              {log.invoiceNumber && (
                                <span className="text-[9px] text-slate-400 font-mono">
                                  NF: {log.invoiceNumber}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleOpenEditFuelModal(log)}
                                  className="p-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-600 rounded-lg transition-colors cursor-pointer"
                                  title="Editar abastecimento"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  onClick={() => setFuelDeleteConfirm(log)}
                                  className="p-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 rounded-lg transition-colors cursor-pointer"
                                  title="Excluir registro"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Cards de Abastecimentos (Mobile) */}
              <div className="lg:hidden space-y-2.5">
                {filteredFuelLogs.length === 0 ? (
                  <p className="text-center py-6 text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Nenhum abastecimento encontrado para este filtro.
                  </p>
                ) : (
                  filteredFuelLogs.map((log) => (
                    <div key={log.id} className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-black text-xs text-slate-900 uppercase">
                              {log.driverName}
                            </span>
                            <span className="font-mono text-[9px] bg-slate-200 px-1.5 py-0.2 rounded font-bold uppercase">
                              {log.plate}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
                            {log.date ? new Date(log.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </span>
                        </div>
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-200">
                          📍 {log.sector || 'Centro'}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-white p-2.5 rounded-xl border border-slate-100 text-[10px]">
                        <div>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Abastecido</span>
                          <strong className="font-mono font-black text-xs text-slate-800">
                            {log.liters} L
                          </strong>
                        </div>
                        <div>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Percorrido</span>
                          <strong className="font-mono font-black text-xs text-slate-800">
                            {log.distanceKm} km
                          </strong>
                        </div>
                        <div>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Consumo</span>
                          <strong className={`font-mono font-black text-xs ${
                            log.kmPerLiter >= 2.8 ? 'text-emerald-600' : log.kmPerLiter < 2.2 ? 'text-rose-600' : 'text-amber-700'
                          }`}>
                            {log.kmPerLiter > 0 ? `${log.kmPerLiter.toFixed(2)} km/L` : '—'}
                          </strong>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[10px]">
                        <span className="font-mono font-bold text-slate-700">
                          {log.totalCost ? log.totalCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditFuelModal(log)}
                            className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg font-bold text-[10px] uppercase flex items-center gap-1 shadow-2xs"
                          >
                            <Edit2 size={11} /> Editar
                          </button>
                          <button
                            onClick={() => setFuelDeleteConfirm(log)}
                            className="p-1 bg-white border border-slate-200 text-rose-600 rounded-lg"
                            title="Excluir"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sitios' && (
          <div className="p-4 lg:p-8 max-w-5xl mx-auto w-full">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 lg:mb-8">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <button
                    onClick={() => setActiveTab('map')}
                    className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar para o Painel"
                    aria-label="Voltar para o Painel"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-black uppercase tracking-tight text-slate-900">Abastecimentos</h2>
                </div>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Pontos de coleta de água e abastecimento de frota</p>
              </div>
              <button 
                onClick={() => {
                  setNewSitio({ 
                    name: '', 
                    description: '', 
                    lat: -9.2201, 
                    lng: -36.3503, 
                    rawCoords: '-9.2201, -36.3503',
                    type: 'WATER' as 'WATER' | 'FUEL' | 'OTHER',
                    fuelType: 'NONE' as 'DIESEL' | 'GASOLINE' | 'NONE'
                  });
                  setEditingSitio(null);
                  setShowAddSitio(true);
                }}
                className="w-full sm:w-auto bg-brand-teal text-white px-5 py-3 lg:py-2.5 rounded-2xl lg:rounded-xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand-teal/20 hover:bg-brand-teal/80 transition-all active:scale-95"
              >
                <Plus size={18} /> Novo Abastecimento
              </button>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {sitios.map(sitio => (
                <div key={sitio.id} className="bg-white p-6 rounded-3xl border border-slate-200 relative group">
                  <div className="absolute top-4 right-4 flex gap-2">
                    <button 
                      onClick={() => {
                        setEditingSitio(sitio);
                        setNewSitio({
                          name: sitio.name || '',
                          description: sitio.description || '',
                          lat: sitio.lat || 0,
                          lng: sitio.lng || 0,
                          rawCoords: `${sitio.lat || 0}, ${sitio.lng || 0}`,
                          type: sitio.type || 'WATER',
                          fuelType: sitio.fuelType || 'NONE'
                        });
                        setShowAddSitio(true);
                      }}
                      className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-brand-primary hover:text-white transition-colors"
                    >
                      <Settings size={16} /> 
                    </button>
                    <button 
                      onClick={() => handleDelete('sitios', sitio.id)}
                      className="p-2 bg-slate-100 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <h3 className="font-bold text-xl mb-1">{sitio.name}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${sitio.type === 'WATER' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                      {sitio.type === 'WATER' ? "Água" : "Combustível"}
                    </span>
                    {sitio.type === 'FUEL' && sitio.fuelType && (
                       <span className={`text-[10px] items-center gap-2 font-black uppercase tracking-widest px-2 py-1 rounded-md ${sitio.fuelType === 'DIESEL' ? 'bg-amber-700/10 text-amber-800' : 'bg-red-100 text-red-700'}`}>
                         {sitio.fuelType}
                       </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-sm mb-2">{sitio.description}</p>
                  <p className="text-xs text-slate-400 font-mono">{sitio.lat}, {sitio.lng}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'residents' && (
          <div className="p-2.5 sm:p-4 lg:p-5 max-w-5xl mx-auto w-full">
            <header className="mb-4 lg:mb-6 flex items-center gap-2.5">
              <button
                onClick={() => setActiveTab('map')}
                className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                title="Voltar para o Painel"
                aria-label="Voltar para o Painel"
              >
                <ArrowLeft size={16} />
              </button>
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-black uppercase tracking-tight text-slate-900">Cadastros</h2>
            </header>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-5 lg:mb-8">
              {[
                {id: 'resident', label: 'Moradores'},
                {id: 'truck', label: 'Caminhões'},
                {id: 'driver', label: 'Motoristas'},
                {id: 'councilman', label: 'Vereadores'}
              ].map((tab) => (
                 <button 
                   key={tab.id}
                   onClick={() => setActiveCadastroSubTab(tab.id as any)}
                   className={`px-3 py-2.5 md:p-4 rounded-xl border uppercase font-black text-[11px] lg:text-xs tracking-wide md:tracking-widest transition-all ${
                     activeCadastroSubTab === tab.id 
                       ? 'bg-brand-dark text-white border-brand-dark shadow-xs' 
                       : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                   }`}
                 >
                   {tab.label}
                 </button>
              ))}
            </div>
            
            <div className="bg-white p-3 md:p-5 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {activeCadastroSubTab === 'resident' && (
                  <div className="w-full">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                      <div>
                        <h3 className="font-bold text-lg text-slate-900">Moradores, Escolas e Creches</h3>
                        <p className="text-xs text-slate-500 font-medium">Cadastros de beneficiários e pontos de entrega de água</p>
                      </div>
                      <div className="flex flex-col sm:flex-row w-full sm:w-auto items-stretch sm:items-center gap-2">
                        <input 
                          type="text" 
                          placeholder="Buscar nome, sítio ou endereço..." 
                          value={residentSearch} 
                          onChange={(e) => setResidentSearch(e.target.value)} 
                          className="bg-slate-100 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm w-full sm:w-[220px] outline-none" 
                        />
                        <div className="grid grid-cols-3 sm:flex gap-2 w-full sm:w-auto">
                          <button onClick={handleExportResidentsCSV} className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-2.5 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-1"><Download size={13} className="shrink-0" /> <span className="truncate">CSV</span></button>
                          <button onClick={() => handleDeleteAll('residents', residents)} className="bg-red-100 text-red-600 px-2.5 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wide flex items-center justify-center"><span className="truncate">Limpar</span></button>
                          <button 
                            onClick={() => {
                              setResidentFormError('');
                              setNewResident({
                                name: '',
                                address: '',
                                neighborhood: '',
                                phone: '',
                                referencePoint: '',
                                councilman: '',
                                category: residentCategoryFilter === 'ALL' ? 'RESIDENT' : residentCategoryFilter
                              });
                              setShowAddResident(true);
                            }} 
                            className="bg-brand-dark hover:bg-slate-800 text-white px-3 sm:px-3.5 py-2.5 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
                          >
                            <Plus size={13} />
                            <span className="truncate">+ Cadastrar</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Category Filter Tabs */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3 custom-scrollbar">
                      {[
                        { id: 'ALL', label: `Todos (${residents.length})` },
                        { id: 'RESIDENT', label: `🏠 Moradores (${residents.filter(r => !r.category || r.category === 'RESIDENT').length})` },
                        { id: 'SCHOOL', label: `🏫 Escolas (${residents.filter(r => r.category === 'SCHOOL').length})` },
                        { id: 'DAYCARE', label: `👶 Creches (${residents.filter(r => r.category === 'DAYCARE').length})` },
                      ].map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setResidentCategoryFilter(tab.id as any)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                            residentCategoryFilter === tab.id
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    
                    {/* Desktop Table */}
                    <div className="overflow-x-auto w-full custom-scrollbar hidden sm:block">
                      <table className="w-full text-left min-w-[700px]">
                          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            <tr>
                              <th className="px-3.5 py-2">Categoria</th>
                              <th className="px-3.5 py-2">Nome</th>
                              <th className="px-3.5 py-2">Endereço / Sítio</th>
                              <th className="px-3.5 py-2">Notificação Secretário (Motorista Indicado)</th>
                              <th className="px-3.5 py-2">Telefone</th>
                              <th className="px-3.5 py-2">Ref.</th>
                              <th className="px-3.5 py-2 text-center">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {residents
                              .filter(r => {
                                if (residentCategoryFilter === 'SCHOOL' && r.category !== 'SCHOOL') return false;
                                if (residentCategoryFilter === 'DAYCARE' && r.category !== 'DAYCARE') return false;
                                if (residentCategoryFilter === 'RESIDENT' && r.category && r.category !== 'RESIDENT') return false;
                                if (residentSearch.trim()) {
                                  const q = residentSearch.toLowerCase().trim();
                                  return (r.name || '').toLowerCase().includes(q) || 
                                         (r.address || '').toLowerCase().includes(q) || 
                                         (r.neighborhood || '').toLowerCase().includes(q) ||
                                         (r.referencePoint || '').toLowerCase().includes(q);
                                }
                                return true;
                              })
                              .map(resident => (
                              <tr key={resident.id} className="hover:bg-slate-50/50">
                                <td className="px-3.5 py-2">
                                  {resident.category === 'SCHOOL' ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                                      <School size={11} /> ESCOLA
                                    </span>
                                  ) : resident.category === 'DAYCARE' ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-pink-700 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-md">
                                      <Baby size={11} /> CRECHE
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md">
                                      <Home size={11} /> MORADOR
                                    </span>
                                  )}
                                </td>
                                <td className="px-3.5 py-2 font-extrabold text-xs text-brand-dark uppercase tracking-tight">
                                  {resident.name}
                                  {resident.councilman && (
                                    <span className="inline-block ml-1.5 text-[8px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded w-fit">
                                      🏛️ {resident.councilman}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3.5 py-2 text-[11px] font-medium text-slate-600">
                                  {resident.address}
                                  {resident.neighborhood && resident.neighborhood !== resident.address && (
                                    <span className="block text-[10px] text-slate-400 font-bold uppercase">{resident.neighborhood}</span>
                                  )}
                                </td>
                                <td className="px-3.5 py-2">
                                  {(() => {
                                    const match = getResidentSectorAndDriver(resident);
                                    if (match.driverName) {
                                      return (
                                        <div className="flex flex-col gap-0.5">
                                          <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-900 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-lg w-fit shadow-2xs">
                                            <Bell size={10} className="text-amber-600 shrink-0" />
                                            <span>{match.driverName}</span>
                                            {match.plate && <span className="text-[9px] font-mono text-slate-500">({match.plate})</span>}
                                          </span>
                                          <span className="text-[9px] text-slate-500 font-medium">
                                            {match.reasonText}
                                          </span>
                                        </div>
                                      );
                                    }
                                    return (
                                      <span className="text-[9px] text-slate-400 italic">
                                        Sem motorista fixado
                                      </span>
                                    );
                                  })()}
                                </td>
                                <td className="px-3.5 py-2 text-[11px] font-mono">{resident.phone || '-'}</td>
                                <td className="px-3.5 py-2 text-[11px] text-slate-500 font-medium">{resident.referencePoint || '-'}</td>
                                <td className="px-3.5 py-2 text-center flex items-center justify-center gap-1.5">
                                  <button 
                                    onClick={() => handleQuickDispatchForResident(resident)} 
                                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all cursor-pointer shadow-xs"
                                    title="Despachar entrega de água"
                                  >
                                    <TruckIcon size={12}/> Despachar
                                  </button>
                                  <button onClick={() => handleEdit('residents', resident)} className="p-1.5 bg-slate-100 text-slate-500 hover:bg-brand-primary hover:text-white rounded-lg transition-colors cursor-pointer" title="Editar"><Edit2 size={13}/></button>
                                  <button onClick={() => handleDelete('residents', resident.id)} className="p-1.5 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors cursor-pointer" title="Excluir"><Trash2 size={13}/></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                      </table>
                    </div>

                    {/* Mobile cards for Residents */}
                    <div className="sm:hidden space-y-2">
                      {residents
                        .filter(r => {
                          if (residentCategoryFilter === 'SCHOOL' && r.category !== 'SCHOOL') return false;
                          if (residentCategoryFilter === 'DAYCARE' && r.category !== 'DAYCARE') return false;
                          if (residentCategoryFilter === 'RESIDENT' && r.category && r.category !== 'RESIDENT') return false;
                          if (residentSearch.trim()) {
                            const q = residentSearch.toLowerCase().trim();
                            return (r.name || '').toLowerCase().includes(q) || 
                                   (r.address || '').toLowerCase().includes(q) || 
                                   (r.neighborhood || '').toLowerCase().includes(q) ||
                                   (r.referencePoint || '').toLowerCase().includes(q);
                          }
                          return true;
                        })
                        .map(resident => (
                          <div key={resident.id} className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-1.5">
                            <div className="flex justify-between items-center">
                              <div className="min-w-0 flex-1 pr-2">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  {resident.category === 'SCHOOL' ? (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] font-black text-indigo-700 bg-indigo-100/70 border border-indigo-200 px-1.5 py-0.2 rounded">
                                      <School size={9} /> ESCOLA
                                    </span>
                                  ) : resident.category === 'DAYCARE' ? (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] font-black text-pink-700 bg-pink-100/70 border border-pink-200 px-1.5 py-0.2 rounded">
                                      <Baby size={9} /> CRECHE
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] font-black text-emerald-700 bg-emerald-100/70 border border-emerald-200/60 px-1.5 py-0.2 rounded">
                                      <Home size={9} /> MORADOR
                                    </span>
                                  )}
                                </div>
                                <h4 className="font-extrabold text-xs text-brand-dark uppercase tracking-tight leading-tight truncate">{resident.name}</h4>
                                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                  <span className="inline-block text-[7px] font-black uppercase tracking-widest bg-brand-primary/10 text-brand-dark px-1.5 py-0.2 rounded-full">
                                    {resident.neighborhood || 'Não Informado'}
                                  </span>
                                  {resident.councilman && (
                                    <span className="inline-block text-[7px] font-black uppercase tracking-widest bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded-full">
                                      🏛️ {resident.councilman}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button 
                                  onClick={() => handleEdit('residents', resident)} 
                                  className="p-1.5 bg-white border border-slate-200 text-slate-500 hover:bg-brand-primary hover:text-white rounded-lg active:scale-95 transition-all shadow-xs"
                                  title="Editar"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button 
                                  onClick={() => handleDelete('residents', resident.id)} 
                                  className="p-1.5 bg-white border border-slate-200 text-red-500 hover:bg-red-50 rounded-lg active:scale-95 transition-all shadow-xs"
                                  title="Excluir"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            
                            <div className="text-[10px] space-y-0.5 border-t border-slate-100 pt-1.5">
                              <p className="text-slate-600 flex items-center gap-1 font-medium leading-none">
                                <MapPin size={10} className="text-slate-400 shrink-0" />
                                <span className="truncate">{resident.address}</span>
                              </p>
                              {resident.phone && (
                                <p className="text-slate-500 flex items-center gap-1 font-mono leading-none">
                                  <Smartphone size={10} className="text-slate-400 shrink-0" />
                                  <a href={`tel:${resident.phone}`} className="hover:underline">{resident.phone}</a>
                                </p>
                              )}
                              {resident.referencePoint && (
                                <p className="text-slate-600 flex items-center gap-1 font-sans text-[10px] bg-slate-100/60 px-1 py-0.5 rounded border border-slate-200/50 mt-1">
                                  <span className="font-bold text-[8px] uppercase tracking-wider text-slate-400">Ref:</span>
                                  <span className="truncate">{resident.referencePoint}</span>
                                </p>
                              )}

                              {/* Notificação para o Secretário de qual motorista selecionar */}
                              {(() => {
                                const match = getResidentSectorAndDriver(resident);
                                return (
                                  <div className={`p-2 rounded-xl border text-[10px] flex items-start gap-1.5 my-1 ${
                                    match.driverName ? 'bg-amber-50/90 border-amber-200/80 text-amber-950' : 'bg-slate-50 border-slate-200 text-slate-500'
                                  }`}>
                                    <Bell size={12} className={match.driverName ? "text-amber-600 shrink-0 mt-0.5" : "text-slate-400 shrink-0 mt-0.5"} />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-black text-[9px] uppercase tracking-wide">
                                          {match.driverName ? `Notificação Secretário: ${match.driverName}` : 'Sem Motorista Fixo'}
                                        </span>
                                        {match.plate && <span className="font-mono text-[8px] text-slate-600">[{match.plate}]</span>}
                                      </div>
                                      <p className="text-[8px] text-slate-500 font-medium mt-0.5 leading-tight">
                                        {match.reasonText}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })()}

                              <button 
                                onClick={() => handleQuickDispatchForResident(resident)} 
                                className="w-full mt-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase tracking-wider rounded-lg flex items-center justify-center gap-1 active:scale-95 shadow-sm shadow-blue-500/10 transition-all cursor-pointer"
                              >
                                <TruckIcon size={12} /> Despachar Água
                              </button>
                            </div>
                          </div>
                      ))}
                      {residents.filter(r => {
                        if (residentCategoryFilter === 'SCHOOL' && r.category !== 'SCHOOL') return false;
                        if (residentCategoryFilter === 'DAYCARE' && r.category !== 'DAYCARE') return false;
                        if (residentCategoryFilter === 'RESIDENT' && r.category && r.category !== 'RESIDENT') return false;
                        if (residentSearch.trim()) {
                          const q = residentSearch.toLowerCase().trim();
                          return (r.name || '').toLowerCase().includes(q) || 
                                 (r.address || '').toLowerCase().includes(q) || 
                                 (r.neighborhood || '').toLowerCase().includes(q) ||
                                 (r.referencePoint || '').toLowerCase().includes(q);
                        }
                        return true;
                      }).length === 0 && (
                        <p className="text-center py-6 text-slate-400 text-xs">Nenhum registro encontrado nesta categoria.</p>
                      )}
                    </div>
                  </div>
                )}
                
                {activeCadastroSubTab === 'truck' && (
                  <div className="w-full">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                      <h3 className="font-bold text-lg">Caminhões</h3>
                      <div className="flex gap-2 w-full sm:w-auto justify-end">
                         <button onClick={() => handleDeleteAll('trucks', trucks)} className="flex-1 sm:flex-initial bg-red-100 text-red-600 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap">Apagar Todos</button>
                         <button onClick={() => setShowAddTruck(true)} className="flex-1 sm:flex-initial bg-brand-dark text-white px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap">+ Novo</button>
                      </div>
                    </div>
                    
                    {/* Desktop Table */}
                    <div className="overflow-x-auto w-full custom-scrollbar hidden sm:block">
                      <table className="w-full text-left min-w-[500px]">
                        <thead className="bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <tr>
                            <th className="px-6 py-4">Placa</th>
                            <th className="px-6 py-4">Motorista</th>
                            <th className="px-6 py-4 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {trucks.map(truck => (
                            <tr key={truck.id}>
                              <td className="px-6 py-5 font-black">{truck.plate}</td>
                              <td className="px-6 py-5">{truck.driverName}</td>
                              <td className="px-6 py-5 text-center flex items-center justify-center gap-2">
                                  <button onClick={() => handleEdit('trucks', truck)} className="p-2 bg-slate-100 text-slate-500 hover:bg-brand-primary hover:text-white rounded-lg transition-colors"><Edit2 size={16}/></button>
                                  <button onClick={() => handleDelete('trucks', truck.id)} className="p-2 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors"><Trash2 size={16}/></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards for Trucks */}
                    <div className="sm:hidden space-y-3">
                      {trucks.map(truck => (
                        <div key={truck.id} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
                          <div>
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Caminhão</span>
                            <h4 className="font-black text-slate-800 text-base leading-tight uppercase">{truck.driverName}</h4>
                            <p className="font-mono text-xs text-brand-dark/70 font-bold mt-1 bg-slate-100 border border-slate-200 inline-block px-2.5 py-0.5 rounded-lg">{truck.plate}</p>
                          </div>
                          <div className="flex gap-1.5">
                            <button 
                              onClick={() => handleEdit('trucks', truck)} 
                              className="p-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl active:scale-95 transition-all shadow-sm"
                              title="Editar"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={() => handleDelete('trucks', truck.id)} 
                              className="p-2.5 bg-white border border-slate-200 text-red-500 hover:bg-red-50 rounded-xl active:scale-95 transition-all shadow-sm"
                              title="Excluir"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {trucks.length === 0 && (
                        <p className="text-center py-6 text-slate-400 text-xs">Nenhum caminhão cadastrado.</p>
                      )}
                    </div>
                  </div>
                )}
                
                {activeCadastroSubTab === 'driver' && (
                  <div className="w-full">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                      <h3 className="font-bold text-lg">Motoristas</h3>
                      <div className="flex gap-2 w-full sm:w-auto justify-end">
                        <button onClick={() => handleDeleteAll('drivers', drivers)} className="flex-1 sm:flex-initial bg-red-100 text-red-600 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap">Apagar Todos</button>
                        <button onClick={() => setShowAddDriver(true)} className="flex-1 sm:flex-initial bg-brand-dark text-white px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap">+ Novo</button>
                      </div>
                    </div>
                    
                    {/* Desktop Table */}
                    <div className="overflow-x-auto w-full custom-scrollbar hidden sm:block">
                      <table className="w-full text-left min-w-[750px]">
                        <thead className="bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <tr>
                            <th className="px-6 py-4">Nome</th>
                            <th className="px-6 py-4">Telefone</th>
                            <th className="px-6 py-4">Sítio onde Mora (GPS)</th>
                            <th className="px-6 py-4">Setor / Região Atendida</th>
                            <th className="px-6 py-4">Endereço / Base</th>
                            <th className="px-6 py-4">Caminhão Vinculado</th>
                            <th className="px-6 py-4 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {drivers.map(driver => {
                            const linkedTruck = trucks.find(t => t.driverName.toLowerCase() === driver.name.toLowerCase());
                            return (
                              <tr key={driver.id}>
                                <td className="px-6 py-5 font-black text-slate-900">{driver.name}</td>
                                <td className="px-6 py-5 font-mono text-xs">{driver.phone || '—'}</td>
                                <td className="px-6 py-5 text-xs">
                                  {driver.homeSitio ? (
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-bold text-slate-900 flex items-center gap-1">
                                        🏡 {driver.homeSitio}
                                      </span>
                                      {driver.homeLat && driver.homeLng ? (
                                        <span className="text-[10px] text-emerald-700 font-mono flex items-center gap-1 bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 rounded-md w-fit">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                          GPS Mapeado
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-amber-600 font-medium">Sem coordenadas</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 italic">Não informado</span>
                                  )}
                                </td>
                                <td className="px-6 py-5 text-xs">
                                  {driver.sector ? (
                                    <span className="inline-flex items-center gap-1 font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200/60">
                                      <MapPin size={11} /> {driver.sector}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 italic">Não especificado</span>
                                  )}
                                </td>
                                <td className="px-6 py-5 text-xs text-slate-600 font-medium">{driver.address || '—'}</td>
                                <td className="px-6 py-5 text-xs">
                                  {linkedTruck ? (
                                    <span className="font-mono font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-slate-700">
                                      🚛 {linkedTruck.plate}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 italic text-[11px]">Nenhum caminhão</span>
                                  )}
                                </td>
                                <td className="px-6 py-5 text-center flex items-center justify-center gap-2">
                                  <button onClick={() => handleEdit('drivers', driver)} className="p-2 bg-slate-100 text-slate-500 hover:bg-brand-primary hover:text-white rounded-lg transition-colors cursor-pointer" title="Editar"><Edit2 size={16}/></button>
                                  <button onClick={() => handleDelete('drivers', driver.id)} className="p-2 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors cursor-pointer" title="Excluir"><Trash2 size={16}/></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards for Drivers */}
                    <div className="sm:hidden space-y-3">
                      {drivers.map(driver => {
                        const linkedTruck = trucks.find(t => t.driverName.toLowerCase() === driver.name.toLowerCase());
                        return (
                          <div key={driver.id} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Motorista</span>
                                <h4 className="font-black text-brand-dark uppercase tracking-tight leading-tight">{driver.name}</h4>
                              </div>
                              <div className="flex gap-1.5 shrink-0">
                                <button 
                                  onClick={() => handleEdit('drivers', driver)} 
                                  className="p-2.5 bg-white border border-slate-200 text-slate-500 hover:bg-brand-primary hover:text-white rounded-xl active:scale-95 transition-all shadow-sm"
                                  title="Editar"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button 
                                  onClick={() => handleDelete('drivers', driver.id)} 
                                  className="p-2.5 bg-white border border-slate-200 text-red-500 hover:bg-red-50 rounded-xl active:scale-95 transition-all shadow-sm"
                                  title="Excluir"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            {driver.homeSitio && (
                              <div className="text-[11px] font-bold text-emerald-950 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/80 w-fit flex items-center gap-1.5 flex-wrap">
                                <span>🏡 Sítio: <strong>{driver.homeSitio}</strong></span>
                                {driver.homeLat && driver.homeLng ? (
                                  <span className="text-[9px] font-mono text-emerald-700 bg-emerald-100/90 px-1.5 py-0.2 rounded font-black flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    GPS Ativo
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-amber-600 font-medium">Sem GPS</span>
                                )}
                              </div>
                            )}
                            {driver.sector && (
                              <div className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200/60 w-fit flex items-center gap-1">
                                <MapPin size={11} /> Setor: {driver.sector}
                              </div>
                            )}
                            {driver.address && (
                              <p className="text-[11px] text-slate-600">
                                Base/Endereço: <strong>{driver.address}</strong>
                              </p>
                            )}
                            {linkedTruck && (
                              <p className="text-[11px] text-slate-600 font-mono">
                                Caminhão: <strong>{linkedTruck.plate}</strong>
                              </p>
                            )}
                            {driver.phone && (
                              <div className="text-xs border-t border-slate-100 pt-1.5 flex items-center gap-1.5 font-mono text-slate-600">
                                <Smartphone size={12} className="text-slate-400" />
                                <a href={`tel:${driver.phone}`} className="hover:underline font-bold text-slate-700">{driver.phone}</a>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {drivers.length === 0 && (
                        <p className="text-center py-6 text-slate-400 text-xs">Nenhum motorista cadastrado.</p>
                      )}
                    </div>
                  </div>
                )}
                
                {activeCadastroSubTab === 'councilman' && (
                  <div className="w-full">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                      <h3 className="font-bold text-lg">Vereadores</h3>
                      <div className="flex gap-2 w-full sm:w-auto justify-end">
                          <button onClick={() => handleDeleteAll('councilmen', councilmen)} className="flex-1 sm:flex-initial bg-red-100 text-red-600 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap">Apagar Todos</button>
                          <button onClick={() => setShowAddCouncilman(true)} className="flex-1 sm:flex-initial bg-brand-dark text-white px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap">+ Novo</button>
                      </div>
                    </div>
                    
                    {/* Desktop Table */}
                    <div className="overflow-x-auto w-full custom-scrollbar hidden sm:block">
                      <table className="w-full text-left min-w-[400px]">
                        <thead className="bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <tr>
                            <th className="px-6 py-4">Nome</th>
                            <th className="px-6 py-4 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {councilmen.map(councilman => (
                            <tr key={councilman.id}>
                              <td className="px-6 py-5 font-black">{councilman.name}</td>
                              <td className="px-6 py-5 text-center flex items-center justify-center gap-2">
                                  <button onClick={() => handleEdit('councilmen', councilman)} className="p-2 bg-slate-100 text-slate-500 hover:bg-brand-primary hover:text-white rounded-lg transition-colors"><Edit2 size={16}/></button>
                                  <button onClick={() => handleDelete('councilmen', councilman.id)} className="p-2 bg-slate-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors"><Trash2 size={16}/></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards for Councilmen */}
                    <div className="sm:hidden space-y-3">
                      {councilmen.map(councilman => (
                        <div key={councilman.id} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
                          <div>
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Vereador / Indicação</span>
                            <h4 className="font-black text-slate-800 text-base leading-tight uppercase">{councilman.name}</h4>
                          </div>
                          <div className="flex gap-1.5">
                            <button 
                              onClick={() => handleEdit('councilmen', councilman)} 
                              className="p-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl active:scale-95 transition-all shadow-sm"
                              title="Editar"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={() => handleDelete('councilmen', councilman.id)} 
                              className="p-2.5 bg-white border border-slate-200 text-red-500 hover:bg-red-50 rounded-xl active:scale-95 transition-all shadow-sm"
                              title="Excluir"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {councilmen.length === 0 && (
                        <p className="text-center py-6 text-slate-400 text-xs">Nenhum vereador cadastrado.</p>
                      )}
                    </div>
                  </div>
                )}
            </div>
          </div>
        )}

        {activeTab === 'councilmen' && (
          <div className="p-3 sm:p-4 lg:p-5 max-w-4xl mx-auto w-full">
            <header className="flex justify-between items-center mb-4 sm:mb-6">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setActiveTab('map')}
                  className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar para o Painel"
                  aria-label="Voltar para o Painel"
                >
                  <ArrowLeft size={16} />
                </button>
                <h2 className="text-3xl font-bold">Vereadores</h2>
              </div>
              <button 
                onClick={() => setShowAddCouncilman(true)}
                className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95"
              >
                <Plus size={18} /> Novo Vereador
              </button>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {councilmen.map(councilman => (
                <div key={councilman.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                    <UserCheck size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{councilman.name}</h3>
                    <p className="text-slate-400 text-xs uppercase font-bold tracking-widest">Inhapi • AL</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-2.5 sm:p-4 lg:p-5 max-w-2xl mx-auto w-full">
            <header className="mb-4 lg:mb-6">
               <div className="flex items-center gap-2.5">
                 <button
                   onClick={() => setActiveTab('map')}
                   className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                   title="Voltar para o Painel"
                   aria-label="Voltar para o Painel"
                 >
                   <ArrowLeft size={16} />
                 </button>
                 <h2 className="text-xl sm:text-2xl lg:text-3xl font-black flex items-center gap-2.5 uppercase tracking-tight">
                   <Shield className="text-brand-dark" size={24} /> Configurações
                 </h2>
               </div>
               <p className="text-slate-500 mt-1 uppercase font-bold text-[9px] lg:text-[10px] tracking-widest">Segurança e acessos administrativos.</p>
            </header>

            <div className="bg-white rounded-2xl p-4 lg:p-6 shadow-md border-2 border-brand-dark/10">
               <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shrink-0">
                    <Key size={24} />
                  </div>
                  <div>
                    <h3 className="font-black text-lg lg:text-xl uppercase tracking-tight">Senha ADM</h3>
                    <p className="text-slate-400 text-xs font-bold leading-tight uppercase tracking-wider">Protege o acesso ao Painel Administrativo.</p>
                  </div>
               </div>

               <div className="space-y-6">
                 <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Nova Senha</label>
                    <input 
                      type="password"
                      placeholder="Mínimo 4 caracteres"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-brand-dark outline-none rounded-2xl py-4 px-6 font-bold transition-all text-sm"
                    />
                 </div>

                 <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Repetir Senha</label>
                    <input 
                      type="password"
                      placeholder="Confirmação"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-brand-dark outline-none rounded-2xl py-4 px-6 font-bold transition-all text-sm"
                    />
                 </div>

                 {settingsError && (
                   <div className="bg-red-50 text-red-500 p-4 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center gap-2 border border-red-100">
                     <AlertCircle size={16} /> {settingsError}
                   </div>
                 )}

                 {settingsSuccess && (
                   <div className="bg-emerald-50 text-emerald-600 p-4 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center gap-2 border border-emerald-100">
                     <CheckCircle2 size={16} /> Senha atualizada!
                   </div>
                 )}

                 <div className="flex flex-col sm:flex-row gap-3">
                   <button 
                    disabled={settingsLoading}
                    onClick={handleChangePassword}
                    className="flex-1 bg-brand-dark text-white font-black py-4 rounded-3xl flex items-center justify-center gap-3 hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-brand-dark/20 disabled:opacity-50 uppercase tracking-widest text-xs sm:text-sm"
                   >
                     {settingsLoading ? 'Salvando...' : (
                       <>
                         <Save size={18} /> Salvar Nova Senha
                       </>
                     )}
                   </button>
                   <button 
                    type="button"
                    disabled={settingsLoading}
                    onClick={handleResetAdminPasswordToDefault}
                    className="py-4 px-6 bg-slate-100 hover:bg-amber-50 hover:text-amber-800 text-slate-700 font-black rounded-3xl transition-all active:scale-95 text-xs uppercase tracking-wider flex items-center justify-center gap-2 border border-slate-200"
                    title="Redefinir para a senha padrão 123456"
                   >
                     <span>Redefinir para 123456</span>
                   </button>
                 </div>

                 <div className="mt-12 pt-10 border-t border-slate-100">
                    <h3 className="font-black text-lg uppercase tracking-tight text-red-500 mb-2">Perigo</h3>
                    <p className="text-slate-400 text-xs font-bold leading-tight uppercase tracking-wider mb-6">Apagar todos os dados do aplicativo.</p>
                    {showResetConfirmation ? (
                      <div className="space-y-4">
                        <input 
                          type="password"
                          placeholder="Senha de ADMIN para confirmar"
                          value={resetPasswordInput}
                          onChange={e => setResetPasswordInput(e.target.value)}
                          className="w-full bg-slate-50 border-2 border-transparent focus:border-red-500 outline-none rounded-2xl py-4 px-6 font-bold transition-all text-sm"
                        />
                        <div className="flex gap-4">
                          <button onClick={() => setShowResetConfirmation(false)} className="flex-1 py-3 sm:py-4 bg-slate-100 rounded-2xl font-black uppercase text-[10px] sm:text-xs">Cancelar</button>
                          <button onClick={handleResetAppData} className="flex-1 py-3 sm:py-4 bg-red-600 text-white rounded-2xl font-black uppercase text-[10px] sm:text-xs">Resetar Agora</button>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowResetConfirmation(true)}
                        className="w-full bg-red-50 text-red-600 font-black py-3 sm:py-4 rounded-[20px] sm:rounded-3xl flex items-center justify-center gap-3 hover:bg-red-100 transition-all active:scale-95 uppercase tracking-widest text-[11px] sm:text-xs"
                      >
                        <Trash2 size={20} /> Resetar Aplicativo
                      </button>
                    )}

                 </div>
               </div>
            </div>

            {/* Sound Notification Alert Settings Card */}
            <div className="bg-white rounded-2xl p-4 lg:p-6 shadow-md border-2 border-indigo-500/10 mt-6">
               <div className="flex items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                      soundEnabled ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
                    </div>
                    <div>
                      <h3 className="font-black text-lg lg:text-xl uppercase tracking-tight">Notificações Sonoras</h3>
                      <p className="text-slate-400 text-xs font-bold leading-tight uppercase tracking-wider">Avisos sonoros de conclusão de entrega.</p>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => {
                      playTestChime();
                      setAdminToast({ show: true, message: 'Tocando teste de som...' });
                      setTimeout(() => setAdminToast({ show: false, message: '' }), 2000);
                    }}
                    className="p-2.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-xl transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold"
                    title="Testar sinal sonoro"
                  >
                    <BellRing size={14} />
                    <span className="hidden sm:inline">Testar Som</span>
                  </button>
               </div>

               <div className="space-y-5">
                  <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <div className="font-black text-sm text-slate-800 uppercase tracking-wide flex items-center gap-2">
                        <span>Sinal Sonoro de Entregas Concluídas</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${
                          soundEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {soundEnabled ? 'Ativado' : 'Silenciado'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                        Toca automaticamente um sinal melódico no alto-falante/fone do administrador no exato momento em que um motorista conclui uma entrega no campo.
                      </p>
                    </div>

                    <button
                      onClick={handleToggleSound}
                      className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 shrink-0 shadow-md ${
                        soundEnabled 
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20' 
                          : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      }`}
                    >
                      {soundEnabled ? 'Desativar Som' : 'Ativar Som'}
                    </button>
                  </div>
               </div>
            </div>

            {/* Firebase Firestore Database Management Card */}
            <div className="bg-white rounded-2xl p-4 lg:p-6 shadow-md border-2 border-amber-500/20 mt-6">
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                      <Database size={24} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black text-lg lg:text-xl uppercase tracking-tight">Banco de Dados Firebase Firestore</h3>
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-black uppercase px-2 py-0.5 rounded-full">
                          Oficial
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs font-bold leading-tight uppercase tracking-wider">Armazenamento em nuvem 100% Google Firebase em tempo real.</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleCheckFirebase}
                    disabled={isCheckingFirebase}
                    className="p-2.5 bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-600 rounded-xl transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold self-start sm:self-auto"
                    title="Testar Conexão com Firebase"
                  >
                    <RefreshCw size={14} className={isCheckingFirebase ? 'animate-spin' : ''} />
                    <span>Testar Conexão</span>
                  </button>
               </div>

               <div className="space-y-5">
                  {/* Status Indicator */}
                  <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
                    firebaseStatus?.connected
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50/70 border-amber-200 text-amber-900'
                  }`}>
                    <div className="mt-0.5">
                      {firebaseStatus?.connected ? (
                        <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      ) : (
                        <div className="w-3 h-3 rounded-full bg-amber-500" />
                      )}
                    </div>
                    <div className="text-xs flex-1">
                      <div className="font-black uppercase tracking-wider flex items-center gap-2">
                        <span>{firebaseStatus?.connected ? 'Firebase Firestore Conectado' : 'Conectando ao Firebase...'}</span>
                        {firebaseStatus?.latencyMs && (
                          <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono">
                            {firebaseStatus.latencyMs} ms
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-medium opacity-90 mt-0.5">
                        {firebaseStatus?.message || 'Verificando conexão com o Google Cloud Firestore...'}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Projeto: <strong>{firebaseStatus?.projectId || 'ai-studio-dad26a59-43f1-4ca1-9d3e-846540128eb8'}</strong></span>
                        <span>Banco: <strong>{firebaseStatus?.databaseId || '(default)'}</strong></span>
                        {firebaseStatus?.timestamp && <span>Última checagem: <strong>{firebaseStatus.timestamp}</strong></span>}
                      </div>
                    </div>
                  </div>

                  {/* Collections Document Count Cards */}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2.5">
                      Coleções Ativas no Firebase Firestore
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Caminhões</span>
                        <span className="text-xl font-black text-slate-800">{trucks.length}</span>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Entregas</span>
                        <span className="text-xl font-black text-blue-600">{deliveries.length}</span>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Moradores</span>
                        <span className="text-xl font-black text-emerald-600">{residents.length}</span>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Sítios/Fontes</span>
                        <span className="text-xl font-black text-cyan-600">{sitios.length}</span>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Motoristas</span>
                        <span className="text-xl font-black text-indigo-600">{drivers.length}</span>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vereadores</span>
                        <span className="text-xl font-black text-purple-600">{councilmen.length}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Backup */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      onClick={handleExportFirebaseBackup}
                      disabled={isExportingBackup}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 disabled:opacity-50"
                    >
                      <Download size={16} className={isExportingBackup ? 'animate-bounce' : ''} />
                      {isExportingBackup ? 'Gerando Backup...' : 'Exportar Backup JSON (Firebase)'}
                    </button>
                    <button
                      onClick={handleCheckFirebase}
                      disabled={isCheckingFirebase}
                      className="py-3.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all active:scale-95 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={14} className={isCheckingFirebase ? 'animate-spin' : ''} />
                      <span>Atualizar Status</span>
                    </button>
                  </div>

                  {/* Security & Architecture Badges */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2 items-center text-[10px] font-bold text-slate-400">
                    <span className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-600">
                      <ShieldCheck size={12} className="text-emerald-600" />
                      Regras de Segurança Ativas (firestore.rules)
                    </span>
                    <span className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-600">
                      <Zap size={12} className="text-amber-500" />
                      Sincronização em Tempo Real (WebSockets / WebChannel)
                    </span>
                    <span className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-600">
                      <CheckCircle2 size={12} className="text-blue-600" />
                      Cache Offline Habilitado (IndexedDB)
                    </span>
                  </div>
               </div>
            </div>
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="p-2.5 sm:p-4 lg:p-5 max-w-4xl mx-auto w-full flex-1 flex flex-col gap-4">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setActiveTab('map')}
                    className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar para o Painel"
                    aria-label="Voltar para o Painel"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-black flex items-center gap-2.5 uppercase tracking-tight">
                    <Database className="text-brand-dark" size={26} /> Sincronia de Aparelhos
                  </h2>
                </div>
                <p className="text-slate-500 mt-1 uppercase font-bold text-[10px] lg:text-xs tracking-widest">Acompanhamento de dados pendentes em IndexedDB de campo.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCheckFirebase}
                  className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold"
                >
                  <RefreshCw size={14} className={isCheckingFirebase ? 'animate-spin' : ''} />
                  <span>Atualizar Status</span>
                </button>
              </div>
            </header>

            {/* Informational Hero Card */}
            <div className="bg-slate-50 rounded-3xl p-5 border border-slate-200/60 text-slate-600 text-xs leading-relaxed">
              <p className="font-bold text-slate-800 uppercase tracking-wider text-[10px] mb-1.5 flex items-center gap-1.5">
                <AlertCircle size={14} className="text-brand-dark" /> Como funciona a Sincronização?
              </p>
              Os motoristas utilizam o banco de dados local <strong className="text-brand-dark">IndexedDB</strong> nos celulares quando perdem o sinal de internet (3G/4G). Todas as fotos de entregas, coordenadas e novos moradores são guardadas com segurança no aparelho e enviadas automaticamente ao Firebase assim que o sinal for restabelecido. Este painel permite que você saiba exatamente o que ainda está retido localmente nos aparelhos de campo.
            </div>

            {/* Summary Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Aparelhos Monitorados</span>
                <span className="text-3xl font-black text-slate-800">{deviceSyncStatuses.length}</span>
                <span className="text-[9px] text-slate-400 mt-2 font-bold uppercase">Celulares ativos em campo</span>
              </div>
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Total de Ações Pendentes</span>
                <span className={`text-3xl font-black ${deviceSyncStatuses.reduce((acc, curr) => acc + (curr.pendingCount || 0), 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {deviceSyncStatuses.reduce((acc, curr) => acc + (curr.pendingCount || 0), 0)}
                </span>
                <span className="text-[9px] text-slate-400 mt-2 font-bold uppercase">Aguardando reestabelecimento de rede</span>
              </div>
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Status Geral da Operação</span>
                <div className="mt-1">
                  {deviceSyncStatuses.reduce((acc, curr) => acc + (curr.pendingCount || 0), 0) === 0 ? (
                    <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">
                      <CheckCircle2 size={12} /> 100% Sincronizado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">
                      <Clock size={12} /> Dados em Fila
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-slate-400 mt-2.5 font-bold uppercase">Atualizado em tempo real</span>
              </div>
            </div>

            {/* Devices List Table/Grid */}
            <div className="bg-white rounded-[40px] border border-slate-200 overflow-hidden shadow-xl">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="font-black text-xs uppercase tracking-wider text-slate-500">Status por Veículo/Aparelho</h3>
                <span className="text-[10px] font-bold bg-slate-200 px-2.5 py-1 rounded-full text-slate-600">
                  {deviceSyncStatuses.length} Cadastrados
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {deviceSyncStatuses.map((device) => {
                  const hasPending = (device.pendingCount || 0) > 0;
                  const lastUpdateDate = device.lastUpdate ? new Date(device.lastUpdate) : null;
                  const isOnlineRecently = lastUpdateDate ? (Date.now() - lastUpdateDate.getTime() < 10 * 60 * 1000) : false;

                  return (
                    <div key={device.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${hasPending ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                          <Smartphone size={24} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-black text-slate-800 text-sm sm:text-base uppercase tracking-tight">
                              {device.driverName || 'Motorista Sem Nome'}
                            </h4>
                            <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded-md text-slate-500 uppercase font-bold">
                              {device.plate || 'Sem Placa'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] font-medium text-slate-400">
                            <span>Sinal:</span>
                            {isOnlineRecently ? (
                              <span className="text-emerald-600 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Ativo Agora
                              </span>
                            ) : (
                              <span>
                                {device.lastUpdate ? `Último sinal há ${Math.round((Date.now() - lastUpdateDate!.getTime()) / 60000)} min` : 'Sem contato'}
                              </span>
                            )}
                            <span>•</span>
                            <span className="font-mono">{device.lastUpdate ? new Date(device.lastUpdate).toLocaleString('pt-BR') : '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        <div className="text-right hidden sm:block">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ações em Cache</p>
                          <p className={`text-base font-black ${hasPending ? 'text-amber-500' : 'text-slate-700'}`}>
                            {device.pendingCount || 0} pendentes
                          </p>
                        </div>
                        
                        <div className={`px-4 py-2 rounded-2xl border text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${
                          hasPending 
                            ? 'bg-amber-50 border-amber-200 text-amber-800' 
                            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        }`}>
                          {hasPending ? (
                            <>
                              <AlertCircle size={14} className="text-amber-600" />
                              <span>{device.pendingCount} Retidos</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={14} className="text-emerald-600" />
                              <span>Sincronizado</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {deviceSyncStatuses.length === 0 && (
                  <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
                    <Database size={40} className="text-slate-300 stroke-[1.5]" />
                    <p className="text-sm font-bold uppercase tracking-wider">Nenhum aparelho registrado</p>
                    <p className="text-xs text-slate-400 max-w-sm">Os aparelhos dos motoristas reportarão seu status de sincronia automaticamente assim que realizarem qualquer ação no campo.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {activeDashboardModal && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[2010] flex items-center justify-center p-2.5 sm:p-5 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 14 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.95, opacity: 0, y: 14 }}
              className={`bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-7 w-full shadow-2xl my-auto border border-slate-200/90 max-h-[92dvh] flex flex-col pointer-events-auto transition-all ${
                activeDashboardModal === 'active_trucks' || activeDashboardModal === 'in_service' ? 'max-w-4xl' : 'max-w-lg'
              }`}
            >
              {/* Header */}
              <div className="flex justify-between items-start gap-2 pb-3 sm:pb-4 border-b border-slate-100 flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      activeDashboardModal === 'completed' ? 'bg-emerald-500' :
                      activeDashboardModal === 'in_service' ? 'bg-emerald-600 animate-pulse' :
                      activeDashboardModal === 'active_trucks' ? 'bg-blue-600' : 'bg-amber-500'
                    }`} />
                    <span className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wider truncate ${
                      activeDashboardModal === 'completed' || activeDashboardModal === 'in_service' ? 'text-emerald-600' :
                      activeDashboardModal === 'active_trucks' ? 'text-blue-600' : 'text-amber-600'
                    }`}>
                      {activeDashboardModal === 'completed' ? 'Histórico de Entregas' :
                       activeDashboardModal === 'in_service' ? 'Monitoramento em Tempo Real' :
                       activeDashboardModal === 'active_trucks' ? 'Rastreamento de Frota' : 'Solicitações'}
                    </span>
                  </div>
                  <h3 className="text-base sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5 leading-snug">
                    {activeDashboardModal === 'completed' ? 'Entregas Concluídas Hoje' :
                     activeDashboardModal === 'in_service' ? 'Caminhões e Motoristas em Serviço' :
                     activeDashboardModal === 'active_trucks' ? 'Escolher Motorista para Rastrear' : 'Águas Pendentes'}
                  </h3>
                  {activeDashboardModal === 'in_service' ? (
                    <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                      Informações completas da operação ativa, status de GPS, placas e destinos ({activeInServiceDrivers.length} em serviço de {allRegisteredDrivers.length} cadastrados)
                    </p>
                  ) : activeDashboardModal === 'active_trucks' ? (
                    <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                      Lista completa de motoristas cadastrados ({allRegisteredDrivers.length} no total)
                    </p>
                  ) : activeDashboardModal === 'completed' ? (
                    <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                      Registros de abastecimentos finalizados na data de hoje
                    </p>
                  ) : (
                    <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                      Moradores aguardando liberação de entrega de água
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button 
                    onClick={() => setActiveDashboardModal(null)} 
                    className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar"
                    aria-label="Voltar"
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button 
                    onClick={() => setActiveDashboardModal(null)} 
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                    title="Fechar"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Pinned Filter Bar for Em Serviço Modal */}
              {activeDashboardModal === 'in_service' && (
                <div className="py-3 flex flex-wrap items-center justify-between gap-2 flex-shrink-0 border-b border-slate-100">
                  <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 w-full sm:w-auto">
                    <button
                      onClick={() => setInServiceModalFilter('in_service')}
                      className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        inServiceModalFilter === 'in_service'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${inServiceModalFilter === 'in_service' ? 'bg-white animate-pulse' : 'bg-emerald-500'}`} />
                      <span>Em Serviço ({activeInServiceDrivers.length})</span>
                    </button>
                    <button
                      onClick={() => setInServiceModalFilter('all')}
                      className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        inServiceModalFilter === 'all'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <span>Todos os Veículos ({allRegisteredDrivers.length})</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500 px-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500" /> Em Rota: <strong className="text-slate-800">{allRegisteredDrivers.filter(d => d.status === 'IN_ROUTE').length}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" /> Com GPS: <strong className="text-slate-800">{allRegisteredDrivers.filter(d => d.hasGPS).length}</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Pinned Search & Tabs for Active Trucks / Driver Selector */}
              {activeDashboardModal === 'active_trucks' && (
                <div className="py-3 space-y-2.5 flex-shrink-0 border-b border-slate-100">
                  <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all">
                    <Search size={15} className="text-slate-400 mr-2 shrink-0" />
                    <input
                      type="text"
                      placeholder="Buscar motorista, placa ou telefone..."
                      value={trucksModalSearch}
                      onChange={(e) => setTrucksModalSearch(e.target.value)}
                      className="w-full bg-transparent text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 outline-none font-medium"
                    />
                    {trucksModalSearch && (
                      <button onClick={() => setTrucksModalSearch('')} className="text-slate-400 hover:text-slate-600 p-0.5">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:flex items-center gap-1.5 pt-0.5">
                    {[
                      { id: 'all', label: `Todos (${allRegisteredDrivers.length})` },
                      { id: 'gps_active', label: `Com GPS (${allRegisteredDrivers.filter(d => d.hasGPS).length})` },
                      { id: 'in_route', label: `Em Rota (${allRegisteredDrivers.filter(d => d.status === 'IN_ROUTE').length})` },
                      { id: 'idle', label: `Disponíveis (${allRegisteredDrivers.filter(d => d.status !== 'IN_ROUTE').length})` },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setTrucksModalFilter(tab.id as any)}
                        className={`px-2.5 py-2 sm:py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer text-center ${
                          trucksModalFilter === tab.id
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Scrollable list content */}
              <div className="flex-1 overflow-y-auto py-3.5 pr-1 custom-scrollbar">
                {activeDashboardModal === 'completed' && (() => {
                  const completedList = deliveries.filter(d => {
                    if (d.status !== 'DELIVERED' || !d.createdAt) return false;
                    try {
                      return new Date(d.createdAt).toLocaleDateString('en-CA') === todayStr;
                    } catch (e) {
                      return d.createdAt.startsWith(todayStr);
                    }
                  });

                  if (completedList.length === 0) {
                    return (
                      <div className="text-center py-10 space-y-2">
                        <CheckCircle2 size={40} className="text-slate-300 mx-auto" />
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Nenhuma entrega realizada hoje ainda.</p>
                      </div>
                    );
                  }

                  return completedList.map(d => (
                    <div key={d.id} className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-2xl flex justify-between items-center gap-3">
                      <div className="min-w-0">
                        <h4 className="font-extrabold text-xs sm:text-sm text-slate-900 uppercase truncate">{d.residentName}</h4>
                        <p className="text-[10px] text-slate-500 font-bold uppercase truncate">{d.address}</p>
                        <p className="text-[9px] text-slate-400 font-medium mt-1">
                          Concluído às {new Date(d.createdAt || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {d.proofPhoto && (
                        <button
                          onClick={() => {
                            setSelectedPhoto(d.proofPhoto!);
                            setActiveDashboardModal(null);
                          }}
                          className="bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-md hover:bg-emerald-700 transition-all active:scale-95 flex-shrink-0"
                        >
                          Ver Comprovante
                        </button>
                      )}
                    </div>
                  ));
                })()}

                {activeDashboardModal === 'active_trucks' && (() => {
                  if (filteredDriversForModal.length === 0) {
                    return (
                      <div className="text-center py-14 space-y-2">
                        <TruckIcon size={44} className="text-slate-300 mx-auto" />
                        <p className="text-slate-500 text-sm font-semibold">Nenhum motorista encontrado com os filtros aplicados.</p>
                        {trucksModalSearch && (
                          <button
                            onClick={() => setTrucksModalSearch('')}
                            className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
                          >
                            Limpar busca
                          </button>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {filteredDriversForModal.map(d => {
                        const isSelected = selectedTruck?.id === d.id;

                        return (
                          <div 
                            key={d.id} 
                            className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                              isSelected
                                ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/20 shadow-xs'
                                : 'bg-slate-50/60 hover:bg-blue-50/30 border-slate-200/90 shadow-xs'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-bold text-sm text-slate-900 truncate">
                                  {d.driverName}
                                </h4>
                                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 shadow-xs">
                                  {d.plate}
                                </span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  d.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  d.status === 'ARRIVED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                  'bg-slate-200/80 text-slate-700'
                                }`}>
                                  {d.status === 'IN_ROUTE' ? 'Em Rota' : d.status === 'ARRIVED' ? 'No Local' : 'Disponível'}
                                </span>
                              </div>

                              <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full ${d.hasGPS ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                    <span className={d.hasGPS ? 'text-emerald-700 font-semibold' : 'text-slate-400 font-medium'}>
                                      {d.hasGPS 
                                        ? `GPS Ativo (${d.lastLat?.toFixed(4)}, ${d.lastLng?.toFixed(4)})` 
                                        : 'Aguardando sinal GPS'}
                                    </span>
                                  </span>

                                  {d.phone && (
                                    <span className="text-slate-500 font-mono text-[11px]">
                                      • 📞 {d.phone}
                                    </span>
                                  )}
                                </div>

                                {d.activeDelivery ? (
                                  <div className="truncate text-slate-600 mt-0.5">
                                    📍 Destino: <strong className="text-slate-800">{d.activeDelivery.residentName}</strong> ({d.activeDelivery.address})
                                  </div>
                                ) : (
                                  <div className="italic text-slate-400 mt-0.5">
                                    • Disponível para novos abastecimentos
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100/90">
                              <button
                                onClick={() => {
                                  if (d.truck) {
                                    setSelectedTruck(d.truck);
                                  }
                                  setActiveTab('map');
                                  setActiveDashboardModal(null);
                                  setAdminToast({ 
                                    show: true, 
                                    message: d.hasGPS 
                                      ? `Rastreando ${d.driverName} (${d.plate}) no mapa em tempo real` 
                                      : `Motorista ${d.driverName} selecionado. Aguardando transmissão GPS.` 
                                  });
                                  setTimeout(() => setAdminToast({ show: false, message: '' }), 3500);
                                }}
                                className={`w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-xs ${
                                  d.hasGPS 
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                                    : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                }`}
                              >
                                <LocateFixed size={14} className={d.hasGPS ? "text-white" : "text-slate-500"} />
                                <span>{d.hasGPS ? 'Rastrear no Mapa' : 'Selecionar'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {activeDashboardModal === 'in_service' && (() => {
                  if (displayedInServiceDrivers.length === 0) {
                    return (
                      <div className="text-center py-12 space-y-3 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 p-6">
                        <TruckIcon size={44} className="text-slate-300 mx-auto" />
                        <div>
                          <p className="text-slate-700 text-sm font-bold">Nenhum caminhão em serviço ativo no momento.</p>
                          <p className="text-slate-400 text-xs mt-1">Você pode visualizar todos os veículos cadastrados clicando no botão abaixo.</p>
                        </div>
                        {inServiceModalFilter === 'in_service' && allRegisteredDrivers.length > 0 && (
                          <button
                            onClick={() => setInServiceModalFilter('all')}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                          >
                            Ver Todos os {allRegisteredDrivers.length} Veículos
                          </button>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {displayedInServiceDrivers.map(d => {
                        const isSelected = selectedTruck?.id === d.id;

                        return (
                          <div 
                            key={d.id} 
                            className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                              isSelected
                                ? 'bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs'
                                : 'bg-white hover:bg-slate-50/80 border-slate-200/90 shadow-xs'
                            }`}
                          >
                            <div className="space-y-2.5">
                              {/* Top Row: Driver Name, Plate & Status Badge */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h4 className="font-black text-sm sm:text-base text-slate-900 leading-snug break-words">
                                    {d.driverName}
                                  </h4>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700">
                                      Placa: {d.plate}
                                    </span>
                                    {d.phone && (
                                      <span className="text-xs font-mono text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200/70">
                                        📞 {d.phone}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0 ${
                                  d.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  d.status === 'ARRIVED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                  'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                  {d.status === 'IN_ROUTE' ? 'Em Rota' : d.status === 'ARRIVED' ? 'No Local' : 'Disponível'}
                                </span>
                              </div>

                              {/* Details Box: GPS, Last Update & Active Delivery */}
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70 space-y-2 text-xs">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="flex items-center gap-1.5 font-semibold">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${d.hasGPS ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                    <span className={d.hasGPS ? 'text-emerald-700' : 'text-slate-500'}>
                                      {d.hasGPS ? 'Sinal GPS Ativo' : 'Sem sinal GPS recente'}
                                    </span>
                                  </span>
                                  {d.lastUpdate && (
                                    <span className="text-[11px] text-slate-400 font-mono">
                                      Atualizado às {new Date(d.lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>

                                {d.hasGPS && (
                                  <div className="text-[11px] font-mono text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200/60">
                                    Coordenadas: {d.lastLat?.toFixed(5)}, {d.lastLng?.toFixed(5)}
                                  </div>
                                )}

                                {d.activeDelivery ? (
                                  <div className="pt-1.5 border-t border-slate-200/70">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 block">
                                      Destino Atual / Entrega Ativa:
                                    </span>
                                    <p className="font-bold text-slate-900 mt-0.5 break-words">
                                      {d.activeDelivery.residentName}
                                    </p>
                                    <p className="text-slate-600 text-[11px] break-words">
                                      📍 {d.activeDelivery.address}
                                      {d.activeDelivery.neighborhood ? ` (${d.activeDelivery.neighborhood})` : ''}
                                    </p>
                                  </div>
                                ) : (
                                  <div className="pt-1 border-t border-slate-200/60 text-slate-400 italic text-[11px]">
                                    Nenhuma entrega em andamento vinculada no momento.
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                              {d.truck && (
                                <button
                                  onClick={() => {
                                    setSelectedTruck(d.truck!);
                                    setActiveDashboardModal(null);
                                  }}
                                  className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all active:scale-95 cursor-pointer"
                                >
                                  Ver Ficha
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (d.truck) {
                                    setSelectedTruck(d.truck);
                                  }
                                  setActiveTab('map');
                                  setActiveDashboardModal(null);
                                  setAdminToast({ 
                                    show: true, 
                                    message: d.hasGPS 
                                      ? `Focando em ${d.driverName} (${d.plate}) no mapa` 
                                      : `Motorista ${d.driverName} selecionado.` 
                                  });
                                  setTimeout(() => setAdminToast({ show: false, message: '' }), 3000);
                                }}
                                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-xs"
                              >
                                <LocateFixed size={14} />
                                <span>Localizar no Mapa</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {activeDashboardModal === 'pending' && (() => {
                  const pendingList = deliveries.filter(d => d.status === 'PENDING');

                  if (pendingList.length === 0) {
                    return (
                      <div className="text-center py-10 space-y-2">
                        <Clock size={40} className="text-slate-300 mx-auto" />
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Nenhum abastecimento pendente na fila.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {pendingList.map(d => (
                        <div key={d.id} className="p-3 bg-amber-50/40 border border-amber-100 rounded-2xl flex justify-between items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-extrabold text-xs sm:text-sm text-slate-900 uppercase truncate">{d.residentName}</h4>
                            <p className="text-[10px] text-slate-500 font-bold uppercase truncate">{d.address}</p>
                            <p className="text-[9px] text-slate-400 font-medium mt-1">
                              Cadastrado em: {new Date(d.createdAt || '').toLocaleDateString()} às {new Date(d.createdAt || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setActiveDashboardModal(null);
                            }}
                            className="bg-amber-500 text-white px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-md hover:bg-amber-600 transition-all active:scale-95 flex-shrink-0 cursor-pointer"
                          >
                            Fechar
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-100 pt-3 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 flex-shrink-0">
                {activeDashboardModal === 'active_trucks' ? (
                  <span className="text-[11px] sm:text-xs text-slate-500 font-medium text-center sm:text-left">
                    Exibindo <strong>{filteredDriversForModal.length}</strong> de <strong>{allRegisteredDrivers.length}</strong> motoristas
                  </span>
                ) : activeDashboardModal === 'in_service' ? (
                  <span className="text-[11px] sm:text-xs text-slate-500 font-medium text-center sm:text-left">
                    Exibindo <strong>{displayedInServiceDrivers.length}</strong> de <strong>{allRegisteredDrivers.length}</strong> veículos/motoristas
                  </span>
                ) : (
                  <span className="hidden sm:inline" />
                )}
                <button
                  onClick={() => setActiveDashboardModal(null)}
                  className="w-8 h-8 sm:w-9 sm:h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={16} />
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddTruck && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-xl p-4 max-w-md w-full shadow-lg border border-brand-dark/10 max-h-[92dvh] overflow-y-auto my-auto">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight">Novo Caminhão</h3>
                <button
                  onClick={() => setShowAddTruck(false)}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>
              <div className="space-y-4">
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3" 
                  placeholder="Placa"
                  value={newTruck.plate}
                  onChange={e => setNewTruck(prev => ({ ...prev, plate: e.target.value }))}
                />
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3" 
                  value={newTruck.driverName}
                  onChange={e => setNewTruck(prev => ({ ...prev, driverName: e.target.value }))}
                >
                  <option value="">Selecionar Motorista...</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {drivers.length === 0 && (
                  <p className="text-red-500 text-xs font-semibold px-1">
                    ⚠️ Nenhum motorista cadastrado. Cadastre motoristas na aba de Cadastros primeiro.
                  </p>
                )}
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => setShowAddTruck(false)} className="flex-1 py-3 rounded-xl border border-slate-200">Cancelar</button>
                <button onClick={handleAddTruck} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold">Salvar</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddDelivery && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-xl p-4 sm:p-5 max-w-2xl w-full shadow-lg my-auto border border-brand-dark/10 max-h-[92dvh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4 sm:mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Despacho para Motorista</span>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">Nova Entrega de Água</h3>
                  <p className="text-slate-500 text-xs mt-0.5">Selecione o morador cadastrado e o sistema preenche tudo automaticamente.</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button 
                    onClick={() => setShowAddDelivery(false)} 
                    className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar"
                    aria-label="Voltar"
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button 
                    onClick={() => setShowAddDelivery(false)} 
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 1. Seletor do Morador Salvo */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Users size={12} className="text-emerald-600" />
                      1. Destinatário (Morador, Escola ou Creche) *
                    </label>
                    <select 
                      className="w-full bg-emerald-50/50 border border-emerald-200 rounded-xl px-4 py-3 text-sm font-black text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition-all"
                      value={newDelivery.residentId || (residents.find(r => r.name === newDelivery.residentName)?.id || '')}
                      onChange={e => {
                        const sel = residents.find(r => r.id === e.target.value);
                        handleSelectResident(sel || null);
                      }}
                    >
                      <option value="">Escolha um Morador, Escola ou Creche...</option>
                      {[...residents].sort((a, b) => a.name.localeCompare(b.name)).map(r => {
                        const m = getResidentSectorAndDriver(r);
                        return (
                          <option key={r.id} value={r.id}>
                            {r.category === 'SCHOOL' ? '🏫 [ESCOLA] ' : r.category === 'DAYCARE' ? '👶 [CRECHE] ' : '🏠 '}{r.name} — {r.neighborhood || r.address || 'Inhapi'} {m.driverName ? `[🔔 ${m.driverName}]` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* 2. Seletor de Caminhão / Motorista com destaque para o indicado */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <TruckIcon size={12} className="text-blue-600" />
                      2. Caminhão / Motorista *
                    </label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all"
                      value={newDelivery.truckId}
                      onChange={e => setNewDelivery(prev => ({ ...prev, truckId: e.target.value }))}
                    >
                      <option value="">Selecionar Caminhão...</option>
                      {trucks.map(t => {
                        const isRecommended = selectedResidentObj && getResidentSectorAndDriver(selectedResidentObj).truckId === t.id;
                        return (
                          <option key={t.id} value={t.id}>
                            {isRecommended ? '⭐ [INDICADO P/ ESTE SETOR] ' : ''}
                            {t.driverName} ({t.plate}) - {t.status === 'IDLE' ? 'Disponível' : 'Em Rota'} {t.sector ? `[Setor: ${t.sector}]` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* NOTIFICAÇÃO PARA O SECRETÁRIO: Motorista indicado para este morador */}
                  {selectedResidentObj && (() => {
                    const match = getResidentSectorAndDriver(selectedResidentObj);
                    const isSelectedTruckMatched = newDelivery.truckId === match.truckId;
                    const selectedTruckObj = trucks.find(t => t.id === newDelivery.truckId);

                    return (
                      <div className="md:col-span-2 bg-gradient-to-r from-amber-50 via-amber-50/80 to-yellow-50/60 border-2 border-amber-300 rounded-2xl p-4 shadow-sm space-y-2 animate-in fade-in duration-200">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                              <Bell size={16} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black uppercase tracking-wider text-amber-950">
                                  Notificação para o Secretário
                                </span>
                                <span className="text-[10px] font-bold bg-amber-200/90 text-amber-900 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Setor: {match.sectorName}
                                </span>
                              </div>
                              <p className="text-xs text-amber-900 font-semibold mt-1">
                                {match.driverName ? (
                                  <>
                                    Motorista indicado para este endereço/setor: <strong className="font-black text-amber-950 text-sm">{match.driverName}</strong>
                                    {match.plate ? ` (Placa: ${match.plate})` : ''}
                                  </>
                                ) : (
                                  <>Nenhum motorista fixado exclusivamente para este setor. Você pode selecionar qualquer caminhão da frota.</>
                                )}
                              </p>
                              <span className="text-[10px] text-amber-800 font-medium block mt-0.5">
                                Motivo: {match.reasonText}
                              </span>
                            </div>
                          </div>

                          {match.truckId && !isSelectedTruckMatched && (
                            <button
                              type="button"
                              onClick={() => setNewDelivery(prev => ({ ...prev, truckId: match.truckId }))}
                              className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-95 shadow-sm shrink-0 flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 size={13} />
                              Selecionar {match.driverName}
                            </button>
                          )}
                          {match.truckId && isSelectedTruckMatched && (
                            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-xl shrink-0 flex items-center gap-1">
                              <CheckCircle2 size={14} className="text-emerald-600" /> Motorista Selecionado!
                            </span>
                          )}
                        </div>

                        {/* Recomendação de Proximidade por GPS do Sítio do Motorista */}
                        {match.closestDriverByGps && (
                          <div className="mt-2.5 pt-2.5 border-t border-amber-300/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-white/70 p-2.5 rounded-xl border border-amber-200">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="text-lg shrink-0">📍</span>
                              <div className="min-w-0 text-xs">
                                <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block">
                                  Proximidade Geográfica via GPS do Sítio:
                                </span>
                                <p className="font-bold text-slate-900 mt-0.5">
                                  {match.closestDriverByGps.driver.name}
                                  <span className="text-slate-600 font-normal"> mora no </span>
                                  <span className="text-emerald-950 font-black">{match.closestDriverByGps.driver.homeSitio || 'Sítio'}</span>
                                  <span className="text-slate-600 font-normal"> a apenas </span>
                                  <span className="text-emerald-800 font-extrabold bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-300/80">{match.closestDriverByGps.distanceKm.toFixed(1)} km</span>
                                  <span className="text-slate-600 font-normal"> de distância deste morador.</span>
                                </p>
                              </div>
                            </div>
                            {match.closestDriverByGps.truck && newDelivery.truckId !== match.closestDriverByGps.truck.id && (
                              <button
                                type="button"
                                onClick={() => setNewDelivery(prev => ({ ...prev, truckId: match.closestDriverByGps!.truck!.id }))}
                                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-[11px] uppercase tracking-wider rounded-xl transition-all shadow-sm shrink-0 flex items-center gap-1 active:scale-95 cursor-pointer"
                              >
                                <Navigation size={12} /> Selecionar Mais Próximo
                              </button>
                            )}
                          </div>
                        )}

                        {/* Aviso se selecionou outro motorista diferente do indicado */}
                        {match.driverName && selectedTruckObj && selectedTruckObj.id !== match.truckId && (
                          <div className="text-[10px] text-amber-800 bg-white/70 border border-amber-200 px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5">
                            <AlertCircle size={13} className="text-amber-600 shrink-0" />
                            <span>
                              Atenção Secretário: O motorista habitual deste setor é <strong>{match.driverName}</strong>, mas você selecionou <strong>{selectedTruckObj.driverName}</strong>. A entrega será despachada para {selectedTruckObj.driverName}.
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Card com os dados que foram preenchidos automaticamente do banco */}
                  {selectedResidentObj ? (
                    <div className="md:col-span-2 bg-gradient-to-br from-emerald-50 to-teal-50/40 border-2 border-emerald-200 rounded-2xl p-4 text-slate-800 shadow-sm animate-in fade-in duration-200">
                      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-emerald-200/70">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                            <CheckCircle2 size={14} />
                          </div>
                          <div>
                            <span className="text-xs font-black uppercase tracking-wider text-emerald-950 block">
                              Morador Localizado no Banco de Dados
                            </span>
                            <span className="text-[10px] text-emerald-700 font-semibold">
                              Informações carregadas e preenchidas automaticamente
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold bg-emerald-100/90 text-emerald-800 px-2.5 py-1 rounded-full flex items-center gap-1 border border-emerald-200 shrink-0">
                          <Sparkles size={11} className="text-emerald-600" /> Automático
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
                          <span className="font-bold text-emerald-700 text-[9px] uppercase tracking-wider block">Nome do Morador:</span>
                          <p className="font-black text-slate-900 text-sm mt-0.5">{selectedResidentObj.name}</p>
                        </div>
                        <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
                          <span className="font-bold text-emerald-700 text-[9px] uppercase tracking-wider block">Bairro / Sítio:</span>
                          <p className="font-bold text-slate-800 mt-0.5">{selectedResidentObj.neighborhood || 'Inhapi (Centro)'}</p>
                        </div>
                        <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
                          <span className="font-bold text-emerald-700 text-[9px] uppercase tracking-wider block">Ponto de Referência Cadastrado:</span>
                          <p className="font-semibold text-slate-700 mt-0.5">{selectedResidentObj.referencePoint || 'Nenhum ponto registrado'}</p>
                        </div>
                        <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
                          <span className="font-bold text-emerald-700 text-[9px] uppercase tracking-wider block">Telefone de Contato:</span>
                          <p className="font-mono font-bold text-slate-800 mt-0.5">{selectedResidentObj.phone || 'Sem telefone registrado'}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="md:col-span-2 bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4 text-center text-xs text-slate-500">
                      💡 Selecione o morador acima: o endereço, ponto de referência, telefone e histórico serão preenchidos automaticamente.
                    </div>
                  )}

                  {/* Campos do Formulário para Revisão ou Edição */}
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <MapPin size={12} className="text-blue-600" />
                      Endereço Completo para Entrega *
                    </label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all text-sm" 
                      placeholder="Ex: Rua São Vicente, 120 - Centro"
                      value={newDelivery.address}
                      onChange={e => setNewDelivery(prev => ({ ...prev, address: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Ponto de Referência
                    </label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm outline-none focus:border-blue-500 focus:bg-white transition-all" 
                      placeholder="Ex: Próximo à caixa d'água / em frente ao mercadinho"
                      value={newDelivery.referencePoint}
                      onChange={e => setNewDelivery(prev => ({ ...prev, referencePoint: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Telefone do Morador
                    </label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-slate-800 text-sm outline-none focus:border-blue-500 focus:bg-white transition-all" 
                      placeholder="(82) 99999-9999"
                      value={newDelivery.phone || ''}
                      onChange={e => setNewDelivery(prev => ({ ...prev, phone: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Indicação (Vereador)
                    </label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 text-sm outline-none focus:border-blue-500 focus:bg-white transition-all"
                      value={newDelivery.councilman}
                      onChange={e => setNewDelivery(prev => ({ ...prev, councilman: e.target.value }))}
                    >
                      <option value="">Sem indicação específica...</option>
                      {councilmen.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Bairro / Sítio
                    </label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm outline-none focus:border-blue-500 focus:bg-white transition-all" 
                      placeholder="Ex: Sítio Chã / Centro"
                      value={newDelivery.neighborhood || ''}
                      onChange={e => setNewDelivery(prev => ({ ...prev, neighborhood: e.target.value }))}
                    />
                  </div>

                  <div className="md:col-span-2 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-600">
                    <span className="flex items-center gap-1.5 font-bold">
                      <MapPin size={14} className="text-emerald-600" />
                      Coordenadas GPS da Entrega:
                    </span>
                    <span className="font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                      {newDelivery.lat.toFixed(4)}, {newDelivery.lng.toFixed(4)}
                    </span>
                  </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-4 mt-6 sm:mt-8">
                <button 
                  onClick={() => setShowAddDelivery(false)} 
                  className="w-full sm:flex-1 py-3 rounded-xl border border-slate-200 font-bold text-xs sm:text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleAddDelivery} 
                  className="w-full sm:flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 active:scale-95 transition-all"
                >
                  <Send size={15} className="shrink-0" /> <span>Enviar Entrega</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddSitio && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl sm:rounded-[36px] p-5 sm:p-8 max-w-md w-full shadow-2xl border-2 sm:border-4 border-brand-dark/10 overflow-y-auto max-h-[92dvh] my-auto">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight">{editingSitio ? 'Editar Local' : 'Novo Local'}</h3>
                <button
                  onClick={() => { setShowAddSitio(false); setEditingSitio(null); }}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Tipo de Local</label>
                  <div className="grid grid-cols-3 gap-2">
                    {/* 1º Esquerda: Morador */}
                    <button 
                      type="button"
                      onClick={() => setNewSitio(prev => ({ ...prev, type: 'RESIDENT', fuelType: 'NONE' }))}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center justify-center gap-1.5 ${newSitio.type === 'RESIDENT' ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                    >
                      <Home size={13} />
                      Morador
                    </button>

                    {/* 2º Meio: Escola */}
                    <button 
                      type="button"
                      onClick={() => setNewSitio(prev => ({ ...prev, type: 'SCHOOL', fuelType: 'NONE' }))}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center justify-center gap-1.5 ${newSitio.type === 'SCHOOL' ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                    >
                      <School size={13} />
                      Escola
                    </button>

                    {/* 3º Direita: Creche */}
                    <button 
                      type="button"
                      onClick={() => setNewSitio(prev => ({ ...prev, type: 'DAYCARE', fuelType: 'NONE' }))}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center justify-center gap-1.5 ${newSitio.type === 'DAYCARE' ? 'bg-pink-500 border-pink-400 text-white shadow-lg' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                    >
                      <Baby size={13} />
                      Creche
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Coordenadas Manuais (Copiar e Colar)</label>
                  <input 
                    type="text"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono" 
                    placeholder="Ex: -9.2201, -36.3503"
                    value={newSitio.rawCoords}
                    onChange={e => {
                      const val = e.target.value;
                      const match = val.match(/([+-]?\d+\.?\d*)[,\s]+([+-]?\d+\.?\d*)/);
                      if (match) {
                        setNewSitio(prev => ({ ...prev, rawCoords: val, lat: parseFloat(match[1]), lng: parseFloat(match[2]) }));
                      } else {
                        setNewSitio(prev => ({ ...prev, rawCoords: val }));
                      }
                    }}
                  />
                  <div className="flex gap-2 text-xs text-slate-500 font-mono mt-1 px-1">
                    <span>Lat: {newSitio.lat}</span>
                    <span>|</span>
                    <span>Lng: {newSitio.lng}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold ml-1 uppercase italic">* Clique no mapa para capturar coordenadas automaticamente</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Identificação</label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3" 
                    placeholder={
                      newSitio.type === 'RESIDENT' ? 'Nome do Morador ou Sítio' :
                      newSitio.type === 'SCHOOL' ? 'Nome da Escola' :
                      'Nome da Creche'
                    }
                    value={newSitio.name}
                    onChange={e => setNewSitio(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Observações</label>
                  <textarea 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 min-h-[80px]" 
                    placeholder="Descrição opcional..."
                    value={newSitio.description}
                    onChange={e => setNewSitio(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => { setShowAddSitio(false); setEditingSitio(null); }} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold uppercase text-[10px] tracking-widest">Cancelar</button>
                <button onClick={handleAddSitio} className="flex-1 py-3 rounded-xl bg-brand-dark text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-brand-dark/20">Salvar Local</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddResident && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl sm:rounded-[36px] p-5 sm:p-8 max-w-md w-full shadow-2xl border-2 sm:border-4 border-brand-dark/10 overflow-y-auto max-h-[92dvh] my-auto">
              <div className="flex items-center justify-between mb-4 sm:mb-5">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                    Cadastro no Sistema
                  </span>
                  <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-900">
                    {newResident.category === 'SCHOOL' ? 'Nova Escola' :
                     newResident.category === 'DAYCARE' ? 'Nova Creche' :
                     'Novo Morador'}
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setShowAddResident(false);
                    setShowNameAutocomplete(false);
                    setDuplicateWarningAcknowledged(false);
                    setResidentFormError('');
                    setIsAddingCouncilmanInResident(false);
                    setInlineCouncilmanName('');
                  }}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>

              {/* Category Selector Tabs */}
              <div className="mb-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5 pl-1">
                  Selecione o Tipo de Destinatário:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button 
                    type="button"
                    onClick={() => {
                      setResidentFormError('');
                      setNewResident(prev => ({ ...prev, category: 'RESIDENT' }));
                    }}
                    className={`py-2.5 rounded-xl text-[11px] font-black uppercase transition-all border flex items-center justify-center gap-1.5 cursor-pointer ${
                      (!newResident.category || newResident.category === 'RESIDENT')
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/20' 
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Home size={13} />
                    <span>Morador</span>
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setResidentFormError('');
                      setNewResident(prev => ({ ...prev, category: 'SCHOOL' }));
                    }}
                    className={`py-2.5 rounded-xl text-[11px] font-black uppercase transition-all border flex items-center justify-center gap-1.5 cursor-pointer ${
                      newResident.category === 'SCHOOL' 
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <School size={13} />
                    <span>Escola</span>
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setResidentFormError('');
                      setNewResident(prev => ({ ...prev, category: 'DAYCARE' }));
                    }}
                    className={`py-2.5 rounded-xl text-[11px] font-black uppercase transition-all border flex items-center justify-center gap-1.5 cursor-pointer ${
                      newResident.category === 'DAYCARE' 
                        ? 'bg-pink-600 border-pink-500 text-white shadow-md shadow-pink-600/20' 
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Baby size={13} />
                    <span>Creche</span>
                  </button>
                </div>
              </div>

              {residentFormError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl flex items-center gap-2">
                  <AlertCircle size={15} className="text-red-500 shrink-0" />
                  <span>{residentFormError}</span>
                </div>
              )}

              <div className="space-y-3.5">
                <div className="space-y-1 relative">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Nome {newResident.category === 'SCHOOL' ? 'da Escola' : newResident.category === 'DAYCARE' ? 'da Creche' : 'do Morador'} *
                    </label>
                    {newResident.name.trim().length >= 2 && residentNameSuggestions.length > 0 && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                        <Users size={11} />
                        {residentNameSuggestions.length} {residentNameSuggestions.length === 1 ? 'sugestão' : 'sugestões'}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:bg-white transition-all pr-10" 
                      placeholder={
                        newResident.category === 'SCHOOL' ? 'Ex: Escola Municipal Maria das Graças' :
                        newResident.category === 'DAYCARE' ? 'Ex: Creche Municipal Tia Emília' :
                        'Nome Completo do Morador'
                      }
                      value={newResident.name}
                      onFocus={() => setShowNameAutocomplete(true)}
                      onChange={e => {
                        setResidentFormError('');
                        setDuplicateWarningAcknowledged(false);
                        setShowNameAutocomplete(true);
                        setNewResident(prev => ({ ...prev, name: e.target.value }));
                      }}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <Search size={16} />
                    </div>
                  </div>

                  {/* Auto-complete Suggestions Dropdown */}
                  {showNameAutocomplete && residentNameSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl p-2.5 max-h-64 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-slate-100">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                          <Users size={12} className="text-blue-600" />
                          Cadastros encontrados com este nome:
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowNameAutocomplete(false)}
                          className="p-1 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 cursor-pointer"
                          title="Fechar sugestões"
                        >
                          <X size={12} />
                        </button>
                      </div>

                      <div className="space-y-1.5 pt-1">
                        {residentNameSuggestions.map(sug => {
                          const sugCategory = sug.category || 'RESIDENT';
                          const isExact = (sug.name || '').trim().toLowerCase() === newResident.name.trim().toLowerCase();

                          return (
                            <div 
                              key={sug.id}
                              className={`p-2.5 rounded-xl border transition-all text-left flex flex-col gap-1.5 ${
                                isExact 
                                  ? 'bg-amber-50/80 border-amber-300 ring-1 ring-amber-400/40' 
                                  : 'bg-slate-50 hover:bg-blue-50/50 border-slate-200/80'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {sugCategory === 'SCHOOL' ? (
                                      <span className="text-[8px] font-black text-indigo-700 bg-indigo-100 border border-indigo-200 px-1.5 py-0.2 rounded">
                                        🏫 ESCOLA
                                      </span>
                                    ) : sugCategory === 'DAYCARE' ? (
                                      <span className="text-[8px] font-black text-pink-700 bg-pink-100 border border-pink-200 px-1.5 py-0.2 rounded">
                                        👶 CRECHE
                                      </span>
                                    ) : (
                                      <span className="text-[8px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.2 rounded">
                                        🏠 MORADOR
                                      </span>
                                    )}
                                    <strong className="text-xs font-black text-slate-900 truncate">
                                      {sug.name}
                                    </strong>
                                    {isExact && (
                                      <span className="text-[8px] font-black text-amber-700 bg-amber-200/70 border border-amber-300 px-1.5 py-0.2 rounded-full uppercase">
                                        Já cadastrado
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                                    📍 {sug.neighborhood || sug.address || 'Inhapi'}
                                    {sug.referencePoint ? ` • Ref: ${sug.referencePoint}` : ''}
                                    {sug.councilman ? ` • 🏛️ ${sug.councilman}` : ''}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-200/50">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewResident({
                                      name: sug.name,
                                      address: sug.address || '',
                                      neighborhood: sug.neighborhood || '',
                                      phone: sug.phone || '',
                                      referencePoint: sug.referencePoint || '',
                                      councilman: sug.councilman || '',
                                      category: sug.category || 'RESIDENT'
                                    });
                                    setShowNameAutocomplete(false);
                                    setDuplicateWarningAcknowledged(true);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-200/80 hover:bg-slate-300 text-slate-700 text-[10px] font-bold transition-all cursor-pointer"
                                  title="Carregar dados deste cadastro no formulário"
                                >
                                  Preencher Formulário
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowAddResident(false);
                                    setShowNameAutocomplete(false);
                                    handleEdit('residents', sug);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                                  title="Abrir este cadastro existente para editar em vez de criar duplicata"
                                >
                                  <Edit2 size={10} />
                                  <span>Editar Existente</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Duplicate warning alert if exact match exists */}
                  {exactDuplicateResident && (
                    <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl flex flex-col gap-1.5 mt-2 animate-in fade-in duration-200 shadow-xs">
                      <div className="flex items-center gap-1.5">
                        <AlertCircle size={15} className="text-amber-600 shrink-0" />
                        <span className="text-xs font-black uppercase tracking-tight">Aviso de Cadastro Existente</span>
                      </div>
                      <p className="text-xs text-amber-800">
                        Já existe um cadastro registrado com o nome <strong>"{exactDuplicateResident.name}"</strong> no sítio <strong>{exactDuplicateResident.neighborhood || exactDuplicateResident.address || 'Inhapi'}</strong>
                        {exactDuplicateResident.councilman ? ` (Indicação: ${exactDuplicateResident.councilman})` : ''}.
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddResident(false);
                            setShowNameAutocomplete(false);
                            handleEdit('residents', exactDuplicateResident);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                        >
                          <Edit2 size={11} />
                          <span>Abrir e Editar Registro Existente</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                    Bairro / Sítio (Ex: Sítio Promissão, Sítio Chã, Centro)
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all" 
                    placeholder="Nome do Sítio ou Bairro"
                    value={newResident.neighborhood}
                    onChange={e => setNewResident(prev => ({ ...prev, neighborhood: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                    Endereço / Localização <span className="text-slate-400 lowercase font-normal">(opcional se preencher Sítio)</span>
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all" 
                    placeholder="Rua, número ou estrada vicinal"
                    value={newResident.address}
                    onChange={e => setNewResident(prev => ({ ...prev, address: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                    Telefone / WhatsApp <span className="text-slate-400 lowercase font-normal">(opcional)</span>
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all" 
                    placeholder="(82) 99999-9999"
                    value={newResident.phone}
                    onChange={e => setNewResident(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                    Ponto de Referência <span className="text-slate-400 lowercase font-normal">(opcional)</span>
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all" 
                    placeholder="Ex: Próximo à caixa d'água / em frente ao mercadinho"
                    value={newResident.referencePoint || ''}
                    onChange={e => setNewResident(prev => ({ ...prev, referencePoint: e.target.value }))}
                  />
                </div>

                {/* Seleção de Vereador cadastrado ou Adicionar Novo */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider pl-1">
                      Vereador / Indicação
                    </label>
                    {!isAddingCouncilmanInResident && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingCouncilmanInResident(true);
                          setInlineCouncilmanName('');
                        }}
                        className="text-[11px] font-black text-purple-600 hover:text-purple-700 flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                      >
                        <Plus size={12} /> Novo Vereador
                      </button>
                    )}
                  </div>

                  {!isAddingCouncilmanInResident ? (
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:border-brand-primary outline-none"
                      value={newResident.councilman || ''}
                      onChange={e => {
                        if (e.target.value === '__ADD_NEW__') {
                          setIsAddingCouncilmanInResident(true);
                          setInlineCouncilmanName('');
                        } else {
                          setNewResident(prev => ({ ...prev, councilman: e.target.value }));
                        }
                      }}
                    >
                      <option value="">Selecione o Vereador (Opcional)...</option>
                      {councilmen.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                      <option value="__ADD_NEW__" className="text-purple-600 font-bold">
                        ➕ Adicionar Novo Vereador...
                      </option>
                    </select>
                  ) : (
                    <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl space-y-2 animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-purple-800 uppercase tracking-wider">Novo Vereador no Banco de Dados</span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingCouncilmanInResident(false);
                            setInlineCouncilmanName('');
                          }}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Nome do Vereador"
                          value={inlineCouncilmanName}
                          onChange={e => setInlineCouncilmanName(e.target.value)}
                          onKeyDown={async e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (inlineCouncilmanName.trim()) {
                                const saved = await handleQuickAddCouncilman(inlineCouncilmanName);
                                setNewResident(prev => ({ ...prev, councilman: saved }));
                                setIsAddingCouncilmanInResident(false);
                                setInlineCouncilmanName('');
                              }
                            }
                          }}
                          className="flex-1 bg-white border border-purple-200 rounded-lg px-3 py-2 text-xs text-slate-800 outline-none focus:border-purple-500"
                        />
                        <button
                          type="button"
                          disabled={!inlineCouncilmanName.trim()}
                          onClick={async () => {
                            if (inlineCouncilmanName.trim()) {
                              const saved = await handleQuickAddCouncilman(inlineCouncilmanName);
                              setNewResident(prev => ({ ...prev, councilman: saved }));
                              setIsAddingCouncilmanInResident(false);
                              setInlineCouncilmanName('');
                            }
                          }}
                          className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold active:scale-95 transition-all shadow-sm cursor-pointer"
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  )}
                  {newResident.councilman && !isAddingCouncilmanInResident && (
                    <div className="flex items-center justify-between px-1 text-[11px] text-purple-700 font-medium">
                      <span>Vereador selecionado: <strong className="uppercase">{newResident.councilman}</strong></span>
                      <button
                        type="button"
                        onClick={() => setNewResident(prev => ({ ...prev, councilman: '' }))}
                        className="text-slate-400 hover:text-red-500 text-[10px] underline ml-2 cursor-pointer"
                      >
                        Limpar
                      </button>
                    </div>
                  )}
                </div>

                {/* Setor / Região do Morador */}
                <div className="space-y-1 pt-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1">
                    <MapPin size={11} className="text-blue-500" />
                    Setor / Sítio Específico
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all font-medium" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={newResident.sector || ''}
                    onChange={e => setNewResident(prev => ({ ...prev, sector: e.target.value }))}
                  />
                  <p className="text-[9px] text-slate-400 pl-1">
                    Permite agrupar as entregas automaticamente para o motorista deste setor.
                  </p>
                </div>

                {/* Motorista Vinculado / Notificado para o Secretário */}
                <div className="space-y-1 pt-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1">
                    <Bell size={11} className="text-amber-500" />
                    Motorista Vinculado / Recomendado (Notificação p/ Secretário)
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:border-brand-primary outline-none font-semibold"
                    value={newResident.preferredDriver || ''}
                    onChange={e => setNewResident(prev => ({ ...prev, preferredDriver: e.target.value }))}
                  >
                    <option value="">Detecção Automática (pelo Sítio / Endereço)</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.name}>
                        🚛 {d.name} {d.sector ? `(Setor: ${d.sector})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 pl-1">
                    Ao definir, o secretário verá uma notificação direta indicando este motorista sempre que for despachar água.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-6 sm:mt-8">
                <button 
                  type="button"
                  onClick={() => {
                    setShowAddResident(false);
                    setShowNameAutocomplete(false);
                    setDuplicateWarningAcknowledged(false);
                    setResidentFormError('');
                    setIsAddingCouncilmanInResident(false);
                    setInlineCouncilmanName('');
                  }} 
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="button"
                  disabled={isSavingResident}
                  onClick={handleAddResident} 
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save size={15} />
                  <span>
                    {isSavingResident ? 'Salvando...' : 
                     `Salvar ${newResident.category === 'SCHOOL' ? 'Escola' : newResident.category === 'DAYCARE' ? 'Creche' : 'Morador'}`}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddCouncilman && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl sm:rounded-[36px] p-5 sm:p-8 max-w-md w-full shadow-2xl border-2 sm:border-4 border-brand-dark/10 overflow-y-auto max-h-[92dvh] my-auto">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight">Novo Vereador</h3>
                <button
                  onClick={() => setShowAddCouncilman(false)}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>
              <div className="space-y-4">
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3" 
                  placeholder="Nome do Vereador"
                  value={newCouncilman.name}
                  onChange={e => setNewCouncilman(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => setShowAddCouncilman(false)} className="flex-1 py-3 rounded-xl border border-slate-200">Cancelar</button>
                <button onClick={handleAddCouncilman} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-semibold">Salvar</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddDriver && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl sm:rounded-[36px] p-5 sm:p-8 max-w-md w-full shadow-2xl border-2 sm:border-4 border-brand-dark/10 overflow-y-auto max-h-[92dvh] my-auto">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight">Novo Motorista</h3>
                <button
                  onClick={() => setShowAddDriver(false)}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>
              <div className="space-y-4">
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3" 
                  placeholder="Nome do Motorista"
                  value={newDriver.name}
                  onChange={e => setNewDriver(prev => ({ ...prev, name: e.target.value }))}
                />
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-sm outline-none focus:border-blue-500" 
                  placeholder="Telefone / Contato (Ex: 82 99999-9999)"
                  value={newDriver.phone}
                  onChange={e => setNewDriver(prev => ({ ...prev, phone: e.target.value }))}
                />
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1">
                    <MapPin size={11} className="text-blue-500" />
                    Setor / Sítios Atendidos por este Motorista
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={newDriver.sector}
                    onChange={e => setNewDriver(prev => ({ ...prev, sector: e.target.value }))}
                  />
                  <p className="text-[9px] text-slate-400 pl-1">
                    Define o setor do motorista para que o sistema separe e notifique o secretário nas entregas.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1">
                    <Home size={11} className="text-slate-500" />
                    Endereço / Base do Motorista
                  </label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500" 
                    placeholder="Ex: Centro, Rua São Vicente"
                    value={newDriver.address}
                    onChange={e => setNewDriver(prev => ({ ...prev, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-emerald-700 pl-1 flex items-center gap-1">
                    <Home size={11} className="text-emerald-600" />
                    Sítio onde Mora (Residência do Motorista)
                  </label>
                  <input 
                    className="w-full bg-emerald-50/50 border border-emerald-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-500 font-semibold text-slate-800" 
                    placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                    value={newDriver.homeSitio}
                    onChange={e => setNewDriver(prev => ({ ...prev, homeSitio: e.target.value }))}
                  />
                  <p className="text-[9px] text-slate-400 pl-1">
                    Localidade onde o motorista mora para mapeamento e cálculo de proximidade das entregas.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1">
                    <Navigation size={11} className="text-slate-400" />
                    Coordenadas GPS da Residência (Opcional - Motorista também salva via celular)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="number"
                      step="any"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                      placeholder="Latitude"
                      value={newDriver.homeLat || ''}
                      onChange={e => setNewDriver(prev => ({ ...prev, homeLat: parseFloat(e.target.value) || 0 }))}
                    />
                    <input 
                      type="number"
                      step="any"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                      placeholder="Longitude"
                      value={newDriver.homeLng || ''}
                      onChange={e => setNewDriver(prev => ({ ...prev, homeLng: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={() => setShowAddDriver(false)} className="flex-1 py-3 rounded-xl border border-slate-200">Cancelar</button>
                <button onClick={handleAddDriver} className="flex-1 py-3 rounded-xl bg-brand-dark text-white font-semibold">Salvar</button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedTruck && (
          <div className="fixed inset-0 z-[2000] flex justify-end">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }}
               onClick={() => setSelectedTruck(null)}
               className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
             />
             <motion.div 
               initial={{ x: '100%' }} 
               animate={{ x: 0 }} 
               exit={{ x: '100%' }} 
               transition={{ type: 'spring', damping: 25, stiffness: 200 }}
               className="relative w-full max-w-full sm:max-w-md bg-white backdrop-blur-xl h-full shadow-2xl flex flex-col p-5 sm:p-6 lg:p-8 overflow-y-auto border-l border-white/30 pb-24 lg:pb-8 transition-all duration-300"
             >
               <div className="flex justify-between items-start mb-6 sm:mb-8">
                 <div>
                    <span className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1 block">Detalhes do Veículo</span>
                    <h2 className="text-2xl sm:text-3xl font-black">{selectedTruck.driverName}</h2>
                    <p className="text-slate-400 font-mono text-sm">{selectedTruck.plate}</p>
                 </div>
                 <div className="flex items-center gap-1.5">
                   <button 
                     onClick={() => {
                       setSelectedTruck(null);
                       setPlannedRoute(undefined);
                     }}
                     className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                     title="Voltar"
                     aria-label="Voltar"
                   >
                     <ArrowLeft size={15} />
                   </button>
                   <button 
                     onClick={() => {
                       setSelectedTruck(null);
                       setPlannedRoute(undefined);
                     }}
                     className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                   >
                     <X size={24} />
                   </button>
                 </div>
               </div>

               <div className="flex gap-4 mb-8">
                  <div className="flex-1 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Status Atual</p>
                    <span className={`text-sm font-bold ${
                      selectedTruck.status === 'IN_ROUTE' ? 'text-amber-600' : 
                      selectedTruck.status === 'ARRIVED' ? 'text-emerald-600' : 'text-slate-500'
                    }`}>
                      {selectedTruck.status === 'IN_ROUTE' ? 'Em Rota' : selectedTruck.status === 'ARRIVED' ? 'No Local' : 'Disponível'}
                    </span>
                  </div>
                  <div className="flex-1 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Último Sinal</p>
                    <span className="text-sm font-bold text-slate-700">
                      {new Date(selectedTruck.lastUpdate || '').toLocaleTimeString()}
                    </span>
                  </div>
               </div>

               <div className="flex-1">
                 <div className="flex items-center justify-between mb-4">
                   <h3 className="text-lg font-bold flex items-center gap-2">
                     <ClipboardList className="text-blue-500" size={20} /> Histórico de Entregas
                   </h3>
                   <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded-full uppercase tracking-wider text-slate-500">
                     {deliveries.filter(d => d.truckId === selectedTruck.id).length} Total
                   </span>
                 </div>

                 <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100">
                      <p className="text-[9px] uppercase font-bold text-emerald-400 mb-0.5">Concluídas</p>
                      <p className="text-lg font-black text-emerald-600">
                        {deliveries.filter(d => d.truckId === selectedTruck.id && d.status === 'DELIVERED').length}
                      </p>
                    </div>
                    <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100">
                      <p className="text-[9px] uppercase font-bold text-amber-400 mb-0.5">Pendentes</p>
                      <p className="text-lg font-black text-amber-600">
                        {deliveries.filter(d => d.truckId === selectedTruck.id && d.status !== 'DELIVERED').length}
                      </p>
                    </div>
                 </div>

                 <div className="space-y-3">
                   {deliveries
                     .filter(d => d.truckId === selectedTruck.id)
                     .length === 0 ? (
                       <div className="text-center py-10 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                          <p className="text-slate-400 text-sm">Sem histórico recente.</p>
                       </div>
                     ) : (
                       deliveries
                        .filter(d => d.truckId === selectedTruck.id)
                        .map(delivery => (
                          <div key={delivery.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                             <div className="flex justify-between items-start mb-1">
                              <h4 className="font-bold text-slate-800">{delivery.residentName}</h4>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                delivery.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                              }`}>
                                {delivery.status === 'DELIVERED' ? 'CONCLUÍDA' : 'EM ROTA'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">{delivery.address}</p>
                            
                            {delivery.photo && (
                              <button 
                                onClick={() => setSelectedPhoto(delivery.photo!)}
                                className="mt-3 flex items-center gap-2 text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full hover:bg-blue-100 transition-colors"
                              >
                                <ImageIcon size={12} /> Ver Comprovante
                              </button>
                            )}

                            <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                              <Clock size={10} /> {new Date(delivery.createdAt || '').toLocaleDateString()}
                            </div>
                          </div>
                        ))
                     )
                   }
                 </div>
               </div>

                <div className="mt-6 sm:mt-8 space-y-2.5">
                  {(() => {
                    const activeDel = deliveries.find(d => d.truckId === selectedTruck.id && d.status === 'IN_ROUTE');
                    if (!activeDel || !selectedTruck.lastLat || !selectedTruck.lastLng) return null;
                    return (
                      <button 
                        onClick={async () => {
                          setSettingsLoading(true);
                          const roadRoute = await fetchRoadRoute([
                            [selectedTruck.lastLat!, selectedTruck.lastLng!],
                            [activeDel.lat, activeDel.lng]
                          ]);
                          setSettingsLoading(false);
                          if (roadRoute && isRoadRoute(roadRoute)) {
                            setPlannedRoute(roadRoute);
                            setActiveTab('map');
                            setSelectedTruck(null);
                          } else {
                            alert('Não foi possível traçar a rota pelas vias no momento.');
                          }
                        }}
                        className="w-full bg-emerald-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm text-center"
                      >
                        <Navigation size={16} className="shrink-0" /> <span>Traçar Rota da Entrega Atual</span>
                      </button>
                    );
                  })()}

                  <button 
                   onClick={handleOptimizeRoute}
                   className="w-full bg-slate-900 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm text-center"
                  >
                    <Navigation size={16} className="shrink-0" /> <span>Otimizar Rota pelas Estradas</span>
                  </button>

                 <button 
                  onClick={() => {
                    setNewDelivery(prev => ({ ...prev, truckId: selectedTruck.id }));
                    setActiveTab('map');
                    setSelectedTruck(null);
                    setShowAddDelivery(true);
                  }}
                  className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm text-center"
                 >
                   <Plus size={16} className="shrink-0" /> <span>Designar Nova Entrega</span>
                 </button>
               </div>
             </motion.div>
          </div>
        )}
        {selectedSitio && (
          <div className="fixed inset-0 z-[2000] flex justify-end">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }}
               onClick={() => setSelectedSitio(null)}
               className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
             />
             <motion.div 
               initial={{ x: '100%' }} 
               animate={{ x: 0 }} 
               exit={{ x: '100%' }} 
               transition={{ type: 'spring', damping: 25, stiffness: 200 }}
               className="relative w-full max-w-full sm:max-w-md bg-white backdrop-blur-xl h-full shadow-2xl flex flex-col p-5 sm:p-6 lg:p-8 overflow-y-auto border-l border-white/30 pb-24 lg:pb-8 transition-all duration-300"
             >
               <div className="flex justify-between items-start mb-6 sm:mb-8">
                 <div>
                    <span className="text-xs font-black text-purple-600 uppercase tracking-widest mb-1 block">Local Registrado</span>
                    <h2 className="text-2xl sm:text-3xl font-black">{selectedSitio.name}</h2>
                    <div className="flex items-center gap-2 text-slate-400 font-mono text-xs mt-2">
                       <MapPin size={14} /> {selectedSitio.lat.toFixed(6)}, {selectedSitio.lng.toFixed(6)}
                    </div>
                 </div>
                 <div className="flex items-center gap-1.5">
                   <button 
                     onClick={() => setSelectedSitio(null)}
                     className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                     title="Voltar"
                     aria-label="Voltar"
                   >
                     <ArrowLeft size={15} />
                   </button>
                   <button 
                     onClick={() => setSelectedSitio(null)}
                     className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                   >
                     <X size={24} />
                   </button>
                 </div>
               </div>

               <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 mb-8">
                 <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Descrição</h3>
                 <p className="text-slate-700 leading-relaxed">
                   {selectedSitio.description || 'Nenhuma descrição fornecida.'}
                 </p>
               </div>

               <div className="mt-auto">
                 <button 
                  onClick={() => {
                    setNewDelivery(prev => ({ 
                      ...prev, 
                      lat: selectedSitio.lat, 
                      lng: selectedSitio.lng,
                      address: selectedSitio.name 
                    }));
                    setShowAddDelivery(true);
                    setSelectedSitio(null);
                  }}
                  className="w-full bg-purple-600 text-white font-bold py-4 rounded-2xl shadow-xl shadow-purple-100 hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                 >
                   <Plus size={18} /> Criar Entrega Neste Local
                 </button>
                 <button 
                  onClick={() => {
                    handleDelete('sitios', selectedSitio.id);
                    setSelectedSitio(null);
                  }}
                  className="w-full bg-red-50 hover:bg-red-100/80 active:bg-red-100 text-red-600 font-bold py-4 rounded-2xl border border-red-200/60 transition-all flex items-center justify-center gap-2 font-black uppercase tracking-wider text-xs mt-3"
                 >
                   <Trash2 size={16} /> Excluir Ponto do Mapa
                 </button>
               </div>
             </motion.div>
          </div>
        )}

        {selectedPhoto && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[3000] flex items-center justify-center p-6" onClick={() => setSelectedPhoto(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }}
              className="relative max-w-4xl w-full max-h-full flex items-center justify-center"
            >
              <img src={selectedPhoto} alt="Comprovante" className="max-w-full max-h-[85vh] object-contain rounded-3xl shadow-2xl border-4 border-white/10" />
              <div className="absolute -top-12 right-0 flex items-center gap-2">
                <button 
                  onClick={() => setSelectedPhoto(null)}
                  className="w-8 h-8 rounded-xl text-white bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={16} />
                </button>
                <button 
                  onClick={() => setSelectedPhoto(null)}
                  className="text-white bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* MODAL: NOVO / EDITAR ABASTECIMENTO */}
        {showAddFuelModal && (
          <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-md z-[2020] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 14 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 14 }}
              className="bg-white rounded-3xl p-5 sm:p-7 max-w-xl w-full shadow-2xl border border-slate-200 overflow-y-auto max-h-[92dvh] my-auto space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <Fuel size={20} />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
                      {editingFuelLog ? 'Editar Abastecimento' : 'Registrar Novo Abastecimento'}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Auditoria de combustível e cálculo automático de KM/L por setor
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setShowAddFuelModal(false);
                      setEditingFuelLog(null);
                    }}
                    className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                    title="Voltar"
                    aria-label="Voltar"
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button
                    onClick={() => {
                      setShowAddFuelModal(false);
                      setEditingFuelLog(null);
                    }}
                    className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {fuelFormError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0 text-rose-600" />
                  <span>{fuelFormError}</span>
                </div>
              )}

              <div className="space-y-3.5">
                {/* 1. Seleção de Caminhão-Pipa */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1.5">
                    <TruckIcon size={12} className="text-blue-600" />
                    Caminhão-Pipa *
                  </label>
                  <select
                    value={fuelFormData.truckId}
                    onChange={(e) => handleTruckSelectionInFuelForm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                  >
                    <option value="">Selecione o caminhão...</option>
                    {trucks.map((t) => (
                      <option key={t.id} value={t.id}>
                        🚛 {t.driverName} — Placa: {t.plate} {t.sector ? `(Setor: ${t.sector})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Motorista (auto-detectado ou custom) */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Motorista
                    </label>
                    <input
                      type="text"
                      placeholder="Nome do Motorista"
                      value={fuelFormData.driverName}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, driverName: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>

                  {/* Placa */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Placa do Veículo
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: ABC-1234"
                      value={fuelFormData.plate}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, plate: e.target.value.toUpperCase() }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold uppercase text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Setor de Atuação */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1.5">
                      <MapPin size={12} className="text-amber-600" />
                      Setor / Região Atendida *
                    </label>
                    <input
                      type="text"
                      list="known-sectors-datalist"
                      placeholder="Ex: Sítio Baixa da Areia, Povoado Leão"
                      value={fuelFormData.sector}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, sector: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                    <datalist id="known-sectors-datalist">
                      {sectorsList.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                    <span className="text-[9px] text-slate-400 pl-1 block">
                      Define a qual setor este consumo de combustível será atribuído.
                    </span>
                  </div>

                  {/* Data e Hora */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1 flex items-center gap-1.5">
                      <Calendar size={12} className="text-blue-500" />
                      Data e Hora do Abastecimento
                    </label>
                    <input
                      type="datetime-local"
                      value={fuelFormData.date}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, date: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                {/* Combustível e Litros */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Tipo de Combustível */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Combustível
                    </label>
                    <select
                      value={fuelFormData.fuelType}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, fuelType: e.target.value as FuelLogType }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    >
                      <option value="DIESEL_S10">Diesel S-10</option>
                      <option value="DIESEL_COMUM">Diesel Comum</option>
                      <option value="GASOLINA">Gasolina</option>
                      <option value="ARLA_32">Arla 32</option>
                    </select>
                  </div>

                  {/* Litros Abastecidos */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Litros Abastecidos *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Ex: 120"
                      value={fuelFormData.liters}
                      onChange={(e) => {
                        const l = e.target.value;
                        setFuelFormData((prev) => {
                          const p = Number(prev.pricePerLiter);
                          const total = l && p ? (Number(l) * p).toFixed(2) : prev.totalCost;
                          return { ...prev, liters: l, totalCost: total };
                        });
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-black text-amber-950 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>

                  {/* Preço por Litro */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Preço / Litro (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Ex: 6.45"
                      value={fuelFormData.pricePerLiter}
                      onChange={(e) => {
                        const p = e.target.value;
                        setFuelFormData((prev) => {
                          const l = Number(prev.liters);
                          const total = p && l ? (Number(p) * l).toFixed(2) : prev.totalCost;
                          return { ...prev, pricePerLiter: p, totalCost: total };
                        });
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                {/* Odômetros: Anterior e Atual */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Odômetro Anterior (KM)
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Ex: 145000"
                      value={fuelFormData.previousKm}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, previousKm: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                    <span className="text-[9px] text-slate-400 pl-1 block">
                      Último registro detectado
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Odômetro Atual (KM) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Ex: 145320"
                      value={fuelFormData.currentKm}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, currentKm: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-black text-blue-900 outline-none focus:border-blue-500 focus:bg-white transition-all"
                    />
                    <span className="text-[9px] text-slate-400 pl-1 block">
                      KM no momento da bomba
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Valor Total da Nota (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Ex: 774.00"
                      value={fuelFormData.totalCost}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, totalCost: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-black text-emerald-800 outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                    <span className="text-[9px] text-slate-400 pl-1 block">
                      Calculado automaticamente
                    </span>
                  </div>
                </div>

                {/* PRÉVIA EM TEMPO REAL DO CONSUMO MÉDIO (KM/L, L/KM, R$/KM) */}
                {(() => {
                  const cKm = Number(fuelFormData.currentKm) || 0;
                  const pKm = Number(fuelFormData.previousKm) || 0;
                  const dist = Math.max(0, cKm - pKm);
                  const lts = Number(fuelFormData.liters) || 0;
                  const kmL = dist > 0 && lts > 0 ? (dist / lts).toFixed(2) : '—';
                  const lKm = dist > 0 && lts > 0 ? (lts / dist).toFixed(3) : '—';
                  const cost = Number(fuelFormData.totalCost) || (lts * Number(fuelFormData.pricePerLiter || 0));
                  const costKm = dist > 0 && cost > 0 ? (cost / dist).toFixed(2) : '—';

                  return (
                    <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-emerald-500/10 rounded-2xl p-3.5 border border-amber-500/20 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-amber-950 tracking-wider flex items-center gap-1.5">
                          <TrendingUp size={13} className="text-amber-600" />
                          Cálculo de Consumo para o Setor: <strong className="text-amber-900">{fuelFormData.sector || 'Geral'}</strong>
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-500">
                          {dist > 0 ? `${dist} km rodados` : 'Preencha os KMs'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center pt-1">
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/60">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Consumo Médio</span>
                          <strong className="text-sm font-black text-amber-900 font-mono">
                            {kmL !== '—' ? `${kmL} km/L` : '—'}
                          </strong>
                        </div>
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/60">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Por KM Rodado</span>
                          <strong className="text-sm font-black text-slate-800 font-mono">
                            {lKm !== '—' ? `${lKm} L/km` : '—'}
                          </strong>
                        </div>
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/60">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Custo por KM</span>
                          <strong className="text-sm font-black text-emerald-800 font-mono">
                            {costKm !== '—' ? `R$ ${costKm}/km` : '—'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Posto e Nota Fiscal */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Posto / Fornecedor
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Posto Central Inhapi"
                      value={fuelFormData.gasStation}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, gasStation: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                      Nº da Nota Fiscal / Cupom / Requisição
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: NF-e 10842"
                      value={fuelFormData.invoiceNumber}
                      onChange={(e) => setFuelFormData((prev) => ({ ...prev, invoiceNumber: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-medium text-slate-900 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                {/* Observações */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                    Observações Adicionais (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Rota com serra acentuada, tanque cheio completo"
                    value={fuelFormData.notes}
                    onChange={(e) => setFuelFormData((prev) => ({ ...prev, notes: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-amber-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              {/* Botões do Modal */}
              <div className="flex gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddFuelModal(false);
                    setEditingFuelLog(null);
                  }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSavingFuelLog}
                  onClick={handleSaveFuelLog}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white py-3 rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-600/20 transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save size={14} />
                  <span>{isSavingFuelLog ? 'Salvando...' : 'Salvar Abastecimento'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* MODAL: CONFIRMAR EXCLUSÃO DE ABASTECIMENTO */}
        {fuelDeleteConfirm && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-100 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
                  <Trash2 size={24} />
                </div>
                <button
                  onClick={() => setFuelDeleteConfirm(null)}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>
              <div>
                <h3 className="font-black text-base text-slate-900 uppercase tracking-tight">Excluir Abastecimento</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Deseja excluir o registro do caminhão <strong>{fuelDeleteConfirm.driverName}</strong> ({fuelDeleteConfirm.plate}) do setor <strong>{fuelDeleteConfirm.sector}</strong> de {fuelDeleteConfirm.liters} L?
                </p>
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setFuelDeleteConfirm(null)}
                  className="flex-1 bg-slate-100 py-2.5 rounded-xl font-bold text-slate-600 text-xs hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteFuelLog(fuelDeleteConfirm.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Confirmar Exclusão
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
