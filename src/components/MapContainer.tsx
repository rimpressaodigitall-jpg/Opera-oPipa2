import { MapContainer as LeafletMap, TileLayer, Marker, Popup, useMapEvents, Polyline, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { Truck, Delivery, Sitio, Driver, Resident } from '../types';
import { LocateFixed, Filter, Check, Layers, ExternalLink, User, Search, X, Navigation, Plus, Minus, Maximize, Users, Truck as TruckIcon, CheckCircle2, Clock, ArrowLeft, Home, Phone, MapPin } from 'lucide-react';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchRoadRoute, isRoadRoute, getHaversineDistanceKm } from '../lib/routing';

// Using divIcon for all markers to avoid image import issues in TS
const defaultIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background-color: #3B82F6; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

// Haversine formula to compute great-circle distance in kilometers
function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute bearing between two geographical coordinates in degrees [0, 360)
function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const dLonRad = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(dLonRad) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLonRad);

  const bearingRad = Math.atan2(y, x);
  const bearingDeg = (bearingRad * 180) / Math.PI;
  return (bearingDeg + 360) % 360;
}

// Calculate intermediate directional arrow points along the polyline path
// following the exact road curvature with smooth tangent bearing calculations
interface RouteArrowPoint {
  position: [number, number];
  heading: number;
  id: string;
  index: number;
}

function calculateRouteArrows(
  points: [number, number][],
  minDistanceMeters?: number
): RouteArrowPoint[] {
  if (!points || points.length < 2) return [];

  // Filter out any invalid/zero coordinates
  const validPoints = points.filter(
    (p) => typeof p[0] === 'number' && !isNaN(p[0]) && p[0] !== 0 &&
           typeof p[1] === 'number' && !isNaN(p[1]) && p[1] !== 0
  );

  if (validPoints.length < 2) return [];

  // Compute segment lengths and cumulative distances
  const segDistances: number[] = [];
  const cumDistances: number[] = [0];
  let totalDistance = 0;

  for (let i = 0; i < validPoints.length - 1; i++) {
    const p1 = validPoints[i];
    const p2 = validPoints[i + 1];
    const d = getHaversineDistance(p1[0], p1[1], p2[0], p2[1]) * 1000;
    segDistances.push(d);
    totalDistance += d;
    cumDistances.push(totalDistance);
  }

  if (totalDistance < 15) return [];

  // Helper to interpolate coordinate along the polyline at a given distance
  const getPointAtDist = (dist: number): [number, number] => {
    const clampedDist = Math.max(0, Math.min(dist, totalDistance));
    let segIdx = 0;
    for (let i = 0; i < cumDistances.length - 1; i++) {
      if (clampedDist >= cumDistances[i] && clampedDist <= cumDistances[i + 1]) {
        segIdx = i;
        break;
      }
    }
    const segLen = segDistances[segIdx] || 0.0001;
    const t = Math.max(0, Math.min(1, (clampedDist - cumDistances[segIdx]) / segLen));
    const pA = validPoints[segIdx];
    const pB = validPoints[segIdx + 1] || pA;
    return [
      pA[0] + t * (pB[0] - pA[0]),
      pA[1] + t * (pB[1] - pA[1])
    ];
  };

  // Helper to compute smoothed curve tangent bearing at a given distance
  // Samples points along the road polyline curve to eliminate micro-jitter and follow bends
  const getCurveHeadingAtDist = (dist: number): number => {
    const lookAhead = Math.min(dist + 12, totalDistance);
    const lookBehind = Math.max(dist - 6, 0);
    const pBehind = getPointAtDist(lookBehind);
    const pAhead = getPointAtDist(lookAhead);

    if (Math.abs(pBehind[0] - pAhead[0]) < 1e-7 && Math.abs(pBehind[1] - pAhead[1]) < 1e-7) {
      return computeBearing(
        validPoints[0][0], validPoints[0][1],
        validPoints[validPoints.length - 1][0], validPoints[validPoints.length - 1][1]
      );
    }

    return computeBearing(pBehind[0], pBehind[1], pAhead[0], pAhead[1]);
  };

  // Adaptive spacing: closer on short/urban trips, balanced on long rural routes
  let step = minDistanceMeters || 50;
  if (!minDistanceMeters) {
    if (totalDistance < 400) step = 32;
    else if (totalDistance < 1800) step = 45;
    else if (totalDistance < 6000) step = 60;
    else step = 85;
  }

  // Cap maximum arrows to 110 to preserve silky 60fps performance on mobile
  if (totalDistance / step > 110) {
    step = totalDistance / 110;
  }

  const arrows: RouteArrowPoint[] = [];
  const startOffset = Math.min(22, step * 0.45);
  const endOffset = Math.min(20, step * 0.4);

  let currentDist = startOffset;
  let arrowIndex = 0;

  while (currentDist <= totalDistance - endOffset) {
    const pos = getPointAtDist(currentDist);
    const heading = getCurveHeadingAtDist(currentDist);

    arrows.push({
      position: pos,
      heading,
      id: `arrow-${arrowIndex}-${pos[0].toFixed(5)}-${pos[1].toFixed(5)}`,
      index: arrowIndex
    });

    arrowIndex++;
    currentDist += step;
  }

  // Ensure at least one arrow if we have a reasonable route length
  if (arrows.length === 0 && totalDistance >= 15) {
    const midDist = totalDistance / 2;
    arrows.push({
      position: getPointAtDist(midDist),
      heading: getCurveHeadingAtDist(midDist),
      id: 'arrow-fallback-mid',
      index: 0
    });
  }

  return arrows;
}

// Directional Animated Arrow Icon with dynamic rotation and streaming animation
const routeArrowIcon = (
  bearing: number,
  colorTheme: 'neon' | 'navy' = 'neon',
  animIndex = 0
) => {
  const isNeon = colorTheme === 'neon';
  const fillColor = isNeon ? '#10B981' : '#0284C7';
  const coreColor = isNeon ? '#ECFDF5' : '#F0F9FF';
  const strokeColor = isNeon ? '#064E3B' : '#082F49';
  const glowColor = isNeon ? 'rgba(16, 185, 129, 0.8)' : 'rgba(2, 132, 199, 0.8)';
  
  // Stagger animation delay so the arrows stream forward continuously in a wave
  const delaySec = (-((animIndex * 0.22) % 1.76)).toFixed(2);

  return L.divIcon({
    className: 'route-arrow-icon',
    html: `
      <div class="route-arrow-wrapper" style="transform: rotate(${bearing.toFixed(1)}deg);">
        <div class="route-arrow-anim" style="animation-delay: ${delaySec}s;">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 5px ${glowColor});">
            <!-- Aerodynamic Directional Arrow aligned with road curvature -->
            <path d="M12 3.2L4.5 12.2H8.5V19.8H15.5V12.2H19.5L12 3.2Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M12 6.5L7.8 11.6H10V18.2H14V11.6H16.2L12 6.5Z" fill="${coreColor}"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
};

// Custom icons for different types
const getTruckColor = (driverName?: string, truckId?: string) => {
  const colors = [
    '#EF4444', // Red
    '#3B82F6', // Blue
    '#10B981', // Green
    '#D97706', // Yellow/Amber/Orange
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#14B8A6', // Teal
    '#F97316', // Orange
    '#6366F1'  // Indigo
  ];
  const str = driverName || truckId || '';
  if (!str) return '#4B5563'; // Gray default
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

const truckIcon = (
  driverName: string, 
  truckId: string, 
  status: string, 
  isSelected: boolean,
  isActiveInService: boolean = false
) => {
  const uniqueColor = getTruckColor(driverName, truckId);
  let classes = isSelected ? 'custom-div-icon selected-truck' : 'custom-div-icon';
  if (status === 'IN_ROUTE' || isActiveInService) {
    classes += ' truck-in-route-pulse';
  }
  
  const truckSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="2" ry="2" fill="white" fill-opacity="0.2"></rect>
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" fill="white" fill-opacity="0.2"></polygon>
      <circle cx="5.5" cy="18.5" r="2.5" fill="black" stroke="white" stroke-width="1.5"></circle>
      <circle cx="18.5" cy="18.5" r="2.5" fill="black" stroke="white" stroke-width="1.5"></circle>
    </svg>
  `;

  const size = isSelected ? 38 : (isActiveInService ? 34 : 28);
  const borderSize = isSelected ? 3 : 2;
  const shadowStyle = isSelected 
    ? 'box-shadow: 0 4px 12px rgba(0,0,0,0.5);' 
    : (isActiveInService 
        ? 'box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.45), 0 3px 8px rgba(0,0,0,0.3);' 
        : 'box-shadow: 0 2px 6px rgba(0,0,0,0.3);');

  const displayName = driverName ? driverName.split(' ')[0] : 'Pipa';
  const activeBadge = isActiveInService ? `
    <div style="
      position: absolute;
      top: -24px;
      left: 50%;
      transform: translateX(-50%);
      background: #064E3B;
      color: #A7F3D0;
      border: 1px solid #10B981;
      padding: 1px 6px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 800;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 3px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.35);
      letter-spacing: 0.02em;
      pointer-events: none;
    ">
      <span style="width: 5px; height: 5px; border-radius: 50%; background: #10B981; display: inline-block;"></span>
      ${displayName}
    </div>
  ` : '';

  return L.divIcon({
    className: classes,
    html: `
      <div style="position: relative;">
        ${activeBadge}
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          width: ${size}px;
          height: ${size}px;
          background-color: ${uniqueColor};
          border: ${borderSize}px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          ${shadowStyle}
          transition: all 0.3s ease;
        ">
          <div style="
            transform: rotate(45deg);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            ${truckSvg}
          </div>
        </div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size]
  });
};

const deliveryIcon = (status: string, residentName?: string) => {
  if (status === 'DELIVERED') {
    const shortName = (residentName || 'Entregue').split(' ')[0];
    return L.divIcon({
      className: 'custom-delivery-delivered-icon',
      html: `
        <div style="display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4)); cursor: pointer;">
          <div style="background: #047857; color: white; padding: 1.5px 6px; border-radius: 6px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; border: 1.5px solid #34D399; white-space: nowrap; display: flex; align-items: center; gap: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.25);">
            <span>✓</span>
            <span style="max-width: 85px; overflow: hidden; text-overflow: ellipsis;">${shortName}</span>
          </div>
          <div style="background-color: #10B981; width: 28px; height: 28px; border-radius: 50% 50% 50% 0; border: 2px solid white; display: flex; align-items: center; justify-content: center; transform: rotate(-45deg); margin-top: -2px; box-shadow: 0 3px 8px rgba(16,185,129,0.5);">
            <div style="transform: rotate(45deg); color: white; font-weight: 900; font-size: 13px;">
              ✓
            </div>
          </div>
        </div>
      `,
      iconSize: [100, 52],
      iconAnchor: [50, 38],
      popupAnchor: [0, -40]
    });
  }

  const isRoute = status === 'IN_ROUTE';
  const color = isRoute ? '#F59E0B' : '#3B82F6';
  const label = isRoute ? 'Em Rota' : 'Pendente';
  const shortName = (residentName || label).split(' ')[0];

  return L.divIcon({
    className: 'custom-div-icon',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3)); cursor: pointer;">
        <div style="background: ${color}; color: white; padding: 1px 5px; border-radius: 5px; font-size: 8px; font-weight: 800; text-transform: uppercase; white-space: nowrap; border: 1px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          ${shortName}
        </div>
        <div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; margin-top: 1px; box-shadow: 0 0 6px ${color};"></div>
      </div>
    `,
    iconSize: [80, 36],
    iconAnchor: [40, 26],
    popupAnchor: [0, -26]
  });
};

const getSitioIcon = (type?: string, fuelType?: string, name?: string) => {
  let bgColor = '#8B5CF6'; // Default color (purple)
  let iconHtml = '';
  let badgeLabel = (name || 'Sítio').split(' ')[0];

  if (type === 'WATER') {
    bgColor = '#0EA5E9'; // Blue for water
    iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>';
  } else if (type === 'FUEL') {
    bgColor = fuelType === 'DIESEL' ? '#B45309' : '#EF4444'; // Brown for diesel, Red for gasoline
    iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h13M3 18h13M3 10h13M3 6h13M16 4v16a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2z"/></svg>';
  } else if (type === 'SCHOOL') {
    bgColor = '#6366F1'; // Indigo for school
    iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 8-4 8 4"/><path d="m18 10 4 2v6"/><path d="M14 22v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4"/><path d="M18 5v17"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/></svg>';
  } else if (type === 'DAYCARE') {
    bgColor = '#EC4899'; // Pink for daycare
    iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><circle cx="12" cy="12" r="10"/></svg>';
  } else if (type === 'RESIDENT') {
    bgColor = '#059669'; // Emerald for resident sitio
    iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
  } else {
    bgColor = '#8B5CF6';
    iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
  }

  const nameBadge = name ? `
    <div style="background: ${bgColor}; color: white; padding: 1px 6px; border-radius: 6px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; border: 1.5px solid rgba(255,255,255,0.8); white-space: nowrap; max-width: 90px; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 4px rgba(0,0,0,0.25);">
      ${badgeLabel}
    </div>
  ` : '';

  return L.divIcon({
    className: 'custom-div-icon',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); cursor: pointer;">
        ${nameBadge}
        <div style="background-color: ${bgColor}; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; border: 2px solid white; display: flex; align-items: center; justify-content: center; transform: rotate(-45deg); margin-top: ${name ? '-2px' : '0'};">
          <div style="transform: rotate(45deg); display: flex;">
            ${iconHtml}
          </div>
        </div>
      </div>
    `,
    iconSize: [95, 48],
    iconAnchor: [47.5, 42],
    popupAnchor: [0, -40]
  });
};

const newPointIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `
    <div style="display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
      <div style="background-color: #10B981; width: 32px; height: 32px; border-radius: 50% 50% 50% 0; border: 3px solid white; display: flex; align-items: center; justify-content: center; transform: rotate(-45deg);">
        <div style="transform: rotate(45deg); display: flex;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </div>
      </div>
    </div>
  `,
  iconSize: [32, 38],
  iconAnchor: [16, 36],
  popupAnchor: [0, -32]
});

const userLocationIcon = L.divIcon({
  className: 'user-location-pulse',
  html: `<div style="background-color: #3B82F6; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

// Ícone personalizado para o Sítio / Residência do Motorista (salvo via GPS do celular)
const driverHomeSitioIcon = (sitioName: string, driverName: string) => {
  const shortSitio = (sitioName || 'Sítio').trim();
  const shortDriver = (driverName || 'Motorista').split(' ')[0];
  return L.divIcon({
    className: 'custom-driver-home-icon',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); cursor: pointer;">
        <div style="background: linear-gradient(135deg, #047857, #065F46); color: white; padding: 2px 7px; border-radius: 8px; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: 1.5px solid #34D399; white-space: nowrap; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
          <span>🏠</span>
          <span>${shortSitio}</span>
        </div>
        <div style="background-color: #059669; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; transform: rotate(-45deg); margin-top: -3px; box-shadow: 0 4px 10px rgba(5,150,105,0.4);">
          <div style="transform: rotate(45deg); font-size: 16px;">
            🏡
          </div>
        </div>
        <div style="background: rgba(15, 23, 42, 0.95); color: #A7F3D0; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 4px; margin-top: 1px; white-space: nowrap; border: 1px solid rgba(52, 211, 153, 0.4);">
          Mot. ${shortDriver}
        </div>
      </div>
    `,
    iconSize: [120, 62],
    iconAnchor: [60, 44],
    popupAnchor: [0, -45]
  });
};

// Ícone personalizado para Moradores / Localidades salvas com GPS pelo celular do motorista
const residentMarkerIcon = (resident: Resident) => {
  const isSchool = resident.category === 'SCHOOL';
  const isDaycare = resident.category === 'DAYCARE';
  const emoji = isSchool ? '🏫' : isDaycare ? '👶' : '👤';
  const bgColor = isSchool ? '#4F46E5' : isDaycare ? '#DB2777' : '#0284C7';
  const borderColor = isSchool ? '#A5B4FC' : isDaycare ? '#FBCFE8' : '#7DD3FC';
  const shortName = (resident.name || 'Morador').split(' ')[0];

  return L.divIcon({
    className: 'custom-resident-marker-icon',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4)); cursor: pointer;">
        <div style="background: ${bgColor}; color: white; padding: 1.5px 6px; border-radius: 7px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; border: 1.5px solid ${borderColor}; white-space: nowrap; display: flex; align-items: center; gap: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.25);">
          <span>${emoji}</span>
          <span style="max-width: 85px; overflow: hidden; text-overflow: ellipsis;">${shortName}</span>
        </div>
        <div style="background-color: ${bgColor}; width: 28px; height: 28px; border-radius: 50% 50% 50% 0; border: 2px solid white; display: flex; align-items: center; justify-content: center; transform: rotate(-45deg); margin-top: -2px; box-shadow: 0 3px 8px rgba(0,0,0,0.35);">
          <div style="transform: rotate(45deg); font-size: 13px;">
            ${emoji}
          </div>
        </div>
      </div>
    `,
    iconSize: [100, 52],
    iconAnchor: [50, 38],
    popupAnchor: [0, -40]
  });
};

interface MapViewProps {
  trucks: Truck[];
  deliveries: Delivery[];
  sitios: Sitio[];
  drivers?: Driver[];
  residents?: Resident[];
  onMapClick?: (lat: number, lng: number) => void;
  onSitioClick?: (sitio: Sitio) => void;
  onSelectResidentForDelivery?: (resident: Resident) => void;
  selectedTruckId?: string | null;
  route?: [number, number][];
  newPoint?: [number, number] | null;
  isDriver?: boolean;
  onOpenDriverSelector?: () => void;
  flyToCoords?: [number, number] | null;
}

function MapClickHandler({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function LocateControl({ 
  streetViewMode, 
  setStreetViewMode, 
  onMarkerClick,
  selectedTruck,
  autoTrack,
  setAutoTrack,
  isDriver,
  mapLayer,
  setMapLayer,
  trucks,
  setSelectedDetail,
  onOpenDriverSelector
}: { 
  streetViewMode: boolean; 
  setStreetViewMode: (v: boolean) => void; 
  onMarkerClick?: (lat: number, lng: number) => void;
  selectedTruck?: Truck;
  autoTrack: boolean;
  setAutoTrack: (v: boolean) => void;
  isDriver?: boolean;
  mapLayer: 'osmand' | 'satellite';
  setMapLayer: (v: 'osmand' | 'satellite') => void;
  trucks: Truck[];
  setSelectedDetail: (detail: any) => void;
  onOpenDriverSelector?: () => void;
}) {
  const map = useMap();
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [showLocateMenu, setShowLocateMenu] = useState(false);

  useEffect(() => {
    let watchId: number;

    if (isLocating && isDriver) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setPosition([latitude, longitude]);
          map.flyTo([latitude, longitude], map.getZoom() || 16, { animate: true, duration: 1.0 });
        },
        (err) => {
          console.error("Erro ao obter localização:", err);
          setIsLocating(false);
        },
        { enableHighAccuracy: true }
      );
    }

    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };
  }, [isLocating, map, isDriver]);

  const handleDriverLocateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setPosition([latitude, longitude]);
          map.flyTo([latitude, longitude], 17, { animate: true, duration: 1.2 });
          setIsLocating(true);
        },
        (err) => {
          console.warn("Aviso ao buscar GPS instantâneo:", err);
          if (selectedTruck?.lastLat && selectedTruck?.lastLng) {
            map.flyTo([selectedTruck.lastLat, selectedTruck.lastLng], 17, { animate: true, duration: 1.2 });
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    } else if (selectedTruck?.lastLat && selectedTruck?.lastLng) {
      map.flyTo([selectedTruck.lastLat, selectedTruck.lastLng], 17, { animate: true, duration: 1.2 });
    }
  };

  return (
    <>
      {/* Barra de Ferramentas Alinhada do Lado Direito (Web e Celular) */}
      <div 
        className={`absolute ${isDriver ? 'top-2.5 right-2.5 sm:top-3 sm:right-3' : 'top-2.5 right-2.5 sm:top-3 sm:right-3'} z-[1010] flex flex-col gap-1 p-1 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl pointer-events-auto transition-all`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {/* Toggle Camada do Mapa (Satélite / OsmAnd) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMapLayer(mapLayer === 'osmand' ? 'satellite' : 'osmand');
          }}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
            mapLayer === 'satellite'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30 ring-2 ring-purple-400/40'
              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
          }`}
          title={mapLayer === 'satellite' ? "Mudar para Mapa Padrão (Vias)" : "Mudar para Visão Satélite"}
        >
          <Layers size={18} />
        </button>

        <div className="h-px w-6 bg-slate-200 mx-auto" />

        {/* Localizar Motorista (Admin) ou Minha Localização GPS (Driver) */}
        {isDriver ? (
          <button
            onClick={handleDriverLocateClick}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
              isLocating 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40' 
                : 'text-blue-600 hover:bg-blue-50'
            }`}
            title="Minha Localidade (Levar mapa para minha localização atual)"
          >
            <LocateFixed size={18} className={isLocating ? "animate-pulse" : ""} />
          </button>
        ) : (
          <div className="relative flex flex-col items-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (onOpenDriverSelector) {
                  onOpenDriverSelector();
                }
              }}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 cursor-pointer ${
                selectedTruck ? 'bg-blue-50 text-blue-600 border border-blue-200 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
              title="Escolher e Rastrear Motorista (Lista Completa de Cadastrados)"
            >
              <LocateFixed size={18} className={selectedTruck ? "animate-pulse text-blue-600" : ""} />
            </button>
          </div>
        )}

        {/* Modo Street View */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setStreetViewMode(!streetViewMode);
          }}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
            streetViewMode 
              ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30 ring-2 ring-amber-400/40' 
              : 'text-amber-600 hover:bg-amber-50'
          }`}
          title={streetViewMode ? "Desativar Street View" : "Ativar Modo Street View (Clique no mapa)"}
        >
          <User size={18} className={streetViewMode ? "animate-bounce" : ""} />
        </button>

        {/* Botão Ver Todos os Motoristas (Show all drivers on map) */}
        {!isDriver && (
          <>
            <div className="h-px w-6 bg-slate-200 mx-auto" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const validTrucks = trucks.filter(t => typeof t.lastLat === 'number' && typeof t.lastLng === 'number');
                if (validTrucks.length > 0) {
                  const points = validTrucks.map(t => [t.lastLat!, t.lastLng!] as [number, number]);
                  const bounds = L.latLngBounds(points);
                  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
                } else {
                  map.setView([-9.2201, -36.3503], 13);
                }
              }}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 text-indigo-600 hover:bg-indigo-50"
              title="Enquadrar Todos os Motoristas (Visão Geral)"
            >
              <Maximize size={18} />
            </button>
          </>
        )}

        {/* Rastreamento Automático do Caminhão Selecionado */}
        {selectedTruck && (
          <>
            <div className="h-px w-6 bg-slate-200 mx-auto" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAutoTrack(!autoTrack);
              }}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
                autoTrack 
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400/40' 
                  : 'text-emerald-600 hover:bg-emerald-50'
              }`}
              title={autoTrack ? "Desativar Rastreamento Automático" : "Ativar Rastreamento Automático do Caminhão"}
            >
              <Navigation size={18} className={`-rotate-45 ${autoTrack ? "animate-pulse" : ""}`} />
            </button>
          </>
        )}
      </div>

      {position && isDriver && (
        <Marker 
          position={position} 
          icon={userLocationIcon}
          eventHandlers={{
            click: () => onMarkerClick?.(position[0], position[1])
          }}
        />
      )}
    </>
  );
}

function StreetViewHandler({ active }: { active: boolean }) {
  useMapEvents({
    click(e) {
      if (active) {
        const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${e.latlng.lat},${e.latlng.lng}`;
        window.open(url, '_blank');
      }
    },
  });
  return null;
}

function MapAutoZoom({ truck, route, autoTrack }: { truck?: Truck, route?: [number, number][], autoTrack: boolean }) {
  const map = useMap();
  
  useEffect(() => {
    let timeoutId: number;

    const performZoom = () => {
      map.invalidateSize();

      if (route && route.length > 0) {
        if (route.length === 1) {
          map.flyTo(route[0], 15, { animate: true, duration: 1.5 });
        } else {
          const bounds = L.polyline(route).getBounds();
          const isMobile = window.innerWidth < 1024;
          
          map.fitBounds(bounds, { 
            paddingTopLeft: isMobile ? [30, 30] : [120, 120],
            paddingBottomRight: isMobile ? [30, 320] : [120, 120], // Bottom margin for mobile drawer (Driver App)
            maxZoom: 16,
            animate: true,
            duration: 1.5
          });
        }
      } else if (truck?.lastLat && truck?.lastLng) {
        if (autoTrack) {
          map.setView([truck.lastLat, truck.lastLng], map.getZoom() || 15, {
            animate: true,
            duration: 0.8
          });
        }
      }
    };

    performZoom();
    // Re-verify after a small timer in case CSS animations were running
    timeoutId = window.setTimeout(performZoom, 400);

    const handleResize = () => {
      performZoom();
    };

    window.addEventListener('resize', handleResize);
    
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, [truck?.id, truck?.lastLat, truck?.lastLng, route, map, autoTrack]);

  return null;
}

function MapFlyToHandler({ target }: { target: { coords: [number, number]; id: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target && target.coords) {
      map.flyTo(target.coords, 17, { animate: true, duration: 1.2 });
    }
  }, [target, map]);
  return null;
}

function CustomZoomControl({ isDriver }: { isDriver?: boolean }) {
  const map = useMap();
  return (
    <div 
      className={`absolute ${isDriver ? 'top-2.5 sm:top-3' : 'top-2.5 sm:top-3'} left-2.5 sm:left-3 z-[1010] flex flex-col gap-1 rounded-2xl bg-white/95 backdrop-blur-md p-1 border border-slate-200 shadow-xl pointer-events-auto transition-all`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          map.zoomIn();
        }}
        className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-xl active:scale-90 transition-all font-bold"
        title="Aumentar Zoom"
      >
        <Plus size={18} />
      </button>
      <div className="h-px w-6 bg-slate-200 mx-auto" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          map.zoomOut();
        }}
        className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-xl active:scale-90 transition-all font-bold"
        title="Diminuir Zoom"
      >
        <Minus size={18} />
      </button>
    </div>
  );
}

export default function MapContainer({ 
  trucks, 
  deliveries, 
  sitios, 
  drivers = [], 
  residents = [], 
  onMapClick, 
  onSitioClick, 
  onSelectResidentForDelivery, 
  selectedTruckId, 
  route, 
  newPoint, 
  isDriver, 
  onOpenDriverSelector,
  flyToCoords
}: MapViewProps) {
  const center: [number, number] = route && route.length > 0 ? route[0] : [-9.2201, -36.3503]; // Use route start or Inhapi, AL city center
  const selectedTruck = trucks.find(t => t.id === selectedTruckId);

  const [mapLayer, setMapLayer] = useState<'osmand' | 'satellite'>('osmand');
  const [autoTrack, setAutoTrack] = useState(true);
  const [mapFlyTarget, setMapFlyTarget] = useState<{ coords: [number, number]; id: number } | null>(null);

  // Quando flyToCoords for recebido do botão Minha Localidade do motorista, centraliza e voa imediatamente
  useEffect(() => {
    if (flyToCoords && typeof flyToCoords[0] === 'number' && typeof flyToCoords[1] === 'number' && !isNaN(flyToCoords[0])) {
      setMapFlyTarget({ coords: [flyToCoords[0], flyToCoords[1]], id: Date.now() });
    }
  }, [flyToCoords]);

  useEffect(() => {
    if (selectedTruckId) {
      setAutoTrack(true);
    }
  }, [selectedTruckId]);

  // Caminhões que estão ativos em serviço com GPS disponível
  const activeInServiceTrucks = useMemo(() => {
    return trucks.filter(truck => {
      const hasCoords = typeof truck.lastLat === 'number' && typeof truck.lastLng === 'number';
      if (!hasCoords) return false;
      const isInRouteOrArrived = truck.status === 'IN_ROUTE' || truck.status === 'ARRIVED';
      const hasAssignedDeliveries = deliveries.some(
        d => d.truckId === truck.id && (d.status === 'IN_ROUTE' || d.status === 'PENDING')
      );
      return isInRouteOrArrived || hasAssignedDeliveries;
    });
  }, [trucks, deliveries]);

  const [filters, setFilters] = useState({
    trucks: true,
    onlyActiveInService: true, // Prioriza rastrear os caminhões ativos em serviço no mapa do admin
    pending: true,
    inRoute: true,
    delivered: true, // Pontos de entregas concluídas salvos via GPS ficam visíveis por padrão
    sitios: true,
    driverSitios: true, // Sítios onde os motoristas moram (salvo via GPS do celular)
    residents: true // Moradores e localidades salvas com GPS do celular
  });
  const [showLayersModal, setShowLayersModal] = useState(false);
  const [countdownSecs, setCountdownSecs] = useState(5);
  const [isInteractingWithModal, setIsInteractingWithModal] = useState(false);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Mantém a tela de camadas aberta enquanto o usuário estiver mexendo nas configurações
  const handleUserActivity = useCallback(() => {
    setIsInteractingWithModal(true);
    setCountdownSecs(5);

    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    // Só inicia a contagem regressiva para diminuir quando o usuário parar completamente de mexer por 4 segundos
    idleTimerRef.current = setTimeout(() => {
      setIsInteractingWithModal(false);
    }, 4000);
  }, []);

  // Timer para diminuir/fechar automaticamente o painel de camadas apenas quando o usuário NÃO estiver mexendo
  useEffect(() => {
    let interval: any;

    if (showLayersModal && !isInteractingWithModal) {
      interval = setInterval(() => {
        setCountdownSecs((prev) => {
          if (prev <= 1) {
            setShowLayersModal(false);
            return 5;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showLayersModal, isInteractingWithModal]);

  // Limpa os timers ao fechar ou desmontar
  useEffect(() => {
    if (!showLayersModal) {
      setIsInteractingWithModal(false);
      setCountdownSecs(5);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    }
  }, [showLayersModal]);

  const activeLayersCount = useMemo(() => {
    let count = 0;
    if (filters.residents) count++;
    if (filters.driverSitios) count++;
    if (filters.sitios) count++;
    if (filters.delivered) count++;
    if (filters.trucks) count++;
    return count;
  }, [filters]);

  const [streetViewMode, setStreetViewMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<{
    type: 'truck' | 'delivery' | 'sitio' | 'water_supply' | 'new_point' | 'user_location' | 'driver_sitio' | 'resident';
    data: any;
  } | null>(null);

  // Moradores e localidades salvos com coordenadas GPS pelo celular
  const residentsWithCoords = useMemo(() => {
    if (!residents || residents.length === 0) return [];
    return residents.filter(r => {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      const hasCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
      if (!hasCoords) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (r.name || '').toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q) ||
        (r.neighborhood || '').toLowerCase().includes(q) ||
        (r.referencePoint || '').toLowerCase().includes(q) ||
        (r.sector || '').toLowerCase().includes(q)
      );
    }).map(r => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
  }, [residents, searchQuery]);

  // Sítios onde os motoristas moram com localização GPS capturada
  const driverSitiosWithCoords = useMemo(() => {
    if (!drivers || drivers.length === 0) return [];
    return drivers.filter(d => {
      const hasCoords = typeof d.homeLat === 'number' && typeof d.homeLng === 'number' && !isNaN(d.homeLat) && !isNaN(d.homeLng);
      if (!hasCoords) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (d.name || '').toLowerCase().includes(q) ||
        (d.homeSitio || '').toLowerCase().includes(q) ||
        (d.sector || '').toLowerCase().includes(q) ||
        (d.address || '').toLowerCase().includes(q)
      );
    });
  }, [drivers, searchQuery]);

  // Driver Selector Modal State (Complete list of all registered drivers)
  const [showDriverSelectorModal, setShowDriverSelectorModal] = useState(false);
  const [driverModalSearch, setDriverModalSearch] = useState('');
  const [driverModalFilter, setDriverModalFilter] = useState<'ALL' | 'IN_ROUTE' | 'IDLE'>('ALL');

  const filteredModalTrucks = useMemo(() => {
    return trucks.filter(t => {
      if (driverModalFilter === 'IN_ROUTE' && t.status !== 'IN_ROUTE') return false;
      if (driverModalFilter === 'IDLE' && t.status === 'IN_ROUTE') return false;
      if (driverModalSearch.trim()) {
        const q = driverModalSearch.toLowerCase().trim();
        const nameMatch = (t.driverName || '').toLowerCase().includes(q);
        const plateMatch = (t.plate || '').toLowerCase().includes(q);
        return nameMatch || plateMatch;
      }
      return true;
    });
  }, [trucks, driverModalFilter, driverModalSearch]);

  // Search and active service filtering
  const filteredTrucks = trucks.filter(truck => {
    if (filters.onlyActiveInService && !activeInServiceTrucks.some(at => at.id === truck.id)) {
      return false;
    }
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (truck.driverName || '').toLowerCase().includes(q) ||
      (truck.plate || '').toLowerCase().includes(q)
    );
  });

  const filteredDeliveries = useMemo(() => {
    return deliveries.filter(delivery => {
      const lat = Number(delivery.lat || (delivery as any).deliveredLat);
      const lng = Number(delivery.lng || (delivery as any).deliveredLng);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (delivery.residentName || '').toLowerCase().includes(q) ||
        (delivery.address || '').toLowerCase().includes(q)
      );
    }).map(d => ({
      ...d,
      lat: Number(d.lat || (d as any).deliveredLat),
      lng: Number(d.lng || (d as any).deliveredLng)
    }));
  }, [deliveries, searchQuery]);

  const filteredSitios = useMemo(() => {
    return sitios.filter(sitio => {
      const lat = Number(sitio.lat);
      const lng = Number(sitio.lng);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (sitio.name || '').toLowerCase().includes(q) ||
        (sitio.description || '').toLowerCase().includes(q)
      );
    }).map(s => ({
      ...s,
      lat: Number(s.lat),
      lng: Number(s.lng)
    }));
  }, [sitios, searchQuery]);

  const [routeColorStyle, setRouteColorStyle] = useState<'neon' | 'navy'>('neon');
  const [showRouteControls, setShowRouteControls] = useState(true);
  const [activeRoadRoute, setActiveRoadRoute] = useState<[number, number][] | undefined>(undefined);
  const [isCalculatingRoad, setIsCalculatingRoad] = useState(false);

  // Garante estritamente que rotas sejam SEMPRE traçadas no caminho real da pista/estrada (NUNCA em linha reta)
  useEffect(() => {
    if (!route || route.length === 0) {
      setActiveRoadRoute(undefined);
      return;
    }

    // Se já é uma rota detalhada pelas vias (> 2 pontos de estrada), utiliza diretamente
    if (route.length > 2) {
      setActiveRoadRoute(route);
      setShowRouteControls(true);
      return;
    }

    // Se possui 2 pontos (tentativa de linha reta), busca a geometria real da estrada
    // Jamais desenha a linha reta provisória!
    let isCancelled = false;
    setIsCalculatingRoad(true);

    fetchRoadRoute(route)
      .then((roadCoords) => {
        if (!isCancelled) {
          setIsCalculatingRoad(false);
          if (roadCoords && isRoadRoute(roadCoords)) {
            setActiveRoadRoute(roadCoords);
            setShowRouteControls(true);
          } else {
            // Em hipótese alguma desenhar em linha reta
            setActiveRoadRoute(undefined);
          }
        }
      })
      .catch((err) => {
        console.warn('Falha ao traçar rota real pelas vias:', err);
        if (!isCancelled) {
          setIsCalculatingRoad(false);
          setActiveRoadRoute(undefined);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [route]);

  // Calcula setas direcionais animadas que seguem fielmente a curvatura da rota calculada pelas vias
  const routeArrows = useMemo(() => {
    if (!activeRoadRoute || activeRoadRoute.length < 2) return [];
    return calculateRouteArrows(activeRoadRoute);
  }, [activeRoadRoute]);

  // Calcula a quilometragem total real percorrendo as curvas da pista
  const roadTotalKm = useMemo(() => {
    if (!activeRoadRoute || activeRoadRoute.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < activeRoadRoute.length - 1; i++) {
      total += getHaversineDistance(
        activeRoadRoute[i][0], activeRoadRoute[i][1],
        activeRoadRoute[i + 1][0], activeRoadRoute[i + 1][1]
      );
    }
    return total;
  }, [activeRoadRoute]);

  const toggleFilter = (key: keyof typeof filters) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="w-full h-full min-h-[340px] sm:min-h-[420px] relative rounded-2xl overflow-hidden shadow-sm border border-slate-200/90 z-0 isolate">
      {/* Auto tracking Active Badge (Apenas modo Motorista) */}
        {isDriver && selectedTruck && autoTrack && (
          <div className="absolute top-2.5 sm:top-3 left-1/2 -translate-x-1/2 z-[1025] max-w-[calc(100%-120px)] bg-emerald-950/95 text-emerald-300 backdrop-blur-md px-3 py-1.5 rounded-xl border border-emerald-500/30 flex items-center gap-2 shadow-lg text-[10px] font-black uppercase tracking-wider truncate pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping flex-shrink-0" />
            <span className="truncate">Seguindo: {selectedTruck.driverName || 'Caminhão'}</span>
          </div>
        )}

        {/* Indicador de cálculo de rota (Apenas modo Motorista) */}
        {isDriver && isCalculatingRoad && (
          <div className={`absolute ${selectedTruck && autoTrack ? 'top-12 sm:top-13' : 'top-2.5 sm:top-3'} left-1/2 -translate-x-1/2 z-[1025] max-w-[calc(100%-120px)] bg-brand-dark/95 text-cyan-300 backdrop-blur-md px-3 py-1.5 rounded-xl border border-cyan-500/30 flex items-center gap-2 shadow-lg text-[10px] font-black uppercase tracking-wider animate-pulse pointer-events-auto`}>
            <Navigation size={12} className="animate-spin text-cyan-400 shrink-0" />
            <span className="truncate">Traçando caminho pelas estradas...</span>
          </div>
        )}

        {/* Route Active Control Badge & Vibrant Color Switcher */}
        {activeRoadRoute && isRoadRoute(activeRoadRoute) && showRouteControls && (
          <div 
            className={`absolute ${isDriver ? 'bottom-18 sm:bottom-20 left-2.5 right-16 sm:right-auto sm:max-w-md' : 'bottom-3 sm:bottom-4 left-2.5 sm:left-4 max-w-[calc(100%-20px)] sm:max-w-md'} z-[1030] bg-slate-900/95 text-white backdrop-blur-md px-3 py-2 rounded-2xl border border-emerald-500/30 shadow-2xl flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`w-2.5 h-2.5 rounded-full animate-ping shrink-0 ${routeColorStyle === 'neon' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
            <div className="flex flex-col">
              <span className="text-[8px] min-[360px]:text-[9px] font-black uppercase tracking-widest text-emerald-400">
                Traçado pelas Estradas Ativo
              </span>
              <span className="text-[10px] min-[360px]:text-[11px] font-bold text-white flex items-center gap-1.5">
                <Navigation size={11} className={routeColorStyle === 'neon' ? 'text-emerald-400' : 'text-sky-400'} />
                {roadTotalKm > 0 ? `${roadTotalKm.toFixed(1)} km • ${routeArrows.length} setas animadas` : `${routeArrows.length} Setas Animadas nas Vias`}
              </span>
            </div>

            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 ml-auto sm:ml-2">
              <button
                onClick={() => setRouteColorStyle('neon')}
                className={`px-1.5 min-[360px]:px-2 py-1 rounded-lg text-[8px] min-[360px]:text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${
                  routeColorStyle === 'neon'
                    ? 'bg-emerald-500 text-slate-950 shadow-md font-extrabold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Destacar com Verde Neon"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 border border-black/30" />
                Neon
              </button>
              <button
                onClick={() => setRouteColorStyle('navy')}
                className={`px-1.5 min-[360px]:px-2 py-1 rounded-lg text-[8px] min-[360px]:text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${
                  routeColorStyle === 'navy'
                    ? 'bg-sky-500 text-slate-950 shadow-md font-extrabold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Destacar com Azul Marinho / Royal"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 border border-black/30" />
                Azul
              </button>
            </div>

            <button 
              onClick={() => setShowRouteControls(false)}
              className="p-1 text-slate-400 hover:text-white transition-colors ml-1"
              title="Ocultar painel de rota"
            >
              <X size={14} />
            </button>
          </div>
        )}

      <LeafletMap
        center={center}
        zoom={route ? 17 : 16}
        scrollWheelZoom={true}
        className="w-full h-full z-0 isolate"
        zoomControl={false}
      >
        <CustomZoomControl isDriver={isDriver} />
        <MapFlyToHandler target={mapFlyTarget} />
        {mapLayer === 'osmand' ? (
          <TileLayer
            key="tile-osmand"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <TileLayer
            key="tile-satellite"
            attribution='&copy; Google Maps'
            url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
            maxZoom={22}
            maxNativeZoom={20}
          />
        )}
        

        <MapClickHandler onClick={onMapClick} />
        <StreetViewHandler active={streetViewMode} />
        <LocateControl 
          streetViewMode={streetViewMode} 
          setStreetViewMode={setStreetViewMode} 
          onMarkerClick={(lat, lng) => setSelectedDetail({
            type: 'user_location',
            data: { lat, lng }
          })}
          selectedTruck={selectedTruck}
          autoTrack={autoTrack}
          setAutoTrack={setAutoTrack}
          isDriver={isDriver}
          mapLayer={mapLayer}
          setMapLayer={setMapLayer}
          trucks={trucks}
          setSelectedDetail={setSelectedDetail}
          onOpenDriverSelector={onOpenDriverSelector || (() => setShowDriverSelectorModal(true))}
        />
        <MapAutoZoom truck={selectedTruck} route={activeRoadRoute} autoTrack={autoTrack} />

        {/* Optimized Route Visualization with Vibrant Highlights & Directional Arrows */}
        {activeRoadRoute && isRoadRoute(activeRoadRoute) && (
          <>
            {/* Outer Glow Halo Layer */}
            <Polyline 
              positions={activeRoadRoute} 
              color={routeColorStyle === 'neon' ? '#10B981' : '#0284C7'} 
              weight={14} 
              opacity={0.35} 
              lineJoin="round"
              lineCap="round"
            />
            {/* Main Vibrant Track Layer */}
            <Polyline 
              positions={activeRoadRoute} 
              color={routeColorStyle === 'neon' ? '#059669' : '#0369A1'} 
              weight={7} 
              opacity={0.9} 
              lineJoin="round"
              lineCap="round"
            />
            {/* High-Contrast Crisp Center Core Line */}
            <Polyline 
              positions={activeRoadRoute} 
              color={routeColorStyle === 'neon' ? '#A7F3D0' : '#BAE6FD'} 
              weight={2.5} 
              opacity={1} 
              lineJoin="round"
              lineCap="round"
            />
            {/* Directional Animated Arrows along the Road Path */}
            {routeArrows.map((arrow) => (
              <Marker
                key={arrow.id}
                position={arrow.position}
                icon={routeArrowIcon(arrow.heading, routeColorStyle, arrow.index)}
                interactive={false}
                zIndexOffset={200}
              />
            ))}
          </>
        )}

        {/* Trucks */}
        {filters.trucks && filteredTrucks.map((truck) => {
          const isActive = activeInServiceTrucks.some(at => at.id === truck.id);
          return (
            truck.lastLat && truck.lastLng && (
              <Marker
                key={truck.id}
                position={[truck.lastLat, truck.lastLng]}
                icon={truckIcon(truck.driverName, truck.id, truck.status, truck.id === selectedTruckId, isActive)}
                eventHandlers={{
                  click: () => setSelectedDetail({
                    type: 'truck',
                    data: truck
                  })
                }}
              />
            )
          );
        })}

        {/* Deliveries with sequence numbers if route is active */}
        {filteredDeliveries
          .filter(d => {
            if (d.status === 'PENDING' && !filters.pending) return false;
            if (d.status === 'IN_ROUTE' && !filters.inRoute) return false;
            if (d.status === 'DELIVERED' && !filters.delivered) return false;
            return true;
          })
          .map((delivery) => {
            const sequenceIndex = route ? route.findIndex(p => p[0] === delivery.lat && p[1] === delivery.lng) : -1;
            
            return (
              <Marker
                key={delivery.id}
                position={[delivery.lat, delivery.lng]}
                icon={sequenceIndex > 0 ? L.divIcon({
                  className: 'custom-div-icon',
                  html: `<div style="background-color: #10B981; width: 22px; height: 22px; border-radius: 50%; border: 2px solid white; color: white; font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(0,0,0,0.3);">${sequenceIndex}</div>`,
                  iconSize: [22, 22],
                  iconAnchor: [11, 11]
                }) : deliveryIcon(delivery.status, delivery.residentName)}
                eventHandlers={{
                  click: () => setSelectedDetail({
                    type: 'delivery',
                    data: { ...delivery, sequenceIndex }
                  })
                }}
              />
            );
          })}

        {/* Sitios */}
        {filters.sitios && filteredSitios.map((sitio) => (
          <Marker
            key={sitio.id}
            position={[sitio.lat, sitio.lng]}
            icon={getSitioIcon(sitio.type, sitio.fuelType, sitio.name)}
            eventHandlers={{
              click: () => {
                setSelectedDetail({
                  type: 'sitio',
                  data: sitio
                });
                onSitioClick?.(sitio);
              }
            }}
          />
        ))}

        {/* Sítios onde os Motoristas moram (Salvos via GPS do Celular) */}
        {filters.driverSitios && driverSitiosWithCoords.map((driver) => (
          <Marker
            key={`driver-home-${driver.id}`}
            position={[driver.homeLat!, driver.homeLng!]}
            icon={driverHomeSitioIcon(driver.homeSitio || 'Sítio do Motorista', driver.name)}
            eventHandlers={{
              click: () => {
                setSelectedDetail({
                  type: 'driver_sitio',
                  data: driver
                });
              }
            }}
          />
        ))}

        {/* Moradores e Localidades salvas com GPS do celular do motorista */}
        {filters.residents && residentsWithCoords.map((resident) => (
          <Marker
            key={`resident-gps-${resident.id}`}
            position={[resident.lat!, resident.lng!]}
            icon={residentMarkerIcon(resident)}
            eventHandlers={{
              click: () => {
                setSelectedDetail({
                  type: 'resident',
                  data: resident
                });
              }
            }}
          />
        ))}

        {/* New Point Marker */}
        {newPoint && (
          <Marker 
            position={newPoint} 
            icon={newPointIcon}
            eventHandlers={{
              click: () => setSelectedDetail({
                type: 'new_point',
                data: { lat: newPoint[0], lng: newPoint[1] }
              })
            }}
          />
        )}
      </LeafletMap>

      {/* Slide-out Sidebar for Marker Details */}
      <AnimatePresence>
        {selectedDetail && (
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="absolute top-0 right-0 h-full w-full sm:w-96 max-w-full bg-white/95 sm:bg-white/90 backdrop-blur-xl shadow-2xl border-l border-slate-200/80 z-[1100] flex flex-col transition-all duration-300 pointer-events-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-200/60 bg-white/60 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-pulse" />
                <h4 className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-600">Detalhes do Item</h4>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                title="Voltar"
                aria-label="Voltar"
              >
                <ArrowLeft size={15} />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4 sm:space-y-5">
              {selectedDetail.type === 'truck' && (() => {
                const truck = selectedDetail.data;
                const assignedDelivery = deliveries.find(d => d.truckId === truck.id && d.status === 'IN_ROUTE') 
                  || deliveries.find(d => d.truckId === truck.id && d.status === 'PENDING');
                const distance = (truck.lastLat && truck.lastLng && assignedDelivery) 
                  ? getHaversineDistance(truck.lastLat, truck.lastLng, assignedDelivery.lat, assignedDelivery.lng) 
                  : null;

                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-amber-50 rounded-2xl text-amber-600 border border-amber-100">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-base leading-tight">{truck.driverName || 'Sem Motorista'}</h3>
                        <p className="text-xs font-mono font-black text-slate-400 uppercase mt-0.5 tracking-wider">PLACA: {truck.plate}</p>
                      </div>
                    </div>

                    <hr className="border-slate-100" />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Status Geral</p>
                        <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          truck.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-700 border border-amber-200 /80' :
                          truck.status === 'ARRIVED' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 /80' :
                          'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {truck.status === 'IN_ROUTE' ? 'Em Rota' :
                           truck.status === 'ARRIVED' ? 'No Local' : 'Disponível'}
                        </span>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Coordenadas</p>
                        <p className="text-xs font-mono font-bold text-slate-600 mt-1 leading-tight">
                          {truck.lastLat?.toFixed(4)},<br/>{truck.lastLng?.toFixed(4)}
                        </p>
                      </div>
                    </div>

                    {distance !== null && assignedDelivery && (
                      <div className="bg-emerald-50 border border-emerald-100/60 p-3.5 rounded-2xl flex flex-col shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Distância até a Entrega
                        </p>
                        <div className="flex items-baseline gap-1 mt-1.5">
                          <p className="text-2xl font-black text-emerald-950 leading-none">{distance.toFixed(2)}</p>
                          <p className="text-xs font-black text-emerald-700">km</p>
                        </div>
                        <p className="text-[10px] text-emerald-700 font-bold mt-1.5 leading-normal">
                          Para: {assignedDelivery.residentName} ({assignedDelivery.address})
                        </p>
                      </div>
                    )}

                    <div className="space-y-2 !mt-6">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">Ações rápidas</label>
                      {assignedDelivery && (
                        <button
                          onClick={async () => {
                            setIsCalculatingRoad(true);
                            const road = await fetchRoadRoute([
                              [truck.lastLat, truck.lastLng],
                              [assignedDelivery.lat, assignedDelivery.lng]
                            ]);
                            setIsCalculatingRoad(false);
                            if (road && isRoadRoute(road)) {
                              setActiveRoadRoute(road);
                              setShowRouteControls(true);
                            }
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-md shadow-emerald-600/20"
                        >
                          <Navigation size={14} /> Traçar Rota pelas Estradas
                        </button>
                      )}
                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${truck.lastLat},${truck.lastLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-md shadow-amber-500/10"
                      >
                        <ExternalLink size={14} /> Ver Street View
                      </a>
                      
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${truck.lastLat}, ${truck.lastLng}`);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 active:scale-[0.98] text-slate-700 rounded-xl font-bold text-xs transition-all"
                      >
                        Copiar Coordenadas
                      </button>
                    </div>
                  </div>
                );
              })()}

              {selectedDetail.type === 'delivery' && (() => {
                const delivery = selectedDetail.data;
                const assignedTruck = trucks.find(t => t.id === delivery.truckId);
                const distance = (assignedTruck && assignedTruck.lastLat && assignedTruck.lastLng)
                  ? getHaversineDistance(assignedTruck.lastLat, assignedTruck.lastLng, delivery.lat, delivery.lng)
                  : null;

                return (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="p-3 bg-blue-50 rounded-2xl text-blue-600 border border-blue-100 flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-base leading-tight">{delivery.residentName}</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-snug font-semibold">{delivery.address}</p>
                      </div>
                    </div>

                    {delivery.sequenceIndex > 0 && (
                      <div className="bg-emerald-50 border border-emerald-100/60 p-3 rounded-2xl flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider text-emerald-800">Caminho da Rota Ativa</span>
                        <span className="bg-emerald-600 text-white font-black text-xs px-3 py-1 rounded-full shadow-sm">
                          PARADA #{delivery.sequenceIndex}
                        </span>
                      </div>
                    )}

                    <hr className="border-slate-100" />

                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Status da Entrega</p>
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        delivery.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200/80' :
                        delivery.status === 'IN_ROUTE' ? 'bg-amber-100 text-amber-700 border border-amber-200/80' :
                        'bg-blue-100 text-blue-700 border border-blue-200/80'
                      }`}>
                        {delivery.status === 'DELIVERED' ? 'Entregue' :
                         delivery.status === 'IN_ROUTE' ? 'Em Rota' : 'Pendente'}
                      </span>
                    </div>

                    {distance !== null && assignedTruck && (
                      <div className="bg-blue-50 border border-blue-100/60 p-3.5 rounded-2xl flex flex-col shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-wider text-blue-850 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          Distância até o Caminhão
                        </p>
                        <div className="flex items-baseline gap-1 mt-1.5">
                          <p className="text-2xl font-black text-blue-950 leading-none">{distance.toFixed(2)}</p>
                          <p className="text-xs font-black text-blue-700">km</p>
                        </div>
                        <p className="text-[10px] text-blue-700 font-bold mt-1.5 leading-normal">
                          Motorista: {assignedTruck.driverName || 'Sem Motorista'} ({assignedTruck.plate})
                        </p>
                      </div>
                    )}

                    {delivery.referencePoint && (
                      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ponto de Referência</p>
                        <p className="text-xs text-slate-700 font-bold mt-1 leading-normal">{delivery.referencePoint}</p>
                      </div>
                    )}

                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Latitude</p>
                        <p className="text-xs font-mono text-slate-600 font-bold mt-0.5">{delivery.lat?.toFixed(5)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Longitude</p>
                        <p className="text-xs font-mono text-slate-600 font-bold mt-0.5">{delivery.lng?.toFixed(5)}</p>
                      </div>
                    </div>

                    {delivery.councilman && (
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Vereador Solicitante</p>
                        <p className="text-xs text-slate-800 font-black uppercase mt-0.5">{delivery.councilman}</p>
                      </div>
                    )}

                    <div className="space-y-2 !mt-6">
                      {assignedTruck && assignedTruck.lastLat && assignedTruck.lastLng && (
                        <button
                          onClick={async () => {
                            setIsCalculatingRoad(true);
                            const road = await fetchRoadRoute([
                              [assignedTruck.lastLat, assignedTruck.lastLng],
                              [delivery.lat, delivery.lng]
                            ]);
                            setIsCalculatingRoad(false);
                            if (road && isRoadRoute(road)) {
                              setActiveRoadRoute(road);
                              setShowRouteControls(true);
                            }
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-md shadow-emerald-600/20"
                        >
                          <Navigation size={14} /> Traçar Rota do Caminhão pelas Vias
                        </button>
                      )}
                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${delivery.lat},${delivery.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-md shadow-amber-500/10"
                      >
                        <ExternalLink size={14} /> Ver Street View
                      </a>
                      
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${delivery.lat}, ${delivery.lng}`);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 active:scale-[0.98] text-slate-700 rounded-xl font-bold text-xs transition-all"
                      >
                        Copiar Coordenadas
                      </button>
                    </div>
                  </div>
                );
              })()}

              {selectedDetail.type === 'sitio' && (() => {
                const sitio = selectedDetail.data;
                return (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="p-3 bg-purple-50 rounded-2xl text-purple-600 border border-purple-100 flex-shrink-0 font-bold">
                        SÍ
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-base leading-tight">{sitio.name}</h3>
                        <p className="text-xs text-slate-400 mt-1 uppercase font-black flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${
                            sitio.type === 'WATER' ? 'bg-sky-500' :
                            sitio.type === 'FUEL' ? (sitio.fuelType === 'DIESEL' ? 'bg-amber-700' : 'bg-red-500') :
                            sitio.type === 'SCHOOL' ? 'bg-indigo-500' :
                            sitio.type === 'DAYCARE' ? 'bg-pink-500' :
                            'bg-purple-500'
                          }`} />
                          {sitio.type === 'WATER' ? 'Abastecimento de Água' :
                           sitio.type === 'FUEL' ? 'Combustível' :
                           sitio.type === 'SCHOOL' ? 'Escola' :
                           sitio.type === 'DAYCARE' ? 'Creche' :
                           'Ponto Registrado'}
                        </p>
                      </div>
                    </div>

                    <hr className="border-slate-100" />

                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Informações</p>
                      <p className="text-xs text-slate-600 font-bold mt-1 whitespace-pre-line leading-relaxed">{sitio.description}</p>
                    </div>

                    <div className="space-y-2 !mt-6">
                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${sitio.lat},${sitio.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 rounded-xl font-black uppercase tracking-wider text-xs transition-all"
                      >
                        <ExternalLink size={14} /> Ver Street View
                      </a>
                    </div>
                  </div>
                );
              })()}

              {selectedDetail.type === 'water_supply' && (() => {
                const water = selectedDetail.data;
                return (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="p-3 bg-sky-50 rounded-2xl text-sky-600 border border-sky-100 flex-shrink-0 animate-pulse">
                        💡
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-base leading-tight">{water.name}</h3>
                        <p className="text-xs font-black uppercase text-sky-600 mt-1">Sede de Captação</p>
                      </div>
                    </div>

                    <hr className="border-slate-100" />

                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Descrição</p>
                      <p className="text-xs text-slate-600 font-semibold leading-relaxed mt-1">{water.description}</p>
                    </div>

                    <div className="space-y-2 !mt-6">
                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${water.lat},${water.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 rounded-xl font-black uppercase tracking-wider text-xs transition-all"
                      >
                        <ExternalLink size={14} /> Street View
                      </a>
                    </div>
                  </div>
                );
              })()}

              {selectedDetail.type === 'new_point' && (() => {
                const point = selectedDetail.data;
                return (
                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 text-base">Ponto Escolhido no Mapa</h3>
                    <p className="text-xs text-slate-500 leading-normal mb-2">Utilize as coordenadas para mapear novas rotas ou designar entregas para moradores da localidade.</p>
                    
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 font-mono text-xs">
                      <p className="font-bold text-slate-700">LAT: {point.lat?.toFixed(6)}</p>
                      <p className="font-bold text-slate-700 mt-1">LNG: {point.lng?.toFixed(6)}</p>
                    </div>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${point.lat}, ${point.lng}`);
                      }}
                      className="flex items-center justify-center gap-2 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs border"
                    >
                      Copiar Coordenadas
                    </button>
                  </div>
                );
              })()}

              {selectedDetail.type === 'driver_sitio' && (() => {
                const driver = selectedDetail.data as Driver;
                const linkedTruck = trucks.find(t => t.driverName.toLowerCase() === driver.name.toLowerCase());
                const lat = driver.homeLat!;
                const lng = driver.homeLng!;
                const distanceToTruck = (selectedTruck?.lastLat && selectedTruck?.lastLng)
                  ? getHaversineDistance(selectedTruck.lastLat, selectedTruck.lastLng, lat, lng)
                  : null;

                // Entregas mais próximas da residência deste motorista
                const nearbyDeliveries = deliveries
                  .filter(d => d.status !== 'DELIVERED')
                  .map(d => ({
                    ...d,
                    distanceKm: getHaversineDistance(lat, lng, d.lat, d.lng)
                  }))
                  .sort((a, b) => a.distanceKm - b.distanceKm)
                  .slice(0, 3);

                return (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-800 border border-emerald-200 flex-shrink-0 text-xl font-bold shadow-sm">
                        🏡
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          Residência / Sítio do Motorista
                        </span>
                        <h3 className="font-extrabold text-slate-900 text-base leading-tight mt-1">{driver.homeSitio || 'Sítio do Motorista'}</h3>
                        <p className="text-xs text-slate-600 font-bold mt-0.5">
                          Motorista: <span className="text-emerald-950 font-black">{driver.name}</span>
                        </p>
                      </div>
                    </div>

                    <hr className="border-slate-100" />

                    {/* Badge de GPS do Celular */}
                    <div className="bg-emerald-50/70 p-3.5 rounded-2xl border border-emerald-200/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-900 font-black text-xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span>Mapeado via GPS do Celular</span>
                      </div>
                      <p className="text-[11px] text-emerald-800 font-medium">
                        {driver.homeGpsSavedAt 
                          ? `Localização salva em ${new Date(driver.homeGpsSavedAt).toLocaleDateString()} às ${new Date(driver.homeGpsSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` 
                          : 'Coordenadas salvas no aplicativo'}
                        {driver.homeGpsAccuracy && ` (Precisão: ±${driver.homeGpsAccuracy.toFixed(0)}m)`}
                      </p>
                    </div>

                    {/* Informações de contato e base */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <p className="text-[9px] font-black uppercase text-slate-400">Setor Atendido</p>
                        <p className="font-bold text-slate-800 mt-0.5 truncate">{driver.sector || 'Todos os setores'}</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <p className="text-[9px] font-black uppercase text-slate-400">Caminhão Vinculado</p>
                        <p className="font-bold text-slate-800 mt-0.5 truncate">
                          {linkedTruck ? `🚛 ${linkedTruck.plate}` : 'Nenhum'}
                        </p>
                      </div>
                    </div>

                    {/* Coordenadas */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 font-mono text-xs">
                      <p className="text-[9px] font-black font-sans uppercase text-slate-400">Coordenadas da Residência</p>
                      <p className="font-bold text-slate-700 mt-0.5">{lat.toFixed(6)}, {lng.toFixed(6)}</p>
                    </div>

                    {/* Proximidade */}
                    {distanceToTruck !== null && (
                      <div className="bg-blue-50 border border-blue-200/80 p-3 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase text-blue-800">Distância até o Caminhão</p>
                          <p className="text-sm font-black text-blue-950 mt-0.5">{distanceToTruck.toFixed(2)} km</p>
                        </div>
                        <Navigation size={18} className="text-blue-600" />
                      </div>
                    )}

                    {/* Entregas Próximas */}
                    {nearbyDeliveries.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Entregas mais próximas deste Sítio:
                        </p>
                        <div className="space-y-1">
                          {nearbyDeliveries.map(d => (
                            <div key={d.id} className="p-2 bg-slate-50 border border-slate-200/60 rounded-xl flex justify-between items-center text-xs">
                              <div className="min-w-0 pr-2">
                                <p className="font-bold text-slate-800 truncate">{d.residentName}</p>
                                <p className="text-[10px] text-slate-500 truncate">{d.address}</p>
                              </div>
                              <span className="font-black text-emerald-700 shrink-0 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px]">
                                {d.distanceKm.toFixed(1)} km
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Botões de Ação */}
                    <div className="space-y-2 !mt-5">
                      {driver.phone && (
                        <a
                          href={`tel:${driver.phone}`}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-md shadow-emerald-600/20"
                        >
                          <Phone size={14} /> Ligar ({driver.phone})
                        </a>
                      )}
                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 rounded-xl font-black uppercase tracking-wider text-xs transition-all"
                      >
                        <ExternalLink size={14} /> Abrir no Google Maps / Street View
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${lat}, ${lng}`);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs border border-slate-200 transition-all cursor-pointer"
                      >
                        Copiar Coordenadas GPS
                      </button>
                    </div>
                  </div>
                );
              })()}

              {selectedDetail.type === 'resident' && (() => {
                const resident = selectedDetail.data as Resident;
                const isSchool = resident.category === 'SCHOOL';
                const isDaycare = resident.category === 'DAYCARE';
                const lat = resident.lat!;
                const lng = resident.lng!;
                const distanceToTruck = (selectedTruck?.lastLat && selectedTruck?.lastLng)
                  ? getHaversineDistance(selectedTruck.lastLat, selectedTruck.lastLng, lat, lng)
                  : null;

                const activeDeliveryForResident = deliveries.find(d => 
                  (d.residentId && d.residentId === resident.id) ||
                  (d.residentName && d.residentName.trim().toLowerCase() === resident.name.trim().toLowerCase())
                );

                return (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-3 rounded-2xl flex-shrink-0 text-xl font-bold shadow-sm ${
                        isSchool ? 'bg-indigo-100 text-indigo-800 border border-indigo-200' :
                        isDaycare ? 'bg-pink-100 text-pink-800 border border-pink-200' :
                        'bg-sky-100 text-sky-800 border border-sky-200'
                      }`}>
                        {isSchool ? '🏫' : isDaycare ? '👶' : '👤'}
                      </div>
                      <div className="min-w-0">
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                          isSchool ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                          isDaycare ? 'bg-pink-50 text-pink-700 border-pink-200' :
                          'bg-sky-50 text-sky-700 border-sky-200'
                        }`}>
                          {isSchool ? 'Escola Municipal' : isDaycare ? 'Creche' : 'Morador Cadastrado'}
                        </span>
                        <h3 className="font-extrabold text-slate-900 text-base leading-tight mt-1">{resident.name}</h3>
                        <p className="text-xs text-slate-600 font-semibold mt-0.5">
                          {resident.neighborhood || resident.address || 'Inhapi - AL'}
                        </p>
                      </div>
                    </div>

                    <hr className="border-slate-100" />

                    {/* Badge de GPS Salvo via Celular do Motorista */}
                    <div className="bg-sky-50/80 p-3.5 rounded-2xl border border-sky-200/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-sky-950 font-black text-xs">
                        <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
                        <span>Mapeado via GPS do Celular</span>
                      </div>
                      <p className="text-[11px] text-sky-800 font-medium">
                        Localização salva via GPS do motorista. Visível para o secretário e todos os motoristas.
                      </p>
                    </div>

                    {/* Detalhes de Endereço e Referência */}
                    <div className="space-y-2 text-xs">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <p className="text-[9px] font-black uppercase text-slate-400">Endereço Completo</p>
                        <p className="font-bold text-slate-800 mt-0.5">{resident.address || '—'}</p>
                      </div>

                      {resident.referencePoint && (
                        <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200/60">
                          <p className="text-[9px] font-black uppercase text-amber-800 flex items-center gap-1">
                            <MapPin size={11} className="text-amber-600" /> Ponto de Referência
                          </p>
                          <p className="font-bold text-amber-950 mt-0.5">{resident.referencePoint}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <p className="text-[9px] font-black uppercase text-slate-400">Setor / Região</p>
                          <p className="font-bold text-slate-800 mt-0.5 truncate">{resident.sector || resident.neighborhood || 'Geral'}</p>
                        </div>
                        {resident.councilman && (
                          <div className="bg-purple-50 p-2.5 rounded-xl border border-purple-100">
                            <p className="text-[9px] font-black uppercase text-purple-700">Indicação</p>
                            <p className="font-bold text-purple-900 mt-0.5 truncate">{resident.councilman}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Coordenadas */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 font-mono text-xs">
                      <p className="text-[9px] font-black font-sans uppercase text-slate-400">Coordenadas GPS</p>
                      <p className="font-bold text-slate-700 mt-0.5">{lat.toFixed(6)}, {lng.toFixed(6)}</p>
                    </div>

                    {/* Distância até o caminhão */}
                    {distanceToTruck !== null && (
                      <div className="bg-emerald-50 border border-emerald-200/80 p-3 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase text-emerald-800">Distância do Caminhão</p>
                          <p className="text-sm font-black text-emerald-950 mt-0.5">{distanceToTruck.toFixed(2)} km</p>
                        </div>
                        <Navigation size={18} className="text-emerald-600" />
                      </div>
                    )}

                    {/* Status de Entrega Atual */}
                    {activeDeliveryForResident && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs flex items-center justify-between">
                        <div>
                          <span className="text-[9px] font-black uppercase text-amber-800">Entrega Cadastrada</span>
                          <p className="font-bold text-amber-950">{activeDeliveryForResident.status === 'IN_ROUTE' ? 'Em Rota com motorista' : 'Pendente na fila'}</p>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                      </div>
                    )}

                    {/* Ações */}
                    <div className="space-y-2 !mt-5">
                      {!isDriver && onSelectResidentForDelivery && (
                        <button
                          onClick={() => {
                            onSelectResidentForDelivery(resident);
                            setSelectedDetail(null);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-md shadow-blue-600/20 cursor-pointer"
                        >
                          <Plus size={15} /> Nova Entrega para este Morador
                        </button>
                      )}

                      {resident.phone && (
                        <a
                          href={`tel:${resident.phone}`}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl font-black uppercase tracking-wider text-xs transition-all shadow-sm"
                        >
                          <Phone size={14} /> Ligar ({resident.phone})
                        </a>
                      )}

                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 rounded-xl font-black uppercase tracking-wider text-xs transition-all"
                      >
                        <ExternalLink size={14} /> Abrir no Google Maps / Street View
                      </a>

                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${lat}, ${lng}`);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs border border-slate-200 transition-all cursor-pointer"
                      >
                        Copiar Coordenadas GPS
                      </button>
                    </div>
                  </div>
                );
              })()}

              {selectedDetail.type === 'user_location' && (() => {
                const pos = selectedDetail.data;
                return (
                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 text-base">Sua Localização</h3>
                    <p className="text-xs text-slate-500 leading-normal">Coordenadas estimadas via seu receptor GPS.</p>
                    
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 font-mono text-xs">
                      <p className="font-bold text-slate-700">LAT: {pos.lat?.toFixed(6)}</p>
                      <p className="font-bold text-slate-700 mt-1">LNG: {pos.lng?.toFixed(6)}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botão Compacto Flutuante de Camadas - Acima de Registrar Novo Local */}
      <div 
        className={`absolute ${isDriver ? 'bottom-[70px] sm:bottom-[84px] right-3 sm:right-5' : 'bottom-3 sm:bottom-5 right-3 sm:right-5'} z-[1040] pointer-events-auto`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowLayersModal(prev => {
              const next = !prev;
              if (next) handleUserActivity();
              return next;
            });
          }}
          className={`h-10 sm:h-11 px-3 sm:px-3.5 rounded-2xl shadow-xl backdrop-blur-md border flex items-center gap-2 transition-all active:scale-95 cursor-pointer text-xs font-bold ${
            showLayersModal 
              ? 'bg-blue-600 border-blue-400 text-white shadow-blue-500/25 ring-2 ring-blue-400/40' 
              : 'bg-slate-900/95 hover:bg-slate-800 text-white border-slate-700/80'
          }`}
          title={showLayersModal ? "Ocultar painel de camadas" : "Abrir painel de camadas"}
        >
          <div className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 ${showLayersModal ? 'bg-white/20 text-white' : 'bg-blue-500/20 text-blue-400'}`}>
            <Layers size={14} />
          </div>
          <span className="tracking-wide">Camadas</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black leading-none ${showLayersModal ? 'bg-white text-blue-900' : 'bg-blue-600 text-white'}`}>
            {activeLayersCount}
          </span>
        </button>
      </div>

      {/* Tela Grande de Seleção de Opções de Camadas que Diminui Automaticamente */}
      <AnimatePresence>
        {showLayersModal && (
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-5"
            onClick={() => setShowLayersModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 16 }}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              onMouseEnter={handleUserActivity}
              onMouseMove={handleUserActivity}
              onTouchStart={handleUserActivity}
              onTouchMove={handleUserActivity}
              onPointerDown={handleUserActivity}
              onScroll={handleUserActivity}
              onMouseLeave={() => {
                setIsInteractingWithModal(false);
              }}
              onTouchEnd={() => {
                if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
                idleTimerRef.current = setTimeout(() => setIsInteractingWithModal(false), 3000);
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleUserActivity();
              }}
              className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 max-w-xl w-full shadow-2xl border border-slate-200/90 max-h-[90vh] flex flex-col pointer-events-auto overflow-hidden relative"
            >
              {/* Barra de Progresso do Timer de Auto-Minimização (Pausada enquanto o usuário estiver mexendo) */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-100 overflow-hidden">
                <div 
                  style={{ width: isInteractingWithModal ? '100%' : `${(countdownSecs / 5) * 100}%` }}
                  className={`h-full transition-all duration-300 ${isInteractingWithModal ? 'bg-emerald-500' : 'bg-blue-600'}`}
                />
              </div>

              {/* Cabeçalho do Modal */}
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 mt-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200/50">
                    <Layers size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                        Camadas e Filtros do Mapa
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-100 text-blue-700">
                        {activeLayersCount} ativas
                      </span>
                    </div>
                    {isInteractingWithModal ? (
                      <p className="text-xs text-emerald-600 font-bold flex items-center gap-1.5 mt-0.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span>Configurando (não fecha enquanto você estiver mexendo)</span>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
                        <Clock size={12} className="text-slate-400 shrink-0" />
                        <span>Diminui automaticamente em <strong className="text-blue-600 font-bold">{countdownSecs}s</strong> sem toques</span>
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowLayersModal(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  title="Minimizar agora"
                >
                  <X size={15} />
                  <span className="hidden sm:inline">Minimizar</span>
                </button>
              </div>

              {/* Lista de Opções de Camadas */}
              <div className="py-3 space-y-2 overflow-y-auto max-h-[58vh] pr-1">
                {/* 1. Moradores Mapeados via GPS */}
                <div 
                  onClick={() => {
                    toggleFilter('residents');
                    handleUserActivity();
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] select-none ${
                    filters.residents 
                      ? 'bg-blue-50/70 border-blue-300 shadow-xs' 
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base font-bold ${filters.residents ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'}`}>
                      👤
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900">Moradores (GPS)</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black ${filters.residents ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {residentsWithCoords.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Casas e famílias mapeadas com GPS do celular
                      </p>
                    </div>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${filters.residents ? 'bg-blue-600' : 'bg-slate-300'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${filters.residents ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                {/* 2. Sítios Motoristas */}
                <div 
                  onClick={() => {
                    toggleFilter('driverSitios');
                    handleUserActivity();
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] select-none ${
                    filters.driverSitios 
                      ? 'bg-emerald-50/70 border-emerald-300 shadow-xs' 
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base font-bold ${filters.driverSitios ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'}`}>
                      🏠
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900">Sítios dos Motoristas</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black ${filters.driverSitios ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {driverSitiosWithCoords.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Localização dos sítios onde os motoristas residem
                      </p>
                    </div>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${filters.driverSitios ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${filters.driverSitios ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                {/* 3. Pontos Gerais */}
                <div 
                  onClick={() => {
                    toggleFilter('sitios');
                    handleUserActivity();
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] select-none ${
                    filters.sitios 
                      ? 'bg-purple-50/70 border-purple-300 shadow-xs' 
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base font-bold ${filters.sitios ? 'bg-purple-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'}`}>
                      📍
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900">Pontos Gerais / Escolas / Creches</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black ${filters.sitios ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {filteredSitios.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Escolas, creches municipais e pontos comunitários
                      </p>
                    </div>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${filters.sitios ? 'bg-purple-600' : 'bg-slate-300'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${filters.sitios ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                {/* 4. Entregas Concluídas GPS */}
                <div 
                  onClick={() => {
                    toggleFilter('delivered');
                    handleUserActivity();
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] select-none ${
                    filters.delivered 
                      ? 'bg-teal-50/70 border-teal-300 shadow-xs' 
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base font-bold ${filters.delivered ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'}`}>
                      ✓
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900">Entregas Concluídas (GPS)</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black ${filters.delivered ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {filteredDeliveries.filter(d => d.status === 'DELIVERED').length}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Pontos de entrega de água finalizadas com coordenadas
                      </p>
                    </div>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${filters.delivered ? 'bg-teal-600' : 'bg-slate-300'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${filters.delivered ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                {/* 5. Caminhões */}
                <div 
                  onClick={() => {
                    toggleFilter('trucks');
                    handleUserActivity();
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] select-none ${
                    filters.trucks 
                      ? 'bg-amber-50/70 border-amber-300 shadow-xs' 
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base font-bold ${filters.trucks ? 'bg-amber-500 text-slate-950 shadow-xs' : 'bg-slate-200 text-slate-600'}`}>
                      🚛
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900">Caminhões Pipas</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black ${filters.trucks ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {filteredTrucks.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Veículos da Operação Pipa com rastreamento GPS
                      </p>
                    </div>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${filters.trucks ? 'bg-amber-500' : 'bg-slate-300'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${filters.trucks ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                {/* 6. Modo Satélite vs Vias */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">
                        🗺️
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-800">Visualização do Terreno</span>
                        <p className="text-[10px] text-slate-500">
                          {mapLayer === 'satellite' ? 'Visão Satélite em alta resolução' : 'Mapa padrão de estradas e vias'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setMapLayer('osmand');
                          handleUserActivity();
                        }}
                        className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${
                          mapLayer === 'osmand' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Vias
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMapLayer('satellite');
                          handleUserActivity();
                        }}
                        className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${
                          mapLayer === 'satellite' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Satélite
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rodapé com Ações Rápidas */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
                <button
                  type="button"
                  onClick={() => {
                    const allActive = filters.residents && filters.driverSitios && filters.sitios && filters.delivered && filters.trucks;
                    setFilters(prev => ({
                      ...prev,
                      residents: !allActive,
                      driverSitios: !allActive,
                      sitios: !allActive,
                      delivered: !allActive,
                      trucks: !allActive
                    }));
                    handleUserActivity();
                  }}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                >
                  {filters.residents && filters.driverSitios && filters.sitios && filters.delivered && filters.trucks
                    ? 'Desmarcar Todos'
                    : 'Marcar Todos'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowLayersModal(false)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <span>Concluir</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Caixa de Diálogo Completa: Selecionar Motorista para Rastrear */}
      <AnimatePresence>
        {showDriverSelectorModal && (
          <div 
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[2100] flex items-center justify-center p-2.5 sm:p-5 overflow-y-auto"
            onClick={() => setShowDriverSelectorModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 14 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.95, opacity: 0, y: 14 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-7 max-w-4xl w-full shadow-2xl my-auto border border-slate-200/90 max-h-[92vh] flex flex-col pointer-events-auto"
            >
              {/* Header */}
              <div className="flex justify-between items-start gap-2 pb-3 sm:pb-4 border-b border-slate-100 flex-shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse shrink-0" />
                    <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-blue-600">Rastreamento de Frota</span>
                  </div>
                  <h3 className="text-base sm:text-2xl font-extrabold text-slate-900 tracking-tight mt-0.5 leading-snug">
                    Selecionar Motorista para Rastrear
                  </h3>
                  <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                    Exibindo todos os <strong>{trucks.length}</strong> motoristas e caminhões cadastrados.
                  </p>
                </div>
                <button 
                  onClick={() => setShowDriverSelectorModal(false)} 
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
              </div>

              {/* Search & Filters */}
              <div className="py-2.5 sm:py-3.5 space-y-2 flex-shrink-0 border-b border-slate-100">
                <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 sm:py-2.5 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all">
                  <Search size={15} className="text-slate-400 mr-2 shrink-0" />
                  <input
                    type="text"
                    value={driverModalSearch}
                    onChange={(e) => setDriverModalSearch(e.target.value)}
                    placeholder="Buscar por nome ou placa..."
                    className="w-full bg-transparent text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 outline-none font-medium min-w-0"
                  />
                  {driverModalSearch && (
                    <button
                      onClick={() => setDriverModalSearch('')}
                      className="text-slate-400 hover:text-slate-600 p-0.5 shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Filter Tabs */}
                <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                  {[
                    { id: 'ALL', label: `Todos (${trucks.length})` },
                    { id: 'IN_ROUTE', label: `Em Rota (${trucks.filter(t => t.status === 'IN_ROUTE').length})` },
                    { id: 'IDLE', label: `Disponíveis (${trucks.filter(t => t.status !== 'IN_ROUTE').length})` },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDriverModalFilter(tab.id as any)}
                      className={`px-2 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold text-center transition-all cursor-pointer leading-tight ${
                        driverModalFilter === tab.id
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Drivers List */}
              <div className="flex-1 overflow-y-auto py-3 pr-0.5 sm:pr-1 custom-scrollbar">
                {filteredModalTrucks.length === 0 ? (
                  <div className="text-center py-10 space-y-2">
                    <TruckIcon size={36} className="text-slate-300 mx-auto" />
                    <p className="text-xs font-semibold text-slate-500">Nenhum motorista encontrado com os filtros aplicados.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
                    {filteredModalTrucks.map(truck => {
                      const hasGPS = typeof truck.lastLat === 'number' && typeof truck.lastLng === 'number';
                      const activeDelivery = deliveries.find(d => d.truckId === truck.id && (d.status === 'IN_ROUTE' || d.status === 'PENDING'));
                      const isSelected = selectedTruckId === truck.id;

                      return (
                        <div 
                          key={truck.id}
                          className={`p-3 sm:p-4 rounded-2xl border transition-all flex flex-col justify-between gap-2.5 ${
                            isSelected
                              ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/20 shadow-xs'
                              : 'bg-slate-50/60 hover:bg-blue-50/30 border-slate-200/90 shadow-xs'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-bold text-xs sm:text-sm text-slate-900 break-words">
                                {truck.driverName || 'Motorista Não Nomeado'}
                              </h4>
                              <span className="font-mono text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 shadow-xs">
                                {truck.plate || 'SEM PLACA'}
                              </span>
                              <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                truck.status === 'IN_ROUTE' 
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                                  : truck.status === 'ARRIVED'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-slate-200/80 text-slate-700'
                              }`}>
                                {truck.status === 'IN_ROUTE' ? 'Em Rota' : truck.status === 'ARRIVED' ? 'No Local' : 'Disponível'}
                              </span>
                            </div>

                            <div className="mt-1.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-[11px] sm:text-xs text-slate-500 flex-wrap">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${hasGPS ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                <span className={hasGPS ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                                  {hasGPS ? `GPS Ativo (${truck.lastLat?.toFixed(4)}, ${truck.lastLng?.toFixed(4)})` : 'Aguardando sinal GPS'}
                                </span>
                              </span>

                              {activeDelivery ? (
                                <span className="text-slate-600 break-words leading-snug">
                                  📍 Destino: <strong className="text-slate-800">{activeDelivery.residentName}</strong> ({activeDelivery.address})
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Disponível para nova entrega</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100/80">
                            <button
                              onClick={async () => {
                                if (hasGPS && truck.lastLat && truck.lastLng) {
                                  setMapFlyTarget([truck.lastLat, truck.lastLng]);
                                  setAutoTrack(true);
                                  if (activeDelivery) {
                                    setIsCalculatingRoad(true);
                                    const road = await fetchRoadRoute([
                                      [truck.lastLat, truck.lastLng],
                                      [activeDelivery.lat, activeDelivery.lng]
                                    ]);
                                    setIsCalculatingRoad(false);
                                    if (road && isRoadRoute(road)) {
                                      setActiveRoadRoute(road);
                                      setShowRouteControls(true);
                                    }
                                  }
                                }
                                setSelectedDetail({ type: 'truck', data: truck });
                                setShowDriverSelectorModal(false);
                              }}
                              className={`w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-xs ${
                                hasGPS
                                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                  : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                              }`}
                            >
                              <LocateFixed size={14} className={hasGPS ? "text-white" : "text-slate-500"} />
                              <span>{hasGPS ? 'Rastrear no Mapa' : 'Selecionar'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
